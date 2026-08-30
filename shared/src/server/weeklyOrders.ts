// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Weekly ordering: the submitted order a branch sends its suppliers, and the
// provider/template catalogue behind it.
//
// This is the front half of the Phase 01 chain. A weekly order is what a
// delivery is later received against, so a report that is wrong, or quietly
// edited by two people at once, propagates into stock and cost.
//
// ── The bug worth naming ──────────────────────────────────────────────────
// updateReportItemQty() took the ENTIRE items array from the browser, mapped
// over it to change one line, and wrote the whole array back. The client held
// the authoritative copy between read and write, so two people editing the
// same order — which is the normal case, a kitchen lead and a manager on the
// same Sunday — silently lost one set of edits. Whoever saved second won, with
// no conflict and no error.
//
// Here the line is updated from the STORED document, so a concurrent edit to a
// different line survives.

import { FieldValue, FieldPath } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRANCHES } from '../branches'

const DEPARTMENTS = ['Kitchen', 'Bar', 'Cleaning'] as const

function assertBranch(caller: Caller, branch: string): void {
  if (caller.role === 'admin') return
  if (caller.branchIds.length === 0) return
  if (!caller.branchIds.includes(branch)) {
    throw new HttpError(403, 'That branch is not one of yours.')
  }
}

function qty(v: unknown, label: string): number {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label} must be a non-negative number.`)
  if (n > 100_000) throw new HttpError(400, `${label} is implausibly large.`)
  return n
}

// ── Submitting an order ───────────────────────────────────────────────────

export interface SubmitInput {
  branch: string
  weekStart: string
  weekLabel: string
  department?: string
  items: { templateId: string; quantity: number }[]
  notes: string
}

export function parseSubmitInput(body: Record<string, unknown>): SubmitInput {
  const branch = typeof body.branch === 'string' ? body.branch.trim() : ''
  if (!(BRANCHES as readonly string[]).includes(branch)) {
    throw new HttpError(400, `Unknown branch: ${branch || '(none)'}`)
  }

  const weekStart = typeof body.weekStart === 'string' ? body.weekStart.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new HttpError(400, 'weekStart must be YYYY-MM-DD.')

  const department = typeof body.department === 'string' ? body.department.trim() : ''
  if (department && !(DEPARTMENTS as readonly string[]).includes(department)) {
    throw new HttpError(400, `Unknown department: ${department}`)
  }

  const raw = Array.isArray(body.items) ? body.items : []
  if (raw.length === 0) throw new HttpError(400, 'An order needs at least one line.')

  const items = raw.map((row, i) => {
    const r = (row ?? {}) as Record<string, unknown>
    const templateId = typeof r.templateId === 'string' ? r.templateId.trim() : ''
    if (!templateId) throw new HttpError(400, `Line ${i + 1} is missing its template item.`)
    return { templateId, quantity: qty(r.quantity, `Line ${i + 1} quantity`) }
  })

  return {
    branch,
    weekStart,
    weekLabel: String(body.weekLabel ?? '').slice(0, 120),
    department: department || undefined,
    items,
    notes: String(body.notes ?? '').slice(0, 5000),
  }
}

/**
 * Submit a weekly order.
 *
 * The request names template items and quantities; every other field on a line
 * — name, unit, category, provider, pack size — is read from the template
 * document here. The client used to send the whole line, so a browser could
 * submit an order for an item that never existed, or attribute one to the
 * wrong supplier.
 */
export async function submitWeeklyOrder(caller: Caller, input: SubmitInput): Promise<{ id: string; lines: number }> {
  assertBranch(caller, input.branch)
  const db = adminDb()

  const refs = input.items.map(i => db.doc(`orderTemplateItems/${i.templateId}`))
  const snaps = await db.getAll(...refs)

  const items = snaps.map((snap, i) => {
    if (!snap.exists) throw new HttpError(404, 'An item on this order is no longer in the template.')
    const t = snap.data() ?? {}
    return {
      templateId: input.items[i].templateId,
      name: t.name ?? '',
      department: t.department ?? input.department ?? null,
      quantity: input.items[i].quantity,
      unit: t.unit ?? '',
      ...(t.category ? { category: t.category } : {}),
      ...(t.providerId ? { providerId: t.providerId } : {}),
      ...(t.packSize != null ? { packSize: t.packSize } : {}),
      ...(t.packUnit ? { packUnit: t.packUnit } : {}),
    }
  })

  const ref = await db.collection('weeklyOrderReports').add({
    branch: input.branch,
    weekStart: input.weekStart,
    weekLabel: input.weekLabel,
    ...(input.department ? { department: input.department } : {}),
    items,
    notes: input.notes,
    submittedBy: caller.uid,
    submittedByEmail: caller.email ?? '',
    submittedAt: FieldValue.serverTimestamp(),
  })

  return { id: ref.id, lines: items.length }
}

// ── Editing a submitted order ─────────────────────────────────────────────

export async function updateReportItemQty(
  caller: Caller,
  reportId: string,
  templateId: string,
  quantity: number,
): Promise<{ branch: string; name: string; before: number; after: number }> {
  const amount = qty(quantity, 'Quantity')
  const db = adminDb()
  const ref = db.doc(`weeklyOrderReports/${reportId}`)

  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That order no longer exists.')

    const data = snap.data() ?? {}
    assertBranch(caller, String(data.branch ?? ''))

    // Read the items from the STORED document, not the request. This is the
    // whole point: a concurrent edit to a different line survives, because
    // only the named line is touched.
    const items = Array.isArray(data.items) ? [...data.items] : []
    const idx = items.findIndex((i: { templateId?: string }) => i?.templateId === templateId)
    if (idx === -1) throw new HttpError(404, 'That item is not on this order.')

    const before = Number(items[idx].quantity ?? 0)
    items[idx] = { ...items[idx], quantity: amount }
    tx.update(ref, { items })

    return { branch: String(data.branch ?? ''), name: String(items[idx].name ?? templateId), before, after: amount }
  })
}

export async function deleteWeeklyOrder(caller: Caller, reportId: string): Promise<{ branch: string; label: string }> {
  const db = adminDb()
  const ref = db.doc(`weeklyOrderReports/${reportId}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That order no longer exists.')

  const data = snap.data() ?? {}
  assertBranch(caller, String(data.branch ?? ''))

  // A delivery is received against an order. Deleting one that has already
  // been received orphans the delivery's orderReportId, so the receiving
  // history stops being able to explain what was ordered.
  const received = await db.collection('deliveries')
    .where('orderReportId', '==', reportId).limit(1).get()
  if (!received.empty) {
    throw new HttpError(409, 'A delivery has already been received against this order, so it cannot be deleted.')
  }

  await ref.delete()
  return {
    branch: String(data.branch ?? ''),
    label: `${data.branch ?? ''} — ${data.weekLabel ?? reportId}`,
  }
}

export async function setWhatsappSent(
  caller: Caller,
  reportId: string,
  providerKey: string,
  sent: boolean,
): Promise<void> {
  const db = adminDb()
  const ref = db.doc(`weeklyOrderReports/${reportId}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That order no longer exists.')
  assertBranch(caller, String(snap.data()?.branch ?? ''))

  // FieldPath, not the string `whatsappSent.${providerKey}`. The Admin SDK
  // parses a dotted string AS A PATH, so a providerKey containing a dot would
  // write somewhere other than intended — providerKey reaches us from a
  // request. FieldPath's segments are literal.
  await ref.update(new FieldPath('whatsappSent', providerKey), !!sent)
}

export async function appendOrderLog(caller: Caller, entry: Record<string, unknown>): Promise<void> {
  const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined))
  await adminDb().collection('weeklyOrderLogs').add({
    ...clean,
    staffUid: caller.uid,
    staffEmail: caller.email ?? '',
    createdAt: FieldValue.serverTimestamp(),
  })
}
