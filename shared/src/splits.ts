// Splitting a bill — Phase 04, slice 3.
//
// A split is not a new kind of record. The owner's decision (11 Sep 2026) is
// one receipt with several payments, so splitting only works out how much
// each person's payment should be; the payments themselves are the ordinary
// ones from payments.ts. Nothing here is stored.
//
// Every figure is built from lineTotal(), the same per-line figure the bill
// adds up, so the shares of a bill add up to the bill — a staff discount
// included, a voided line excluded — and a split can never leave a cent owed
// that nobody was asked for.

import {
  lineTotal, linesForSeat, seatsUsed,
  type Check,
} from './checks'

type Priced = Pick<Check, 'lines' | 'staffDiscount'>

const toCents = (n: number) => Math.round(n * 100)

/**
 * A total divided N ways, to the cent, adding up to exactly the total.
 *
 * The cents that do not divide go to the first shares, one each — $10.00 three
 * ways is 3.34 + 3.33 + 3.33. Rounding every share the same way instead leaves
 * the table a cent short or a cent over, and one of them argues about it.
 */
export function splitEvenly(totalUsd: number, ways: number): number[] {
  const n = Math.floor(ways)
  if (!Number.isFinite(n) || n < 1 || n > 40 || !(totalUsd >= 0)) return []
  const cents = toCents(totalUsd)
  const base = Math.floor(cents / n)
  const extra = cents - base * n
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 100)
}

export interface SeatShare {
  /** null: lines ordered for the table rather than for a seat. */
  seat: number | null
  usd: number
  items: number
}

/**
 * What each seat ordered, after any staff discount.
 *
 * Lines with no seat are returned as one "table" share and not divided up.
 * Whether shared plates are split or paid by one person is the table's
 * decision, and a till that guessed would guess wrong half the time.
 */
export function sharesBySeat(check: Priced): SeatShare[] {
  const share = (seat: number | null): SeatShare => {
    const lines = linesForSeat(check.lines, seat)
    return {
      seat,
      usd: lines.reduce((c, l) => c + toCents(lineTotal(l, check.staffDiscount)), 0) / 100,
      items: lines.reduce((n, l) => n + l.quantity, 0),
    }
  }
  const out = seatsUsed(check.lines).map(share)
  const table = share(null)
  if (table.items > 0) out.push(table)
  return out
}

/** What a chosen set of lines comes to, after any staff discount. Voided and unknown lines count for nothing. */
export function shareForLines(check: Priced, lineIds: readonly string[]): number {
  const chosen = new Set(lineIds)
  return check.lines
    .filter(l => chosen.has(l.id) && l.status !== 'void')
    .reduce((c, l) => c + toCents(lineTotal(l, check.staffDiscount)), 0) / 100
}
