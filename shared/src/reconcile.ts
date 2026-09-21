// The reconciliation check (UPGRADE.md T7.16). Pure, and run by its own
// verifier (`npm run verify:reconcile`) over a generated café history, so CI
// proves the reports agree without a database; the page /admin/reports/reconcile
// runs the same function over the real period.
//
// Every report is worked out here from the same checks, by the same functions
// its own page uses, and each pair that must agree is compared:
//
//   the export's days          = the sales summary (billed, refunds, VAT)
//   the product mix            = the sales summary's goods on closed checks
//   the VAT report             = the sales summary's VAT, output and reversed
//   payments applied           = bills paid (within the lira rounding per check)
//   the drawers' shifts        = the payments taken into them, per currency
//   the journal                = debits equal credits, in both currencies,
//                                and its VAT is the VAT report's net output
//
// A difference is shown to the cent, never rounded away. Only the tender line
// allows a tolerance, and it says so: a bill paid in lira settles to the
// nearest 1,000 LBP, which is a real, bounded difference per check.

import { checkTotals, type Check } from './checks'
import type { DrawerTotals, Money2 } from './drawer'
import { buildExport } from './salesExport'
import { salesSummary } from './salesSummary'
import { productMix } from './salesReports'
import { vatReport, type DeliveryVatRow } from './vatReport'
import { tenderSummary } from './tenderSummary'
import { buildJournal, refundEntry, saleEntry, type AccountCodes, type DatedEntry } from './journal'
import { refundedAtParts, closedAtParts } from './salesExport'

export interface ReconcileLine {
  key: string
  label: string
  left: number
  leftLabel: string
  right: number
  rightLabel: string
  difference: number
  /** How far apart the two may be, and why; 0 for every line but the tenders. */
  tolerance: number
  unit: 'USD' | 'LBP'
  ok: boolean
}

export interface ReconcileShift { id: string; branch: string; status: string; totals: DrawerTotals | null }

export interface ReconcileInput {
  /** Checks that closed in the period. */
  closed: readonly Check[]
  /** Checks refunded in the period, whenever they closed. */
  refunded: readonly Check[]
  deliveries: readonly DeliveryVatRow[]
  /** Closed drawer shifts of the period's cash-up days. */
  shifts: readonly ReconcileShift[]
  /** Every check that may hold a payment taken into those shifts. */
  shiftChecks: readonly Check[]
  categoryOf: Readonly<Record<string, string>>
  codes: AccountCodes
  branches: readonly string[]
  timeZone: string
  fallbackRate: number
  from: string
  to: string
}

const r2 = (n: number) => Math.round(n * 100) / 100

function line(key: string, label: string, leftLabel: string, left: number, rightLabel: string, right: number, unit: 'USD' | 'LBP' = 'USD', tolerance = 0): ReconcileLine {
  const difference = unit === 'USD' ? r2(left - right) : Math.round(left - right)
  return { key, label, left: unit === 'USD' ? r2(left) : Math.round(left), leftLabel, right: unit === 'USD' ? r2(right) : Math.round(right), rightLabel, difference, tolerance, unit, ok: Math.abs(difference) <= tolerance + 1e-9 }
}

export function reconcile(input: ReconcileInput): { lines: ReconcileLine[]; ok: boolean } {
  const wanted = new Set(input.branches)
  const byId = new Map<string, Check>()
  for (const c of [...input.closed, ...input.refunded]) if (wanted.has(c.branch)) byId.set(c.id, c)
  const all = [...byId.values()]
  const opts = { timeZone: input.timeZone, fallbackRate: input.fallbackRate, from: input.from, to: input.to }
  const exp = buildExport(all, opts)
  const summary = salesSummary(exp.checks, input.branches).total
  const days = exp.days
  const sum = <T,>(list: readonly T[], pick: (x: T) => number) => list.reduce((n, x) => n + pick(x), 0)
  const lines: ReconcileLine[] = []

  lines.push(line('days-billed', 'The export\'s days = the sales summary: billed', 'Export days', sum(days, d => d.net), 'Sales summary', summary.billed))
  lines.push(line('days-refunds', 'The export\'s days = the sales summary: refunds given', 'Export days', sum(days, d => d.refunds), 'Sales summary', summary.refundsBilled))
  lines.push(line('days-vat', 'The export\'s days = the sales summary: VAT', 'Export days', sum(days, d => d.vat), 'Sales summary', summary.vatOutput))

  // The mix counts closed checks only; the summary's sales rows still standing are those.
  const closedInRange = input.closed.filter(c => wanted.has(c.branch) && c.status === 'closed')
  const mix = productMix(closedInRange, { categoryOf: input.categoryOf }).totals
  const standing = exp.checks.filter(r => r.kind === 'sale' && r.status === 'closed')
  lines.push(line('mix-goods', 'The product mix = the sales summary: goods on closed checks, after discounts', 'Product mix', mix.revenue - mix.checkDiscounts, 'Sales summary', sum(standing, r => r.net - r.service)))

  // A check closed with no receipt number is in no export, journal or mix:
  // there must be none, and any is named here rather than lost.
  const unnumbered = input.closed.filter(c => wanted.has(c.branch) && c.status === 'closed' && !c.receiptNumber)
  lines.push(line('unnumbered', 'Checks closed with no receipt number (in no export, journal or report)', 'Their bills', sum(unnumbered, c => checkTotals(c).net), 'Expected', 0))

  const vat = vatReport(exp.checks, input.deliveries, input.branches).total
  lines.push(line('vat-output', 'The VAT report = the sales summary: output VAT', 'VAT report', vat.outputVat, 'Sales summary', summary.vatOutput))
  lines.push(line('vat-reversed', 'The VAT report = the sales summary: VAT reversed on refunds', 'VAT report', vat.refundVat, 'Sales summary', summary.refundsVat))

  const tenders = tenderSummary(exp.payments, exp.checks, input.branches).total
  const paidChecks = new Set(exp.payments.map(p => p.receipt)).size
  lines.push(line('tenders', 'Payments applied = bills paid (each lira bill settles to the nearest 1,000 LBP)', 'Applied to bills', tenders.appliedUsd, 'Billed, paid checks', tenders.billedPaid, 'USD', r2(0.05 * Math.max(1, paidChecks))))

  // The drawers: each closed shift's stored totals against the payments taken into it.
  const shifts = input.shifts.filter(s => wanted.has(s.branch) && s.status === 'closed' && s.totals)
  const ids = new Set(shifts.map(s => s.id))
  const taken = { cashUsd: 0, cashLbp: 0, changeUsd: 0, changeLbp: 0, cardUsd: 0, cardLbp: 0 }
  const seen = new Set<string>()
  for (const c of input.shiftChecks) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    for (const p of c.payments ?? []) {
      if (!p.shiftId || !ids.has(p.shiftId)) continue
      const usd = p.currency === 'USD'
      if (p.tender === 'card') { if (usd) taken.cardUsd += p.amount; else taken.cardLbp += p.amount }
      else if (usd) taken.cashUsd += p.amount
      else taken.cashLbp += p.amount
      taken.changeUsd += p.changeUsd
      taken.changeLbp += p.changeLbp
    }
  }
  const stored = (pick: (t: DrawerTotals) => Money2 | undefined, cur: 'usd' | 'lbp') => sum(shifts, s => pick(s.totals as DrawerTotals)?.[cur] ?? 0)
  lines.push(line('drawer-cash-usd', 'The drawers = the payments taken into them: cash in, dollars', 'Shifts', stored(t => t.cashIn, 'usd'), 'Payments', taken.cashUsd))
  lines.push(line('drawer-cash-lbp', 'The drawers = the payments taken into them: cash in, lira', 'Shifts', stored(t => t.cashIn, 'lbp'), 'Payments', taken.cashLbp, 'LBP'))
  lines.push(line('drawer-change-usd', 'The drawers = the payments taken into them: change, dollars', 'Shifts', stored(t => t.change, 'usd'), 'Payments', taken.changeUsd))
  lines.push(line('drawer-change-lbp', 'The drawers = the payments taken into them: change, lira', 'Shifts', stored(t => t.change, 'lbp'), 'Payments', taken.changeLbp, 'LBP'))
  lines.push(line('drawer-card-usd', 'The drawers = the payments taken into them: card, dollars', 'Shifts', stored(t => t.card, 'usd'), 'Payments', taken.cardUsd))
  lines.push(line('drawer-card-lbp', 'The drawers = the payments taken into them: card, lira', 'Shifts', stored(t => t.card, 'lbp'), 'Payments', taken.cardLbp, 'LBP'))

  // The journal, from the same checks.
  const entries: DatedEntry[] = []
  const inRange = (day: string) => day >= input.from && day <= input.to
  for (const c of all) {
    const closedDay = closedAtParts(c.closedAt, input.timeZone).day
    if (c.receiptNumber && inRange(closedDay) && (c.status === 'closed' || c.status === 'refunded')) {
      entries.push({ day: closedDay, branch: c.branch, kind: 'sales', postings: saleEntry(c, input.categoryOf, input.fallbackRate) })
    }
    const refundDay = c.status === 'refunded' ? refundedAtParts(c as Check & { refundedAt?: unknown }, input.timeZone).day : ''
    if (c.receiptNumber && refundDay && inRange(refundDay)) {
      entries.push({ day: refundDay, branch: c.branch, kind: 'refunds', postings: refundEntry(c, input.categoryOf, input.fallbackRate) })
    }
  }
  const journal = buildJournal(entries, input.codes)
  lines.push(line('journal-usd', 'The journal: debits = credits, dollars', 'Debits', sum(journal.journals, j => j.debitUsd), 'Credits', sum(journal.journals, j => j.creditUsd)))
  lines.push(line('journal-lbp', 'The journal: debits = credits, lira', 'Debits', sum(journal.journals, j => j.debitLbp), 'Credits', sum(journal.journals, j => j.creditLbp), 'LBP'))
  const vatCode = input.codes.accounts.vat.code
  const vatLines = journal.lines.filter(l => l.code === vatCode && l.account === input.codes.accounts.vat.name)
  lines.push(line('journal-vat', 'The journal\'s VAT output = the VAT report\'s output less reversals', 'Journal', sum(vatLines, l => l.creditUsd - l.debitUsd), 'VAT report', vat.outputVat - vat.refundVat))

  return { lines, ok: lines.every(l => l.ok) }
}
