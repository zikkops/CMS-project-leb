// Café hubs: the counter PCs that run the POS for a branch with no internet.
// POS software, stage 4.
//
// GET    the hubs, active and unpaired                (admin)
// POST   { branch, name }  → a one-time pairing code  (admin)
// PATCH  { deviceId, action: 'revoke' }    unpair a hub                                    (admin)
// PATCH  { deviceId, action: 'online' }    its branch trades on the online till (S21)     (admin)
// PATCH  { deviceId, action: 'handback' }  give the branch back to the hub (S23)          (admin)
//
// Admin only, as Printers is: pairing gives a PC this café's menu, settings and
// staff roles, and unpairing is what happens to a PC that has been lost. The
// code is answered once and never logged — the log is read by more people than
// may pair a PC.

import { requireRole, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { createPairingCode, handBackToHub, listDevices, requestEndSession, revokeDevice, startOnlineTrading } from '@big-cms/shared/server/hubDevices'
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

export async function GET(request: Request): Promise<Response> {
  try {
    await requireRole(request, ['admin'])
    return Response.json({ ok: true, hubs: await listDevices() })
  } catch (err) {
    return toResponse(err)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireRole(request, ['admin'])
    const body = await readBody(request)
    const issued = await createPairingCode(actor, { branch: body.branch, name: body.name })
    await logActivity(actor, 'create', 'Café Hubs', `Pairing code made for a hub at ${issued.branch} ("${issued.name}")`)
    return Response.json({ ok: true, ...issued }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireRole(request, ['admin'])
    const body = await readBody(request)
    switch (body.action) {
      case 'revoke': {
        const hub = await revokeDevice(actor, body.deviceId)
        if (!hub.already) {
          await logActivity(actor, 'update', 'Café Hubs', `Café hub "${hub.name}" at ${hub.branch} unpaired`)
        }
        return Response.json({ ok: true, ...hub })
      }
      case 'online': {
        const hub = await startOnlineTrading(actor, body.deviceId)
        if (!hub.already) {
          await logActivity(actor, 'update', 'Café Hubs',
            `${hub.branch} switched to the online till while café hub "${hub.name}" is out of action; what it sends up is held for a manager`)
        }
        return Response.json({ ok: true, ...hub })
      }
      case 'endSession': {
        // Ending somebody's hub session from the admin panel (T6.5): the hub ends it at its next sync.
        const { hub, session } = await requestEndSession(body.deviceId, body.sessionId)
        await logActivity(actor, 'update', 'Café Hubs', `Asked café hub "${hub.name}" to end ${session.name || session.email || 'a'}${session.name || session.email ? '\'s' : ''} session on ${session.device}`)
        return Response.json({ ok: true })
      }
      case 'handback': {
        const hub = await handBackToHub(actor, body.deviceId)
        await logActivity(actor, 'update', 'Café Hubs', `${hub.branch} handed back to café hub "${hub.name}"`)
        return Response.json({ ok: true, ...hub })
      }
      default:
        throw new HttpError(400, 'Unknown action.')
    }
  } catch (err) {
    return toResponse(err)
  }
}
