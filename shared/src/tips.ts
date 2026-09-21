// Splitting the tips.
//
// ── Why this is not three lines in a page ──────────────────────────────────
// It was, and the constant at the top of it was wrong. The tips calculator
// carried `const DEDUCTION = 0.11` while Business Settings offered an editable
// `tipsDeductionRate` on a form that implies it matters. Changing the setting
// changed nothing: every payout kept coming out at 11%, and there was no
// symptom — just a number, slightly wrong, handed to staff.
//
// `audit:branding` had been flagging that line for weeks as a hardcoded 11%.
// It was filed as a branding smell; nobody noticed the same line meant the
// setting was ignored.
//
// ── The rule the arithmetic follows ────────────────────────────────────────
// A deduction comes off the pot, and what is left is split by shift points —
// a double shift counts twice. The parts must add up to the pot: money that
// disappears into rounding is money somebody was owed, so the remaining cents
// are handed out by largest remainder rather than dropped.

/** What one attendance entry is worth. A day off is not a share. */
export const SHIFT_POINTS: Record<string, number> = {
  none: 0,
  single: 1,
  double: 2,
}

export function shiftPoints(shift: string): number {
  return SHIFT_POINTS[shift] ?? 1
}

export interface Attendee {
  name: string
  shift: string
  /**
   * How much a shift of theirs counts (UPGRADE.md T7.18), as set on the staff
   * pay panel for that day. Absent: 1. Zero: not in the tips.
   */
  weight?: number
}

export interface StaffTip {
  name: string
  shiftPoints: number
  /** Shift points × their weight: what the pot is split by. Equal to shiftPoints at weight 1. */
  weightedPoints: number
  earned: number
}

/** A weight that is not a sensible number counts as 1, never as 0 or as a fortune. */
function safeWeight(w: number | undefined): number {
  return w === undefined ? 1 : Number.isFinite(w) && w >= 0 && w <= 5 ? w : 1
}

export interface TipDistribution {
  totalTipsUsd: number
  /** The rate actually used, after the guard below. */
  deductionRate: number
  deductedUsd: number
  netTipsUsd: number
  totalShiftPoints: number
  /** Shift points × weights, summed: what the pot is divided by. */
  totalWeightedPoints: number
  /** What one shift point is worth, before rounding. Display only. */
  perPoint: number
  staff: StaffTip[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * A rate that is not a sensible fraction takes nothing off.
 *
 * The alternative — trusting whatever arrived — means a misconfigured or
 * missing setting can quietly take 100% of the tips, and the failure looks
 * like a pot of zero rather than like an error. Nothing is the safe direction:
 * staff are paid too much rather than not at all, and somebody notices.
 */
function safeRate(rate: number): number {
  return Number.isFinite(rate) && rate > 0 && rate < 1 ? rate : 0
}

export function distributeTips(
  totalTipsUsd: number,
  deductionRate: number,
  attendance: readonly Attendee[],
): TipDistribution {
  return distributeTipDays([{ tipsUsd: totalTipsUsd, deductionRate }], attendance)
}

/**
 * The pot of several days, each day's deduction at the rate THAT day was saved
 * with (UPGRADE.md T7.11, reporting gap 16), then split as one pot. So a
 * month worked out again after the setting changed comes out as it did: the
 * VAT rule again. `deductionRate` on the answer is what came off overall,
 * deducted ÷ pot, for display.
 */
export function distributeTipDays(
  days: readonly { tipsUsd: number; deductionRate: number }[],
  attendance: readonly Attendee[],
): TipDistribution {
  let total = 0
  let net = 0
  for (const d of days) {
    const tips = Number.isFinite(d.tipsUsd) && d.tipsUsd > 0 ? r2(d.tipsUsd) : 0
    total = r2(total + tips)
    net = r2(net + r2(tips * (1 - safeRate(d.deductionRate))))
  }
  const rate = total > 0 ? Math.round(((total - net) / total) * 1_000_000) / 1_000_000 : days.length === 1 ? safeRate(days[0].deductionRate) : 0

  // Points accumulate per person across the whole period: somebody who worked
  // six doubles is one row worth twelve, not six rows.
  // Each day's shift is weighted by that day's weight, so a raise in the
  // middle of a month counts from the day it took effect.
  const points = new Map<string, number>()
  const weighted = new Map<string, number>()
  for (const a of attendance) {
    const p = shiftPoints(a.shift)
    if (p <= 0) continue
    const name = a.name.trim()
    if (!name) continue
    points.set(name, (points.get(name) ?? 0) + p)
    weighted.set(name, (weighted.get(name) ?? 0) + p * safeWeight(a.weight))
  }

  const totalShiftPoints = [...points.values()].reduce((s, v) => s + v, 0)
  const totalWeightedPoints = [...weighted.values()].reduce((s, v) => s + v, 0)
  const perPoint = totalWeightedPoints > 0 ? net / totalWeightedPoints : 0

  // Largest remainder, in cents, so the shares add up to the pot exactly.
  // Dropping the odd cent is the same bug as netting a refund into sales: a
  // small amount of somebody's money going quietly missing.
  const cents = Math.round(net * 100)
  const entries = [...points.entries()].map(([name, pts]) => {
    const wp = weighted.get(name) ?? 0
    const exact = totalWeightedPoints > 0 ? (cents * wp) / totalWeightedPoints : 0
    const floor = Math.floor(exact + 1e-9)
    return { name, shiftPoints: pts, weightedPoints: wp, floor, remainder: exact - floor }
  })

  let left = cents - entries.reduce((s, e) => s + e.floor, 0)
  const order = [...entries].sort((a, b) =>
    b.remainder - a.remainder || b.weightedPoints - a.weightedPoints || a.name.localeCompare(b.name))
  // Nobody at weight 0 is handed a leftover cent: they are out of the tips.
  for (const e of order.filter(x => x.weightedPoints > 0)) {
    if (left <= 0) break
    e.floor += 1
    left -= 1
  }

  const staff: StaffTip[] = entries
    .map(e => ({ name: e.name, shiftPoints: e.shiftPoints, weightedPoints: Math.round(e.weightedPoints * 100) / 100, earned: e.floor / 100 }))
    .sort((a, b) => b.earned - a.earned || a.name.localeCompare(b.name))

  return {
    totalTipsUsd: total,
    deductionRate: rate,
    deductedUsd: r2(total - net),
    netTipsUsd: net,
    totalShiftPoints,
    totalWeightedPoints: Math.round(totalWeightedPoints * 100) / 100,
    perPoint,
    staff,
  }
}
