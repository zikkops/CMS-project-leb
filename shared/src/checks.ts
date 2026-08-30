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

export type CheckStatus = 'open' | 'closed' | 'cancelled'

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
  /** Why it was struck off. Required — see voidLine below. */
  voidReason: string | null
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

// ── Money on a line (not a bill — see the header) ──────────────────────────

/** One line's total, modifiers included. Voided lines count as zero. */
export function lineTotal(line: CheckLine): number {
  if (line.status === 'void') return 0
  const unit = lineUnitPrice(line.unitPrice, line.modifiers)
  return Math.round(unit * line.quantity * 100) / 100
}

/**
 * What the table has ordered so far.
 *
 * Explicitly NOT a bill: no VAT, no service, no discount, no rounding rule.
 * Those are Phase 04 and each is a decision this must not pre-empt by
 * pretending to be the total somebody pays.
 */
export function orderedTotal(lines: CheckLine[]): number {
  return Math.round(lines.reduce((sum, l) => sum + lineTotal(l), 0) * 100) / 100
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
