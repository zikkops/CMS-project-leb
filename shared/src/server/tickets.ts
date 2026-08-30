// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Moving a ticket along the pass.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { transitionError, type Ticket, type TicketStatus } from '../tickets'

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
    })

    return { from: ticket.status, to, station: ticket.station }
  })
}
