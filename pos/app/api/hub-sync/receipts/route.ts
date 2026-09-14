// Receipt numbers for a café hub — POS software, stage 4.
//
// POST { have }   Authorization: Hub <deviceId>.<secret>
//   → { year, first, last, next }
//
// A block of 500 off the counter the cloud issues its own receipts from, so a
// hub can close checks with no internet and never print a number the cloud
// has given out (owner's decision S9). The hub asks once fewer than 100 are
// left; a hub that says it has more is refused. shared/src/receiptBlocks.ts
// has the rules, and every block is written down in hubReceiptBlocks.
//
// Cloud only; 404 on a hub.

import { toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { deviceFromRequest, reserveReceiptBlock } from '@big-cms/shared/server/hubDevices'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    if (hubDbPath()) throw new HttpError(404, 'Not found.')
    const device = await deviceFromRequest(request)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const block = await reserveReceiptBlock(device, body.have)
    // In the activity log as the hub itself: "who took receipt numbers 901 to
    // 1400" is asked by somebody reconciling a gap in the numbering.
    const actor: Caller = {
      uid: `hub:${device.id}`, email: null, role: null, branchIds: [device.branch], superadmin: false, isStaff: true,
    }
    await logActivity(actor, 'create', 'Café Hubs',
      `Receipt numbers ${block.first}–${block.last} (${block.year}) reserved for café hub "${device.name}" at ${device.branch}`)
    return Response.json({ ok: true, ...block }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}
