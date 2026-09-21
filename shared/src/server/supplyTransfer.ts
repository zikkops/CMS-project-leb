// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Moving ingredient stock between branches (UPGRADE.md T3.14): a supply's
// `quantity.<branch>`, counted in its purchase unit, as receiving and the daily
// count use. The product transfer's rules (stockTransfer.ts), for supplies:
// every line or none, what is on hand read and checked inside the transaction,
// the branches only ones that hold stock, and a request marker so a retried
// Move after a lost reply moves nothing twice. Quantities may be fractional
// (2.5 kg), to three places.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { STOCKED_BRANCHES } from '../branches'

const MAX_QTY = 100_000
const r3 = (n: number) => Math.round(n * 1000) / 1000

export interface SupplyTransferInput {
  fromBranch: string
  toBranch: string
  items: { supplyId: string; quantity: number }[]
}

export function parseSupplyTransfer(body: Record<string, unknown>): SupplyTransferInput {
  const fromBranch = String(body.fromBranch ?? '').trim()
  const toBranch = String(body.toBranch ?? '').trim()
  for (const [value, label] of [[fromBranch, 'Source'], [toBranch, 'Destination']] as const) {
    if (!(STOCKED_BRANCHES as readonly string[]).includes(value)) {
      throw new HttpError(400, `${label} branch does not hold ingredient stock: ${value || '(none)'}`)
    }
  }
  if (fromBranch === toBranch) throw new HttpError(400, 'Pick two different branches.')
  const raw = Array.isArray(body.items) ? body.items : []
  if (raw.length === 0) throw new HttpError(400, 'Nothing to move.')
  if (raw.length > 200) throw new HttpError(400, 'Move 200 items at a time or fewer.')
  const seen = new Set<string>()
  const items = raw.map((row, i) => {
    const r = (row ?? {}) as Record<string, unknown>
    const supplyId = String(r.supplyId ?? '').trim()
    if (!supplyId || supplyId.includes('/')) throw new HttpError(400, `Line ${i + 1} is missing its item.`)
    if (seen.has(supplyId)) throw new HttpError(400, `Line ${i + 1} repeats an item. Combine the lines.`)
    seen.add(supplyId)
    const quantity = Number(r.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QTY || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-6) {
      throw new HttpError(400, `Line ${i + 1}: an amount above 0, to three decimal places at most.`)
    }
    return { supplyId, quantity }
  })
  return { fromBranch, toBranch, items }
}

export async function transferSupplies(
  input: SupplyTransferInput,
  requestId: string | null = null,
): Promise<{ lines: { name: string; unit: string; quantity: number }[]; duplicate: boolean }> {
  const db = adminDb()
  const refs = input.items.map(i => db.doc(`supplies/${i.supplyId}`))
  const markerRef = requestId ? db.doc(`stockTransfers/${requestId}`) : null
  return db.runTransaction(async tx => {
    if (markerRef) {
      const marker = await tx.get(markerRef)
      if (marker.exists) {
        const lines = marker.data()?.lines
        return { lines: Array.isArray(lines) ? lines : [], duplicate: true }
      }
    }
    const snaps = await tx.getAll(...refs)
    const lines = snaps.map((snap, i) => {
      const line = input.items[i]
      if (!snap.exists) throw new HttpError(404, 'An item on the list no longer exists.')
      const d = snap.data() ?? {}
      const name = String(d.name ?? line.supplyId)
      const onHand = Number((d.quantity as Record<string, unknown> | undefined)?.[input.fromBranch] ?? 0)
      if (!(onHand >= line.quantity)) {
        throw new HttpError(409, `${name}: only ${r3(Number.isFinite(onHand) ? onHand : 0)} ${String(d.unit ?? '')} at ${input.fromBranch}, tried to move ${line.quantity}.`)
      }
      return { name, unit: String(d.unit ?? ''), quantity: line.quantity }
    })
    snaps.forEach((snap, i) => {
      const q = input.items[i].quantity
      tx.update(refs[i], {
        [`quantity.${input.fromBranch}`]: FieldValue.increment(-q),
        [`quantity.${input.toBranch}`]: FieldValue.increment(q),
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
    if (markerRef) {
      tx.set(markerRef, { kind: 'supplies', fromBranch: input.fromBranch, toBranch: input.toBranch, items: input.items, lines, createdAt: FieldValue.serverTimestamp() })
    }
    return { lines, duplicate: false }
  })
}
