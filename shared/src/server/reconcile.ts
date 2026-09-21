// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The reconciliation's reads (UPGRADE.md T7.16): the same reads each report
// makes, once, for one period. The drawer side reads the period's shifts by
// cash-up day, and every check closed from the day before to the day after,
// since a shift that opens in the evening takes payments on checks that close
// after midnight.

import { readClosedChecks, readInChunks, readRefundedChecks, type ExportRequest } from './salesExport'
import { readReceivedDeliveries } from './receivedDeliveries'
import { readCashUp } from './cashUp'
import { readMenuCategories, readAccountCodesDoc } from './journal'
import { readSettings } from './settings'
import { addDays } from '../reportPeriods'
import { reconcile, type ReconcileLine } from '../reconcile'
import type { Check } from '../checks'
import type { CutShort } from '../salesExport'

export async function readReconcile(
  range: ExportRequest,
  opts: { timeZone: string; branches: string[] },
): Promise<{ lines: ReconcileLine[]; ok: boolean; branches: string[]; cutShort: CutShort | null }> {
  const around = { from: addDays(range.from, -1), to: addDays(range.to, 1) }
  const [closed, refunded, received, cashUp, around2, categoryOf, codes, settings] = await Promise.all([
    readClosedChecks(range, opts),
    readRefundedChecks(range, opts),
    readReceivedDeliveries(range, opts),
    readCashUp(range, opts),
    readInChunks('checks', 'closedAt', around, opts.timeZone),
    readMenuCategories(),
    readAccountCodesDoc(),
    readSettings(),
  ])
  const result = reconcile({
    closed: closed.checks,
    refunded,
    deliveries: received.deliveries,
    shifts: cashUp.shifts.map(s => ({ id: s.id, branch: s.branch, status: s.status, totals: s.totals })),
    shiftChecks: around2.docs.map(d => ({ id: d.id, ...d.data }) as Check),
    categoryOf,
    codes,
    branches: closed.branches,
    timeZone: opts.timeZone,
    fallbackRate: settings.exchangeRate,
    from: range.from,
    to: range.to,
  })
  const cuts = [closed.cutShort, received.cutShort, around2.cutShort].filter((c): c is CutShort => Boolean(c))
  return { ...result, branches: closed.branches, cutShort: cuts.length ? cuts.reduce((a, b) => (b.completeThrough < a.completeThrough ? b : a)) : null }
}
