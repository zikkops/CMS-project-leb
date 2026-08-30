// Open checks: what a table has ordered.
//
// Phase 03, POS v1. A check gets an order from a waiter's hand to a kitchen
// and back. It deliberately does NOT touch money — no bill, no split, no
// payment, no tender. That is Phase 04, and keeping the line exactly there is
// what makes this phase finishable.
//
// No React and no Firebase import: the server validates against these rules
// and the waiter's screen renders from them, so both halves must be able to
// import it.

import {
  lineUnitPrice, describeSelections, type ModifierSelection,
} from './modifiers'

// ── Where a line draws its stock from ──────────────────────────────────────
// THE field that has to exist from the first version.
//
// A cappuccino and a board game on one bill deduct from two different stock
// models: menuItems for food and drink, products with per-branch stock for
// retail. Omega sells Restaurant POS and Retail POS as two separate products
// and neither does this, which makes it the differentiator — and it is only
// cheap now. Adding it later means migrating every check line ever written,
// guessing which model each one drew from.
export type LineSource = 'menu' | 'product'

export type LineStatus =
  | 'draft'   // on the check, not yet sent to a station
  | 'sent'    // a ticket exists for it
  | 'void'    // struck off; kept rather than deleted, see below

export type CheckStatus =
  | 'open'
  | 'closed'
  /**
   * Closed and then reversed.
   *
   * A separate status rather than deleting or reopening the check: the record
   * of what was ordered has to survive the reversal, because "what did we give
   * money back for" is the question a refund exists to answer.
   *
   * Worth being plain about what this does and does not mean while there is no
   * payment step. It records that a closed check was reversed and puts any
   * merchandise back on the shelf. It does not move money, because no money
   * moved through here in the first place — the till still takes payment.
   * Phase 04 puts tender underneath this and the shape does not change.
   */
  | 'refunded'
  | 'cancelled'

/**
 * Where a line goes when it is sent.
 *
 * Derived from the menu category's section, which the plan predicted would map
 * almost directly onto kitchen routing — Food to the kitchen, Beverage to the
 * bar, Sweets to its own pass.
 *
 * A merchandise line has no station. Nobody cooks a board game; it is taken
 * off a shelf. Giving it a fake station would put it in a kitchen queue where
 * it would sit unbumped forever.
 */
export type Station = 'Kitchen' | 'Bar' | 'Sweets'

export const STATIONS: Station[] = ['Kitchen', 'Bar', 'Sweets']

const STATION_FOR_SECTION: Record<string, Station> = {
  Food: 'Kitchen',
  Beverage: 'Bar',
  Sweets: 'Sweets',
}

/** null for merchandise, and for a section nobody has mapped yet. */
export function stationForSection(section: string | null | undefined): Station | null {
  return STATION_FOR_SECTION[String(section ?? '')] ?? null
}

// ── Why something was struck off ───────────────────────────────────────────
//
// A void used to take free text, and free text cannot be acted on. "Changed
// his mind" and "dropped it" are different events: the first leaves a sellable
// item, the second destroys one, and a till that treats them the same either
// loses stock it still has or keeps stock it does not.
//
// So the reason is a CHOICE, and the choice carries what follows from it.
// Free text stays, as a note beside the reason rather than instead of it.

export interface VoidReasonDef {
  key: string
  label: string
  /**
   * Whether the thing still exists and can be sold again.
   *
   * Only merchandise acts on this — a board game handed back goes on the
   * shelf. Food has no per-ingredient stock in this version, so nothing
   * changes either way for it; the flag is still recorded, because the day
   * recipes land it is the field that says whether the ingredients were used.
   */
  returnsToStock: boolean
  /**
   * Whether this counts as waste: made or consumed, and lost.
   *
   * Nothing reads this yet. It is recorded from the first version because
   * waste is on the roadmap and a void without it is a void nobody can go
   * back and classify — the person who knew is gone by then.
   */
  isWaste: boolean
}

export const VOID_REASONS: VoidReasonDef[] = [
  // Nothing was consumed. The item is still there.
  { key: 'changed-mind', label: 'Customer changed their mind', returnsToStock: true, isWaste: false },
  { key: 'rung-wrong', label: 'Rung up by mistake', returnsToStock: true, isWaste: false },
  { key: 'not-available', label: 'Not available after all', returnsToStock: true, isWaste: false },

  // It was made, or it is gone. Either way it is not going back.
  { key: 'made-wrong', label: 'Made wrong', returnsToStock: false, isWaste: true },
  { key: 'sent-back', label: 'Customer sent it back', returnsToStock: false, isWaste: true },
  { key: 'damaged', label: 'Damaged or spilled', returnsToStock: false, isWaste: true },

  // Deliberately last and deliberately not defaulting to "returns": guessing
  // wrong in that direction invents stock that is not on the shelf.
  { key: 'other', label: 'Other', returnsToStock: false, isWaste: true },
]

export function voidReason(key: string): VoidReasonDef | undefined {
  return VOID_REASONS.find(r => r.key === key)
}

export interface CheckLine {
  /** Stable for the life of the check — edits, voids and tickets all cite it. */
  id: string
  source: LineSource
  /** menuItems/{id} or products/{id}. Kept for reporting, never for pricing. */
  refId: string

  // ── Snapshots ────────────────────────────────────────────────────────────
  // Name, price and modifiers are copied onto the line when it is added, and
  // never re-read. Same rule as the end-of-day exchange rate and the delivery
  // VAT: a check written at eight o'clock must not change because somebody
  // edited the menu at nine. Pricing from refId would do exactly that.
  name: string
  /** Before modifiers. lineUnitPrice() adds them. */
  unitPrice: number
  modifiers: ModifierSelection[]

  quantity: number
  /** Which seat ordered it, or null for the table as a whole. */
  seat: number | null
  /** Course number for pacing; null means "whenever". */
  course: number | null
  /** Snapshotted at add time, for the same reason the price is. */
  station: Station | null
  status: LineStatus
  /** "no ice", "allergy — nuts". Reaches the ticket. */
  note: string

  addedBy: string
  addedByEmail: string
  /** Set when a ticket was created for it; null while still a draft. */
  sentAt: string | null
  /**
   * Why it was struck off, as a chosen reason plus anything typed.
   *
   * voidReason keeps the human sentence so old lines written before the
   * reasons existed still read correctly; voidReasonKey is the one a report
   * can group by.
   */
  voidReason: string | null
  voidReasonKey: string | null
  /** Copied from the reason, so a later change to the list cannot re-classify
   *  a void that already happened. */
  voidWasWaste: boolean | null
}

/**
 * The staff-meal rates, copied onto a check when it is marked as one.
 *
 * Snapshotted for the reason every rate in this codebase is: a check written
 * tonight must not re-price itself because somebody changed the policy next
 * month. null means this is an ordinary check.
 */
export interface StaffDiscount {
  /** Fraction taken OFF food. 0.7 is seventy percent off. */
  food: number
  drink: number
  appliedBy: string
  appliedByEmail: string
}

export interface Check {
  id: string
  branch: string
  /** TableMarker.id from branchTableLayouts — not the printed number, which
   *  can be changed on the floor plan without meaning a different table. */
  tableId: string
  /** Snapshotted so a closed check still reads "Table 12" after a renumber. */
  tableNumber: number
  status: CheckStatus
  guestCount: number
  lines: CheckLine[]
  openedBy: string
  openedByEmail: string
  closedAt: string | null
  /**
   * Issued when the check closes, from the same sequence counter sales and
   * wholesale orders use — one series for the business, which is what an
   * accountant expects. Null while the check is still open.
   */
  receiptNumber: string | null
  /** null on an ordinary check. Set by the staff-meal toggle. */
  staffDiscount: StaffDiscount | null
}

// ── Bounds ────────────────────────────────────────────────────────────────

export const CHECK_LIMITS = {
  /** A table ordering more than this has a data-entry problem, not an appetite. */
  linesPerCheck: 200,
  quantityPerLine: 99,
  /** Enough for a long table; above this somebody is typing, not seating. */
  maxSeat: 40,
  maxCourse: 9,
  maxGuests: 40,
  noteLength: 200,
} as const

// ── Staff meals ────────────────────────────────────────────────────────────

/**
 * Which rate a line takes, from the station it was routed to.
 *
 * The station already encodes what was bought — Bar means a drink, Kitchen and
 * Sweets mean food — so nothing new has to be stored on the line to know which
 * rate applies. Merchandise has no station and takes no staff discount: a
 * board game is bought stock with a real cost, not a plate of food, and
 * discounting it is a different policy nobody has asked for.
 */
export function staffRateFor(line: CheckLine, discount: StaffDiscount | null): number {
  if (!discount) return 0
  if (line.source === 'product') return 0
  if (line.station === 'Bar') return discount.drink
  if (line.station === 'Kitchen' || line.station === 'Sweets') return discount.food
  // A section nobody mapped to a station. No rate rather than a guess.
  return 0
}

/** What comes off one line, in the main currency. */
export function lineDiscount(line: CheckLine, discount: StaffDiscount | null): number {
  const rate = staffRateFor(line, discount)
  if (rate <= 0) return 0
  return Math.round(grossLineTotal(line) * rate * 100) / 100
}

// ── Money on a line (not a bill — see the header) ──────────────────────────

/** One line before any discount. Voided lines count as zero. */
export function grossLineTotal(line: CheckLine): number {
  if (line.status === 'void') return 0
  const unit = lineUnitPrice(line.unitPrice, line.modifiers)
  return Math.round(unit * line.quantity * 100) / 100
}

/**
 * One line's total.
 *
 * Takes the discount rather than reading it from anywhere, so a caller that
 * has not thought about staff meals gets the undiscounted figure instead of
 * silently the wrong one.
 */
export function lineTotal(line: CheckLine, discount: StaffDiscount | null = null): number {
  return Math.round((grossLineTotal(line) - lineDiscount(line, discount)) * 100) / 100
}

/**
 * What the table has ordered so far.
 *
 * Explicitly NOT a bill: no VAT, no service, no discount, no rounding rule.
 * Those are Phase 04 and each is a decision this must not pre-empt by
 * pretending to be the total somebody pays.
 */
export function orderedTotal(lines: CheckLine[], discount: StaffDiscount | null = null): number {
  return Math.round(lines.reduce((sum, l) => sum + lineTotal(l, discount), 0) * 100) / 100
}

export interface CheckTotals {
  /** Before any staff discount. */
  gross: number
  /** What the discount took off. Zero on an ordinary check. */
  discount: number
  /** What is owed, before VAT and service — those are Phase 04. */
  net: number
}

/**
 * The three figures a check screen shows.
 *
 * Discount is returned separately rather than folded into the total, because a
 * staff meal that quietly shows a smaller number is a staff meal nobody can
 * audit. It should be visible as a line somebody signed off.
 */
export function checkTotals(check: Pick<Check, 'lines' | 'staffDiscount'>): CheckTotals {
  const gross = Math.round(check.lines.reduce((s, l) => s + grossLineTotal(l), 0) * 100) / 100
  const discount = Math.round(
    check.lines.reduce((s, l) => s + lineDiscount(l, check.staffDiscount), 0) * 100) / 100
  return { gross, discount, net: Math.round((gross - discount) * 100) / 100 }
}

// ── Reading a check ────────────────────────────────────────────────────────

/** Lines not yet sent, which is what the Send button acts on. */
export function draftLines(lines: CheckLine[]): CheckLine[] {
  return lines.filter(l => l.status === 'draft')
}

/**
 * Draft lines grouped by the station that will cook them.
 *
 * One ticket per station per send. Merchandise (station null) is excluded —
 * it is not cooked, so it never becomes a kitchen ticket, and a caller that
 * wants to know about it should look at the check.
 */
export function draftsByStation(lines: CheckLine[]): Map<Station, CheckLine[]> {
  const out = new Map<Station, CheckLine[]>()
  for (const line of draftLines(lines)) {
    if (!line.station) continue
    const list = out.get(line.station) ?? []
    list.push(line)
    out.set(line.station, list)
  }
  return out
}

/** Lines for one seat, for splitting a table's order by who ordered what. */
export function linesForSeat(lines: CheckLine[], seat: number | null): CheckLine[] {
  return lines.filter(l => l.seat === seat && l.status !== 'void')
}

/** Seats that have actually ordered something, in order. */
export function seatsUsed(lines: CheckLine[]): number[] {
  const seats = new Set<number>()
  for (const l of lines) if (l.status !== 'void' && l.seat !== null) seats.add(l.seat)
  return [...seats].sort((a, b) => a - b)
}

/** "2 x Flat White (Large, Oat milk) — seat 3 — no sugar" */
export function describeLine(line: CheckLine): string {
  const parts = [`${line.quantity} x ${line.name}`]
  if (line.modifiers.length > 0) parts.push(`(${describeSelections(line.modifiers)})`)
  if (line.seat !== null) parts.push(`— seat ${line.seat}`)
  if (line.note) parts.push(`— ${line.note}`)
  return parts.join(' ')
}

// ── Rules the screen and the server both enforce ───────────────────────────

/**
 * Whether a line may still be changed.
 *
 * Once a ticket exists the kitchen may already be cooking it, so editing the
 * line would change what the customer is charged for something already being
 * made. Sent lines are voided, not edited — and a void is a decision somebody
 * has to own, which is why voidReason is required rather than optional.
 */
export function canEditLine(line: CheckLine): boolean {
  return line.status === 'draft'
}

/** Why this check cannot be closed yet, or null. */
export function closeBlockedReason(check: Check): string | null {
  if (check.status !== 'open') return 'That check is already closed.'
  const drafts = draftLines(check.lines).length
  if (drafts > 0) {
    return `${drafts} item${drafts === 1 ? '' : 's'} ${drafts === 1 ? 'has' : 'have'} not been sent to the kitchen yet. ` +
      'Send them or void them first.'
  }
  return null
}
