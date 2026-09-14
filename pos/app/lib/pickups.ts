// What the counter and the floor show when the kitchen marks something ready
// (owner's decision, 14 Sep 2026). Pure, asserted by `npm run verify:counter`;
// ReadyPanel.tsx only draws what this decides, and useReadyAlerts.ts only
// rings when this says a plate is new.
//
// No imports on purpose, so the verifier can compile this file on its own.

export interface ReadyTicket {
  id: string
  tableNumber: number
  station: string
  round: number
  lines: readonly { name: string; quantity: number; voided: boolean }[]
  /** When the kitchen marked it ready; null on a ticket marked ready before that was recorded. */
  readyAtMs: number | null
  sentAtMs: number
}

export interface PickupCard {
  id: string
  tableNumber: number
  station: string
  round: number
  /** "2× Burger, 1× Fries". A voided line is not food to carry. */
  summary: string
  items: number
  /** How long it has sat on the pass. */
  waitingMinutes: number
}

/**
 * One card per ready ticket, the plate that has waited longest first — it is
 * the one going cold. A ticket from before `readyAt` was recorded counts from
 * when it was sent, which overstates the wait rather than hiding it.
 */
export function pickupCards(tickets: readonly ReadyTicket[], now: number): PickupCard[] {
  return tickets
    .map(t => {
      const live = t.lines.filter(l => !l.voided)
      const since = t.readyAtMs ?? t.sentAtMs
      const card: PickupCard = {
        id: t.id,
        tableNumber: t.tableNumber,
        station: t.station,
        round: t.round,
        summary: live.length > 0 ? live.map(l => `${l.quantity}× ${l.name}`).join(', ') : 'Every item on it was cancelled',
        items: live.reduce((n, l) => n + l.quantity, 0),
        waitingMinutes: Math.max(0, Math.floor((now - since) / 60_000)),
      }
      return { card, since }
    })
    .sort((a, b) => a.since - b.since || a.card.tableNumber - b.card.tableNumber)
    .map(x => x.card)
}

/** A ready plate is on a clock the kitchen's queue is not: food cools and ice melts. */
export function pickupUrgency(minutes: number): 'fresh' | 'aging' | 'late' {
  if (minutes >= 5) return 'late'
  if (minutes >= 2) return 'aging'
  return 'fresh'
}

/**
 * The tickets that turned ready since the last look — what the chime is for.
 *
 * `previous` null is the screen's first look. Plates already waiting when it
 * opened are shown but do not ring, or every reload would ring and people
 * learn to ignore it. A ticket that leaves (sent back) and returns rings again,
 * because it is ready again.
 */
export function newlyReady(previous: ReadonlySet<string> | null, current: readonly string[]): string[] {
  if (previous === null) return []
  return current.filter(id => !previous.has(id))
}
