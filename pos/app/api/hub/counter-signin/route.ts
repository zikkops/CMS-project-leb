// Signing in on the counter PC with your own phone — POS software, stage 5
// (owner's decisions S24–S25).
//
// GET  ?view=people                                 who can sign in: first names only
// POST { action: 'ask', uid }                       the counter PC asks → { id, secret, code, expiresAt }
// POST { action: 'challenge', keyId }               → { nonce } for the person's phone to sign
// POST { action: 'approve', code, keyId, nonce, signature }   the person's phone approves
// POST { action: 'collect', id, secret }            → { status, token? }
//
// Only on a hub; the cloud answers 404. No session in front of it: approving is
// the person's own fingerprint signature over the code on the counter screen
// (hubCounterSignIn.ts), and collecting is the counter's secret.

import { toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { issueChallenge } from '@big-cms/shared/server/hubKeySignIn'
import { listPeople } from '@big-cms/shared/server/hubApprovals'
import { approveCounterSignIn, askCounterSignIn, collectCounterSignIn } from '@big-cms/shared/server/hubCounterSignIn'
import { isRole } from '@big-cms/shared/roles'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request: Request): Promise<Response> {
  try {
    if (!hubDbPath()) throw new HttpError(404, 'Not found.')
    if (new URL(request.url).searchParams.get('view') !== 'people') throw new HttpError(400, 'Unknown view.')
    return Response.json({ ok: true, people: await listPeople() }, { headers: noStore })
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

    switch (body.action) {
      case 'ask': {
        const { id, secret, code, expiresAt, label } = await askCounterSignIn(body, { host: request.headers.get('host') })
        return Response.json({ ok: true, id, secret, code, expiresAt, label }, { headers: noStore })
      }
      case 'challenge':
        return Response.json({ ok: true, ...(await issueChallenge(body.keyId)) }, { headers: noStore })
      case 'approve': {
        const approved = await approveCounterSignIn(body)
        const person: Caller = {
          uid: approved.uid, email: null, role: isRole(approved.role) ? approved.role : null,
          branchIds: [], superadmin: false, isStaff: true,
        }
        await logActivity(person, 'update', 'POS', `${approved.label} approved signing in on the counter PC with their fingerprint`)
        return Response.json({ ok: true }, { headers: noStore })
      }
      case 'collect': {
        const result = await collectCounterSignIn(body)
        if (result.status !== 'approved' || !result.token || !result.caller) {
          return Response.json({ ok: true, status: result.status }, { headers: noStore })
        }
        await logActivity(result.caller, 'create', 'POS', 'Signed in on the counter PC with their phone, until 15 minutes without a tap')
        return Response.json({ ok: true, status: 'approved', token: result.token }, { headers: noStore })
      }
      default:
        throw new HttpError(400, 'Unknown action.')
    }
  } catch (err) {
    return toResponse(err)
  }
}
