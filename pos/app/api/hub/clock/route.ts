// Clocking in and out with the staff app (UPGRADE.md T3.12).
//
// GET  ?keyId=                                          → { clockedIn, since }
// POST { action: 'challenge', keyId }                   → { nonce } for the phone to sign
// POST { action: 'clock', keyId, nonce, direction, signature }   in or out
//
// Only on a hub; the cloud answers 404. No session in front of it: the clock
// is the person's own fingerprint signature (server/hubClock.ts). Logged, so
// the activity log shows who clocked in or out, when.

import { toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { issueChallenge } from '@big-cms/shared/server/hubKeySignIn'
import { clockStatus, clockWithKey } from '@big-cms/shared/server/hubClock'
import { isRole } from '@big-cms/shared/roles'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request: Request): Promise<Response> {
  try {
    if (!hubDbPath()) throw new HttpError(404, 'Not found.')
    const keyId = new URL(request.url).searchParams.get('keyId')
    return Response.json({ ok: true, ...(await clockStatus(keyId)) }, { headers: noStore })
  } catch (err) {
    return toResponse(err)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!hubDbPath()) throw new HttpError(404, 'Not found.')
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }
    if (body.action === 'challenge') {
      return Response.json({ ok: true, ...(await issueChallenge(body.keyId)) }, { headers: noStore })
    }
    if (body.action === 'clock') {
      const done = await clockWithKey(body)
      const person: Caller = { uid: done.uid, email: null, role: isRole(done.role) ? done.role : null, branchIds: [], superadmin: false, isStaff: true }
      await logActivity(person, 'update', 'POS', `${done.label} clocked ${done.direction} with their fingerprint`)
      return Response.json({ ok: true, direction: done.direction, at: done.at }, { headers: noStore })
    }
    throw new HttpError(400, 'Unknown action.')
  } catch (err) {
    return toResponse(err)
  }
}
