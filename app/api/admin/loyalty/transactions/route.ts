// Resolving a pending loyalty submission. Phase 00 standing rule — a
// privileged mutation moved off the client SDK and behind a route handler.
//
// PATCH  approve or reject one pending transaction
//
// PATCH rather than POST: the transaction already exists (a customer or a staff
// panel created it), and this changes its status. Nothing here creates one.
//
// There is deliberately no DELETE. A resolved transaction is the record of
// points having been credited; removing one leaves balances that were moved by
// a document that no longer exists. Rejecting is the reversal that keeps an
// audit trail.

import { requireSection, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import { parseResolveInput, resolveTransaction } from '@/app/lib/server/loyalty'
import { logUpdate } from '@/app/lib/server/activityLog'

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

export async function PATCH(request: Request): Promise<Response> {
  try {
    // requireSection, not requireRole: this mirrors the page's own
    // useRequireRole(SECTION_ACCESS.loyalty) exactly, so an admin who granted
    // one person the loyalty section gets the same answer on both sides.
    const caller: Caller = await requireSection(request, 'loyalty')
    const input = parseResolveInput(await readBody(request))

    const result = await resolveTransaction(caller, input)

    // Logged after the transaction commits, not inside it. A failed write must
    // not leave an audit entry claiming points were credited — and the log is
    // append-only, so there is nothing to roll back if this itself fails.
    await logUpdate(
      caller,
      'Loyalty Management',
      result.label,
      { status: 'pending' },
      input.action === 'approve'
        ? { status: 'approved', pointsCredited: result.credited }
        : { status: 'rejected', rejectionReason: input.reason ?? '' },
    )

    // A named account that no longer exists is worth surfacing rather than
    // swallowing: the rest of the split was credited, so the submission is
    // resolved, but somebody got nothing and only this response says so.
    return Response.json({
      ok: true,
      credited: result.credited,
      warning: result.missingUsers.length > 0
        ? `Approved, but ${result.missingUsers.length} account(s) on this submission no longer exist and were not credited.`
        : undefined,
    })
  } catch (err) {
    return toResponse(err)
  }
}
