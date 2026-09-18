// Email a closed check's receipt (UPGRADE.md T3.7).
//
// POST { checkId, email }
//
// Anyone on the till, behind the emailReceipts switch. The address is used for
// this send only: never stored, never logged (the log says a receipt was
// emailed, not where). A branch a café hub trades is refused here like every
// other till write (S10).

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { refuseWhileHubbed } from '@big-cms/shared/server/hubLock'
import { serverFeatureOn } from '@big-cms/shared/server/features'
import { logActivity } from '@big-cms/shared/server/activityLog'
import { emailReceipt } from '@big-cms/shared/server/receiptEmail'

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
    if (!(await serverFeatureOn('emailReceipts'))) throw new HttpError(403, 'Emailing receipts is switched off.')
    const checkId = typeof body.checkId === 'string' ? body.checkId : ''
    if (!checkId || checkId.includes('/')) throw new HttpError(400, 'Missing check id.')
    await refuseWhileHubbed({ checkId })
    const result = await emailReceipt(checkId, body.email)
    if (result.sent) await logActivity(caller, 'update', 'POS', `Emailed receipt ${result.receiptNumber} at ${result.branch}`)
    return Response.json({ ok: true, sent: result.sent, reason: result.reason })
  } catch (err) {
    return toResponse(err)
  }
}
