// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Reads what the inventory report needs (UPGRADE.md T7.12): submitted counts,
// and every stock movement since before the period, so each supply's opening
// count can be found up to OPENING_LOOKBACK_DAYS back and its movements
// followed from there:
//   received   deliveries, on the day their stock moved (`stockAppliedAt`:
//              a draft keeps its first `deliveredAt`, which is not that day)
//   transfers  stockTransfers of kind 'supplies' (every one recorded from
//              21 Sep 2026; before that only those sent with a retry key)
//   used/waste each closed or refunded check's recipe snapshots, by its close
//              day: sold lines are used; a void of food already sent is waste
//              when its reason said so; a refund's lines are waste when its
//              reason said so, and otherwise went back to stock (no movement)

import { adminDb } from './firebaseAdmin'
import { readInChunks, requestedBranches, type ExportRequest } from './salesExport'
import { closedAtParts, type CutShort } from '../salesExport'
import { addDays } from '../reportPeriods'
import { lineTaken } from '../recipes'
import type { Check } from '../checks'
import type { CountRecord, StockMove, SupplyNow } from '../inventoryReport'

/** How far back a supply's opening count is looked for. */
export const OPENING_LOOKBACK_DAYS = 45

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export async function readInventory(
  range: ExportRequest,
  opts: { timeZone: string; branches: readonly string[] },
): Promise<{ counts: CountRecord[]; moves: StockMove[]; supplies: SupplyNow[]; branches: string[]; cutShort: CutShort | null; lookbackFrom: string }> {
  const branches = requestedBranches(range, [...opts.branches])
  const wanted = new Set(branches)
  const lookbackFrom = addDays(range.from, -OPENING_LOOKBACK_DAYS)
  const window = { from: lookbackFrom, to: range.to }
  const dayOf = (v: unknown) => {
    const { day } = closedAtParts(v, opts.timeZone)
    return day && day >= window.from && day <= window.to ? day : ''
  }
  const db = adminDb()
  const [countSnap, deliveries, transfers, checks, supplySnap] = await Promise.all([
    db.collection('dailyInventoryCounts').where('date', '>=', window.from).where('date', '<=', window.to).get(),
    readInChunks('deliveries', 'stockAppliedAt', window, opts.timeZone),
    readInChunks('stockTransfers', 'createdAt', window, opts.timeZone),
    readInChunks('checks', 'closedAt', window, opts.timeZone),
    db.collection('supplies').get(),
  ])

  const counts: CountRecord[] = countSnap.docs.map(d => d.data())
    .filter(c => c.status === 'submitted' && wanted.has(String(c.branch)))
    .map(c => ({
      branch: String(c.branch),
      day: String(c.date),
      lines: (Array.isArray(c.items) ? c.items : []).map((l: Record<string, unknown>) => ({
        supplyId: String(l.supplyId ?? ''), name: String(l.name ?? ''), unit: String(l.unit ?? ''),
        countedQty: Number(l.countedQty) || 0, unitCostUsd: num(l.unitCostUsd),
      })).filter((l: { supplyId: string }) => l.supplyId),
    }))

  const moves: StockMove[] = []
  for (const { data: d } of deliveries.docs) {
    const branch = String(d.branch)
    const day = dayOf(d.stockAppliedAt)
    if (d.status === 'draft' || !wanted.has(branch) || !day) continue
    const rate = num(d.rateUsed)
    for (const l of (Array.isArray(d.lines) ? d.lines : []) as Record<string, unknown>[]) {
      const qty = (num(l.qtyReceived) ?? 0) - (num(l.qtyRejected) ?? 0)
      if (qty <= 0) continue
      const cost = num(l.unitCost)
      const unitCostUsd = cost === null ? null : d.currency === 'LBP' ? (rate && rate > 0 ? cost / rate : null) : cost
      moves.push({ branch, day, supplyId: String(l.supplyId ?? ''), kind: 'received', qty, unitCostUsd })
    }
  }
  for (const { data: t } of transfers.docs) {
    if (t.kind !== 'supplies') continue
    const day = dayOf(t.createdAt)
    if (!day) continue
    const lines = (Array.isArray(t.lines) ? t.lines : []) as Record<string, unknown>[]
    const items = (Array.isArray(t.items) ? t.items : []) as Record<string, unknown>[]
    items.forEach((it, i) => {
      const supplyId = String(it.supplyId ?? lines[i]?.supplyId ?? '')
      const qty = num(it.quantity) ?? 0
      const unitCostUsd = num(lines[i]?.unitCostUsd)
      if (!supplyId || qty <= 0) return
      if (wanted.has(String(t.fromBranch))) moves.push({ branch: String(t.fromBranch), day, supplyId, kind: 'transferOut', qty, unitCostUsd })
      if (wanted.has(String(t.toBranch))) moves.push({ branch: String(t.toBranch), day, supplyId, kind: 'transferIn', qty, unitCostUsd })
    })
  }
  for (const doc of checks.docs) {
    const check = { id: doc.id, ...doc.data } as Check
    if (!wanted.has(check.branch) || (check.status !== 'closed' && check.status !== 'refunded')) continue
    const day = dayOf(check.closedAt)
    if (!day) continue
    const refundedAsWaste = check.status === 'refunded' && check.refundWasWaste === true
    for (const line of check.lines ?? []) {
      let kind: 'used' | 'waste' | null = null
      if (line.status === 'void') kind = line.sentAt && line.voidWasWaste === true ? 'waste' : null
      else if (check.status === 'closed') kind = 'used'
      else kind = refundedAsWaste ? 'waste' : null
      if (!kind) continue
      for (const c of lineTaken(line)) moves.push({ branch: check.branch, day, supplyId: c.supplyId, kind, qty: c.qty, unitCostUsd: c.unitCostUsd })
    }
  }

  const supplies: SupplyNow[] = supplySnap.docs.map(d => {
    const s = d.data()
    const raw = s.quantity
    const qty: Record<string, number> = typeof raw === 'number' ? {} : Object.fromEntries(
      Object.entries((raw ?? {}) as Record<string, unknown>).map(([b, q]) => [b, Number(q) || 0]),
    )
    const avg = num(s.avgUnitCost)
    return { supplyId: d.id, name: String(s.name ?? d.id), unit: String(s.unit ?? ''), qty, avgUnitCost: avg !== null && avg > 0 ? avg : null }
  })

  const cuts = [deliveries.cutShort, transfers.cutShort, checks.cutShort].filter((c): c is CutShort => Boolean(c))
  return {
    counts, moves, supplies, branches, lookbackFrom,
    cutShort: cuts.length ? cuts.reduce((a, b) => (b.completeThrough < a.completeThrough ? b : a)) : null,
  }
}
