// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The ordering setup: who we buy from, and the list of things we order.
//
// Neither of these moves money directly, which is why they sat in the browser
// this long. What they do is worse in a quieter way: they are the spine the
// weekly order and the delivery both hang off, and deleting from either end
// breaks a chain nothing reports on.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { BRANCHES } from '../branches'

function text(raw: unknown, label: string, { required = false, maxLen = 200 } = {}): string {
  const v = String(raw ?? '').trim()
  if (required && !v) throw new HttpError(400, `${label} is required.`)
  return v.slice(0, maxLen)
}

// ── Providers ─────────────────────────────────────────────────────────────

export interface ProviderInput {
  name: string
  phones: Record<string, string>
  categories: string[]
  notes: string
}

export function parseProviderInput(body: Record<string, unknown>): ProviderInput {
  const rawPhones = (body.phones ?? {}) as Record<string, unknown>
  // Keyed to the configured branches only. A phone filed under a branch that
  // does not exist is a number nobody will ever be shown — the order screen
  // looks it up by the branch it is ordering for.
  const phones: Record<string, string> = {}
  for (const b of BRANCHES) phones[b] = text(rawPhones[b], `Phone for ${b}`, { maxLen: 40 })

  const rawCategories = Array.isArray(body.categories) ? body.categories : []
  return {
    name: text(body.name, 'Provider name', { required: true }),
    phones,
    categories: rawCategories.map(c => text(c, 'Category', { maxLen: 100 })).filter(Boolean),
    notes: text(body.notes, 'Notes', { maxLen: 2000 }),
  }
}

export async function createProvider(input: ProviderInput): Promise<{ id: string }> {
  const ref = await adminDb().collection('orderProviders').add({
    ...input, createdAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
}

export async function updateProvider(id: string, input: ProviderInput): Promise<{ before: Record<string, unknown> }> {
  const ref = adminDb().doc(`orderProviders/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That provider no longer exists.')
  await ref.update({ ...input })
  return { before: snap.data() ?? {} }
}

/**
 * Deletes a provider, refusing while anything still orders from them.
 *
 * The template groups its items by provider. Deleting one out from under its
 * items left them pointing at an id that resolves to nothing — they do not
 * error, they simply stop appearing under a supplier heading, which is the
 * kind of disappearance nobody notices until an order goes out short.
 */
export async function deleteProvider(id: string): Promise<{ name: string }> {
  const db = adminDb()
  const ref = db.doc(`orderProviders/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That provider no longer exists.')

  const used = await db.collection('orderTemplateItems').where('providerId', '==', id).get()
  if (!used.empty) {
    const names = used.docs.slice(0, 3).map(d => String(d.data().name ?? d.id))
    const more = used.size > 3 ? `, and ${used.size - 3} more` : ''
    throw new HttpError(409,
      `${used.size} order item${used.size === 1 ? '' : 's'} still come${used.size === 1 ? 's' : ''} from this supplier — ${names.join(', ')}${more}. Move them to another supplier first.`)
  }

  const name = String(snap.data()?.name ?? id)
  await ref.delete()
  return { name }
}

// ── Template items ────────────────────────────────────────────────────────

export interface TemplateItemInput {
  name: string
  nameAr: string | null
  department: string
  category: string
  unit: string
  providerId: string | null
  supplyId: string | null
}

export function parseTemplateItemInput(body: Record<string, unknown>): TemplateItemInput {
  return {
    name: text(body.name, 'Item name', { required: true }),
    nameAr: body.nameAr ? text(body.nameAr, 'Arabic name') : null,
    department: text(body.department, 'Department', { required: true, maxLen: 100 }),
    category: text(body.category, 'Category', { maxLen: 100 }),
    unit: text(body.unit, 'Unit', { maxLen: 50 }),
    providerId: body.providerId ? text(body.providerId, 'Provider', { maxLen: 128 }) : null,
    supplyId: body.supplyId ? text(body.supplyId, 'Supply', { maxLen: 128 }) : null,
  }
}

export async function createTemplateItem(input: TemplateItemInput): Promise<{ id: string }> {
  const ref = await adminDb().collection('orderTemplateItems').add({
    ...input, createdAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
}

export async function updateTemplateItem(
  id: string,
  input: TemplateItemInput,
): Promise<{ before: Record<string, unknown> }> {
  const ref = adminDb().doc(`orderTemplateItems/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That item no longer exists.')
  await ref.update({ ...input })
  return { before: snap.data() ?? {} }
}

/**
 * Deletes a template item, refusing while an order is still waiting on it.
 *
 * This is the guard that matters. Receiving resolves a delivery's lines by
 * looking each ordered item's templateId up in the template — and an item it
 * cannot find is DROPPED, not flagged, because a line with no supply behind it
 * can move no stock. So deleting a template item that a submitted order still
 * references silently removes that line from the delivery: the goods arrive,
 * nobody records them, and the shortfall turns up weeks later at a count with
 * no explanation.
 *
 * "Still waiting" means a weekly order references it and nothing has been
 * received against that order yet. Once a delivery exists the order is
 * history, and history keeps its own copy of the line.
 */
export async function deleteTemplateItem(id: string): Promise<{ name: string }> {
  const db = adminDb()
  const ref = db.doc(`orderTemplateItems/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That item no longer exists.')

  const [reports, deliveries] = await Promise.all([
    db.collection('weeklyOrderReports').get(),
    db.collection('deliveries').get(),
  ])
  const receivedAgainst = new Set(
    deliveries.docs.map(d => d.data().orderReportId).filter(Boolean)
  )
  const waiting = reports.docs.filter(r => {
    if (receivedAgainst.has(r.id)) return false
    const items = (r.data().items ?? []) as { templateId?: string }[]
    return items.some(i => i.templateId === id)
  })

  if (waiting.length > 0) {
    throw new HttpError(409,
      `${waiting.length} submitted order${waiting.length === 1 ? '' : 's'} still include${waiting.length === 1 ? 's' : ''} this item and ${waiting.length === 1 ? 'has' : 'have'} not been received yet. Receive ${waiting.length === 1 ? 'it' : 'them'} first, or the delivery will quietly arrive a line short.`)
  }

  const name = String(snap.data()?.name ?? id)
  await ref.delete()
  return { name }
}
