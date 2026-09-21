// A café hub reports who is signed in there, with every sync (UPGRADE.md T6.5).
// The cloud keeps the list on the hub's row for the admin panel, and answers
// with the sessions an admin asked to end, which the hub then ends.
//
// POST { sessions: [...] }  →  { end: [sessionId, ...] }
//
// Cloud only, and only with a hub's own credential (`Hub <id>.<secret>`).
// Labels and times only arrive here; never a session token.

import { toResponse, HttpError } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { deviceFromRequest, noteSessions } from '@big-cms/shared/server/hubDevices'

export const runtime = 'nodejs'

const MAX_BODY = 200_000

export async function POST(request: Request): Promise<Response> {
  try {
    if (hubDbPath()) throw new HttpError(404, 'Not found.')
    const device = await deviceFromRequest(request)
    const text = await request.text()
    if (text.length > MAX_BODY) throw new HttpError(413, 'Too large.')
    const body = (() => { try { return JSON.parse(text || '{}') as Record<string, unknown> } catch { return {} } })()
    const end = await noteSessions(device, body.sessions)
    return Response.json({ ok: true, end }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}
