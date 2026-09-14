// Theoretical food cost: what the recipes say the food sold should have cost.
//
// The arithmetic is theoreticalFoodCost() in shared/src/recipes.ts, pure and
// asserted by `npm run verify:recipes`. This file only gets the right closed
// checks out of Firestore — the same padded closedAt window and café-day
// narrowing as the sales export, so "the 12th" means the same checks in both.
//
// It runs on the server because checks are readable only by POS and KDS
// accounts, and the people reading a food cost report are neither.

import { adminDb } from './firebaseAdmin'
import { paddedWindow, type ExportRequest } from './salesExport'
import { closedAtParts } from '../salesExport'
import { shareForLines } from '../splits'
import { theoreticalFoodCost, type SoldLine, type TheoreticalFoodCost } from '../recipes'
import type { Check } from '../checks'

export async function readTheoreticalFoodCost(
  range: ExportRequest,
  opts: { timeZone: string; branches: readonly string[] },
): Promise<TheoreticalFoodCost & { checks: number; from: string; to: string; branches: string[] }> {
  const { start, end } = paddedWindow(range.from, range.to)

  const snap = await adminDb().collection('checks')
    .where('closedAt', '>=', start)
    .where('closedAt', '<=', end)
    .orderBy('closedAt', 'asc')
    .limit(20_000)
    .get()

  const wanted = new Set(range.branch ? [range.branch] : opts.branches)
  const sold: SoldLine[] = []
  let checks = 0

  for (const doc of snap.docs) {
    const check = { id: doc.id, ...doc.data() } as Check
    if (!wanted.has(check.branch)) continue
    // Refunded checks are out: the sale did not stand, and what happened to
    // its ingredients is the refund's business (returned or wasted).
    if (check.status !== 'closed') continue
    const { day } = closedAtParts(check.closedAt, opts.timeZone)
    if (!day || day < range.from || day > range.to) continue
    checks++

    const vatRate = typeof check.vatRate === 'number' ? check.vatRate : null
    for (const line of check.lines ?? []) {
      if (line.status === 'void') continue
      sold.push({
        status: line.status,
        quantity: line.quantity,
        consumesPerServing: line.consumesPerServing,
        consumesUnknown: line.consumesUnknown,
        source: line.source,
        // The line's share of what the check actually charged — staff meal,
        // item discount and its part of any whole-check discount taken off —
        // from the same function a split bill uses.
        salesUsd: shareForLines(check, [line.id]),
        vatRate,
      })
    }
  }

  return {
    ...theoreticalFoodCost(sold),
    checks,
    from: range.from,
    to: range.to,
    branches: [...wanted],
  }
}
