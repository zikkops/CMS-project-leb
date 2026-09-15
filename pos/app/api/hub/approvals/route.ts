// A manager approving a staff member's sign-in at a café hub — POS software,
// stage 5 (owner's decisions S6, S15–S17).
//
// GET  ?view=people                          who can ask: first names only
// GET  ?view=waiting                         requests still waiting for a manager
// POST { action: 'ask', uid, deviceName }    → { id, secret, expiresAt }
// POST { action: 'challenge', keyId }        → { nonce } for the manager's phone to sign
// POST { action: 'approve', id, keyId, nonce, signature }
// POST { action: 'deny', id, keyId, nonce, signature }
// POST { action: 'collect', id, secret }     → { status, token? }
//
// Only on a hub; the cloud answers 404. No session in front of it: answering
// is the manager's signature (hubApprovals.ts), and collecting is the asking
// phone's secret. Reaching this at all means the café wifi and a paired app.

import { toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { issueChallenge } from '@big-cms/shared/server/hubKeySignIn'
import {
  approveRequest, askApproval, collectApproval, denyRequest, listPeople, listWaiting, type Answered,
} from '@big-cms/shared/server/hubApprovals'
import { isRole } from '@big-cms/shared/roles'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

/** The manager who answered, for the activity log: logged under them, with both names (S16). */
function approverOf(answered: Answered): Caller {
  return {
    uid: answered.approverUid, email: null,
    role: isRole(answered.approverRole) ? answered.approverRole : null,
    branchIds: [], superadmin: false, isStaff: true,
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    if (!hubDbPath()) throw new HttpError(404, 'Not found.')
    const view = new URL(request.url).searchParams.get('view')
    if (view === 'people') return Response.json({ ok: true, people: await listPeople() }, { headers: noStore })
    if (view === 'waiting') return Response.json({ ok: true, waiting: await listWaiting() }, { headers: noStore })
    throw new HttpError(400, 'Unknown view.')
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
        const { id, secret, expiresAt } = await askApproval(body)
        return Response.json({ ok: true, id, secret, expiresAt }, { headers: noStore })
      }
      case 'challenge':
        return Response.json({ ok: true, ...(await issueChallenge(body.keyId)) }, { headers: noStore })
      case 'approve': {
        const approved = await approveRequest(body)
        await logActivity(approverOf(approved), 'update', 'POS',
          `${approved.approverLabel} approved ${approved.requestedLabel}'s sign-in on ${approved.deviceName} (no fingerprint on that phone)`)
        return Response.json({ ok: true, requested: approved.requestedLabel }, { headers: noStore })
      }
      case 'deny': {
        const denied = await denyRequest(body)
        await logActivity(approverOf(denied), 'update', 'POS',
          `${denied.approverLabel} turned down ${denied.requestedLabel}'s sign-in on ${denied.deviceName}`)
        return Response.json({ ok: true, requested: denied.requestedLabel }, { headers: noStore })
      }
      case 'collect': {
        const result = await collectApproval(body)
        if (result.status !== 'approved' || !result.token || !result.caller) {
          return Response.json({ ok: true, status: result.status }, { headers: noStore })
        }
        await logActivity(result.caller, 'create', 'POS', 'Signed in to the till with a manager\'s approval')
        return Response.json({ ok: true, status: 'approved', token: result.token, expiresAt: result.caller.expiresAt }, { headers: noStore })
      }
      default:
        throw new HttpError(400, 'Unknown action.')
    }
  } catch (err) {
    return toResponse(err)
  }
}
