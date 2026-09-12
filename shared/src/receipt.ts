// The receipt a customer is handed.
//
// Two things live here and nothing else: what a receipt SAYS, and how it lays
// out as fixed-width text.
//
// ── Why this exists before the printer does ────────────────────────────────
// The printer make and model are still unknown, and that decision picks the
// transport — Epson ePOS-Print from the browser over the café wifi, or Star
// CloudPRNT with the printer polling out. What it does NOT pick is the
// content. An ESC/POS payload is overwhelmingly plain text at a fixed column
// width with a handful of control codes around it, so the text produced here
// is very close to the bytes a transport will eventually send. Building the
// document now means the hardware decision, when it arrives, is a transport
// and nothing else.
//
// It also means the pilot is not blocked. A browser can print these rows to
// any ordinary printer, which is enough for one section of one branch beside
// the old till.
//
// ── What this is NOT ───────────────────────────────────────────────────────
// VAT appears only when the check recorded the rate in force the day it
// closed (Phase 04, check.vatRate). Prices include it, so it is printed as the
// share of the total that was tax. A check closed before that has no VAT line
// at all rather than one printed as zero or guessed from today's rate: a
// document showing "VAT 0.00" is making a claim about tax it is not entitled
// to make.
//
// How the bill was settled appears only when the till took the money
// (check.payments). Under the old till there is nothing to say, and nothing
// is said.
//
// No React and no Firebase import — the POS renders these rows on screen, a
// print view lays them out for a browser, and a future route handler can hand
// the same rows to a device.

import { checkTotals, grossLineTotal, type Check, type CheckLine } from './checks'
import { zonedParts } from './dates'
import { describeSelections } from './modifiers'
import { billTotals, vatIncluded } from './money'
import { timestampMs } from './timestamps'

// ── The document ───────────────────────────────────────────────────────────
// Deliberately a list of rows rather than a string. A string can only be
// printed one way; rows can be laid out at 32 columns for a 58mm roll, 42 for
// an 80mm one, or as HTML for a browser, without the content being written
// twice and drifting.

export type ReceiptRow =
  | { kind: 'center'; text: string; strong?: boolean }
  | { kind: 'left';   text: string }
  /** A label and a figure. The figure is the part that must never be lost. */
  | { kind: 'pair';   left: string; right: string; strong?: boolean }
  | { kind: 'rule' }
  | { kind: 'blank' }

export interface ReceiptOptions {
  businessName: string
  address?: string
  phone?: string
  /** e.g. 'USD' — prices are held in this one. */
  currency: string
  /** e.g. 'LBP' — what the customer may actually pay in. */
  secondaryCurrency: string
  /**
   * Units of secondaryCurrency per 1 currency.
   *
   * Passed in rather than read from settings here, for the same reason every
   * other money-bearing document in this codebase stores its own rate: a
   * receipt reprinted after the rate moves must show the figures the customer
   * was actually asked for. When Phase 04 records a payment, the rate it was
   * settled at belongs on the check and comes from there.
   */
  exchangeRate: number
  /**
   * The café's timezone, e.g. 'Asia/Beirut'.
   *
   * Required, not optional, and that is the point. This used to be absent and
   * the printed time came from `getHours()` on whichever machine drew the
   * receipt — right only by luck, on a device standing in the café with its
   * clock set correctly. A cheap tablet with the wrong zone printed a wrong
   * time on every receipt a customer took home, and nothing anywhere would
   * have said so. The kitchen ticket next door already took a `timeZone`;
   * the document that leaves the building was the one that did not.
   *
   * Optional with a fallback would have left the old path reachable. Required
   * means the device clock cannot decide this again without someone changing
   * this signature on purpose.
   */
  timeZone: string
  /** Defaults to the check's closedAt, then to now. */
  issuedAt?: Date
  footer?: string
}

/**
 * Why this check cannot produce a receipt yet, or null.
 *
 * Same shape as closeBlockedReason() in checks.ts, and checked for the same
 * reason: an open check has no receipt number, and a numbered document handed
 * to a customer before the sequence issues one is a gap in the series that an
 * accountant will find and nobody will be able to explain.
 */
export function receiptBlockedReason(check: Check): string | null {
  if (check.status === 'open') {
    return 'That check is still open. A receipt is issued when the check closes.'
  }
  if (!check.receiptNumber) {
    return 'That check closed without a receipt number, so it cannot be reprinted.'
  }
  return null
}

function formatMoney(amount: number, currency: string, secondary: string): string {
  // The secondary currency carries no minor unit worth printing — a bill in
  // hundreds of thousands with ".00" on the end is two characters of noise on
  // a roll that is 32 columns wide.
  const digits = currency === secondary ? 0 : 2
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatIssuedAt(date: Date, timeZone: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const p = zonedParts(date, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`
}

/** The line's own description, minus the quantity the pair already shows. */
function lineDetail(line: CheckLine): string | null {
  const parts: string[] = []
  if (line.modifiers.length > 0) parts.push(describeSelections(line.modifiers))
  if (line.seat !== null) parts.push(`seat ${line.seat}`)
  if (line.note) parts.push(line.note)
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Build the receipt for a closed check.
 *
 * Throws when receiptBlockedReason() would return a reason. A throw rather
 * than a degraded document on purpose: there is no useful half of a receipt,
 * and a caller that has not checked is a caller with a bug.
 */
export function buildReceipt(check: Check, opts: ReceiptOptions): ReceiptRow[] {
  const blocked = receiptBlockedReason(check)
  if (blocked) throw new Error(blocked)

  // Not `new Date(check.closedAt)`. closedAt arrives as a Firestore Timestamp,
  // whose valueOf() is a sort key Date cannot parse — that line printed
  // "NaN-NaN-NaN NaN:NaN" on every real receipt. See timestamps.ts.
  const issuedAt = opts.issuedAt ?? new Date(timestampMs(check.closedAt, Date.now()))

  const totals = checkTotals(check)
  // The rate the check was settled at, once there is one. The option is
  // today's setting, and a reprint after the rate moves must show the lira the
  // customer was actually asked for — which is why the first payment fixes it
  // on the check (payments.ts).
  const rate = check.billRate ?? opts.exchangeRate
  const bill = billTotals(totals.net, rate)
  const money = (n: number) => formatMoney(n, opts.currency, opts.secondaryCurrency)

  const rows: ReceiptRow[] = []

  rows.push({ kind: 'center', text: opts.businessName, strong: true })
  if (opts.address) rows.push({ kind: 'center', text: opts.address })
  if (opts.phone)   rows.push({ kind: 'center', text: opts.phone })
  rows.push({ kind: 'blank' })

  rows.push({ kind: 'pair', left: 'Receipt', right: check.receiptNumber as string })
  rows.push({ kind: 'pair', left: 'Table',   right: String(check.tableNumber) })
  if (check.guestCount > 0) {
    rows.push({ kind: 'pair', left: 'Guests', right: String(check.guestCount) })
  }
  rows.push({ kind: 'pair', left: 'Date', right: formatIssuedAt(issuedAt, opts.timeZone) })
  // The local part only. A customer does not need the café's mail domain, and
  // a full address on a receipt left on a table is a staff member's contact
  // detail handed to a stranger.
  rows.push({ kind: 'pair', left: 'Served by', right: check.openedByEmail.split('@')[0] })

  rows.push({ kind: 'rule' })

  // Voided lines are omitted. They were struck off, the customer is not paying
  // for them, and listing them invites an argument at the table about
  // something already resolved. The void and its reason survive on the check,
  // which is where an audit looks.
  for (const line of check.lines) {
    if (line.status === 'void') continue
    rows.push({
      kind: 'pair',
      left: `${line.quantity} x ${line.name}`,
      // grossLineTotal, not unitPrice x quantity: a modifier adds to the price
      // of every unit, and a receipt that ignored them would undercharge on
      // paper for a bill the till got right.
      right: money(grossLineTotal(line)),
    })
    const detail = lineDetail(line)
    if (detail) rows.push({ kind: 'left', text: `  ${detail}` })
    // A manager's comp or item discount, named under the line it applies to.
    // The line still shows its price: what was taken off is the next block.
    if (line.discount) {
      rows.push({
        kind: 'left',
        text: line.discount.kind === 'comp'
          ? '  On the house'
          : `  ${+(line.discount.percent * 100).toFixed(2)}% off`,
      })
    }
  }

  rows.push({ kind: 'rule' })

  // Every discount is its own line, never folded into the total — the same
  // reasoning checkTotals() gives for returning them separately. A discount
  // that quietly prints a smaller number is a discount nobody can audit.
  if (totals.discount > 0 || totals.itemDiscounts > 0 || totals.checkDiscount > 0) {
    rows.push({ kind: 'pair', left: 'Subtotal', right: money(totals.gross) })
  }
  if (totals.discount > 0) {
    rows.push({ kind: 'pair', left: 'Staff discount', right: `-${money(totals.discount)}` })
  }
  if (totals.itemDiscounts > 0) {
    rows.push({ kind: 'pair', left: 'Item discounts', right: `-${money(totals.itemDiscounts)}` })
  }
  if (totals.checkDiscount > 0) {
    const d = check.discount
    rows.push({
      kind: 'pair',
      left: d?.kind === 'percent' ? `Discount ${+(d.value * 100).toFixed(2)}%` : 'Discount',
      right: `-${money(totals.checkDiscount)}`,
    })
  }

  rows.push({
    kind: 'pair',
    left: `Total ${opts.currency}`,
    right: money(bill.usd),
    strong: true,
  })

  rows.push({ kind: 'blank' })
  rows.push({
    kind: 'left',
    text: `At ${formatMoney(rate, opts.secondaryCurrency, opts.secondaryCurrency)} ` +
      `${opts.secondaryCurrency} / 1 ${opts.currency}`,
  })
  if (bill.rounding !== 0) {
    // The adjustment is printed rather than absorbed. Rounding the total is
    // fine; rounding it invisibly is how a customer ends up with a receipt
    // whose lines do not add up to its total.
    const sign = bill.rounding > 0 ? '+' : '-'
    rows.push({
      kind: 'pair',
      left: 'Rounding',
      right: `${sign}${formatMoney(Math.abs(bill.rounding), opts.secondaryCurrency, opts.secondaryCurrency)}`,
    })
  }
  rows.push({
    kind: 'pair',
    left: `Total ${opts.secondaryCurrency}`,
    right: formatMoney(bill.lbp, opts.secondaryCurrency, opts.secondaryCurrency),
    strong: true,
  })

  // The tax inside the total, at the rate the check recorded — never today's.
  if (typeof check.vatRate === 'number') {
    rows.push({
      kind: 'pair',
      left: `Incl. VAT ${+(check.vatRate * 100).toFixed(2)}%`,
      right: money(vatIncluded(bill.usd, check.vatRate)),
    })
  }

  // How it was paid, when the till took the money (Phase 04). Absent on a
  // check closed while the old till still took payment, rather than printed
  // as "Paid: nothing" — the receipt would be making a claim it cannot back.
  const payments = check.payments ?? []
  if (payments.length > 0) {
    rows.push({ kind: 'rule' })
    for (const p of payments) {
      rows.push({
        kind: 'pair',
        left: `${p.tender === 'cash' ? 'Cash' : 'Card'} ${p.currency === 'USD' ? opts.currency : opts.secondaryCurrency}`,
        right: p.currency === 'USD'
          ? money(p.amount)
          : formatMoney(p.amount, opts.secondaryCurrency, opts.secondaryCurrency),
      })
    }
    // Totalled, not per payment: a customer counts the change in their hand
    // once. Each currency on its own line because they were handed over as
    // two separate things.
    const changeUsd = payments.reduce((s, p) => s + p.changeUsd, 0)
    const changeLbp = payments.reduce((s, p) => s + p.changeLbp, 0)
    if (changeUsd > 0) rows.push({ kind: 'pair', left: `Change ${opts.currency}`, right: money(changeUsd) })
    if (changeLbp > 0) {
      rows.push({
        kind: 'pair',
        left: `Change ${opts.secondaryCurrency}`,
        right: formatMoney(changeLbp, opts.secondaryCurrency, opts.secondaryCurrency),
      })
    }
  }

  if (opts.footer) {
    rows.push({ kind: 'blank' })
    rows.push({ kind: 'center', text: opts.footer })
  }

  return rows
}

// ── Laying it out ──────────────────────────────────────────────────────────

/**
 * Column counts for the two thermal roll widths in ordinary use.
 *
 * 58mm rolls print 32 characters, 80mm rolls 42, at the default font. Which
 * one the café has is part of the same unanswered hardware question, so both
 * are supported and neither is assumed.
 */
export const RECEIPT_WIDTHS = { narrow: 32, wide: 42 } as const
export type ReceiptWidth = typeof RECEIPT_WIDTHS[keyof typeof RECEIPT_WIDTHS]

function centerText(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width)
  const left = Math.floor((width - text.length) / 2)
  return ' '.repeat(left) + text
}

/** Break text at word boundaries, splitting a word only if it alone is too long. */
function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text]
  const out: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    if (current === '') {
      current = word
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word
    } else {
      out.push(current)
      current = word
    }
    // A single word longer than the roll — a product name with no spaces —
    // still has to be cut, but only that word and only after everything else
    // has been given its own line.
    while (current.length > width) {
      out.push(current.slice(0, width))
      current = current.slice(width)
    }
  }
  if (current !== '') out.push(current)
  return out.length > 0 ? out : ['']
}

function pairText(left: string, right: string, width: number): string[] {
  // The figure is never truncated and never wrapped: it is the part of the
  // line a customer checks.
  if (left.length + 1 + right.length <= width) {
    return [left + ' '.repeat(width - left.length - right.length) + right]
  }

  // The label wraps instead of being cut. "Catan Board Game (Retail Edi" with
  // the rest missing is a complaint at the counter; two lines are not. The
  // figure then joins the last label line if it fits, and otherwise takes a
  // line of its own, right-aligned — which is what a paper receipt does.
  const wrapped = wrapText(left, width)
  const last = wrapped[wrapped.length - 1]
  if (last.length + 1 + right.length <= width) {
    wrapped[wrapped.length - 1] = last + ' '.repeat(width - last.length - right.length) + right
    return wrapped
  }
  return [...wrapped, ' '.repeat(Math.max(0, width - right.length)) + right]
}

/**
 * The receipt as fixed-width text.
 *
 * This is the artifact a printer transport will want: an ESC/POS device is fed
 * lines of text at a known column count. Rendering it here rather than inside
 * a future adapter keeps the layout testable without a device attached, and
 * means a browser print view and a thermal printer produce the same document
 * rather than two that drift.
 */
/**
 * A left-aligned row, wrapped rather than cut.
 *
 * This used to be `text.slice(0, width)`, which is the same defect pairText()
 * goes out of its way to avoid one function above: a name losing its end is
 * worse than a name taking two lines. It did not show on a receipt, where the
 * only left rows are short modifier lines — it showed the moment kitchen
 * tickets started using left rows for item names, and printed
 * "Halloumi & Zaatar Manou" for a cook to guess at.
 *
 * Continuation lines keep the row's own indentation, so an option indented
 * under its item still reads as belonging to it after it wraps.
 */
function leftText(text: string, width: number): string[] {
  if (text.length <= width) return [text]
  const indent = /^\s*/.exec(text)?.[0] ?? ''
  // Only if the indent leaves room to write anything; a pathological indent
  // wider than the roll would otherwise loop forever making empty lines.
  const body = indent.length < width ? width - indent.length : width
  const [first, ...rest] = wrapText(text.trimStart(), body)
  return [indent + first, ...rest.map(l => indent + l)]
}

export function receiptToText(rows: ReceiptRow[], width: number = RECEIPT_WIDTHS.narrow): string {
  const out: string[] = []
  for (const row of rows) {
    switch (row.kind) {
      case 'center': out.push(centerText(row.text, width)); break
      case 'left':   out.push(...leftText(row.text, width)); break
      case 'pair':   out.push(...pairText(row.left, row.right, width)); break
      case 'rule':   out.push('-'.repeat(width)); break
      case 'blank':  out.push(''); break
    }
  }
  // Trailing whitespace is stripped per line: it is invisible on paper and
  // only makes the text awkward to diff in a test.
  return out.map(l => l.replace(/\s+$/, '')).join('\n')
}
