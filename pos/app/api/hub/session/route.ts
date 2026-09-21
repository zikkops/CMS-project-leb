// Signing in at the café hub — POS software, stage 3, until phone sign-in.
//
// POST    Bearer <Firebase ID token>   start a hub session, to the end of the night
// GET     Bearer <hub session>         who it is, and until when
// PATCH   Bearer <hub session>         the till saw a tap: a counter sign-in's idle count starts again (S25)
// DELETE  Bearer <hub session>         sign out
//
// Only on a hub. Online, sign-in is Firebase's alone and this answers 404.
// How long a session lasts is shared/src/hubSession.ts; how one is checked,
// shared/src/server/hubSession.ts.

import { bearerToken, toResponse, HttpError } from '@big-cms/shared/server/auth'
import { adminDb, hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { readFirstName } from '@big-cms/shared/staffProfiles'
import { signInAtHub, callerFromHubToken, endHubSession, touchHubSession, type HubCaller } from '@big-cms/shared/server/hubSession'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

function hubOnly(): void {
  if (!hubDbPath()) throw new HttpError(404, 'Not found.')
}

/** The caller, with the first name the hub pulled (T6.2) so a shared screen can say who is signed in. */
async function describe(caller: HubCaller) {
  const name = caller.scope === 'kds' ? '' : readFirstName((await adminDb().doc(`users/${caller.uid}`).get()).data()?.firstName)
  return {
    uid: caller.uid, email: caller.email, name, role: caller.role, branchIds: caller.branchIds,
    superadmin: caller.superadmin, expiresAt: caller.expiresAt, scope: caller.scope, idleMs: caller.idleMs,
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    hubOnly()
    const { token, caller } = await signInAtHub(bearerToken(request))
    // Logged: on a hub a sign-in is good for the night, so who started one and
    // when is worth finding again.
    await logActivity(caller, 'create', 'POS', `Signed in at the café hub, until ${new Date(caller.expiresAt).toISOString()}`)
    return Response.json({ ok: true, token, ...(await describe(caller)) })
  } catch (err) {
    return toResponse(err)
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    hubOnly()
    const caller = await callerFromHubToken(bearerToken(request))
    if (!caller) throw new HttpError(401, 'Not signed in.')
    return Response.json({ ok: true, ...(await describe(caller)) })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    hubOnly()
    if (!(await touchHubSession(bearerToken(request)))) throw new HttpError(401, 'Not signed in.')
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
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
