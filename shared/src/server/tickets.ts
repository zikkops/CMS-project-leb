// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Moving a ticket along the pass, and the front taking a ready one out.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { transitionError, pickupOutcome, type Ticket, type TicketStatus } from '../tickets'

const TICKETS = 'kitchenTickets'

const STATUSES: TicketStatus[] = ['new', 'preparing', 'ready', 'bumped', 'cancelled']

export function parseTicketStatus(raw: unknown): TicketStatus {
  const s = String(raw ?? '')
  if (!STATUSES.includes(s as TicketStatus)) throw new HttpError(400, 'Unknown ticket status.')
  return s as TicketStatus
}

/**
 * Advances a ticket, refusing a move the state machine does not allow.
 *
 * In a transaction because a KDS is a shared screen: two people reaching for
 * the same ticket is the normal case, not the edge one. Without it, both reads
 * see 'ready' and both write 'bumped', and the second tap silently succeeds on
 * a ticket that was already gone.
 */
export async function advanceTicket(
  caller: Caller,
  ticketId: string,
  to: TicketStatus,
): Promise<{ from: TicketStatus; to: TicketStatus; station: string }> {
  const db = adminDb()

  return db.runTransaction(async tx => {
    const ref = db.doc(`${TICKETS}/${ticketId}`)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That ticket no longer exists.')

    const ticket = { id: snap.id, ...(snap.data() as Omit<Ticket, 'id'>) }
    const problem = transitionError(ticket.status, to)
    if (problem) throw new HttpError(409, problem)

    tx.update(ref, {
      status: to,
      // Only a bump records who and when. The intermediate states are worked
      // by whoever is on the pass and nobody audits them; a bump is the moment
      // food left the kitchen, which somebody may well ask about later.
      ...(to === 'bumped'
        ? { bumpedAt: FieldValue.serverTimestamp(), bumpedBy: caller.email ?? caller.uid }
        : {}),
      // When it went on the pass for the front, so the counter and the floor
      // can show how long a plate has been sitting. Sent back, it is not ready.
      ...(to === 'ready' ? { readyAt: FieldValue.serverTimestamp() } : {}),
      ...(ticket.status === 'ready' && to !== 'ready' && to !== 'bumped' ? { readyAt: null } : {}),
    })

    return { from: ticket.status, to, station: ticket.station }
  })
}

/**
 * The front took a ready plate out (owner's decision, 14 Sep 2026: the counter
 * or the floor taps "Picked up", and that clears it from the kitchen display).
 *
 * Only a READY ticket moves — see pickupOutcome() — so a card tapped a moment
 * after the kitchen sent it back to preparing cannot clear food still cooking.
 * Already picked up by somebody else is an answer, not an error.
 */
export async function pickUpTicket(
  caller: Caller,
  ticketId: string,
): Promise<{ already: boolean; tableNumber: number; station: string }> {
  const db = adminDb()

  return db.runTransaction(async tx => {
    const ref = db.doc(`${TICKETS}/${ticketId}`)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That ticket no longer exists.')

    const ticket = snap.data() as Omit<Ticket, 'id'>
    const outcome = pickupOutcome(ticket.status)
    if (outcome.kind === 'refused') throw new HttpError(409, outcome.reason)

    if (outcome.kind === 'pick') {
      tx.update(ref, {
        status: 'bumped',
        bumpedAt: FieldValue.serverTimestamp(),
        bumpedBy: caller.email ?? caller.uid,
        pickedUp: true,
      })
    }
    return { already: outcome.kind === 'already', tableNumber: ticket.tableNumber, station: ticket.station }
  })
}

/**
 * Asks for the kitchen tickets again (UPGRADE.md T3.6): one ticket, or every
 * ticket of a check. Each one's reprint count goes up by one, and whichever
 * printer prints its station prints that count once: the café hub makes a job
 * for it (ticketReprintJob()), and a "Print here" screen sees a new print id
 * (printIdsOf()). A cancelled ticket has nothing to cook, so it is left out.
 */
export async function reprintTickets(
  by: { uid: string; email: string | null },
  target: { ticketId?: string; checkId?: string },
): Promise<{ count: number; branch: string; stations: string[]; tableNumber: number | null }> {
  const db = adminDb()
  return db.runTransaction(async tx => {
    const docs = target.ticketId
      ? [await tx.get(db.doc(`${TICKETS}/${target.ticketId}`))].filter(s => s.exists)
      : (await tx.get(db.collection(TICKETS).where('checkId', '==', target.checkId ?? ''))).docs
    const live = docs.filter(s => (s.data() as Ticket).status !== 'cancelled')
    if (live.length === 0) throw new HttpError(404, 'There is no kitchen ticket to print again.')
    for (const s of live) {
      tx.update(s.ref, {
        reprints: FieldValue.increment(1),
        reprintRequestedAt: FieldValue.serverTimestamp(),
        reprintedBy: by.uid,
        reprintedByEmail: by.email ?? '',
      })
    }
    const first = live[0].data() as Ticket
    return {
      count: live.length,
      branch: first.branch,
      stations: [...new Set(live.map(s => (s.data() as Ticket).station))],
      tableNumber: typeof first.tableNumber === 'number' ? first.tableNumber : null,
    }
  })
}
