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
  checkTotals, lineTotal, linesForSeat, seatsUsed,
  type Check,
} from './checks'

type Priced = Pick<Check, 'lines' | 'staffDiscount'> & Partial<Pick<Check, 'discount'>>

const toCents = (n: number) => Math.round(n * 100)

/**
 * Shares (in cents) scaled so they sum to exactly `targetCents` — a whole-check
 * discount spread over them in proportion (slice 6). Largest remainder, so the
 * cents that do not divide go to the shares that lost most to rounding, and
 * the seat shares still add up to the bill.
 */
function spreadTo(cents: number[], targetCents: number): number[] {
  const total = cents.reduce((a, b) => a + b, 0)
  if (total <= 0 || total === targetCents) return cents
  const exact = cents.map(c => (c * targetCents) / total)
  const floors = exact.map(Math.floor)
  let left = targetCents - floors.reduce((a, b) => a + b, 0)
  const order = exact.map((e, i) => ({ i, frac: e - floors[i] })).sort((a, b) => b.frac - a.frac)
  for (const { i } of order) { if (left <= 0) break; floors[i]++; left-- }
  return floors
}

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
  // A whole-check discount belongs to everyone at the table, in proportion.
  const net = toCents(checkTotals(check).net)
  const spread = spreadTo(out.map(s => toCents(s.usd)), net)
  return out.map((s, i) => ({ ...s, usd: spread[i] / 100 }))
}

export interface PersonShare {
  /** 1-based. */
  person: number
  usd: number
  /** The lines this person pays all or part of. */
  lineIds: string[]
}

/** Most people a bill is split between. A table of forty is a set menu, not a split. */
export const MAX_SPLIT_PEOPLE = 40

/**
 * A bill split between any number of people, item by item (owner's request,
 * 14 Sep 2026: choose how to split the bill, for any number of people).
 *
 * `assigned` maps a line to the people who had it, 1-based. A line given to
 * nobody — or only to people outside the party — is shared by everyone. A
 * line shared by several is divided evenly between them to the cent, the odd
 * cents to the first of them, as splitEvenly() does. A whole-check discount is
 * spread over everyone in proportion, and the shares add up to exactly the
 * bill: a split can never leave a cent owed that nobody was asked for.
 */
export function sharesByPerson(
  check: Priced,
  people: number,
  assigned: Readonly<Record<string, readonly number[]>>,
): PersonShare[] {
  const n = Math.floor(people)
  if (!Number.isFinite(n) || n < 1 || n > MAX_SPLIT_PEOPLE) return []
  const cents = new Array<number>(n).fill(0)
  const lineIds = Array.from({ length: n }, () => [] as string[])
  const everyone = Array.from({ length: n }, (_, i) => i + 1)

  for (const l of check.lines) {
    if (l.status === 'void') continue
    const lineCents = toCents(lineTotal(l, check.staffDiscount))
    const who = [...new Set((assigned[l.id] ?? []).filter(p => Number.isInteger(p) && p >= 1 && p <= n))].sort((a, b) => a - b)
    const payers = who.length > 0 ? who : everyone
    const base = Math.floor(lineCents / payers.length)
    const extra = lineCents - base * payers.length
    payers.forEach((p, i) => {
      cents[p - 1] += base + (i < extra ? 1 : 0)
      lineIds[p - 1].push(l.id)
    })
  }

  const spread = spreadTo(cents, toCents(checkTotals(check).net))
  return spread.map((c, i) => ({ person: i + 1, usd: c / 100, lineIds: lineIds[i] }))
}

/** What a chosen set of lines comes to, after any staff discount. Voided and unknown lines count for nothing. */
export function shareForLines(check: Priced, lineIds: readonly string[]): number {
  const chosen = new Set(lineIds)
  const cents = check.lines
    .filter(l => chosen.has(l.id) && l.status !== 'void')
    .reduce((c, l) => c + toCents(lineTotal(l, check.staffDiscount)), 0)
  // The same proportion of any whole-check discount, and of the service
  // charge, the chosen items carry (UPGRADE.md T3.8).
  const t = checkTotals(check)
  return t.subtotal > 0 && t.net !== t.subtotal
    ? Math.round(cents * (t.net / t.subtotal)) / 100
    : cents / 100
}
