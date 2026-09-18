// "86 from the till" (UPGRADE.md T3.5).
//
// POST { branch, menuItemId, soldOut: boolean }
//
// A manager (or admin) marks a dish sold out at one branch for the rest of the
// café day, or back on; it clears itself the next day (shared/src/soldOut.ts).
// Behind the soldOut switch. A branch a café hub trades is marked on the hub,
// so here it is refused like every other till write (S10), and on the hub it
// runs against the hub's own menu with no internet. Logged with who and what.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { refuseWhileHubbed } from '@big-cms/shared/server/hubLock'
import { serverFeatureOn } from '@big-cms/shared/server/features'
import { logActivity } from '@big-cms/shared/server/activityLog'
import { setSoldOut } from '@big-cms/shared/server/soldOut'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'pos')
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }
    if (!(await serverFeatureOn('soldOut'))) throw new HttpError(403, 'Marking dishes sold out from the till is switched off.')
    if (caller.role !== 'manager' && caller.role !== 'admin') throw new HttpError(403, 'Only a manager marks a dish sold out.')
    const branch = typeof body.branch === 'string' ? body.branch.trim() : ''
    const menuItemId = typeof body.menuItemId === 'string' ? body.menuItemId : ''
    if (typeof body.soldOut !== 'boolean') throw new HttpError(400, 'Say whether it is sold out.')
    await refuseWhileHubbed({ branch })

    const result = await setSoldOut(menuItemId, branch, body.soldOut)
    if (result.changed) {
      await logActivity(caller, 'update', 'POS',
        body.soldOut ? `Marked "${result.name}" sold out at ${branch} for today` : `Put "${result.name}" back on at ${branch}`)
    }
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
