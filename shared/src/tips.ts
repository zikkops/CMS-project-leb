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
}

export interface StaffTip {
  name: string
  shiftPoints: number
  earned: number
}

export interface TipDistribution {
  totalTipsUsd: number
  /** The rate actually used, after the guard below. */
  deductionRate: number
  deductedUsd: number
  netTipsUsd: number
  totalShiftPoints: number
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
  const total = Number.isFinite(totalTipsUsd) && totalTipsUsd > 0 ? r2(totalTipsUsd) : 0
  const rate = safeRate(deductionRate)
  const net = r2(total * (1 - rate))

  // Points accumulate per person across the whole period: somebody who worked
  // six doubles is one row worth twelve, not six rows.
  const points = new Map<string, number>()
  for (const a of attendance) {
    const p = shiftPoints(a.shift)
    if (p <= 0) continue
    const name = a.name.trim()
    if (!name) continue
    points.set(name, (points.get(name) ?? 0) + p)
  }

  const totalShiftPoints = [...points.values()].reduce((s, v) => s + v, 0)
  const perPoint = totalShiftPoints > 0 ? net / totalShiftPoints : 0

  // Largest remainder, in cents, so the shares add up to the pot exactly.
  // Dropping the odd cent is the same bug as netting a refund into sales: a
  // small amount of somebody's money going quietly missing.
  const cents = Math.round(net * 100)
  const entries = [...points.entries()].map(([name, pts]) => {
    const exact = totalShiftPoints > 0 ? (cents * pts) / totalShiftPoints : 0
    const floor = Math.floor(exact)
    return { name, shiftPoints: pts, floor, remainder: exact - floor }
  })

  let left = cents - entries.reduce((s, e) => s + e.floor, 0)
  const order = [...entries].sort((a, b) =>
    b.remainder - a.remainder || b.shiftPoints - a.shiftPoints || a.name.localeCompare(b.name))
  for (const e of order) {
    if (left <= 0) break
    e.floor += 1
    left -= 1
  }

  const staff: StaffTip[] = entries
    .map(e => ({ name: e.name, shiftPoints: e.shiftPoints, earned: e.floor / 100 }))
    .sort((a, b) => b.earned - a.earned || a.name.localeCompare(b.name))

  return {
    totalTipsUsd: total,
    deductionRate: rate,
    deductedUsd: r2(total - net),
    netTipsUsd: net,
    totalShiftPoints,
    perPoint,
    staff,
  }
}
