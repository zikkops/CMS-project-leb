// Signing in at a café hub with a staff phone's key — POS software, stage 5 (S12–S14).
//
// POST { action: 'challenge', keyId }                    → { nonce, expiresAt }
// POST { action: 'signin', keyId, nonce, signature }     → { token, expiresAt, role }
//
// Only on a hub; the cloud answers 404. No sign-in in front of it, because this
// IS signing in: the signature is the credential, checked against the key the
// hub pulled (hubKeySignIn.ts). Works with no internet.

import { toResponse, HttpError } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { issueChallenge, signInWithKey } from '@big-cms/shared/server/hubKeySignIn'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

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
    if (body.action === 'signin') {
      const { token, caller } = await signInWithKey(body)
      await logActivity(caller, 'create', 'POS', 'Signed in to the till with a phone')
      return Response.json({ ok: true, token, expiresAt: caller.expiresAt, role: caller.role }, { headers: noStore })
    }
    throw new HttpError(400, 'Unknown action.')
  } catch (err) {
    return toResponse(err)
  }
}
