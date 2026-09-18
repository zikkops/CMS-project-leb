// The cash drawer — Phase 04, slice 4. The arithmetic, and nothing else.
//
// One drawer per branch (owner's decision, 11 Sep 2026): waiters take cash at
// the table and hand it to the counter, so the drawer is the branch's, not a
// phone's. A shift opens with a float and closes with a count, and the
// question every close asks is the same one — what should be in there, and
// what is.
//
// No React and no Firebase, for the reason payments.ts gives: the till's
// X reading, the server's Z close and the end-of-day report must all get one
// answer, and two answers is how a drawer stops reconciling.
//
// ── Two currencies, kept apart ─────────────────────────────────────────────
// Expected and counted are compared per currency and never converted. A
// drawer $20 short and 1,790,000 LBP over is not "balanced" — it is a $20
// note that went somewhere and lira that came from somewhere, and netting
// them at the day's rate would hide both. (The vault's "all or nothing"
// rule: a drawer that counts one currency approximately is a drawer nobody
// trusts.)

import type { Payment } from './payments'

// Moved here from endOfDay.ts, which re-exports them: that module imports the
// Firebase client, and these have to be usable where it cannot go.
export const LBP_DENOMS = [100000, 50000, 20000, 10000, 5000, 1000] as const
export const USD_DENOMS = [100, 50, 20, 10, 5, 1] as const

/** Denomination (as a string key) → number of notes. */
export type DenomCount = Record<string, number>

export interface Money2 { usd: number; lbp: number }

const cents = (n: number) => Math.round(n * 100) / 100

/** What a note-by-note count comes to, per currency. Missing and nonsense counts are zero. */
export function countedCash(lbp: DenomCount, usd: DenomCount): Money2 {
  const add = (denoms: readonly number[], c: DenomCount) =>
    denoms.reduce((s, d) => {
      const n = Number(c?.[String(d)] ?? 0)
      return s + (Number.isInteger(n) && n > 0 ? n * d : 0)
    }, 0)
  return { usd: add(USD_DENOMS, usd), lbp: add(LBP_DENOMS, lbp) }
}

export type DrawerPayment = Pick<Payment, 'tender' | 'currency' | 'amount' | 'changeUsd' | 'changeLbp'>

export interface Refund {
  /** Cash that goes back out of the drawer, per currency. Can be negative in one currency — see refundOf(). */
  cash: Money2
  /** Goes back on the card, not out of the drawer. */
  card: Money2
}

/**
 * What refunding a check puts back, from the payments it was settled with.
 *
 * The drawer is returned to exactly where it was before the sale, currency by
 * currency. A customer who paid $20 and got $10 + 45,000 LBP back is refunded
 * the $10 net, and the 45,000 LBP comes back into the drawer — which makes the
 * LBP figure negative. That is the honest reversal; netting it into dollars
 * at some rate is the conversion this module refuses to do.
 */
export function refundOf(payments: readonly DrawerPayment[]): Refund {
  const r: Refund = { cash: { usd: 0, lbp: 0 }, card: { usd: 0, lbp: 0 } }
  for (const p of payments) {
    const side = p.tender === 'cash' ? r.cash : r.card
    if (p.currency === 'USD') side.usd += p.amount
    else side.lbp += p.amount
    r.cash.usd -= p.changeUsd
    r.cash.lbp -= p.changeLbp
  }
  return {
    cash: { usd: cents(r.cash.usd), lbp: Math.round(r.cash.lbp) },
    card: { usd: cents(r.card.usd), lbp: Math.round(r.card.lbp) },
  }
}

// ── Cash that is not a sale (UPGRADE.md T3.1) ─────────────────────────────
// A supplier paid from the drawer, the float topped up, notes taken to the
// safe mid-shift: until these were recorded the drawer read short or over by
// exactly that much, and the only record was somebody's memory at the count.
// Each is per currency, like everything else here, and is never converted.

export type MovementKind = 'paidOut' | 'payIn' | 'safeDrop'

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  paidOut: 'Paid out',
  payIn: 'Paid in',
  safeDrop: 'Safe drop',
}

/**
 * Why cash left or came in. A short list rather than free text, so the
 * report can add them up; "Other" needs a note. (Owner's choice to confirm,
 * UPGRADE.md T3.1: the reasons, and who may record them.)
 */
export const MOVEMENT_REASONS: Record<MovementKind, readonly string[]> = {
  paidOut: ['Supplier paid in cash', 'Café supplies bought', 'Staff advance', 'Other'],
  payIn: ['Float topped up', 'Change brought from the safe or bank', 'Other'],
  safeDrop: ['Taken to the safe'],
}

export interface DrawerMovement {
  /** Made by the till, so the same movement sent twice is recorded once. */
  id: string
  kind: MovementKind
  usd: number
  lbp: number
  reason: string
  note: string
  by?: string
  byEmail?: string
  /** Milliseconds. */
  at?: number
}

/** Why this movement cannot be recorded, or null. Checked on the server. */
export function movementProblem(m: Pick<DrawerMovement, 'kind' | 'usd' | 'lbp' | 'reason' | 'note'>): string | null {
  if (!Object.prototype.hasOwnProperty.call(MOVEMENT_REASONS, m.kind)) return 'Choose paid out, paid in or safe drop.'
  for (const [label, v, max] of [['USD', m.usd, 100_000], ['LBP', m.lbp, 10_000_000_000]] as const) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return `The ${label} amount must be zero or more.`
    if (v > max) return `That ${label} amount is too large to be right.`
  }
  if (Math.abs(m.usd * 100 - Math.round(m.usd * 100)) > 1e-6) return 'Dollars go to the cent, no further.'
  if (!Number.isInteger(m.lbp)) return 'Lira are whole numbers.'
  if (m.usd === 0 && m.lbp === 0) return 'Type how much, in dollars, lira or both.'
  if (!MOVEMENT_REASONS[m.kind].includes(m.reason)) return 'Choose a reason from the list.'
  if (m.reason === 'Other' && !m.note.trim()) return 'Say what it was for.'
  if (m.note.length > 200) return 'Keep the note under 200 characters.'
  return null
}

export interface DrawerTotals {
  float: Money2
  /** Handed over in cash. */
  cashIn: Money2
  /** Handed back as change. */
  change: Money2
  /** Cash paid out for refunds made during the shift. */
  refunds: Money2
  /** Charged to cards. Never in the drawer; shown so the Z report is the whole shift. */
  card: Money2
  /** Cash that is not a sale (T3.1). Absent on totals stored before it existed: read with ?? zero. */
  paidOuts?: Money2
  payIns?: Money2
  safeDrops?: Money2
  /** What should be in the drawer now. */
  expected: Money2
  payments: number
}

/**
 * What a shift should have in its drawer.
 *
 * float + cash in − change − cash refunded − paid out − dropped in the safe
 * + paid in. Card payments are totalled for the report and change nothing
 * here: a card slip is not a note in a drawer.
 */
export function drawerTotals(
  float: Money2,
  payments: readonly DrawerPayment[],
  refunds: readonly Refund[] = [],
  movements: readonly Pick<DrawerMovement, 'kind' | 'usd' | 'lbp'>[] = [],
): DrawerTotals {
  const t = {
    cashIn: { usd: 0, lbp: 0 }, change: { usd: 0, lbp: 0 },
    card: { usd: 0, lbp: 0 }, refunds: { usd: 0, lbp: 0 },
    paidOuts: { usd: 0, lbp: 0 }, payIns: { usd: 0, lbp: 0 }, safeDrops: { usd: 0, lbp: 0 },
  }
  for (const m of movements) {
    const side = m.kind === 'paidOut' ? t.paidOuts : m.kind === 'payIn' ? t.payIns : m.kind === 'safeDrop' ? t.safeDrops : null
    if (!side) continue
    side.usd += m.usd
    side.lbp += m.lbp
  }
  for (const p of payments) {
    const side = p.tender === 'cash' ? t.cashIn : t.card
    if (p.currency === 'USD') side.usd += p.amount
    else side.lbp += p.amount
    t.change.usd += p.changeUsd
    t.change.lbp += p.changeLbp
  }
  for (const r of refunds) {
    t.refunds.usd += r.cash.usd
    t.refunds.lbp += r.cash.lbp
  }
  const round = (m: Money2): Money2 => ({ usd: cents(m.usd), lbp: Math.round(m.lbp) })
  return {
    float: round(float),
    cashIn: round(t.cashIn),
    change: round(t.change),
    refunds: round(t.refunds),
    card: round(t.card),
    paidOuts: round(t.paidOuts),
    payIns: round(t.payIns),
    safeDrops: round(t.safeDrops),
    expected: round({
      usd: float.usd + t.cashIn.usd - t.change.usd - t.refunds.usd - t.paidOuts.usd - t.safeDrops.usd + t.payIns.usd,
      lbp: float.lbp + t.cashIn.lbp - t.change.lbp - t.refunds.lbp - t.paidOuts.lbp - t.safeDrops.lbp + t.payIns.lbp,
    }),
    payments: payments.length,
  }
}

/** Counted minus expected, per currency. Negative is short; positive is over. Never netted across currencies. */
export function drawerDifference(expected: Money2, counted: Money2): Money2 {
  return { usd: cents(counted.usd - expected.usd), lbp: Math.round(counted.lbp - expected.lbp) }
}

export interface DaySystem {
  shifts: number
  /** Shifts not yet closed — their figure is live and will still move. */
  open: number
  /** What the day's drawers should hold, per currency. */
  expected: Money2
  /** The same, as End of Day's "system" figure: LBP at the report's rate. */
  systemLbp: number
}

/**
 * End of Day's "system" figure, from the day's drawer shifts.
 *
 * The owner's answers (12 Sep 2026) decide what goes in it: the figure typed
 * from the old till was CASH sales only, and the end-of-day count is made
 * with the float still in the drawer. So the matching figure is what the
 * drawers should hold — float + cash − change − cash refunds, each shift's
 * `expected` — summed across the day. Card takings are not in it; leaving
 * the float out would have every day read "over" by exactly the float.
 *
 * In LBP at the rate given, because that is the unit the End of Day form has
 * always compared in. The per-currency figure is returned alongside so the
 * form can show what the drawers held, not just the conversion.
 */
export function daySystem(shifts: readonly { expected: Money2; open: boolean }[], rate: number): DaySystem {
  const usd = shifts.reduce((s, x) => s + x.expected.usd, 0)
  const lbp = shifts.reduce((s, x) => s + x.expected.lbp, 0)
  return {
    shifts: shifts.length,
    open: shifts.filter(x => x.open).length,
    expected: { usd: cents(usd), lbp: Math.round(lbp) },
    systemLbp: Math.round(usd * rate + lbp),
  }
}

/** Why this float is not one, or null. Checked on the server when a shift opens. */
export function floatProblem(f: Money2): string | null {
  for (const [label, v, max] of [['USD', f.usd, 100_000], ['LBP', f.lbp, 10_000_000_000]] as const) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return `The ${label} float must be zero or more.`
    if (v > max) return `That ${label} float is too large to be right.`
  }
  if (Math.abs(f.usd * 100 - Math.round(f.usd * 100)) > 1e-6) return 'Dollars go to the cent, no further.'
  if (!Number.isInteger(f.lbp)) return 'Lira are whole numbers.'
  return null
}
