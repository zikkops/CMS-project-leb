// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Supplies and the daily count: the far end of the Phase 01 chain, where
// stock quantities actually live.
//
//   order template → weekly order → delivery → supplies.quantity ← daily count
//
// Two things here move real stock, so both belong on the server: submitting a
// count writes each counted figure onto its supply, and deleting a supply can
// silently break the link a delivery needs to move stock at all.

import { FieldValue, FieldPath } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRANCHES } from '../branches'

const DATE = /^\d{4}-\d{2}-\d{2}$/

function assertBranch(caller: Caller, branch: string): void {
  if (caller.role === 'admin') return
  if (caller.branchIds.length === 0) return
  if (!caller.branchIds.includes(branch)) {
    throw new HttpError(403, 'That branch is not one of yours.')
  }
}

function count(v: unknown, label: string): number {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label} must be a non-negative number.`)
  if (n > 1_000_000) throw new HttpError(400, `${label} is implausibly large.`)
  return n
}

function zeroStock(): Record<string, number> {
  return Object.fromEntries(BRANCHES.map(b => [b, 0]))
}

// ── Supplies ──────────────────────────────────────────────────────────────

export interface SupplyInput {
  name: string
  nameAr: string | null
  category: string
  unit: string
  threshold: number
  provider: string | null
  // Whether VAT applies to this item by default. Most raw food is zero-rated
  // and chemicals and paper goods are not, so the answer belongs on the item
  // rather than being re-decided on every delivery. Receiving seeds each line
  // from it and lets the line override, because the same item can arrive taxed
  // from one supplier and untaxed from another.
  vatable: boolean
}

export function parseSupplyInput(body: Record<string, unknown>): SupplyInput {
  const name = String(body.name ?? '').trim()
  if (!name) throw new HttpError(400, 'A name is required.')

  const threshold = Number(body.threshold ?? 1)
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new HttpError(400, 'Threshold must be a whole number of at least 1.')
  }

  return {
    name: name.slice(0, 200),
    nameAr: body.nameAr ? String(body.nameAr).trim().slice(0, 200) : null,
    category: String(body.category ?? '').trim().slice(0, 100),
    unit: String(body.unit ?? '').trim().slice(0, 50),
    threshold,
    provider: body.provider ? String(body.provider).trim().slice(0, 200) : null,
    // Default true: the old whole-invoice VAT rate taxed every line, so an
    // item that predates this flag keeps totalling the way it always did.
    vatable: body.vatable !== false,
  }
}

export async function createSupply(input: SupplyInput, initialQty: number): Promise<{ id: string }> {
  const ref = await adminDb().collection('supplies').add({
    ...input,
    // Every configured branch, and only those. The client's seedFromTemplates
    // hardcoded { Beirut, Zouk, Broummana } — the original café's branches —
    // so in any other deployment it created stock keys for branches that do
    // not exist and none for the branches that do.
    quantity: Object.fromEntries(BRANCHES.map(b => [b, count(initialQty, 'Quantity')])),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
}

export async function updateSupply(id: string, input: SupplyInput): Promise<void> {
  const ref = adminDb().doc(`supplies/${id}`)
  if (!(await ref.get()).exists) throw new HttpError(404, 'That item no longer exists.')
  // `quantity` is deliberately absent: it is only ever set by a submitted
  // daily count or a received delivery. Editing an item must not become a
  // back door for adjusting stock without a count behind it.
  await ref.update({ ...input, updatedAt: FieldValue.serverTimestamp() })
}

export async function setThreshold(id: string, threshold: number): Promise<void> {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new HttpError(400, 'Threshold must be a whole number of at least 1.')
  }
  await adminDb().doc(`supplies/${id}`).update({
    threshold,
    updatedAt: FieldValue.serverTimestamp(),
  })
}

export async function deleteSupply(id: string): Promise<{ name: string }> {
  const db = adminDb()
  const ref = db.doc(`supplies/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That item no longer exists.')

  // THE GUARD THAT DID NOT EXIST. An order template item points at a supply
  // through supplyId, and receiving a delivery moves stock through that link.
  // Deleting the supply leaves the template pointing at nothing — and a
  // delivery of that item then posts successfully while moving no stock at
  // all, with no error. scripts/link-template-supplies.mjs reports exactly
  // this state, separately from never-linked items, because it means stock
  // has been silently failing to move.
  const linked = await db.collection('orderTemplateItems')
    .where('supplyId', '==', id).limit(5).get()
  if (!linked.empty) {
    const names = linked.docs.map(d => String(d.data().name ?? d.id)).join(', ')
    throw new HttpError(409,
      `${linked.size} order template item(s) still point at this item (${names}). ` +
      `Deleting it would leave deliveries of those items moving no stock. ` +
      `Unlink or delete them in the Weekly Orders template first.`)
  }

  const name = String(snap.data()?.name ?? id)
  await ref.delete()
  return { name }
}

// ── Seeding supplies from the order template ──────────────────────────────

export interface SeedResult {
  created: number
  linked: number
  arabicBackfilled: number
}

/**
 * Create a supply for every template item that has none, and link them.
 *
 * The client version matched template to supply on `name.toLowerCase()` and
 * never wrote `supplyId` — which is precisely the fragile linkage Phase 01
 * exists to replace. Rename either side and the chain from ordering to stock
 * breaks with no error.
 *
 * Here the name match is only used to ADOPT an existing supply that has no
 * link yet; the durable `supplyId` is written in both cases, so this is the
 * last time a name is used to connect them.
 */
export async function seedSuppliesFromTemplates(): Promise<SeedResult> {
  const db = adminDb()
  const [templates, supplies, providers] = await Promise.all([
    db.collection('orderTemplateItems').get(),
    db.collection('supplies').get(),
    db.collection('orderProviders').get(),
  ])

  const providerName = new Map(providers.docs.map(d => [d.id, String(d.data().name ?? '')]))
  const byName = new Map(supplies.docs.map(d => [String(d.data().name ?? '').toLowerCase(), d]))

  let created = 0, linked = 0, arabicBackfilled = 0

  for (const t of templates.docs) {
    const data = t.data()
    if (data.supplyId) continue                       // already linked; nothing to do

    const existing = byName.get(String(data.name ?? '').toLowerCase())

    if (existing) {
      await t.ref.update({ supplyId: existing.id })
      linked++
      if (data.nameAr && !existing.data().nameAr) {
        await existing.ref.update({ nameAr: data.nameAr, updatedAt: FieldValue.serverTimestamp() })
        arabicBackfilled++
      }
      continue
    }

    const ref = await db.collection('supplies').add({
      name: data.name ?? '',
      nameAr: data.nameAr ?? null,
      category: data.department ?? '',
      quantity: zeroStock(),
      unit: data.unit ?? '',
      threshold: 1,
      provider: data.providerId ? (providerName.get(data.providerId) ?? null) : null,
      // Written explicitly rather than left to the read-side default, so an
      // item seeded from a template shows the same VAT state in the inventory
      // form as one created by hand.
      vatable: true,
      updatedAt: FieldValue.serverTimestamp(),
    })
    await t.ref.update({ supplyId: ref.id })
    created++
    linked++
  }

  return { created, linked, arabicBackfilled }
}

// ── The daily count ───────────────────────────────────────────────────────

export interface CountInput {
  branch: string
  date: string
  department: string
  items: { supplyId: string; countedQty: number | null }[]
  notes: string
  submit: boolean
}

export function parseCountInput(body: Record<string, unknown>): CountInput {
  const branch = String(body.branch ?? '').trim()
  if (!(BRANCHES as readonly string[]).includes(branch)) {
    throw new HttpError(400, `Unknown branch: ${branch || '(none)'}`)
  }
  const date = String(body.date ?? '').trim()
  if (!DATE.test(date)) throw new HttpError(400, 'Date must be YYYY-MM-DD.')

  const raw = Array.isArray(body.items) ? body.items : []
  return {
    branch,
    date,
    department: String(body.department ?? '').trim().slice(0, 100),
    items: raw.map((row, i) => {
      const r = (row ?? {}) as Record<string, unknown>
      const supplyId = String(r.supplyId ?? '').trim()
      if (!supplyId) throw new HttpError(400, `Line ${i + 1} is missing its item.`)
      return {
        supplyId,
        countedQty: r.countedQty == null ? null : count(r.countedQty, `Line ${i + 1} count`),
      }
    }),
    notes: String(body.notes ?? '').slice(0, 5000),
    submit: body.submit === true,
  }
}

export function inventoryDocId(branch: string, date: string, department: string): string {
  return `${branch}_${date}_${department}`
}

export async function saveCount(caller: Caller, input: CountInput): Promise<{ id: string; applied: number }> {
  assertBranch(caller, input.branch)

  const db = adminDb()
  const id = inventoryDocId(input.branch, input.date, input.department)
  const ref = db.doc(`dailyInventoryCounts/${id}`)
  const existing = await ref.get()

  if (existing.exists && existing.data()?.status === 'submitted' && input.submit) {
    throw new HttpError(409, 'That count has already been submitted.')
  }

  const batch = db.batch()
  batch.set(ref, {
    ...input,
    id,
    status: input.submit ? 'submitted' : 'draft',
    submittedBy: existing.exists ? existing.data()?.submittedBy ?? caller.uid : caller.uid,
    submittedByEmail: existing.exists ? existing.data()?.submittedByEmail ?? (caller.email ?? '') : (caller.email ?? ''),
    ...(input.submit ? { submittedAt: existing.data()?.submittedAt ?? FieldValue.serverTimestamp() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  }, { merge: false })

  let applied = 0
  if (input.submit) {
    for (const line of input.items) {
      if (line.countedQty == null) continue
      // FieldPath, not the string `quantity.${branch}`. The Admin SDK parses a
      // dotted string as a path, and `branch` arrives in a request — a value
      // containing a dot would write to a different part of the document.
      // Touching only this branch's key is what stops one branch's count
      // clobbering another's.
      batch.update(db.doc(`supplies/${line.supplyId}`),
        new FieldPath('quantity', input.branch), line.countedQty,
        'updatedAt', FieldValue.serverTimestamp())
      applied++
    }
  }

  await batch.commit()
  return { id, applied }
}
