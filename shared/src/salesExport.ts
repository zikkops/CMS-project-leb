// Turning closed checks into something an accountant can work from.
//
// "Accounting — export instead" is a decision in the product plan rather than
// a gap: this system is not going to do double-entry, and every POS buyer asks
// for the export in the first sales call. So this is the seam where the café's
// own records leave it.
//
// ── Why it is pure, and why that matters here ──────────────────────────────
// Three of this repo's worst bugs live in exactly the arithmetic below, and
// all three were invisible to tsc and to a passing build:
//
//   the day       a calendar day judged in the HOST's zone, not the café's,
//                 numbered receipts into the wrong month
//   the VAT       prices INCLUDE VAT, so it is extracted from a total, never
//                 added to one — and each check carries the rate it closed at
//   the rate      a lira figure must use the rate that check was settled at,
//                 not today's, or last year's export changes every time it is
//                 re-run
//
// Nothing here reads a clock, a database or a setting on its own: everything
// arrives as an argument, so scripts/verify-export.mjs can pin each case to an
// explicit zone, rate and date.

import { checkTotals, orderTypeOf, ORDER_TYPES, type Check } from './checks'
import { vatIncluded } from './money'
import { ymdInZone } from './dates'
import { timestampMs } from './timestamps'

export interface ExportOptions {
  /** The café's zone. Day boundaries are judged here and nowhere else. */
  timeZone: string
  /**
   * Used ONLY for a check with no billRate of its own — one closed before the
   * till took payment. A check that was settled carries its own rate and this
   * is never consulted for it.
   */
  fallbackRate: number
}

export interface CheckRow {
  receipt: string
  /** Café-local calendar day, 'YYYY-MM-DD'. */
  day: string
  /** Café-local time of day, 'HH:MM'. */
  time: string
  branch: string
  table: number
  /** Dine in, Takeaway, Delivery or Tab (UPGRADE.md T5.5); a check from before types is Dine in. */
  order: string
  guests: number
  status: string
  gross: number
  staffMeal: number
  itemDiscounts: number
  checkDiscount: number
  /** The service charge (T3.8), inside net. */
  service: number
  net: number
  /** Null when the check predates VAT being recorded — never guessed. */
  vatRate: number | null
  vat: number
  rate: number
  netLbp: number
  cashUsd: number
  cashLbp: number
  card: number
  server: string
}

export interface PaymentRow {
  receipt: string
  day: string
  branch: string
  tender: string
  currency: string
  amount: number
  appliedLbp: number
  changeUsd: number
  changeLbp: number
  rate: number
}

export interface DayRow {
  day: string
  branch: string
  checks: number
  gross: number
  discounts: number
  /** Service charges (T3.8), inside net. */
  service: number
  net: number
  vat: number
  /** Refunded checks, kept apart from sales rather than netted into them. */
  refunds: number
  refundedChecks: number
  cashUsd: number
  cashLbp: number
  card: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** A check is only in an export once it has closed and been numbered. */
export function isExportable(check: Pick<Check, 'status' | 'receiptNumber'>): boolean {
  return Boolean(check.receiptNumber) && (check.status === 'closed' || check.status === 'refunded')
}

/**
 * The café-local day and time a check closed.
 *
 * Through timestampMs(), because closedAt arrives from Firestore as a
 * Timestamp and `new Date(timestamp)` is Invalid Date — that printed
 * "NaN-NaN-NaN" on every real receipt while a verifier passed on a string.
 */
export function closedAtParts(
  closedAt: unknown,
  timeZone: string,
): { day: string; time: string } {
  const ms = timestampMs(closedAt, 0)
  if (!ms) return { day: '', time: '' }
  const at = new Date(ms)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at)
  return { day: ymdInZone(at, timeZone), time }
}

/** What was taken on this check, split the way a drawer is counted. */
function tenders(check: Check): { cashUsd: number; cashLbp: number; card: number } {
  let cashUsd = 0
  let cashLbp = 0
  let card = 0
  for (const p of check.payments ?? []) {
    if (p.tender === 'card') card += p.currency === 'USD' ? p.amount : 0
    else if (p.currency === 'USD') cashUsd += p.amount
    else cashLbp += p.amount
  }
  // Card in lira is recorded on its payment row rather than folded into a
  // dollar column at some rate — the two currencies are never netted, the
  // same rule the drawer count follows.
  return { cashUsd: r2(cashUsd), cashLbp: Math.round(cashLbp), card: r2(card) }
}

export function checkRow(check: Check, opts: ExportOptions): CheckRow {
  const totals = checkTotals(check)
  const { day, time } = closedAtParts(check.closedAt, opts.timeZone)
  const rate = check.billRate ?? opts.fallbackRate
  const vatRate = typeof check.vatRate === 'number' ? check.vatRate : null
  const t = tenders(check)

  return {
    receipt: check.receiptNumber ?? '',
    day,
    time,
    branch: check.branch,
    table: check.tableNumber,
    order: ORDER_TYPES.find(o => o.key === orderTypeOf(check))!.label,
    guests: check.guestCount,
    status: check.status,
    gross: totals.gross,
    staffMeal: totals.discount,
    itemDiscounts: totals.itemDiscounts,
    checkDiscount: totals.checkDiscount,
    service: totals.service,
    net: totals.net,
    vatRate,
    // Extracted, never added: the menu price already contains it. A check with
    // no recorded rate contributes no VAT rather than a guess at today's.
    vat: vatRate === null ? 0 : vatIncluded(totals.net, vatRate),
    rate,
    netLbp: Math.round(totals.net * rate),
    ...t,
    server: check.openedByEmail ?? '',
  }
}

export function paymentRows(check: Check, opts: ExportOptions): PaymentRow[] {
  const { day } = closedAtParts(check.closedAt, opts.timeZone)
  const rate = check.billRate ?? opts.fallbackRate
  return (check.payments ?? []).map(p => ({
    receipt: check.receiptNumber ?? '',
    day,
    branch: check.branch,
    tender: p.tender,
    currency: p.currency,
    amount: p.currency === 'USD' ? r2(p.amount) : Math.round(p.amount),
    appliedLbp: Math.round(p.appliedLbp ?? 0),
    changeUsd: r2(p.changeUsd ?? 0),
    changeLbp: Math.round(p.changeLbp ?? 0),
    rate,
  }))
}

/**
 * One row per café-day per branch.
 *
 * Refunds are their own column and their own count. Netting a refund into the
 * day's sales hides both the sale and the refund, and an accountant asking
 * "what did we take on the 4th" is asking about a figure that reconciles with
 * a drawer, not a net position.
 */
export function dayRows(rows: readonly CheckRow[]): DayRow[] {
  const byKey = new Map<string, DayRow>()
  for (const row of rows) {
    if (!row.day) continue
    const key = `${row.day}|${row.branch}`
    let d = byKey.get(key)
    if (!d) {
      d = {
        day: row.day, branch: row.branch, checks: 0, gross: 0, discounts: 0, service: 0,
        net: 0, vat: 0, refunds: 0, refundedChecks: 0, cashUsd: 0, cashLbp: 0, card: 0,
      }
      byKey.set(key, d)
    }
    if (row.status === 'refunded') {
      d.refundedChecks += 1
      d.refunds = r2(d.refunds + row.net)
      continue
    }
    d.checks += 1
    d.gross = r2(d.gross + row.gross)
    d.discounts = r2(d.discounts + row.staffMeal + row.itemDiscounts + row.checkDiscount)
    d.service = r2(d.service + row.service)
    d.net = r2(d.net + row.net)
    d.vat = r2(d.vat + row.vat)
    d.cashUsd = r2(d.cashUsd + row.cashUsd)
    d.cashLbp = Math.round(d.cashLbp + row.cashLbp)
    d.card = r2(d.card + row.card)
  }
  return [...byKey.values()].sort((a, b) => (a.day === b.day ? a.branch.localeCompare(b.branch) : a.day.localeCompare(b.day)))
}

export interface SalesExport {
  checks: CheckRow[]
  payments: PaymentRow[]
  days: DayRow[]
}

export function buildExport(checks: readonly Check[], opts: ExportOptions): SalesExport {
  const exportable = checks.filter(isExportable)
  const rows = exportable.map(c => checkRow(c, opts))
  // Sorted by when it happened rather than by document id: an export is read
  // down the page, and a receipt sequence is not a chronology once two
  // branches are trading at once.
  rows.sort((a, b) => (a.day === b.day ? a.time.localeCompare(b.time) : a.day.localeCompare(b.day)))
  return {
    checks: rows,
    payments: exportable.flatMap(c => paymentRows(c, opts)),
    days: dayRows(rows),
  }
}

/** Column headings, in the order the sheets are written. Shared with the UI. */
export const SHEETS = {
  checks: [
    ['receipt', 'Receipt'], ['day', 'Day'], ['time', 'Time'], ['branch', 'Branch'],
    ['table', 'Table'], ['order', 'Order'], ['guests', 'Guests'], ['status', 'Status'],
    ['gross', 'Gross USD'], ['staffMeal', 'Staff meal'], ['itemDiscounts', 'Item discounts'],
    ['checkDiscount', 'Check discount'], ['service', 'Service'], ['net', 'Net USD'],
    ['vatRate', 'VAT rate'], ['vat', 'VAT incl. USD'],
    ['rate', 'Rate'], ['netLbp', 'Net LBP'],
    ['cashUsd', 'Cash USD'], ['cashLbp', 'Cash LBP'], ['card', 'Card USD'],
    ['server', 'Opened by'],
  ],
  payments: [
    ['receipt', 'Receipt'], ['day', 'Day'], ['branch', 'Branch'],
    ['tender', 'Tender'], ['currency', 'Currency'], ['amount', 'Amount'],
    ['appliedLbp', 'Applied LBP'], ['changeUsd', 'Change USD'], ['changeLbp', 'Change LBP'],
    ['rate', 'Rate'],
  ],
  days: [
    ['day', 'Day'], ['branch', 'Branch'], ['checks', 'Checks'],
    ['gross', 'Gross USD'], ['discounts', 'Discounts'], ['service', 'Service'], ['net', 'Net USD'], ['vat', 'VAT incl. USD'],
    ['refundedChecks', 'Refunded checks'], ['refunds', 'Refunded USD'],
    ['cashUsd', 'Cash USD'], ['cashLbp', 'Cash LBP'], ['card', 'Card USD'],
  ],
} as const
