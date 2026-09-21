// Moving ingredient stock between branches (UPGRADE.md T3.14).
//
// POST { fromBranch, toBranch, items: [{ supplyId, quantity }], requestId }
//
// The supplies section, and a manager or admin: the section is open to
// baristas and kitchen crew for the daily count, and moving stock out of a
// branch is a manager's call (the default until the owner says otherwise).
// Logged with what moved, by the stored names.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseRequestId } from '@big-cms/shared/server/idempotency'
import { logActivity } from '@big-cms/shared/server/activityLog'
import { parseSupplyTransfer, transferSupplies } from '@big-cms/shared/server/supplyTransfer'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'supplies')
    if (caller.role !== 'manager' && caller.role !== 'admin') throw new HttpError(403, 'Only a manager moves stock between branches.')
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }
    const input = parseSupplyTransfer(body)
    const result = await transferSupplies(input, parseRequestId(body))
    if (!result.duplicate) {
      await logActivity(caller, 'update', 'Stock Transfer',
        `Ingredients ${input.fromBranch} → ${input.toBranch}: ${result.lines.map(l => `${l.name} ${l.quantity} ${l.unit}`.trim()).join(', ')}`)
    }
    return Response.json({ ok: true, lines: result.lines, duplicate: result.duplicate })
  } catch (err) {
    return toResponse(err)
  }
}
