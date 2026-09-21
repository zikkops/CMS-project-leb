// Payments and tenders (UPGRADE.md T7.5). Pure, asserted by verify:export;
// built from the export's own payment and refund rows.
//
// Every currency is kept in its own column and never converted: cash dollars,
// cash lira, card dollars, card lira. Cash is shown as handed over, as change
// given, and as kept (what stays in the drawer), because the drawer counts the
// last one (docs/reporting.md, gap 9). Card tips are on top of the card
// amount and owed to staff (gap 4). Refunds are what went back, by tender, on
// the day they were given (T7.4).
//
// The reconciliation it makes possible: what was applied to the bills (each
// payment's applied lira at its check's rate) equals what those checks billed,
// within the lira rounding. Tips never enter it.

import type { CheckRow, PaymentRow } from './salesExport'

export interface TenderFigures {
  payments: number
  cashUsdTendered: number
  cashLbpTendered: number
  changeUsd: number
  changeLbp: number
  cashUsdKept: number
  cashLbpKept: number
  cardUsd: number
  cardLbp: number
  cardTips: number
  refundCashUsd: number
  refundCashLbp: number
  refundCardUsd: number
  refundCardLbp: number
  /** Applied to bills, in USD at each check's own rate: the side that reconciles with sales. */
  appliedUsd: number
  /** What the checks paid through the till billed. */
  billedPaid: number
  /** Checks closed with no payment recorded (the old till took the money, or payments were off). */
  checksWithoutPayment: number
}

export const TENDER_FIGURE_ROWS: readonly { key: keyof TenderFigures; label: string; kind: 'count' | 'usd' | 'lbp' }[] = [
  { key: 'payments', label: 'Payments', kind: 'count' },
  { key: 'cashUsdTendered', label: 'Cash handed over, USD', kind: 'usd' },
  { key: 'changeUsd', label: 'Change given, USD', kind: 'usd' },
  { key: 'cashUsdKept', label: 'Cash kept, USD', kind: 'usd' },
  { key: 'cashLbpTendered', label: 'Cash handed over, LBP', kind: 'lbp' },
  { key: 'changeLbp', label: 'Change given, LBP', kind: 'lbp' },
  { key: 'cashLbpKept', label: 'Cash kept, LBP', kind: 'lbp' },
  { key: 'cardUsd', label: 'Card, USD', kind: 'usd' },
  { key: 'cardLbp', label: 'Card, LBP', kind: 'lbp' },
  { key: 'cardTips', label: 'Card tips (owed to staff), USD', kind: 'usd' },
  { key: 'refundCashUsd', label: 'Refunded in cash, USD', kind: 'usd' },
  { key: 'refundCashLbp', label: 'Refunded in cash, LBP', kind: 'lbp' },
  { key: 'refundCardUsd', label: 'Refunded to card, USD', kind: 'usd' },
  { key: 'refundCardLbp', label: 'Refunded to card, LBP', kind: 'lbp' },
  { key: 'appliedUsd', label: 'Applied to bills, USD at each check\'s rate', kind: 'usd' },
  { key: 'billedPaid', label: 'Billed on checks paid through the till', kind: 'usd' },
  { key: 'checksWithoutPayment', label: 'Checks closed with no payment recorded', kind: 'count' },
]

const r2 = (n: number) => Math.round(n * 100) / 100

export function emptyTenders(): TenderFigures {
  return {
    payments: 0, cashUsdTendered: 0, cashLbpTendered: 0, changeUsd: 0, changeLbp: 0, cashUsdKept: 0, cashLbpKept: 0,
    cardUsd: 0, cardLbp: 0, cardTips: 0, refundCashUsd: 0, refundCashLbp: 0, refundCardUsd: 0, refundCardLbp: 0,
    appliedUsd: 0, billedPaid: 0, checksWithoutPayment: 0,
  }
}

export function addTenders(list: readonly TenderFigures[]): TenderFigures {
  const out = emptyTenders()
  for (const f of list) for (const k of Object.keys(out) as (keyof TenderFigures)[]) out[k] += f[k]
  for (const row of TENDER_FIGURE_ROWS) out[row.key] = row.kind === 'usd' ? r2(out[row.key]) : Math.round(out[row.key])
  return out
}

function forBranch(payments: readonly PaymentRow[], rows: readonly CheckRow[]): TenderFigures {
  const f = emptyTenders()
  for (const p of payments) {
    f.payments += 1
    if (p.tender === 'card') {
      if (p.currency === 'USD') f.cardUsd += p.amount
      else f.cardLbp += p.amount
      f.cardTips += p.tipUsd
    } else if (p.currency === 'USD') f.cashUsdTendered += p.amount
    else f.cashLbpTendered += p.amount
    // Change always comes out of the drawer, whatever the tender.
    f.changeUsd += p.changeUsd
    f.changeLbp += p.changeLbp
    f.appliedUsd += p.rate > 0 ? p.appliedLbp / p.rate : 0
  }
  f.cashUsdKept = f.cashUsdTendered - f.changeUsd
  f.cashLbpKept = f.cashLbpTendered - f.changeLbp
  const paid = new Set(payments.map(p => p.receipt))
  for (const r of rows) {
    if (r.kind === 'refund') {
      f.refundCashUsd -= r.cashUsd
      f.refundCashLbp -= r.cashLbp
      f.refundCardUsd -= r.card
      f.refundCardLbp -= r.cardLbp
      continue
    }
    if (paid.has(r.receipt)) f.billedPaid += r.net
    else f.checksWithoutPayment += 1
  }
  return f
}

export interface TenderSummary {
  byBranch: { branch: string; figures: TenderFigures }[]
  /** The sum of byBranch. */
  total: TenderFigures
}

export function tenderSummary(payments: readonly PaymentRow[], rows: readonly CheckRow[], branches: readonly string[]): TenderSummary {
  const byBranch = branches.map(branch => ({
    branch,
    figures: addTenders([forBranch(payments.filter(p => p.branch === branch), rows.filter(r => r.branch === branch))]),
  }))
  return { byBranch, total: addTenders(byBranch.map(b => b.figures)) }
}

/**
 * Whether applied-to-bills reconciles with billed on paid checks: within a
 * lira rounding per check (each bill is settled to the nearest 1,000 LBP at
 * its rate, which at any rate the café uses is well under $0.05 a check).
 */
export function tendersReconcile(t: TenderFigures, paidChecks: number): boolean {
  return Math.abs(t.appliedUsd - t.billedPaid) <= 0.05 * Math.max(1, paidChecks)
}
