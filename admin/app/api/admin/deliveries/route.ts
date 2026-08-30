// Goods receiving. Phase 01.
//
// Server-side because posting a delivery does two things a browser must not be
// trusted with: it moves stock, and it sets purchase cost — which feeds
// weighted average cost, which feeds food cost % and every costing decision
// after it.
//
// POST   create a delivery (draft, or received and applied)
// PATCH  update an existing one — draft edits, or a draft being received
//
// There is deliberately no DELETE. A received delivery is a financial record
// matched against a supplier invoice; deleting one leaves stock that was moved
// by a document that no longer exists. Mark it 'disputed' instead.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseDelivery, postDelivery } from '@big-cms/shared/server/deliveries'
import { logActivity, logCreate } from '@big-cms/shared/server/activityLog'
import { deliveryDocLabel } from '@big-cms/shared/deliveries'

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

// A partially-applied delivery is the one outcome worth interrupting someone
// for: the invoice posted, but some lines couldn't move stock because the
// supply behind them no longer exists. Silence here would show up weeks later
// as unexplained shrinkage at a count.
function warningFor(missingSupplies: string[]): string | undefined {
  if (missingSupplies.length === 0) return undefined
  return `Saved, but ${missingSupplies.length} line(s) could not update stock ` +
    `because the item no longer exists in Supplies: ${missingSupplies.join(', ')}. ` +
    `Re-add them in Supplies, then raise a correcting delivery for those lines.`
}

export async function POST(request: Request): Promise<Response> {
  try {
    // Receiving happens at a back door, on a phone, by whoever signed for it —
    // so this matches the roles that already do the daily count rather than
    // being management-only. can() honours per-user grants, so anyone else who
    // genuinely receives stock can be granted the section.
    const actor: Caller = await requireSection(request, 'deliveries')
    const parsed = parseDelivery(await readBody(request))

    const result = await postDelivery(parsed, { uid: actor.uid, email: actor.email })

    const label = deliveryDocLabel(parsed)
    await logCreate(actor, 'Goods Receiving', label, {
      status: parsed.status,
      branch: parsed.branch,
      department: parsed.department,
      provider: parsed.providerName,
      invoiceNumber: parsed.invoiceNumber,
      currency: parsed.currency,
      lines: parsed.lines.length,
      stockMoved: result.stockMoved,
    })

    return Response.json({ id: result.id, warning: warningFor(result.missingSupplies) })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireSection(request, 'deliveries')
    const body = await readBody(request)

    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) throw new HttpError(400, 'Missing delivery id.')

    const parsed = parseDelivery(body)

    // postDelivery refuses to re-apply a delivery whose stock already moved —
    // that guard lives in the transaction, where it can read the current
    // status rather than trusting what the client thinks it is.
    const result = await postDelivery(parsed, { uid: actor.uid, email: actor.email }, id)

    await logActivity(
      actor,
      result.stockMoved ? 'update' : 'create',
      'Goods Receiving',
      `${deliveryDocLabel(parsed)} — ${parsed.status}`,
    )

    return Response.json({ id: result.id, warning: warningFor(result.missingSupplies) })
  } catch (err) {
    return toResponse(err)
  }
}
