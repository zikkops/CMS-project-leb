// GET — the signed-in customer's loyalty member code, made the first time
// they ask. Phase 04, slice 5.
//
// The code is what their profile shows as a QR for the till to scan. It lives
// server-side (shared/src/server/memberCodes.ts) because a code a customer
// could write for themselves could be set to someone else's.

import { requireCaller, toResponse, HttpError } from '@big-cms/shared/server/auth'
import { memberCodeFor } from '@big-cms/shared/server/memberCodes'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    const caller = await requireCaller(request)
    // Staff never collect points — the same line the loyalty rules draw.
    if (caller.isStaff) throw new HttpError(403, 'Staff accounts do not collect points.')
    return Response.json({ ok: true, code: await memberCodeFor(caller.uid) })
  } catch (err) {
    return toResponse(err)
  }
}
