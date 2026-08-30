// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Modifier groups: the reusable choice sets a menu item can carry.
//
// Reusable on purpose. "Milk" is one group attached to every coffee, not a
// copy per item — otherwise adding oat milk means editing fourteen documents
// and missing one. Items reference groups by id; a check line snapshots what
// was chosen (see ModifierSelection in app/lib/modifiers.ts).

import { FieldValue } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { MODIFIER_LIMITS, type ModifierGroup, type ModifierOption } from '../modifiers'

const COLLECTION = 'modifierGroups'

export interface ModifierGroupInput {
  name: string
  minSelections: number
  maxSelections: number
  options: ModifierOption[]
  sortOrder: number
}

function text(raw: unknown, label: string, maxLen = MODIFIER_LIMITS.nameLength): string {
  const v = String(raw ?? '').trim()
  if (!v) throw new HttpError(400, `${label} is required.`)
  return v.slice(0, maxLen)
}

function whole(raw: unknown, label: string, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${label} must be a whole number between ${min} and ${max}.`)
  }
  return n
}

/**
 * Validates a group, preserving option ids that already exist.
 *
 * `existing` is the stored group on an update. An option that keeps its id
 * keeps it; a genuinely new one gets a fresh uuid here rather than accepting
 * whatever the browser sent, so a caller cannot make two options share an id
 * or reuse one from a different group.
 */
export function parseModifierGroupInput(
  body: Record<string, unknown>,
  existing?: ModifierGroup,
): ModifierGroupInput {
  const name = text(body.name, 'Group name')

  const rawOptions = Array.isArray(body.options) ? body.options : []
  if (rawOptions.length === 0) throw new HttpError(400, 'A group needs at least one option.')
  if (rawOptions.length > MODIFIER_LIMITS.optionsPerGroup) {
    throw new HttpError(400, `A group can hold at most ${MODIFIER_LIMITS.optionsPerGroup} options.`)
  }

  const knownIds = new Set((existing?.options ?? []).map(o => o.id))
  const usedIds = new Set<string>()
  const seenNames = new Set<string>()

  const options: ModifierOption[] = rawOptions.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>
    const optionName = text(o.name, `Option ${i + 1}`)

    // Two options reading the same is not a validation nicety — the waiter's
    // list would show the same word twice with no way to tell them apart.
    const key = optionName.toLowerCase()
    if (seenNames.has(key)) {
      throw new HttpError(400, `Two options are both called "${optionName}".`)
    }
    seenNames.add(key)

    const delta = Number(o.priceDelta ?? 0)
    if (!Number.isFinite(delta) || delta < 0 || delta > MODIFIER_LIMITS.maxPriceDelta) {
      throw new HttpError(400,
        `"${optionName}": the extra charge must be between 0 and ${MODIFIER_LIMITS.maxPriceDelta.toLocaleString()}. ` +
        'A modifier cannot take money off a line — price the item at its lower size and charge for the larger one.')
    }

    const sentId = typeof o.id === 'string' ? o.id : ''
    const id = sentId && knownIds.has(sentId) && !usedIds.has(sentId) ? sentId : randomUUID()
    usedIds.add(id)

    return { id, name: optionName, priceDelta: Math.round(delta * 100) / 100 }
  })

  const maxSelections = whole(body.maxSelections, 'Maximum selections', 1, options.length)
  const minSelections = whole(body.minSelections, 'Minimum selections', 0, options.length)
  if (minSelections > maxSelections) {
    throw new HttpError(400, 'The minimum cannot be more than the maximum.')
  }

  return {
    name,
    minSelections,
    maxSelections,
    options,
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
  }
}

export async function readModifierGroup(id: string): Promise<ModifierGroup> {
  const snap = await adminDb().doc(`${COLLECTION}/${id}`).get()
  if (!snap.exists) throw new HttpError(404, 'That modifier group no longer exists.')
  return { id: snap.id, ...(snap.data() as Omit<ModifierGroup, 'id'>) }
}

export async function createModifierGroup(input: ModifierGroupInput): Promise<{ id: string }> {
  const ref = await adminDb().collection(COLLECTION).add({
    ...input,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
}

export async function updateModifierGroup(
  id: string,
  input: ModifierGroupInput,
): Promise<{ before: ModifierGroup }> {
  const before = await readModifierGroup(id)
  await adminDb().doc(`${COLLECTION}/${id}`).update({
    ...input,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { before }
}

/**
 * Deletes a group, refusing while any menu item still uses it.
 *
 * Same shape as the media library's delete, and for the same reason: the
 * alternative is an item referencing a group that no longer exists, which
 * fails at the worst possible moment — a waiter mid-order, on a phone, with a
 * customer waiting.
 */
export async function deleteModifierGroup(id: string): Promise<{ name: string; usedBy: string[] }> {
  const group = await readModifierGroup(id)

  const users = await adminDb().collection('menuItems')
    .where('modifierGroupIds', 'array-contains', id).get()
  const usedBy = users.docs.map(d => String(d.data().name ?? d.id))

  if (usedBy.length > 0) {
    throw new HttpError(409,
      `"${group.name}" is still used by ${usedBy.length} menu item${usedBy.length === 1 ? '' : 's'} — ` +
      `${usedBy.slice(0, 3).join(', ')}${usedBy.length > 3 ? `, and ${usedBy.length - 3} more` : ''}. ` +
      'Remove it from those first.')
  }

  await adminDb().doc(`${COLLECTION}/${id}`).delete()
  return { name: group.name, usedBy }
}

/**
 * Attaches groups to a menu item, in the order the waiter will see them.
 *
 * Every id is checked to exist. A menu item pointing at a group that was
 * never created renders as a silently missing choice, and the first person to
 * notice is whoever gets the wrong drink.
 */
export async function setItemModifierGroups(
  itemId: string,
  groupIds: string[],
): Promise<{ itemName: string; before: string[]; after: string[] }> {
  const db = adminDb()

  const unique = [...new Set(groupIds.filter(g => typeof g === 'string' && g))]
  if (unique.length > MODIFIER_LIMITS.groupsPerItem) {
    throw new HttpError(400,
      `An item can carry at most ${MODIFIER_LIMITS.groupsPerItem} modifier groups.`)
  }

  const itemRef = db.doc(`menuItems/${itemId}`)
  const itemSnap = await itemRef.get()
  if (!itemSnap.exists) throw new HttpError(404, 'That menu item no longer exists.')

  if (unique.length > 0) {
    const snaps = await db.getAll(...unique.map(g => db.doc(`${COLLECTION}/${g}`)))
    const missing = snaps.filter(s => !s.exists).length
    if (missing > 0) {
      throw new HttpError(400, `${missing} of those modifier groups no longer exist.`)
    }
  }

  const data = itemSnap.data() ?? {}
  const before = Array.isArray(data.modifierGroupIds) ? data.modifierGroupIds as string[] : []

  await itemRef.update({
    modifierGroupIds: unique,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { itemName: String(data.name ?? itemId), before, after: unique }
}
