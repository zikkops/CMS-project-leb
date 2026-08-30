// Kitchen tickets: what a station sees and bumps.
//
// A separate collection from `checks`, deliberately, and this is the main
// structural decision in POS v1.
//
// ── Why not just read the checks ───────────────────────────────────────────
// A waiter's check and a station's queue have almost nothing in common. The
// check is edited all through a service, by one person, and is about a table.
// A ticket is created once, worked by someone else, and is about a pass.
//
// Three things follow from keeping them apart:
//
//   The KDS query is trivial — station equals Kitchen, status is not bumped.
//   Reading every open check and filtering client-side would work today with
//   nine tables and stop working the day somebody opens forty.
//
//   A voided line cannot silently vanish from a pass. If tickets were a view
//   over the check, striking a line off would delete food already in a pan.
//   Here the ticket stays and is marked, so the kitchen is told rather than
//   quietly having its work removed.
//
//   The check keeps changing after a ticket exists. Sending a second round
//   must not reopen the first, and it does not, because that round is its own
//   document.
//
// No React and no Firebase import — the KDS renders from these and the server
// writes them.

import type { CheckLine, Station } from './checks'
import { describeSelections } from './modifiers'

export type TicketStatus =
  | 'new'        // on the pass, nobody has picked it up
  | 'preparing'  // someone is cooking it
  | 'ready'      // waiting to be run to the table
  | 'bumped'     // done and cleared from the screen
  | 'cancelled'  // every line on it was voided after it was sent

/** A line as the kitchen sees it. No prices — a pass does not need them. */
export interface TicketLine {
  /** The CheckLine.id it came from, so a later void can find it. */
  lineId: string
  name: string
  quantity: number
  /** Flattened at creation: "Large, Oat milk". The kitchen reads words. */
  modifiers: string
  seat: number | null
  course: number | null
  note: string
  /** Struck off after the ticket was sent. Shown, not removed. */
  voided: boolean
}

export interface Ticket {
  id: string
  checkId: string
  branch: string
  tableNumber: number
  station: Station
  status: TicketStatus
  /** 1 for the first send on this check at this station, 2 for the next. */
  round: number
  lines: TicketLine[]
  sentBy: string
  sentByEmail: string
  /** Set when it leaves the screen; null until then. */
  bumpedAt: string | null
  bumpedBy: string | null
}

/** Statuses still on a pass. What the KDS asks for. */
export const ACTIVE_TICKET_STATUSES: TicketStatus[] = ['new', 'preparing', 'ready']

/**
 * The only moves a ticket may make.
 *
 * Written as a table rather than as checks scattered through the UI, because
 * a KDS is a touchscreen in a hot kitchen and every wrong tap that silently
 * works is a plate that goes out at the wrong time. Nothing leaves 'bumped':
 * a bumped ticket is history, and un-bumping it would let the same food be
 * fired twice.
 */
const NEXT: Record<TicketStatus, TicketStatus[]> = {
  new:       ['preparing', 'ready', 'cancelled'],
  preparing: ['ready', 'new', 'cancelled'],
  ready:     ['bumped', 'preparing'],
  bumped:    [],
  cancelled: [],
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return NEXT[from]?.includes(to) ?? false
}

/** Why that move is not allowed, in words a person can act on. */
export function transitionError(from: TicketStatus, to: TicketStatus): string | null {
  if (canTransition(from, to)) return null
  if (from === 'bumped') return 'That ticket is already bumped. Fire a new round instead of reopening it.'
  if (from === 'cancelled') return 'That ticket was cancelled.'
  return `A ticket cannot go from ${from} to ${to}.`
}

/** Turns check lines into what a station reads. Prices are dropped on purpose. */
export function toTicketLines(lines: CheckLine[]): TicketLine[] {
  return lines.map(l => ({
    lineId: l.id,
    name: l.name,
    quantity: l.quantity,
    modifiers: describeSelections(l.modifiers),
    seat: l.seat,
    course: l.course,
    note: l.note,
    voided: false,
  }))
}

/**
 * How long a ticket has been waiting, for the colour a KDS turns.
 *
 * Takes `now` rather than reading the clock so the caller controls it — a
 * component re-rendering on a timer passes the same value to every ticket,
 * and nothing here becomes untestable.
 */
export function minutesWaiting(sentAtMs: number, now: number): number {
  return Math.max(0, Math.floor((now - sentAtMs) / 60_000))
}

/** Green, amber, red — the only thing a passing glance needs. */
export function urgency(minutes: number): 'fresh' | 'aging' | 'late' {
  if (minutes >= 15) return 'late'
  if (minutes >= 8) return 'aging'
  return 'fresh'
}
