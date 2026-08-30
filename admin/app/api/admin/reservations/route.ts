// Approving and rejecting bookings — event spots and table reservations.
//
// PATCH  { kind: 'event' | 'table', id, action: 'approve' | 'reject', reason? }
//
// One route for both because it is one decision — a manager saying yes or no
// to a customer's request — and the two differ only in which collection they
// live in and whether a rejection releases table locks.
//
// The sections stay separate, though: someone can be trusted with the event
// diary without being trusted with the floor plan, and SECTION_ACCESS already
// models that.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseReservationInput, resolveReservation } from '@big-cms/shared/server/reservations'
import { logUpdate } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

export async function PATCH(request: Request): Promise<Response> {
  try {
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    const input = parseReservationInput(body)

    // Gate on the section that owns this kind of booking, not a blanket staff
    // check — approving an event spot and approving a table are different
    // jobs and are granted separately.
    const caller: Caller = await requireSection(
      request,
      input.kind === 'event' ? 'events' : 'tableReservations',
    )

    const result = await resolveReservation(input, { uid: caller.uid, email: caller.email ?? '' })

    // In the same call as the decision, so a booking cannot change state with
    // nothing in the log — which is exactly what the two separate client
    // calls allowed.
    await logUpdate(
      caller,
      input.kind === 'event' ? 'Event Reservation' : 'Table Reservation',
      result.label,
      { status: 'pending' },
      input.action === 'approve'
        ? { status: 'approved' }
        : { status: 'rejected', rejectionReason: input.reason || null },
    )

    return Response.json({ ok: true, userId: result.userId, locksReleased: result.locksReleased })
  } catch (err) {
    return toResponse(err)
  }
}
