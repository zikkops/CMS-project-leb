// Confirming or rejecting a reward redemption. Phase 00 standing rule.
//
// PATCH  confirm (deduct the points, mark redeemed) or reject
//
// Separate from ../transactions even though both resolve a pending loyalty
// document, because they are not the same operation: one credits points and
// can partially succeed across a split, the other debits a single account and
// must fail outright if the balance moved. Folding them into one endpoint with
// a discriminator would mean a body shape where half the fields are ignored
// depending on the other half.

import { requireSection, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import { parseRedemptionInput, resolveRedemption } from '@/app/lib/server/loyalty'
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
    const caller: Caller = await requireSection(request, 'loyalty')
    const input = parseRedemptionInput(await readBody(request))

    const result = await resolveRedemption(caller, input)

    await logUpdate(
      caller,
      'Loyalty Management',
      `Redemption — ${result.itemName}`,
      { status: 'pending' },
      input.action === 'approve'
        ? { status: 'redeemed', pointsSpent: result.spent }
        : { status: 'rejected', rejectionReason: input.reason ?? '' },
    )

    return Response.json({ ok: true, spent: result.spent })
  } catch (err) {
    return toResponse(err)
  }
}
