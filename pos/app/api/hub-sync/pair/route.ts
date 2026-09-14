// A café hub pairing with the cloud — POS software, stage 4.
//
// POST { code }  →  { deviceId, secret, branch, name }
//
// Called by a hub, not by a person: the code an admin made in Settings → Café
// Hubs is the whole authority, and it works once, for fifteen minutes. The
// secret in the answer is never sent again; the cloud keeps only its hash.
//
// Cloud only. On a hub this answers 404: a hub pairs WITH the cloud, never
// with another hub.

import { toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { pairDevice } from '@big-cms/shared/server/hubDevices'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    if (hubDbPath()) throw new HttpError(404, 'Not found.')
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    const paired = await pairDevice(body.code)
    // Logged as the admin who made the code: they decided this PC would be a
    // hub, and "who let that PC in" is the question the entry answers.
    const actor: Caller = {
      uid: paired.pairedBy.uid, email: paired.pairedBy.email, role: null, branchIds: [], superadmin: false, isStaff: true,
    }
    await logActivity(actor, 'create', 'Café Hubs', `Café hub "${paired.name}" paired for ${paired.branch}`)

    return Response.json(
      { ok: true, deviceId: paired.deviceId, secret: paired.secret, branch: paired.branch, name: paired.name },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return toResponse(err)
  }
}
