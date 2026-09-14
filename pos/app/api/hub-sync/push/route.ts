// What a café hub sends up to the cloud — POS software, stage 4.
//
// POST { seq, docs, moves }   Authorization: Hub <deviceId>.<secret>
//   → { docs, moves, movesAlreadyApplied, seq }
//
// The hub's checks, kitchen tickets, drawer shifts, drawer and activity as they
// stand, and its stock movements, which the cloud adds to its own count rather
// than replacing it (owner's decision S8). Every item is checked
// (shared/src/hubPush.ts) and one refusal refuses the request, so the hub never
// counts something sent that the cloud did not take. A movement sent twice is
// applied once.
//
// Cloud only; 404 on a hub.

import { toResponse, HttpError } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { applyPush, deviceFromRequest } from '@big-cms/shared/server/hubDevices'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    if (hubDbPath()) throw new HttpError(404, 'Not found.')
    const device = await deviceFromRequest(request)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }
    const result = await applyPush(device, body)
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}
