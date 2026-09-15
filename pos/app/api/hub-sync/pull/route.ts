// What a café hub pulls from the cloud — POS software, stage 4.
//
// GET ?digest=<the last one taken in>&sent=<how far it has sent up>&latest=<its change log's end>
//   Authorization: Hub <deviceId>.<secret>
//   → { unchanged: true, digest, tradingOnline }  or  { unchanged: false, digest, docs, tradingOnline }
//
// The menu, options, products, the hub's branch's table layout, the three
// settings documents the till reads, and staff accounts cut down to their
// roles (shared/src/hubSync.ts, pullSpec and staffRecord). Nothing else: not a
// check, not the receipt counter, not a customer. A hub asks every two
// minutes, so an unchanged snapshot is a digest, not the menu again.
//
// Cloud only; 404 on a hub.

import { toResponse, HttpError } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { buildPullSnapshot, deviceFromRequest, encodeSnapshot, noteCaughtUp } from '@big-cms/shared/server/hubDevices'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    if (hubDbPath()) throw new HttpError(404, 'Not found.')
    const device = await deviceFromRequest(request)
    const params = new URL(request.url).searchParams
    // While its branch trades online (S21), a hub that says it has nothing left
    // to send up makes handing the branch back possible (S23).
    await noteCaughtUp(device, params.get('sent'), params.get('latest'))
    const tradingOnline = device.onlineSince != null
    const { docs, digest } = encodeSnapshot(await buildPullSnapshot(device))
    const headers = { 'Cache-Control': 'no-store' }
    if (params.get('digest') === digest) {
      return Response.json({ ok: true, unchanged: true, digest, tradingOnline }, { headers })
    }
    return Response.json({ ok: true, unchanged: false, digest, branch: device.branch, docs, tradingOnline }, { headers })
  } catch (err) {
    return toResponse(err)
  }
}
