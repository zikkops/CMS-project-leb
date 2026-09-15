// A staff phone's sign-in key — POS software, stage 5 (owner's decision S13).
//
// POST   { action: 'challenge' }             start registering: a challenge for the new key's attestation (S20)
// POST   { action: 'check', publicKey }      whether this key is already registered to the caller
// POST   { publicKey, proof, chain, deviceName }   register this phone for the signed-in staff member
// DELETE { keyId }                          remove a phone: its owner, or an admin
//
// Cloud only; a hub answers 404. The caller is a Firebase sign-in checked here,
// which is the cloud checking the staff member's password itself (S13). Hubs
// get the keys at their next pull.

import { requireStaff, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { enrolStaffKey, revokeStaffKey, startStaffKeyEnrolment, staffKeyRegistered } from '@big-cms/shared/server/staffKeys'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') throw new Error('not an object')
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Invalid request body.')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (hubDbPath()) throw new HttpError(404, 'Not found.')
    const caller: Caller = await requireStaff(request)
    const body = await readBody(request)
    if (body.action === 'challenge') return Response.json({ ok: true, ...(await startStaffKeyEnrolment(caller)) })
    if (body.action === 'check') return Response.json({ ok: true, registered: await staffKeyRegistered(caller, body.publicKey) })
    const result = await enrolStaffKey(caller, body)
    if (!result.already) {
      await logActivity(caller, 'create', 'Staff',
        `Registered a phone for fingerprint sign-in at the till (key in ${result.securityLevel === 'strongbox' ? 'StrongBox' : 'the secure area'}, checked with Google)`)
    }
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    if (hubDbPath()) throw new HttpError(404, 'Not found.')
    const caller: Caller = await requireStaff(request)
    const body = await readBody(request)
    const result = await revokeStaffKey(caller, body.keyId)
    if (!result.already) {
      await logActivity(caller, 'delete', 'Staff',
        `Removed a phone (${result.deviceName}) from fingerprint sign-in${result.uid === caller.uid ? '' : ' for another staff member'}`)
    }
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
