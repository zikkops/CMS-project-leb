// What café hubs sent up while their branch traded on the online till — POS
// software, stage 4 (owner's decision S22, 15 Sep 2026).
//
// GET                                   the held items, newest first
// PATCH { id, decision: 'apply' }       write the counter PC's version over the cloud's
// PATCH { id, decision: 'dismiss' }     leave the cloud as it is
//
// Gated on endOfDay, the people who do the cash-up: deciding a held sale is
// deciding what the branch took. A manager decides only for their own branches
// (decideHeldItem). Every decision is logged.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { decideHeldItem, listHeldItems } from '@big-cms/shared/server/hubDevices'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSection(request, 'endOfDay')
    return Response.json({ ok: true, items: await listHeldItems() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireSection(request, 'endOfDay')
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }
    const decided = await decideHeldItem(actor, body.id, body.decision)
    await logActivity(actor, 'update', 'Café Hubs',
      `${decided.decision === 'apply' ? 'Applied' : 'Dismissed'} what café hub "${decided.hubName}" at ${decided.branch} sent up while the branch traded online: ${decided.summary}`)
    return Response.json({ ok: true, ...decided })
  } catch (err) {
    return toResponse(err)
  }
}
