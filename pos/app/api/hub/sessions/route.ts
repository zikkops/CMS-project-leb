// Where people are signed in at this café hub, and ending a session (UPGRADE.md T6.5).
//
// GET              your own live sessions; a manager or admin sees everyone's.
//                  The counter PC's own hub page (localhost) sees everyone's too.
// POST { id }      end one: your own, or anybody's for a manager or admin, or
//                  from the counter PC's hub page. Logged.
//
// Hub only. A session is listed by the hash of its token; the token is never read.

import { bearerToken, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { callerFromHubToken, endHubSessionById, listHubSessions, sessionIdOf } from '@big-cms/shared/server/hubSession'
import { isCounterHost } from '@big-cms/shared/counterSignIn'
import { canEndSession, seesEverySession } from '@big-cms/shared/hubSessions'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

/** The signed-in caller, or null for the counter PC's hub page with nobody signed in. */
async function who(request: Request): Promise<{ caller: Caller | null; token: string; counter: boolean }> {
  if (!hubDbPath()) throw new HttpError(404, 'Not found.')
  const token = bearerToken(request)
  const caller = token ? await callerFromHubToken(token) : null
  const counter = isCounterHost(request.headers.get('host'))
  if (!caller && !counter) throw new HttpError(401, 'Not signed in.')
  return { caller, token, counter }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { caller, token, counter } = await who(request)
    const everyone = counter || (caller !== null && seesEverySession(caller))
    const current = sessionIdOf(token)
    const sessions = (await listHubSessions())
      .filter(s => everyone || s.uid === caller?.uid)
      .map(s => ({ ...s, current: s.id === current }))
    return Response.json({ ok: true, sessions, everyone }, { headers: noStore })
  } catch (err) {
    return toResponse(err)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { caller, counter } = await who(request)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const target = (await listHubSessions()).find(s => s.id === body.id)
    if (!target) throw new HttpError(404, 'That session has already ended.')
    if (!counter && !(caller && canEndSession(caller, target.uid))) throw new HttpError(403, 'You can end your own sessions. A manager can end anybody\'s.')
    const ended = await endHubSessionById(target.id)
    if (ended) {
      const actor: Caller = caller ?? { uid: 'hub:counter-pc', email: null, role: null, branchIds: [], superadmin: false, isStaff: true }
      await logActivity(actor, 'update', 'POS', `Ended ${target.name || target.email || 'a'}${target.name || target.email ? '\'s' : ''} session on ${target.device}`)
    }
    return Response.json({ ok: true, ended: Boolean(ended) }, { headers: noStore })
  } catch (err) {
    return toResponse(err)
  }
}
