// Staff acting on a customer's account. Phase 00 standing rule.
//
// PATCH   set the spendable balance and/or the earned-total, or schedule the
//         annual points reset
// DELETE  remove a customer entirely — Auth login included
//
// Only the two loyalty figures. Everything else on a customer document is
// either theirs to edit (avatar, theme, username) or nobody's (isStaff, role —
// locked by firestore.rules and written only by the accounts route). Keeping
// the endpoint that narrow means it cannot become a general "write anything to
// a user document as staff" hole, which is what the client path effectively
// was.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseAdjustInput, adjustCustomerBalance } from '@big-cms/shared/server/loyalty'
import { deleteCustomerAccount, setLoyaltyResetDate } from '@big-cms/shared/server/customerAccounts'
import { adminDb } from '@big-cms/shared/server/firebaseAdmin'
import { logUpdate, logDelete } from '@big-cms/shared/server/activityLog'

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
    const caller: Caller = await requireSection(request, 'loyalty')

    // Scheduling the reset shares this route because it is the same screen and
    // the same section — /admin/loyalty/customers is where both live.
    const early = await request.clone().json().catch(() => ({})) as Record<string, unknown>
    if (early.action === 'reset-date') {
      const dateStr = typeof early.nextResetDate === 'string' ? early.nextResetDate.trim() : ''
      const { before } = await setLoyaltyResetDate(dateStr)
      await logUpdate(caller, 'Loyalty Reset Schedule', 'Next reset date',
        { nextResetDate: before }, { nextResetDate: dateStr })
      return Response.json({ ok: true })
    }
    const input = parseAdjustInput(await readBody(request))

    const result = await adjustCustomerBalance(caller, input)

    // logUpdate diffs before/after and writes nothing when they match, so a
    // no-op correction doesn't clutter the log with an entry that says nothing.
    await logUpdate(caller, 'Customer Account', result.label, result.before, result.after)

    return Response.json({ ok: true, ...result.after })
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'loyalty')
    const uid = new URL(request.url).searchParams.get('uid') ?? ''
    if (!uid) throw new HttpError(400, 'Missing customer id.')

    // The label comes from the stored document before it is deleted — after,
    // there is nothing left to name them by, and an audit entry reading
    // "deleted <uid>" helps nobody reading it a year later.
    const snap = await adminDb().doc(`users/${uid}`).get()
    const label = String(snap.data()?.email ?? snap.data()?.username ?? uid)

    const result = await deleteCustomerAccount(uid)
    await logDelete(caller, 'Customer Account', label, {
      uid,
      authDeleted: result.authDeleted,
      docsDeleted: result.docsDeleted,
    })
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
