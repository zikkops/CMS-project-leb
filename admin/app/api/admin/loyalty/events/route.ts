// Logging event attendance for loyalty. Phase 00 standing rule — a privileged
// mutation moved off the client SDK and behind a route handler.
//
// POST  create one pending event-attendance submission
//
// It lands as 'pending' exactly as before: this records who attended, and a
// loyalty reviewer approving it is what moves points. That approval already
// runs at /api/admin/loyalty/transactions.
//
// The browser used to write this document itself, which meant it also named
// the award (`pointsAmount`) and who submitted it. Both now come from the
// server — see the note above createEventSubmission for why the cap in
// firestore.rules was not the same thing as a fixed value.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseEventSubmissionInput, createEventSubmission } from '@big-cms/shared/server/loyalty'
import { logCreate } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    // requireSection, not requireRole: mirrors the page's own
    // useRequireRole(SECTION_ACCESS.loyaltyEvents), so an admin who granted
    // one person that section gets the same answer on both sides.
    //
    // Deliberately loyaltyEvents and not loyalty — logging attendance is the
    // submission side, which social hires do; approving it is the review side
    // and stays on the narrower section.
    const caller: Caller = await requireSection(request, 'loyaltyEvents')

    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    const input = parseEventSubmissionInput(body)
    const result = await createEventSubmission(caller, input)

    // Logged after the write, never before — a failed create must not leave
    // an entry claiming something happened.
    await logCreate(caller, 'Loyalty Submission',
      `Event — ${input.eventName} (${result.attendees} attendee${result.attendees === 1 ? '' : 's'})`, {
        branchId: input.branchId,
        eventDate: input.eventDate,
        attendees: result.attendees,
        pointsAmount: result.pointsEach,
      })

    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
