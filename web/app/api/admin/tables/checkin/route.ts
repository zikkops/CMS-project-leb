// Checking a table reservation in, and awarding the points that go with it.
// Phase 00 standing rule.
//
// POST  check in one approved reservation
//
// Under tables/ rather than loyalty/ because that is the section that gates
// it: the person on the floor checking guests in holds tableReservations, not
// loyalty. The award is a consequence of the check-in, not a loyalty action
// someone performs on its own.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseCheckinInput, checkInReservation } from '@big-cms/shared/server/loyalty'
import { logUpdate } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') throw new Error('not an object')
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Invalid request body.')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'tableReservations')
    const input = parseCheckinInput(await readBody(request))

    const result = await checkInReservation(caller, input)

    await logUpdate(
      caller,
      'Table Reservation',
      result.label,
      { checkedIn: false },
      { checkedIn: true, pointsAwarded: result.awarded },
    )

    return Response.json({
      ok: true,
      awarded: result.awarded,
      // Worth saying out loud rather than showing a silent zero: staff expect
      // a check-in to award points, and "this booking has no account attached"
      // is the reason it didn't.
      note: result.guestBooking
        ? 'Checked in. No points awarded — this booking has no customer account attached.'
        : undefined,
    })
  } catch (err) {
    return toResponse(err)
  }
}
