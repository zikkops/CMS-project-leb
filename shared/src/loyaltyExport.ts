// What the loyalty scheme owes, and what moved it.
//
// The sales export answers "what did we take". This answers the other
// question an owner and an accountant both ask: points are a liability —
// every unredeemed one is a promise to give something away — so how many were
// issued this month, how many came back, and how many were spent.
//
// ── The trap this module exists for ────────────────────────────────────────
// A transaction's `pointsAmount` is credited to EVERY user in its `userId`
// array, not divided between them (shared/src/server/loyalty.ts: the approve
// path increments each user by `amount`). An event with five attendees at ten
// points each issues FIFTY points, and a report that sums `pointsAmount` says
// ten. Nothing about the field name warns you, and the neighbouring
// `splitCount` actively misleads: it is set to `attendeeUids.length` — a
// headcount, not a divisor — and the approvals screen labels it "split
// between N people".
//
// Everything else here follows the same rules as the sales export: the café's
// day rather than the server's, and nothing counted that did not happen.

import { ymdInZone } from './dates'
import { timestampMs } from './timestamps'

export interface LoyaltyOptions {
  /** The café's zone. Day boundaries are judged here and nowhere else. */
  timeZone: string
}

/** Only these actually move a balance. The rest are paperwork. */
export const ISSUING_STATUS = 'approved'
export const REVERSED_STATUS = 'reversed'
export const SPENT_STATUS = 'redeemed'

export interface PointsRow {
  id: string
  day: string
  type: string
  status: string
  branch: string
  /** What ONE person was credited. */
  perPerson: number
  people: number
  /** perPerson × people, and zero unless the status actually issued them. */
  issued: number
  /** Points taken back — a refunded POS check. Positive number, own column. */
  reversed: number
  checkNumber: string
  eventName: string
  submittedBy: string
  approvedBy: string
}

export interface RedemptionRow {
  id: string
  day: string
  branch: string
  item: string
  cost: number
  /** Zero unless it was actually handed over. */
  spent: number
  status: string
  userId: string
  confirmedBy: string
}

export interface LoyaltyDayRow {
  day: string
  branch: string
  issued: number
  reversed: number
  spent: number
  /** issued − reversed − spent: what the liability did that day. */
  net: number
  transactions: number
  redemptions: number
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The café-local day something happened, through timestampMs — never `new Date(field)`. */
export function dayOf(at: unknown, timeZone: string): string {
  const ms = timestampMs(at, 0)
  return ms ? ymdInZone(new Date(ms), timeZone) : ''
}

export function pointsRow(tx: Record<string, unknown>, opts: LoyaltyOptions): PointsRow {
  const people = Array.isArray(tx.userId) ? tx.userId.filter(u => typeof u === 'string').length : 0
  const perPerson = num(tx.pointsAmount)
  const status = str(tx.status)

  // THE TRAP: multiplied by the headcount, because that is what the approve
  // path actually did to the balances. And zero unless the status issued
  // anything — a pending submission is a request, not a liability.
  // A reversed transaction WAS issued, on its own day: the reversal is a
  // movement of its own, on the day it happened (reversalRow(), T7.14, gap
  // 19). Reading the status alone made the issue vanish from its day and the
  // reversal land on the original day.
  const issued = status === ISSUING_STATUS || status === REVERSED_STATUS ? perPerson * people : 0
  const reversed = 0

  return {
    id: str(tx.id),
    day: dayOf(tx.createdAt, opts.timeZone),
    type: str(tx.type),
    status,
    branch: str(tx.branchId),
    perPerson,
    people,
    issued,
    reversed,
    checkNumber: str(tx.checkNumber),
    eventName: str(tx.eventName),
    submittedBy: str(tx.submittedBy),
    approvedBy: str(tx.approvedBy),
  }
}

/** A reversal as its own movement, on the day it happened (`reversedAt`), or null when the transaction was never reversed. */
export function reversalRow(tx: Record<string, unknown>, opts: LoyaltyOptions): PointsRow | null {
  if (str(tx.status) !== REVERSED_STATUS) return null
  const issue = pointsRow(tx, opts)
  return {
    ...issue,
    id: `${issue.id}:reversal`,
    // A reversal from before reversedAt was recorded is dated with its issue, never a guess.
    day: dayOf(tx.reversedAt ?? tx.createdAt, opts.timeZone),
    type: 'reversal',
    issued: 0,
    reversed: issue.issued,
    approvedBy: str(tx.reversedBy),
  }
}

/** Every movement a transaction made: its issue, and its reversal when it had one. */
export function pointRows(tx: Record<string, unknown>, opts: LoyaltyOptions): PointsRow[] {
  const back = reversalRow(tx, opts)
  return back ? [pointsRow(tx, opts), back] : [pointsRow(tx, opts)]
}

export function redemptionRow(r: Record<string, unknown>, opts: LoyaltyOptions): RedemptionRow {
  const status = str(r.status)
  const cost = num(r.coinCost)
  return {
    id: str(r.id),
    // The day it was handed over when it has been, otherwise the day it was
    // asked for: a pending request has not moved anything yet, and dating it
    // by a confirmation that never came would put it in no period at all.
    day: dayOf(r.confirmedAt ?? r.createdAt, opts.timeZone),
    branch: str(r.branchId),
    item: str(r.itemName),
    cost,
    spent: status === SPENT_STATUS ? cost : 0,
    status,
    userId: str(r.userId),
    confirmedBy: str(r.confirmedBy),
  }
}

export function loyaltyDayRows(
  points: readonly PointsRow[],
  redemptions: readonly RedemptionRow[],
): LoyaltyDayRow[] {
  const byKey = new Map<string, LoyaltyDayRow>()
  const row = (day: string, branch: string): LoyaltyDayRow | null => {
    if (!day) return null
    const key = `${day}|${branch}`
    let d = byKey.get(key)
    if (!d) {
      d = { day, branch, issued: 0, reversed: 0, spent: 0, net: 0, transactions: 0, redemptions: 0 }
      byKey.set(key, d)
    }
    return d
  }

  for (const p of points) {
    const d = row(p.day, p.branch)
    if (!d) continue
    d.transactions += 1
    d.issued += p.issued
    d.reversed += p.reversed
  }
  for (const r of redemptions) {
    const d = row(r.day, r.branch)
    if (!d) continue
    d.redemptions += 1
    d.spent += r.spent
  }
  for (const d of byKey.values()) d.net = d.issued - d.reversed - d.spent

  return [...byKey.values()].sort((a, b) => (a.day === b.day ? a.branch.localeCompare(b.branch) : a.day.localeCompare(b.day)))
}

export interface LoyaltyExport {
  points: PointsRow[]
  redemptions: RedemptionRow[]
  days: LoyaltyDayRow[]
}

export function buildLoyaltyExport(
  transactions: readonly Record<string, unknown>[],
  redemptions: readonly Record<string, unknown>[],
  opts: LoyaltyOptions & { from?: string; to?: string },
): LoyaltyExport {
  // Each movement is kept only when ITS day is in the range: an issue last
  // month reversed this month shows the reversal only.
  const inRange = (day: string) => (!opts.from || day >= opts.from) && (!opts.to || day <= opts.to)
  const p = transactions.flatMap(t => pointRows(t, opts)).filter(x => inRange(x.day)).sort((a, b) => a.day.localeCompare(b.day))
  const r = redemptions.map(x => redemptionRow(x, opts)).filter(x => inRange(x.day)).sort((a, b) => a.day.localeCompare(b.day))
  return { points: p, redemptions: r, days: loyaltyDayRows(p, r) }
}

export interface LoyaltyMovement { issued: number; reversed: number; spent: number; net: number }

export interface LoyaltyLiability {
  byBranch: { branch: string; movement: LoyaltyMovement }[]
  movement: LoyaltyMovement
  /**
   * Points owed at the end of the period, for the whole scheme: balances are
   * a member's, not a branch's. Worked back from today's balances through the
   * ledger, so a balance changed outside the ledger (a manual correction)
   * moves both ends equally.
   */
  closing: number
  opening: number
  /** closing × the point value, or null when no value is set. */
  closingUsd: number | null
  openingUsd: number | null
  pointValueUsd: number | null
  members: number
}

const movementOf = (days: readonly LoyaltyDayRow[]): LoyaltyMovement => {
  const m = { issued: 0, reversed: 0, spent: 0, net: 0 }
  for (const d of days) { m.issued += d.issued; m.reversed += d.reversed; m.spent += d.spent }
  m.net = m.issued - m.reversed - m.spent
  return m
}

/**
 * The points liability over a period (UPGRADE.md T7.14): issued, reversed and
 * spent per branch, and the balance owed at each end. `balanceNow` is every
 * member's points today; `after` is the ledger from the day after the period
 * up to today, so closing = today's balance − what moved since.
 */
export function loyaltyLiability(input: {
  period: LoyaltyExport
  after: LoyaltyExport | null
  balanceNow: number
  members: number
  branches: readonly string[]
  pointValueUsd: number
}): LoyaltyLiability {
  const movement = movementOf(input.period.days.filter(d => input.branches.includes(d.branch)))
  // The whole scheme, every branch: what moved since the period, and in it.
  const since = input.after ? movementOf(input.after.days).net : 0
  const whole = movementOf(input.period.days).net
  const closing = input.balanceNow - since
  const opening = closing - whole
  const value = input.pointValueUsd > 0 && input.pointValueUsd <= 1 ? input.pointValueUsd : null
  const usd = (points: number) => (value === null ? null : Math.round(points * value * 100) / 100)
  return {
    byBranch: input.branches.map(branch => ({ branch, movement: movementOf(input.period.days.filter(d => d.branch === branch)) })),
    movement,
    closing, opening,
    closingUsd: usd(closing), openingUsd: usd(opening),
    pointValueUsd: value,
    members: input.members,
  }
}

/** Column headings, in the order the sheets are written. Shared with the UI. */
export const LOYALTY_SHEETS = {
  days: [
    ['day', 'Day'], ['branch', 'Branch'],
    ['issued', 'Points issued'], ['reversed', 'Points reversed'], ['spent', 'Points spent'],
    ['net', 'Net movement'], ['transactions', 'Transactions'], ['redemptions', 'Redemptions'],
  ],
  points: [
    ['day', 'Day'], ['branch', 'Branch'], ['type', 'Type'], ['status', 'Status'],
    ['perPerson', 'Points each'], ['people', 'People'], ['issued', 'Issued'], ['reversed', 'Reversed'],
    ['checkNumber', 'Check'], ['eventName', 'Event'],
    ['submittedBy', 'Submitted by'], ['approvedBy', 'Approved by'], ['id', 'Id'],
  ],
  redemptions: [
    ['day', 'Day'], ['branch', 'Branch'], ['item', 'Item'], ['cost', 'Cost'],
    ['spent', 'Spent'], ['status', 'Status'], ['userId', 'Customer'], ['confirmedBy', 'Confirmed by'],
  ],
} as const
