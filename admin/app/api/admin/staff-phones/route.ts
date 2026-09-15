// Staff phones: the phones registered for fingerprint sign-in at the till.
// POS software, stage 5 (S13).
//
// GET    every registered phone, in use and removed      (admin)
// PATCH  { keyId, action: 'remove' }  remove a phone     (admin)
//
// Admin only, as Café Hubs is: removing a phone is what happens to a lost one or
// a leaver's, and it stops signing its owner in at each hub's next pull. A staff
// member may also remove their own through /api/staff-keys on the POS.

import { requireRole, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { listStaffKeys, revokeStaffKey } from '@big-cms/shared/server/staffKeys'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireRole(request, ['admin'])
    return Response.json({ ok: true, phones: await listStaffKeys() })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireRole(request, ['admin'])
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }
    if (body.action !== 'remove') throw new HttpError(400, 'Unknown action.')
    const removed = await revokeStaffKey(actor, body.keyId)
    if (!removed.already) {
      await logActivity(actor, 'delete', 'Staff Phones', `Removed a phone (${removed.deviceName}) from fingerprint sign-in`)
    }
    return Response.json({ ok: true, ...removed })
  } catch (err) {
    return toResponse(err)
  }
}
