// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The reads behind the metrics page (UPGRADE.md T7.19). The list of metrics is
// shared/src/metrics.ts; this fills it in.
//
// Only the groups the chosen metrics belong to are read. Asking for net sales
// and cash counted runs the sales export and the drawer read, and nothing
// else: the inventory and labour reads are the expensive ones, and a page that
// ran them to show a metric nobody asked for would be slow for no reason.
//
// Every figure comes from the same function the report of that name uses, so a
// metric and its report cannot disagree.

import { readClosedChecks, readRefundedChecks, readSalesExport, type ExportRequest } from './salesExport'
import { readReceivedDeliveries } from './receivedDeliveries'
import { readCashUp } from './cashUp'
import { readLabour } from './labour'
import { readInventory } from './inventoryReport'
import { readLoyaltyLiability } from './loyaltyExport'
import { readReceiptSequence } from './receiptSequence'
import { readMenuCategories } from './journal'
import { readSettings } from './settings'
import { salesSummary } from '../salesSummary'
import { tenderSummary } from '../tenderSummary'
import { productMix, voidDiscountReport } from '../salesReports'
import { cashUpReport } from '../cashUpReport'
import { labourReport } from '../labourReport'
import { inventoryReport } from '../inventoryReport'
import { receiptSequence } from '../receiptSequence'
import { deliveryUsd } from '../vatReport'
import { closedAtParts, type CutShort } from '../salesExport'
import { allowedMetrics, groupsNeeded, type MetricGroup, type MetricReport } from '../metrics'
import type { Check } from '../checks'

type Row = Record<string, number>
/** One group's answer: the period's figures, each day's, and each branch's. */
interface GroupResult { total: Row; days: Map<string, Row>; branches: Map<string, Row> }

const empty = (): GroupResult => ({ total: {}, days: new Map(), branches: new Map() })
const addInto = (into: Map<string, Row>, key: string, row: Row) => {
  const at = into.get(key) ?? {}
  for (const [k, v] of Object.entries(row)) at[k] = (at[k] ?? 0) + v
  into.set(key, at)
}
const r2 = (n: number) => Math.round(n * 100) / 100

export async function readMetrics(
  range: ExportRequest,
  opts: { timeZone: string; branches: string[]; keys: readonly string[]; isAdmin: boolean },
): Promise<MetricReport & { cutShort: CutShort | null; branches: string[] }> {
  const keys = allowedMetrics(opts.isAdmin, opts.keys)
  const groups = groupsNeeded(keys)
  const refused: MetricReport['refused'] = []
  for (const group of groupsNeeded(opts.keys)) {
    if (!groups.includes(group)) refused.push({ group, reason: 'Only an admin sees pay.' })
  }

  const results: GroupResult[] = []
  let cutShort: CutShort | null = null
  const noteCut = (cut: CutShort | null | undefined) => {
    if (cut && (!cutShort || cut.completeThrough < cutShort.completeThrough)) cutShort = cut
  }
  const wants = (group: MetricGroup) => groups.includes(group)
  let branches = [...opts.branches]

  // The sales export answers two groups, so it is read once for both.
  if (wants('sales') || wants('tenders')) {
    const { exchangeRate } = await readSettings()
    const exported = await readSalesExport(range, { timeZone: opts.timeZone, fallbackRate: exchangeRate, branches: opts.branches })
    noteCut(exported.cutShort)
    const rows = exported.checks
    const days = [...new Set(rows.map(r => r.day))].filter(Boolean)

    if (wants('sales')) {
      const out = empty()
      const figuresOf = (list: typeof rows, list2: string[]) => {
        const f = salesSummary(list, list2).total
        return {
          checks: f.checks, guests: f.guests, grossSales: f.grossSales, netSales: f.netSales, billed: f.billed,
          billedLbp: f.billedLbp, vatOutput: f.vatOutput, serviceCharge: f.serviceCharge, staffMeals: f.staffMeals,
          itemDiscounts: f.itemDiscounts, checkDiscounts: f.checkDiscounts, refundsGiven: f.refundsGiven, cardTips: f.cardTips,
          averageCheck: f.checks > 0 ? r2(f.billed / f.checks) : 0,
        }
      }
      out.total = figuresOf(rows, opts.branches)
      for (const day of days) out.days.set(day, figuresOf(rows.filter(r => r.day === day), opts.branches))
      for (const branch of opts.branches) out.branches.set(branch, figuresOf(rows.filter(r => r.branch === branch), [branch]))
      results.push(out)
    }

    if (wants('tenders')) {
      const out = empty()
      const figuresOf = (payments: typeof exported.payments, list: typeof rows, list2: string[]) => {
        const t = tenderSummary(payments, list, list2).total
        return {
          payments: t.payments, cashUsdKept: t.cashUsdKept, cashLbpKept: t.cashLbpKept, cardUsd: t.cardUsd, cardLbp: t.cardLbp,
          changeUsd: t.changeUsd, appliedUsd: t.appliedUsd, checksWithoutPayment: t.checksWithoutPayment,
        }
      }
      out.total = figuresOf(exported.payments, rows, opts.branches)
      for (const day of days) {
        out.days.set(day, figuresOf(exported.payments.filter(p => p.day === day), rows.filter(r => r.day === day), opts.branches))
      }
      for (const branch of opts.branches) {
        out.branches.set(branch, figuresOf(exported.payments.filter(p => p.branch === branch), rows.filter(r => r.branch === branch), [branch]))
      }
      results.push(out)
    }
  }

  // The menu and the exceptions both read the closed checks.
  if (wants('menu') || wants('exceptions')) {
    const [closed, refundedChecks, categoryOf] = await Promise.all([
      readClosedChecks(range, { timeZone: opts.timeZone, branches: opts.branches }),
      wants('exceptions') ? readRefundedChecks(range, { timeZone: opts.timeZone, branches: opts.branches }) : Promise.resolve([] as Check[]),
      wants('menu') ? readMenuCategories() : Promise.resolve({} as Record<string, string>),
    ])
    noteCut(closed.cutShort)
    branches = closed.branches
    const dayOf = (c: Check) => closedAtParts(c.closedAt, opts.timeZone).day

    if (wants('menu')) {
      const out = empty()
      const figuresOf = (list: readonly Check[]) => {
        const mix = productMix(list, { categoryOf }).totals
        return {
          itemsSold: mix.quantity, itemRevenue: mix.revenue, menuNetSales: mix.netSales, recipeCost: mix.cost ?? 0,
          grossMargin: mix.marginPercent ?? 0, costedShare: mix.coverage ?? 0,
        }
      }
      out.total = figuresOf(closed.checks)
      for (const day of [...new Set(closed.checks.map(dayOf))].filter(Boolean)) {
        out.days.set(day, figuresOf(closed.checks.filter(c => dayOf(c) === day)))
      }
      for (const branch of closed.branches) out.branches.set(branch, figuresOf(closed.checks.filter(c => c.branch === branch)))
      results.push(out)
    }

    if (wants('exceptions')) {
      const out = empty()
      const report = voidDiscountReport(closed.checks, { timeZone: opts.timeZone, refunded: refundedChecks })
      out.total = {
        voids: report.totals.voids, voidValue: report.totals.voidValue, wasteValue: report.totals.wasteValue,
        discounts: report.totals.discounts, discountValue: report.totals.discountValue, refunds: report.totals.refunds,
        unapproved: report.totals.unapproved, priceRuleValue: report.totals.priceRuleValue,
      }
      for (const d of report.byDay) {
        out.days.set(d.day, { voids: d.voids, voidValue: d.voidValue, discounts: d.discounts, discountValue: d.discountValue, refunds: d.refunds })
      }
      for (const branch of closed.branches) {
        const own = voidDiscountReport(closed.checks.filter(c => c.branch === branch), {
          timeZone: opts.timeZone, refunded: refundedChecks.filter(c => c.branch === branch),
        }).totals
        out.branches.set(branch, {
          voids: own.voids, voidValue: own.voidValue, wasteValue: own.wasteValue, discounts: own.discounts,
          discountValue: own.discountValue, refunds: own.refunds, unapproved: own.unapproved, priceRuleValue: own.priceRuleValue,
        })
      }
      results.push(out)
    }
  }

  if (wants('cash')) {
    const read = await readCashUp(range, { timeZone: opts.timeZone, branches: opts.branches })
    const report = cashUpReport(read.shifts, read.eod, read.branches)
    const out = empty()
    out.total = {
      shifts: report.total.shifts, cashCountedUsd: report.total.counted.usd, cashCountedLbp: report.total.counted.lbp,
      cashDifferenceUsd: report.total.difference.usd, cashDifferenceLbp: report.total.difference.lbp,
    }
    for (const row of report.shifts) {
      addInto(out.days, row.cashUpDay, {
        shifts: 1, cashCountedUsd: row.counted?.usd ?? 0, cashCountedLbp: row.counted?.lbp ?? 0,
        cashDifferenceUsd: row.difference?.usd ?? 0, cashDifferenceLbp: row.difference?.lbp ?? 0,
      })
    }
    for (const b of report.byBranch) {
      out.branches.set(b.branch, {
        shifts: b.totals.shifts, cashCountedUsd: b.totals.counted.usd, cashCountedLbp: b.totals.counted.lbp,
        cashDifferenceUsd: b.totals.difference.usd, cashDifferenceLbp: b.totals.difference.lbp,
      })
    }
    results.push(out)
  }

  if (wants('purchases')) {
    const read = await readReceivedDeliveries(range, { timeZone: opts.timeZone, branches: opts.branches })
    noteCut(read.cutShort)
    const out = empty()
    for (const d of read.deliveries) {
      const row = {
        deliveries: 1,
        purchasesNet: r2(deliveryUsd(d, d.subtotal)),
        inputVat: r2(deliveryUsd(d, d.vat)),
        purchasesTotal: r2(deliveryUsd(d, d.grand)),
      }
      addInto(out.days, d.day, row)
      addInto(out.branches, d.branch, row)
      for (const [k, v] of Object.entries(row)) out.total[k] = r2((out.total[k] ?? 0) + v)
    }
    results.push(out)
  }

  if (wants('inventory')) {
    const read = await readInventory(range, { timeZone: opts.timeZone, branches: opts.branches })
    noteCut(read.cutShort)
    const report = inventoryReport({ counts: read.counts, moves: read.moves, supplies: read.supplies, branches: read.branches, from: range.from, to: range.to })
    const out = empty()
    out.total = {
      stockValueNow: report.total.valueNow, cogs: report.total.cogs,
      inventoryVariance: report.total.varianceValue, inventoryWaste: report.total.wasteValue,
    }
    for (const b of report.byBranch) {
      out.branches.set(b.branch, {
        stockValueNow: b.totals.valueNow, cogs: b.totals.cogs,
        inventoryVariance: b.totals.varianceValue, inventoryWaste: b.totals.wasteValue,
      })
    }
    results.push(out)
  }

  if (wants('labour')) {
    const read = await readLabour(range, { timeZone: opts.timeZone, branches: opts.branches })
    noteCut(read.cutShort)
    const report = labourReport(read)
    const out = empty()
    out.total = {
      hours: r2(report.total.minutes / 60), payUsd: report.total.costUsd, tipsOwed: report.total.tipsUsd,
      labourPercent: report.total.labourPercent ?? 0, openShifts: report.total.openShifts,
    }
    for (const d of report.days) {
      addInto(out.days, d.day, { hours: r2(d.minutes / 60), payUsd: d.costUsd, labourPercent: d.labourPercent ?? 0 })
    }
    for (const b of report.byBranch) {
      out.branches.set(b.branch, {
        hours: r2(b.totals.minutes / 60), payUsd: b.totals.costUsd, tipsOwed: b.totals.tipsUsd,
        labourPercent: b.totals.labourPercent ?? 0, openShifts: b.totals.openShifts,
      })
    }
    results.push(out)
  }

  if (wants('loyalty')) {
    const read = await readLoyaltyLiability(range, { timeZone: opts.timeZone, branches: opts.branches })
    const out = empty()
    out.total = {
      pointsIssued: read.movement.issued, pointsReversed: read.movement.reversed,
      pointsSpent: read.movement.spent, pointsOwed: read.closing,
    }
    for (const d of read.period.days) {
      addInto(out.days, d.day, { pointsIssued: d.issued, pointsReversed: d.reversed, pointsSpent: d.spent })
    }
    for (const b of read.byBranch) {
      out.branches.set(b.branch, { pointsIssued: b.movement.issued, pointsReversed: b.movement.reversed, pointsSpent: b.movement.spent })
    }
    results.push(out)
  }

  if (wants('receipts')) {
    const read = await readReceiptSequence(range, { timeZone: opts.timeZone, branches: opts.branches })
    noteCut(read.cutShort)
    const report = receiptSequence(read.uses, read.issues, read.blocks, { branches: read.branches })
    const out = empty()
    const sum = (pick: (y: typeof report.years[number]) => number) => report.years.reduce((n, y) => n + pick(y), 0)
    out.total = {
      numbersUsed: sum(y => y.used + y.usedElsewhere + y.wholesale),
      numbersMissing: sum(y => y.missing),
      numbersDuplicated: sum(y => y.duplicates),
      numbersNoRecord: sum(y => y.noRecord),
    }
    results.push(out)
  }

  // One answer, from every group that ran: only the metrics asked for.
  const keep = (row: Row): Row => Object.fromEntries(Object.entries(row).filter(([k]) => keys.includes(k)))
  const merged: Row = {}
  const dayRows = new Map<string, Row>()
  const branchRows = new Map<string, Row>()
  for (const result of results) {
    Object.assign(merged, keep(result.total))
    for (const [day, row] of result.days) addInto(dayRows, day, keep(row))
    for (const [branch, row] of result.branches) addInto(branchRows, branch, keep(row))
  }

  return {
    values: merged,
    days: [...dayRows.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, values]) => ({ day, values })),
    byBranch: [...branchRows.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([branch, values]) => ({ branch, values })),
    refused,
    cutShort,
    branches,
  }
}
