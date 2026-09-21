// Theoretical food cost and waste: what the recipes say the food sold should
// have cost, and what was thrown away.
//
// The arithmetic is theoreticalFoodCost() and wasteSummary() in
// shared/src/recipes.ts, pure and asserted by `npm run verify:recipes`. This
// file only gets the right checks out of Firestore — the same padded closedAt
// window and café-day narrowing as the sales export, so "the 12th" means the
// same checks in both.
//
// It runs on the server because checks are readable only by POS and KDS
// accounts, and the people reading a food cost report are neither.

import { adminDb } from './firebaseAdmin'
import { paddedWindow, type ExportRequest, requestedBranches } from './salesExport'
import { closedAtParts, exportCutShort, EXPORT_CHECK_CAP, type CutShort } from '../salesExport'
import { shareForLines } from '../splits'
import {
  theoreticalFoodCost, wasteSummary,
  type SoldLine, type TheoreticalFoodCost, type WasteSource, type WasteSummary,
} from '../recipes'
import type { Check } from '../checks'

export async function readTheoreticalFoodCost(
  range: ExportRequest,
  opts: { timeZone: string; branches: readonly string[] },
): Promise<TheoreticalFoodCost & { checks: number; waste: WasteSummary; from: string; to: string; branches: string[]; cutShort: CutShort | null }> {
  const { start, end } = paddedWindow(range.from, range.to)

  const snap = await adminDb().collection('checks')
    .where('closedAt', '>=', start)
    .where('closedAt', '<=', end)
    .orderBy('closedAt', 'asc')
    .limit(EXPORT_CHECK_CAP)
    .get()
  // Said, never silent: a food cost over a cut-short range is a wrong percentage (T5.8).
  const last = snap.docs[snap.docs.length - 1]
  const cutShort = last ? exportCutShort(snap.size, EXPORT_CHECK_CAP, closedAtParts(last.data().closedAt, opts.timeZone).day) : null

  const wanted = new Set(requestedBranches(range, opts.branches))
  const sold: SoldLine[] = []
  const wasteSources: WasteSource[] = []
  let checks = 0

  for (const doc of snap.docs) {
    const check = { id: doc.id, ...doc.data() } as Check
    if (!wanted.has(check.branch)) continue
    if (check.status !== 'closed' && check.status !== 'refunded' && check.status !== 'cancelled') continue
    const { day } = closedAtParts(check.closedAt, opts.timeZone)
    if (!day || day < range.from || day > range.to) continue

    // Waste is read from every check that ended in the range. A refund is
    // filed under the day its check CLOSED, not the day it was refunded — one
    // window for the whole report; a refund made days later lands in the
    // earlier period.
    wasteSources.push(check)

    // Sales only from checks that stood: a refunded sale did not happen, and
    // what became of its ingredients is the refund's business.
    if (check.status !== 'closed') continue
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

  const theory = theoreticalFoodCost(sold)
  return {
    ...theory,
    checks,
    // Against the same sales the theoretical figure uses, so the two
    // percentages can be read side by side.
    waste: wasteSummary(wasteSources, theory.salesExVatUsd),
    from: range.from,
    to: range.to,
    branches: [...wanted],
    cutShort,
  }
}
