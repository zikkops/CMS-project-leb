// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Reading and writing what a branch's till shows (UPGRADE.md T7.20). The rules
// are shared/src/posLayout.ts; this writes `posHidden.<branch>` on
// `menuCategories/{id}` and `menuItems/{id}`, the same shape and the same two
// collections soldOut already uses.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { BRANCHES } from '../branches'
import { layoutChanges, layoutCounts, readPosHidden } from '../posLayout'

export interface LayoutDoc { id: string; name: string; posHidden?: unknown }
export interface LayoutItemDoc extends LayoutDoc { categoryId: string; available: boolean }

export interface PosLayoutView {
  branch: string
  categories: { id: string; name: string; section: string; hidden: boolean }[]
  items: { id: string; name: string; categoryId: string; available: boolean; hidden: boolean }[]
  counts: ReturnType<typeof layoutCounts>
}

function checkBranch(branch: string): string {
  // A branch id is a document field path segment here, so a dot would write
  // into a nested map instead of the branch's own key.
  if (!(BRANCHES as readonly string[]).includes(branch) || branch.includes('.')) {
    throw new HttpError(400, `Unknown branch: ${branch || '(none)'}`)
  }
  return branch
}

export async function readPosLayout(branch: string): Promise<PosLayoutView> {
  checkBranch(branch)
  const db = adminDb()
  const [cats, items] = await Promise.all([
    db.collection('menuCategories').get(),
    db.collection('menuItems').get(),
  ])
  const categories = cats.docs.map(d => ({
    id: d.id,
    name: String(d.data().name ?? ''),
    section: String(d.data().section ?? ''),
    posHidden: d.data().posHidden,
  }))
  const menuItems = items.docs.map(d => ({
    id: d.id,
    name: String(d.data().name ?? ''),
    categoryId: String(d.data().categoryId ?? ''),
    available: d.data().available !== false,
    posHidden: d.data().posHidden,
  }))
  return {
    branch,
    categories: categories
      .map(c => ({ id: c.id, name: c.name, section: c.section, hidden: readPosHidden(c.posHidden)[branch] === true }))
      .sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name)),
    items: menuItems
      .map(i => ({ id: i.id, name: i.name, categoryId: i.categoryId, available: i.available, hidden: readPosHidden(i.posHidden)[branch] === true }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    counts: layoutCounts(categories, menuItems, branch),
  }
}

/**
 * Saves the whole state the page is looking at, writing only what moved.
 *
 * The page sends every id it wants hidden, not a list of changes: two people
 * with the page open then cannot half-apply each other's work, and a save that
 * is sent twice does the same thing as a save sent once. Unhiding DELETES the
 * branch's key rather than storing false, so a document that has never been
 * hidden anywhere carries no posHidden at all.
 */
export async function savePosLayout(
  branch: string,
  hiddenCategories: readonly string[],
  hiddenItems: readonly string[],
): Promise<{ changed: number; counts: ReturnType<typeof layoutCounts> }> {
  checkBranch(branch)
  const db = adminDb()
  const [cats, items] = await Promise.all([
    db.collection('menuCategories').get(),
    db.collection('menuItems').get(),
  ])
  const catDocs = cats.docs.map(d => ({ id: d.id, posHidden: d.data().posHidden }))
  const itemDocs = items.docs.map(d => ({ id: d.id, categoryId: String(d.data().categoryId ?? ''), posHidden: d.data().posHidden }))

  const catMoves = layoutChanges(catDocs, hiddenCategories, branch)
  const itemMoves = layoutChanges(itemDocs, hiddenItems, branch)
  const changed = catMoves.hide.length + catMoves.show.length + itemMoves.hide.length + itemMoves.show.length
  if (changed === 0) {
    return { changed: 0, counts: layoutCounts(catDocs.map(c => ({ ...c })), itemDocs, branch) }
  }

  const batch = db.batch()
  const field = `posHidden.${branch}`
  for (const id of catMoves.hide) batch.update(db.doc(`menuCategories/${id}`), { [field]: true })
  for (const id of catMoves.show) batch.update(db.doc(`menuCategories/${id}`), { [field]: FieldValue.delete() })
  for (const id of itemMoves.hide) batch.update(db.doc(`menuItems/${id}`), { [field]: true })
  for (const id of itemMoves.show) batch.update(db.doc(`menuItems/${id}`), { [field]: FieldValue.delete() })
  await batch.commit()

  // Counted from what was just written, not from what was read before it.
  const hiddenCats = new Set(hiddenCategories)
  const hiddenIds = new Set(hiddenItems)
  const after = layoutCounts(
    catDocs.map(c => ({ id: c.id, posHidden: hiddenCats.has(c.id) ? { [branch]: true } : {} })),
    itemDocs.map(i => ({ id: i.id, categoryId: i.categoryId, posHidden: hiddenIds.has(i.id) ? { [branch]: true } : {} })),
    branch,
  )
  return { changed, counts: after }
}
