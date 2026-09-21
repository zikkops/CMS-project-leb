// Scan to sign in on the online till (UPGRADE.md T6.4). The rules are
// shared/src/staffSignIn.ts; the server is shared/src/server/staffSignIn.ts.
//
// POST { action: 'ask' }                 a device asks; no sign-in (capped per day)
// POST { action: 'peek', id }            the phone checks the request     (staff)
// POST { action: 'approve', id }         the phone approves it as its owner (staff)
// POST { action: 'collect', id, secret } the device collects a custom token, once
//
// Cloud only: on a café hub this answers 404, since a hub signs people in its
// own way and holds no Admin key. The body is size-capped before it is parsed,
// because two of these actions take no sign-in.

import { requireStaff, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { askStaffSignIn, approveStaffSignIn, collectStaffSignIn, peekStaffSignIn } from '@big-cms/shared/server/staffSignIn'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }
const MAX_BODY = 2_048

export async function POST(request: Request): Promise<Response> {
  try {
    if (hubDbPath()) throw new HttpError(404, 'Not found.')
    const text = await request.text()
    if (text.length > MAX_BODY) throw new HttpError(413, 'Too large.')
    let body: Record<string, unknown>
    try {
      body = JSON.parse(text || '{}') as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }
    switch (body.action) {
      case 'ask':
        return Response.json({ ok: true, ...(await askStaffSignIn()) }, { headers: noStore })
      case 'peek': {
        await requireStaff(request)
        return Response.json({ ok: true, ...(await peekStaffSignIn(body.id)) }, { headers: noStore })
      }
      case 'approve': {
        const caller = await requireStaff(request)
        await approveStaffSignIn(caller, body.id)
        await logActivity(caller, 'update', 'POS', 'Approved signing in on a shared device, from their own phone')
        return Response.json({ ok: true }, { headers: noStore })
      }
      case 'collect': {
        const result = await collectStaffSignIn(body)
        if (result.state !== 'approved') return Response.json({ ok: true, state: result.state }, { headers: noStore })
        const person: Caller = { uid: result.uid, email: null, role: null, branchIds: [], superadmin: false, isStaff: true }
        await logActivity(person, 'create', 'POS', 'Signed in on a shared device by scanning its code')
        return Response.json({ ok: true, state: 'approved', token: result.token }, { headers: noStore })
      }
      default:
        throw new HttpError(400, 'Unknown action.')
    }
  } catch (err) {
    return toResponse(err)
  }
}
