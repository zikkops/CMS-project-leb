// The kitchen display. Phase 03, POS v1.
//
// PATCH  move a ticket along the pass
//
// Gated on `kds` rather than `pos`: kitchen crew work the pass and have no
// business in order entry, and the two are separate grants for that reason.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseTicketStatus, advanceTicket } from '@big-cms/shared/server/tickets'

export const runtime = 'nodejs'

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'kds')

    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    const ticketId = typeof body.ticketId === 'string' ? body.ticketId : ''
    if (!ticketId) throw new HttpError(400, 'Missing ticket id.')

    // Not logged. A service is hundreds of bumps and the ticket carries who
    // bumped it and when, which is the record anyone would actually want.
    const result = await advanceTicket(caller, ticketId, parseTicketStatus(body.status))
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
