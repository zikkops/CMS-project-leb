// The floor's readings — what the open bills add up to, and what today's
// closed tables took (owner's request, 14 Sep 2026: "a square button that
// opens up and lets us choose what to see").
//
// Pure, no imports, asserted by `npm run verify:counter`. The floor page hands
// in one figure per check — each worked out by the shared, verified
// orderedTotal()/checkTotals() — and this adds them up. The adding-up is here
// and not in the component for the reason verify-counter exists at all: the
// till's two money bugs were right arithmetic handed the wrong figures inside
// a component, where nothing could check them.
//
// Two rules the numbers follow:
//   - "Today" is the café's day, decided by the page with closedAtParts() in
//     the café's zone. A check closed at 00:30 belongs to the night before.
//   - Refunds are their own reading, never subtracted from closed sales — the
//     rule the sales export and the Food Cost Report already follow. A refund
//     is filed under the day its check CLOSED.

export type ReadingKey = 'closedToday' | 'openTotal' | 'openCount' | 'averageToday' | 'refundsToday'

export const READINGS: readonly { key: ReadingKey; label: string; hint: string }[] = [
  { key: 'closedToday', label: 'Closed today', hint: 'What the tables closed today came to, in dollars.' },
  { key: 'openTotal', label: 'Open tables', hint: 'What the bills still open add up to right now.' },
  { key: 'openCount', label: 'Tables open', hint: 'How many tables have a bill open.' },
  { key: 'averageToday', label: 'Average bill', hint: 'Closed today, divided by how many tables closed.' },
  { key: 'refundsToday', label: 'Refunds today', hint: 'Refunded checks from today, kept apart from sales.' },
]

/** Shown the first time, before anybody has chosen. */
export const DEFAULT_READINGS: readonly ReadingKey[] = ['closedToday', 'openTotal']

export interface ClosedFigure {
  /** 'closed' or 'refunded'. Anything else is ignored. */
  status: string
  /** The café day it closed on, 'YYYY-MM-DD'; '' when unknown. */
  day: string
  /** What the check came to, in dollars. */
  totalUsd: number
}

export interface FloorReadings {
  openCount: number
  openTotalUsd: number
  closedTodayCount: number
  closedTodayUsd: number
  /** null with nothing closed today — an average of nothing is not $0.00. */
  averageTodayUsd: number | null
  refundsTodayCount: number
  refundsTodayUsd: number
}

const cents = (usd: number) => (Number.isFinite(usd) ? Math.round(usd * 100) : 0)

export function floorReadings(openTotalsUsd: readonly number[], closed: readonly ClosedFigure[], today: string): FloorReadings {
  let openCents = 0
  for (const t of openTotalsUsd) openCents += cents(t)

  let closedCents = 0
  let closedCount = 0
  let refundCents = 0
  let refundCount = 0
  for (const c of closed) {
    if (!c.day || c.day !== today) continue
    if (c.status === 'closed') { closedCents += cents(c.totalUsd); closedCount++ }
    else if (c.status === 'refunded') { refundCents += cents(c.totalUsd); refundCount++ }
  }

  return {
    openCount: openTotalsUsd.length,
    openTotalUsd: openCents / 100,
    closedTodayCount: closedCount,
    closedTodayUsd: closedCents / 100,
    averageTodayUsd: closedCount > 0 ? Math.round(closedCents / closedCount) / 100 : null,
    refundsTodayCount: refundCount,
    refundsTodayUsd: refundCents / 100,
  }
}

/**
 * The readings a device chose, from storage. Unknown keys are dropped and
 * duplicates removed; nothing stored — or something unreadable — is the
 * default. An empty list is a choice and is kept.
 */
export function readReadingChoice(raw: unknown): ReadingKey[] {
  if (typeof raw !== 'string') return [...DEFAULT_READINGS]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_READINGS]
    const known = new Set<string>(READINGS.map(r => r.key))
    return READINGS.map(r => r.key).filter(k => parsed.includes(k) && known.has(k))
  } catch {
    return [...DEFAULT_READINGS]
  }
}
