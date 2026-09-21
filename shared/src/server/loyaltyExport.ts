// Reading the points movements an export is built from.
//
// The arithmetic is in shared/src/loyaltyExport.ts — pure, and asserted by
// `npm run verify:export`. This file only fetches the right documents.
//
// ── Why redemptions take two queries ───────────────────────────────────────
// A redemption is counted on the day it was HANDED OVER, which may be days
// after it was requested. A query ranged on createdAt alone would miss one
// asked for last month and collected this month — the very transaction an
// owner is asking about. So it queries both fields and unions by id. Both are
// single-field ranges, so neither needs a composite index.

import { requestedBranches, readInChunks } from './salesExport'
import type { CutShort } from '../salesExport'
import { buildLoyaltyExport, dayOf, type LoyaltyExport } from '../loyaltyExport'
import type { ExportRequest } from './salesExport'

export async function readLoyaltyExport(
  range: ExportRequest,
  opts: { timeZone: string; branches: string[] },
): Promise<LoyaltyExport & { from: string; to: string; branches: string[]; cutShort: CutShort | null }> {
  const wanted = new Set(requestedBranches(range, opts.branches))

  // In chunks of café days (T7.2), each with its own cap, and said when one
  // is met: a points ledger cut short understates the liability.
  const tx = await readInChunks('transactions', 'createdAt', range, opts.timeZone)
  const txDocs = tx.docs.map(d => ({ id: d.id, data: () => d.data }))

  // Requested-in-window and confirmed-in-window, unioned: see the note above.
  const requested = await readInChunks('redemptions', 'createdAt', range, opts.timeZone)
  const confirmed = await readInChunks('redemptions', 'confirmedAt', range, opts.timeZone)
  const byId = new Map<string, Record<string, unknown>>()
  for (const d of [...requested.docs, ...confirmed.docs]) byId.set(d.id, { id: d.id, ...d.data })
  const cuts = [tx.cutShort, requested.cutShort, confirmed.cutShort].filter((c): c is CutShort => c !== null)
  const cutShort = cuts.sort((a, b) => a.completeThrough.localeCompare(b.completeThrough))[0] ?? null

  const inRange = (day: string) => Boolean(day) && day >= range.from && day <= range.to
  const branchOk = (b: unknown) => wanted.size === 0 || wanted.has(String(b ?? ''))

  const transactions = txDocs
    .map(d => ({ id: d.id, ...d.data() }) as Record<string, unknown>)
    .filter(t => branchOk(t.branchId) && inRange(dayOf(t.createdAt, opts.timeZone)))

  const redemptions = [...byId.values()]
    .filter(r => branchOk(r.branchId) && inRange(dayOf(r.confirmedAt ?? r.createdAt, opts.timeZone)))

  return {
    ...buildLoyaltyExport(transactions, redemptions, { timeZone: opts.timeZone }),
    cutShort,
    from: range.from,
    to: range.to,
    branches: [...wanted],
  }
}
