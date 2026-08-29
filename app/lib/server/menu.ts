// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The menu: sections, categories and the items customers see priced.
//
// This is the most public surface in the platform. A price here is what a
// customer reads before ordering, and until now the browser could write any
// value it liked into one — the save handler spread the form object straight
// into Firestore with nothing between.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'

/** Kept in step with the Section union in app/admin/menu/page.tsx. */
export const SECTIONS = ['Food', 'Beverage', 'Sweets'] as const
export type Section = typeof SECTIONS[number]

// A café menu has no business carrying a five-figure price, and a bound this
// generous still catches the decimal-point slips that matter.
const MAX_PRICE = 10_000

function text(raw: unknown, label: string, { required = false, maxLen = 200 } = {}): string {
  const v = String(raw ?? '').trim()
  if (required && !v) throw new HttpError(400, `${label} is required.`)
  return v.slice(0, maxLen)
}

// ── Categories ────────────────────────────────────────────────────────────

export interface CategoryInput {
  name: string
  section: Section
  image: string
}

export function parseCategoryInput(body: Record<string, unknown>): CategoryInput {
  const section = String(body.section ?? '')
  if (!(SECTIONS as readonly string[]).includes(section)) {
    throw new HttpError(400, `Unknown section: ${section || '(none)'}. Expected one of ${SECTIONS.join(', ')}.`)
  }
  return {
    name: text(body.name, 'Category name', { required: true, maxLen: 100 }),
    section: section as Section,
    image: text(body.image, 'Image', { maxLen: 2000 }),
  }
}

export async function createCategory(input: CategoryInput): Promise<{ id: string }> {
  const db = adminDb()
  // Position counted here, not sent. The browser sent the length of the list
  // it happened to be holding, so two people adding a category at the same
  // time both landed on the same order value.
  const siblings = await db.collection('menuCategories').where('section', '==', input.section).get()
  const ref = await db.collection('menuCategories').add({
    ...input,
    order: siblings.size,
    createdAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
}

export async function updateCategory(id: string, input: CategoryInput): Promise<{ before: Record<string, unknown> }> {
  const ref = adminDb().doc(`menuCategories/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That category no longer exists.')
  await ref.update({ ...input, updatedAt: FieldValue.serverTimestamp() })
  return { before: snap.data() ?? {} }
}

/**
 * Deletes a category and everything in it.
 *
 * The cascade is deliberate and the confirmation says so. What changed is
 * where the list of items comes from: the browser used to delete whichever
 * items were in the array it had loaded, so anything added to that category
 * since the page opened survived the delete and became an orphan — a menu
 * item belonging to a category that no longer exists, which nothing lists and
 * nothing cleans up.
 *
 * Queried and chunked here, because a Firestore batch caps at 500 writes and
 * a large menu would otherwise fail at the boundary rather than at the point
 * of asking.
 */
export async function deleteCategory(id: string): Promise<{ name: string; itemsDeleted: number }> {
  const db = adminDb()
  const ref = db.doc(`menuCategories/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That category no longer exists.')

  const items = await db.collection('menuItems').where('categoryId', '==', id).get()

  const CHUNK = 400
  for (let i = 0; i < items.docs.length; i += CHUNK) {
    const batch = db.batch()
    items.docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
  await ref.delete()

  return { name: String(snap.data()?.name ?? id), itemsDeleted: items.size }
}

// ── Items ─────────────────────────────────────────────────────────────────

export interface MenuItemInput {
  name: string
  description: string
  price: number
  categoryId: string
  badge: string
  available: boolean
}

export function parseMenuItemInput(body: Record<string, unknown>): MenuItemInput {
  const price = Number(body.price)
  // Zero is legitimate — tap water, a free refill. Negative is not, and
  // neither is a price that arrived as text.
  if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) {
    throw new HttpError(400, `Price must be a number between 0 and ${MAX_PRICE.toLocaleString()}.`)
  }
  return {
    name: text(body.name, 'Item name', { required: true }),
    description: text(body.description, 'Description', { maxLen: 1000 }),
    price: Math.round(price * 100) / 100,
    categoryId: text(body.categoryId, 'Category', { required: true, maxLen: 128 }),
    badge: text(body.badge, 'Badge', { maxLen: 50 }),
    available: body.available !== false,
  }
}

export async function createMenuItem(input: MenuItemInput): Promise<{ id: string }> {
  const db = adminDb()
  // An item whose category does not exist renders nowhere — the menu groups
  // strictly by category — so it would be invisible and unreported.
  if (!(await db.doc(`menuCategories/${input.categoryId}`).get()).exists) {
    throw new HttpError(400, 'That category no longer exists — reload before adding items to it.')
  }
  const siblings = await db.collection('menuItems').where('categoryId', '==', input.categoryId).get()
  const ref = await db.collection('menuItems').add({
    ...input,
    order: siblings.size,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
}

export async function updateMenuItem(id: string, input: MenuItemInput): Promise<{ before: Record<string, unknown> }> {
  const ref = adminDb().doc(`menuItems/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That item no longer exists.')
  await ref.update({ ...input, updatedAt: FieldValue.serverTimestamp() })
  return { before: snap.data() ?? {} }
}

export async function deleteMenuItem(id: string): Promise<{ name: string; before: Record<string, unknown> }> {
  const ref = adminDb().doc(`menuItems/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That item no longer exists.')
  const before = snap.data() ?? {}
  await ref.delete()
  return { name: String(before.name ?? id), before }
}

/**
 * Applies a drag-to-reorder.
 *
 * Takes the ids in their new order and writes positions from the index, so
 * the browser decides the ARRANGEMENT and the server decides the numbers.
 * Every id is checked to belong to the category being reordered — otherwise
 * a request could renumber items in a category it was not looking at.
 */
export async function reorderMenuItems(categoryId: string, orderedIds: string[]): Promise<{ moved: number }> {
  const db = adminDb()
  const items = await db.collection('menuItems').where('categoryId', '==', categoryId).get()
  const known = new Set(items.docs.map(d => d.id))

  const stray = orderedIds.filter(id => !known.has(id))
  if (stray.length > 0) {
    throw new HttpError(400, 'That list contains items from another category — reload and try again.')
  }

  const batch = db.batch()
  orderedIds.forEach((id, index) => batch.update(db.doc(`menuItems/${id}`), { order: index }))
  await batch.commit()
  return { moved: orderedIds.length }
}
