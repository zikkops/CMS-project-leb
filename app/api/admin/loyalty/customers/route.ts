// Manual correction of a customer's points. Phase 00 standing rule.
//
// PATCH  set the spendable balance and/or the earned-total
//
// Only the two loyalty figures. Everything else on a customer document is
// either theirs to edit (avatar, theme, username) or nobody's (isStaff, role —
// locked by firestore.rules and written only by the accounts route). Keeping
// the endpoint that narrow means it cannot become a general "write anything to
// a user document as staff" hole, which is what the client path effectively
// was.

import { requireSection, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import { parseAdjustInput, adjustCustomerBalance } from '@/app/lib/server/loyalty'
import { logUpdate } from '@/app/lib/server/activityLog'

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

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'loyalty')
    const input = parseAdjustInput(await readBody(request))

    const result = await adjustCustomerBalance(caller, input)

    // logUpdate diffs before/after and writes nothing when they match, so a
    // no-op correction doesn't clutter the log with an entry that says nothing.
    await logUpdate(caller, 'Customer Account', result.label, result.before, result.after)

    return Response.json({ ok: true, ...result.after })
  } catch (err) {
    return toResponse(err)
  }
}
