// Moving product stock between branches.
//
// Its own route rather than an action on /api/admin/purchases: that one
// requires an order id before it looks at anything else, and a transfer has no
// order. It is also a different section — productTransfers, not productPurchases —
// so a role can be trusted to move stock without being trusted to sell it, or
// the other way round.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseTransferInput, transferStock } from '@big-cms/shared/server/stockTransfer'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'productTransfers')

    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    const input = parseTransferInput(body)
    const result = await transferStock(input)

    // Names come from the stored documents, not the request, so the log says
    // what was actually moved rather than what the browser called it.
    await logActivity(caller, 'update', 'Stock Transfer',
      `${input.fromBranch} → ${input.toBranch}: ` +
      input.items.map((i, n) => `${result.names[n]} ×${i.quantity}`).join(', '))

    return Response.json({ ok: true, moved: result.moved })
  } catch (err) {
    return toResponse(err)
  }
}
