// Whether anybody is signed in at this café hub — POS software (owner's decision
// S27, 15 Sep 2026).
//
// GET → { live }   how many hub sessions are live
//
// The Windows app asks before installing a downloaded update, which it does
// only when nobody is using the till. Only on a hub, and only from the counter
// PC itself (a localhost Host): a number, and nothing about who.

import { toResponse, HttpError } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { liveHubSessions } from '@big-cms/shared/server/hubSession'
import { isCounterHost } from '@big-cms/shared/counterSignIn'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    if (!hubDbPath()) throw new HttpError(404, 'Not found.')
    if (!isCounterHost(request.headers.get('host'))) throw new HttpError(403, 'Only the counter PC itself asks this.')
    return Response.json({ ok: true, live: await liveHubSessions() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}
