// Loyalty status tiers.
//
// Replaces app/lib/levelConfig.ts, which modelled a 50-level RPG curve with
// titles running from 'Newcomer' through 'Dungeon Delver' to 'Game God'. That
// suited a board game café. It does not suit a coffee shop, and it is not
// something a generic tenant would ever configure their way out of.
//
// ── One currency ──────────────────────────────────────────────────────────
// There used to be two: XP (earned at 10 per $1, never spent, drove the level)
// and OB Coins (earned at 1 per $1, spent on rewards). Two currencies at two
// different rates, and customers had to hold both in their head.
//
// There is now one. You earn points, you spend points.
//
//   points        spendable balance
//   pointsEarned  running total of every point ever earned
//
// `pointsEarned` is NOT a second currency. It is a statistic — the same coin,
// counted cumulatively — and it exists for exactly one reason: status has to
// come from what you have earned, not what you are holding. Drive tiers off
// the balance instead and redeeming a reward demotes you, which teaches people
// not to redeem. Both numbers rise together when points are awarded; only
// `points` falls when they are spent.
//
// Nothing else survives from the old scheme. `xp`, `obCoins`, `level` and
// `levelTitle` are gone from the code and from the documents; there was no
// production data to migrate (zero transactions, zero redemptions), so the
// fields were renamed properly rather than mapped.

// ── Earn rates ────────────────────────────────────────────────────────────
// Kept here rather than in loyalty.ts because that file is 'use client', so a
// route handler importing a constant from it would drag React and the Firebase
// client SDK onto the server. This module has no directive and no imports, so
// both sides read the same numbers — the alternative, which briefly existed,
// was the award value defined once for the UI and again for the server.

/** Points earned per $1 spent on a check. The programme's single earn rate. */
export const POINTS_PER_DOLLAR = 10

/** Flat awards where there is no bill to scale against. */
export const EVENT_POINTS_PER_PERSON = 250
export const TABLE_CHECKIN_POINTS = 150

export interface Tier {
  label: string
  /** Total points earned required to reach this tier. */
  threshold: number
  color: string
  /** Shown on the public loyalty page under the tier name. */
  blurb: string
}

// Thresholds assume the default 10 points per $1 spent, so Silver is roughly
// $500 of lifetime spend and Platinum around $5,000. They are a starting
// point for a demo, not a researched commercial ladder — a real tenant should
// set these against their own average basket and visit frequency.
//
// Ordered low to high. getTier() walks backwards, so inserting a tier only
// means putting it in the right place here.
export const TIERS: Tier[] = [
  { label: 'Bronze',   threshold: 0,     color: '#A6704A', blurb: 'Everyone starts here.' },
  { label: 'Silver',   threshold: 5000,  color: '#9AA3AD', blurb: 'A familiar face.' },
  { label: 'Gold',     threshold: 20000, color: '#D4A537', blurb: 'A regular. The staff know your order.' },
  { label: 'Platinum', threshold: 50000, color: '#7F77DD', blurb: 'Our most loyal customers.' },
]

export const TIER_LABELS = TIERS.map(t => t.label)

export const TIER_COLORS: Record<string, string> = Object.fromEntries(
  TIERS.map(t => [t.label, t.color])
)

export interface TierInfo {
  tier: string
  color: string
  /** null at the top tier — there is nothing further to progress toward. */
  nextTier: string | null
  /** Earned-total at which the current tier was reached. */
  tierFloor: number
  /** Earned-total needed for the next tier; equals tierFloor at the top. */
  nextThreshold: number
  /** 0–100 through the current tier. 100 at the top tier. */
  progressPercent: number
  /** Points still needed for the next tier; 0 at the top. */
  pointsToNext: number
}

/**
 * Status from total points earned.
 *
 * Tolerates a missing or negative figure rather than throwing — this runs on
 * a profile that may still be loading, and a customer seeing "Bronze" for a
 * moment is better than a crash.
 */
export function getTier(pointsEarned: number): TierInfo {
  const lifetime = Math.max(0, pointsEarned || 0)

  let index = 0
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (lifetime >= TIERS[i].threshold) { index = i; break }
  }

  const current = TIERS[index]
  const next = TIERS[index + 1] ?? null

  if (!next) {
    return {
      tier: current.label,
      color: current.color,
      nextTier: null,
      tierFloor: current.threshold,
      nextThreshold: current.threshold,
      progressPercent: 100,
      pointsToNext: 0,
    }
  }

  const span = next.threshold - current.threshold
  const into = lifetime - current.threshold

  return {
    tier: current.label,
    color: current.color,
    nextTier: next.label,
    tierFloor: current.threshold,
    nextThreshold: next.threshold,
    progressPercent: Math.min(100, Math.max(0, (into / span) * 100)),
    pointsToNext: Math.max(0, next.threshold - lifetime),
  }
}

/** Tier colour for a label, falling back to the entry tier's colour. */
export function tierColor(label: string): string {
  return TIER_COLORS[label] ?? TIERS[0].color
}
