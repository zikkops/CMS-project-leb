// Signing in at the café hub — POS software, stage 3, until phone sign-in.
//
// POST    Bearer <Firebase ID token>   start a hub session, to the end of the night
// GET     Bearer <hub session>         who it is, and until when
// DELETE  Bearer <hub session>         sign out
//
// Only on a hub. Online, sign-in is Firebase's alone and this answers 404.
// How long a session lasts is shared/src/hubSession.ts; how one is checked,
// shared/src/server/hubSession.ts.

import { bearerToken, toResponse, HttpError } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { signInAtHub, callerFromHubToken, endHubSession, type HubCaller } from '@big-cms/shared/server/hubSession'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

function hubOnly(): void {
  if (!hubDbPath()) throw new HttpError(404, 'Not found.')
}

function describe(caller: HubCaller) {
  return {
    uid: caller.uid, email: caller.email, role: caller.role, branchIds: caller.branchIds,
    superadmin: caller.superadmin, expiresAt: caller.expiresAt,
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    hubOnly()
    const { token, caller } = await signInAtHub(bearerToken(request))
    // Logged: on a hub a sign-in is good for the night, so who started one and
    // when is worth finding again.
    await logActivity(caller, 'create', 'POS', `Signed in at the café hub, until ${new Date(caller.expiresAt).toISOString()}`)
    return Response.json({ ok: true, token, ...describe(caller) })
  } catch (err) {
    return toResponse(err)
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    hubOnly()
    const caller = await callerFromHubToken(bearerToken(request))
    if (!caller) throw new HttpError(401, 'Not signed in.')
    return Response.json({ ok: true, ...describe(caller) })
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    hubOnly()
    const token = bearerToken(request)
    const caller = await callerFromHubToken(token)
    // Signing out twice is not an error: the second press finds nothing to end.
    if (caller && await endHubSession(token)) {
      await logActivity(caller, 'update', 'POS', 'Signed out at the café hub')
    }
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}
