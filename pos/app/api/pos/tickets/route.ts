// The kitchen display, and the front picking up. Phase 03, POS v1.
//
// PATCH  { ticketId, status }             move a ticket along the pass   (kds)
// PATCH  { ticketId, action: 'pickup' }   the front took a ready plate   (pos)
//
// Moving a ticket is gated on `kds` rather than `pos`: kitchen crew work the
// pass and have no business in order entry, and the two are separate grants
// for that reason. Picking up is the other way round — the counter and the
// floor do it (owner's decision, 14 Sep 2026) — and it can only take a READY
// ticket off the pass (pickupOutcome() in shared/src/tickets.ts), so it gives
// the front no say over what the kitchen is still cooking.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseTicketStatus, advanceTicket, pickUpTicket } from '@big-cms/shared/server/tickets'
import { refuseWhileHubbed } from '@big-cms/shared/server/hubLock'

export const runtime = 'nodejs'

export async function PATCH(request: Request): Promise<Response> {
  try {
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    const ticketId = typeof body.ticketId === 'string' ? body.ticketId : ''
    // A slash would address a different document.
    if (!ticketId || ticketId.includes('/')) throw new HttpError(400, 'Missing ticket id.')

    if (body.action === 'pickup') {
      const caller: Caller = await requireSection(request, 'pos')
      // A branch a café hub trades is view-only here (S10): its kitchen is the hub's.
      await refuseWhileHubbed({ ticketId })
      // Not logged, for the same reason as a bump: the ticket carries who took
      // it and when, and a service is hundreds of plates.
      const result = await pickUpTicket(caller, ticketId)
      return Response.json({ ok: true, ...result })
    }

    const caller: Caller = await requireSection(request, 'kds')
    await refuseWhileHubbed({ ticketId })
    // Not logged. A service is hundreds of bumps and the ticket carries who
    // bumped it and when, which is the record anyone would actually want.
    const result = await advanceTicket(caller, ticketId, parseTicketStatus(body.status))
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
