// Retail sales. Phase 00 standing rule.
//
// POST   record a sale — deducts stock, prices it, issues the invoice number
// PATCH  refund one, or attach the rendered invoice image
//
// The two PATCH jobs share an endpoint because they are both "amend an order
// that already exists", and both are gated identically. They are told apart by
// an explicit `action`, not by which fields happen to be present — a body
// missing a field it should have had must be an error, not a different
// operation.

import { requireSection, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import { parsePurchaseInput, createPurchaseOrder, refundPurchaseOrder } from '@/app/lib/server/purchases'
import { adminDb } from '@/app/lib/server/firebaseAdmin'
import { logCreate, logUpdate } from '@/app/lib/server/activityLog'

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

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'gamePurchases')
    const input = parsePurchaseInput(await readBody(request))

    const result = await createPurchaseOrder(caller, input)

    await logCreate(
      caller,
      'Game Sale',
      `${result.invoiceNumber} — ${input.customerName} (${input.branch}) $${result.total.toFixed(2)}`,
      { branch: input.branch, total: result.total, lines: result.items.length },
    )

    // The priced items go back so the browser can render the invoice image
    // from the figures that were actually stored, rather than from its own
    // arithmetic — which is the thing this route exists to stop trusting.
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'gamePurchases')
    const body = await readBody(request)

    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : ''
    if (!orderId) throw new HttpError(400, 'Missing order id.')

    if (body.action === 'refund') {
      const note = typeof body.refundNote === 'string' ? body.refundNote.trim() : ''
      const result = await refundPurchaseOrder(caller, orderId, note)

      await logUpdate(
        caller, 'Game Sale', result.invoiceNumber,
        { status: 'completed' },
        { status: 'refunded', refundNote: note, total: result.total },
      )
      return Response.json({ ok: true })
    }

    if (body.action === 'invoice-url') {
      const invoiceUrl = typeof body.invoiceUrl === 'string' ? body.invoiceUrl.trim() : ''
      if (!invoiceUrl) throw new HttpError(400, 'Missing invoice URL.')

      // Deliberately not logged. This is the second half of an action already
      // in the log — an "invoice image attached" entry after every sale would
      // double the volume of that log and say nothing new.
      await adminDb().doc(`gamePurchaseOrders/${orderId}`).update({ invoiceUrl })
      return Response.json({ ok: true })
    }

    throw new HttpError(400, 'Unknown action.')
  } catch (err) {
    return toResponse(err)
  }
}
