// Whether this counter PC can stop being the café hub — POS software (owner's
// decision S30, 15 Sep 2026).
//
// GET → { ready, reasons }
//
// The Windows app asks before it switches the PC to an online till: refused
// while anything is unsent, a table is open, or the drawer shift is open. Only
// on a hub, and only from the counter PC itself (a localhost Host).

import { toResponse, HttpError } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { readyToLeaveHub } from '@big-cms/shared/server/hubSync'
import { isCounterHost } from '@big-cms/shared/counterSignIn'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    if (!hubDbPath()) throw new HttpError(404, 'Not found.')
    if (!isCounterHost(request.headers.get('host'))) throw new HttpError(403, 'Only the counter PC itself asks this.')
    return Response.json({ ok: true, ...(await readyToLeaveHub()) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}
