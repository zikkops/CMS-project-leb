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

import { requestedBranches } from './salesExport'
import { adminDb } from './firebaseAdmin'
import { buildLoyaltyExport, dayOf, type LoyaltyExport } from '../loyaltyExport'
import type { ExportRequest } from './salesExport'

/** One day either side, as instants, so no café day can fall outside the query. */
function paddedWindow(from: string, to: string): { start: Date; end: Date } {
  return {
    start: new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000),
    end: new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000),
  }
}

async function rangeOn(collection: string, field: string, start: Date, end: Date) {
  const snap = await adminDb().collection(collection)
    .where(field, '>=', start)
    .where(field, '<=', end)
    .orderBy(field, 'asc')
    .limit(20_000)
    .get()
  return snap.docs
}

export async function readLoyaltyExport(
  range: ExportRequest,
  opts: { timeZone: string; branches: string[] },
): Promise<LoyaltyExport & { from: string; to: string; branches: string[] }> {
  const { start, end } = paddedWindow(range.from, range.to)
  const wanted = new Set(requestedBranches(range, opts.branches))

  const txDocs = await rangeOn('transactions', 'createdAt', start, end)

  // Requested-in-window and confirmed-in-window, unioned: see the note above.
  const byId = new Map<string, Record<string, unknown>>()
  for (const d of [
    ...await rangeOn('redemptions', 'createdAt', start, end),
    ...await rangeOn('redemptions', 'confirmedAt', start, end),
  ]) {
    byId.set(d.id, { id: d.id, ...d.data() })
  }

  const inRange = (day: string) => Boolean(day) && day >= range.from && day <= range.to
  const branchOk = (b: unknown) => wanted.size === 0 || wanted.has(String(b ?? ''))

  const transactions = txDocs
    .map(d => ({ id: d.id, ...d.data() }) as Record<string, unknown>)
    .filter(t => branchOk(t.branchId) && inRange(dayOf(t.createdAt, opts.timeZone)))

  const redemptions = [...byId.values()]
    .filter(r => branchOk(r.branchId) && inRange(dayOf(r.confirmedAt ?? r.createdAt, opts.timeZone)))

  return {
    ...buildLoyaltyExport(transactions, redemptions, { timeZone: opts.timeZone }),
    from: range.from,
    to: range.to,
    branches: [...wanted],
  }
}
