// Staff deciding a wholesale order.
//
// The shop-facing half of this endpoint — a shop issuing an invoice number
// and submitting its own order — lives in the customer app at the same path.
// They were one file until the apps split; the seam was already there,
// because the two halves never shared anything but the collection name and
// authenticate as different kinds of account entirely.

import { adminDb } from '@big-cms/shared/server/firebaseAdmin'
import { toResponse, HttpError, requireSection } from '@big-cms/shared/server/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { INVOICE_NUMBER_PATTERN, INVOICE_IMAGE_URL_PATTERN } from '@big-cms/shared/invoiceFormat'

export const runtime = 'nodejs'
// ---- Staff: decide an order ----
//
// Records the decision and nothing else. Shops are deliberately NOT emailed
// here — the only address this system mails is the orders inbox, on submission.
// A shop sees its order status and invoice by signing in to /wholesale/orders.
//
// Keeping the single recipient also means Resend needs no verified domain:
// it only ever sends to the Resend account's own address.
export async function PATCH(request: Request): Promise<Response> {
  try {
    const actor = await requireSection(request, 'products')

    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Request body must be JSON.')
    }

    const orderId = typeof body.orderId === 'string' ? body.orderId : ''
    if (!orderId) throw new HttpError(400, 'orderId is required.')

    // Two things reach this route now, and either one alone is a valid call:
    // deciding the order, and stamping that the orders inbox was mailed about
    // it. The email stamp used to be a client updateDoc on the admin page.
    const status = typeof body.status === 'string' ? body.status : ''
    const markEmailed = body.markEmailed === true

    if (status && !['approved', 'rejected', 'fulfilled'].includes(status)) {
      throw new HttpError(400, 'Unknown status.')
    }
    if (!status && !markEmailed) {
      throw new HttpError(400, 'Nothing to update.')
    }

    const db = adminDb()
    const ref = db.doc(`wholesaleOrders/${orderId}`)
    const snap = await ref.get()
    if (!snap.exists) throw new HttpError(404, 'Order not found.')

    const patch: Record<string, unknown> = {}

    if (status) {
      patch.status = status
      patch.decidedBy = actor.uid
      patch.decidedByEmail = actor.email ?? ''
      patch.decidedAt = FieldValue.serverTimestamp()
    }

    // Stamped when the mailto link is opened, not when anything is delivered —
    // the browser cannot tell us whether the message was actually sent.
    if (markEmailed) patch.emailedAt = FieldValue.serverTimestamp()

    // The invoice is drawn in the browser (it's a canvas), so the number and
    // URL arrive with this request rather than being produced here.
    //
    // Validated the same way POST validates them, which this did not do: the
    // number must match the invoice format and the URL must be an imgbb link.
    // A staff-only route is lower risk than the shop-facing POST, but the
    // invoice URL is shown to the shop and the number is its accounting
    // identity, so neither should be free text.
    const rawNumber = typeof body.invoiceNumber === 'string' ? body.invoiceNumber.trim() : ''
    const rawUrl = typeof body.invoiceUrl === 'string' ? body.invoiceUrl.trim() : ''
    if (rawNumber) {
      if (!INVOICE_NUMBER_PATTERN.test(rawNumber)) throw new HttpError(400, 'That is not a valid invoice number.')
      patch.invoiceNumber = rawNumber
    }
    if (rawUrl) {
      if (!INVOICE_IMAGE_URL_PATTERN.test(rawUrl)) {
        throw new HttpError(400, 'That is not a valid invoice image URL.')
      }
      patch.invoiceUrl = rawUrl
      // Was written by a client updateDoc in generateWholesaleInvoice, which
      // stamped the order itself moments before this route stamped it again
      // with the same number and URL. Removing that write would have dropped
      // invoicedAt, because this route never set it.
      patch.invoicedAt = FieldValue.serverTimestamp()
    }

    await ref.update(patch)

    return Response.json({ orderId, status: status || undefined, emailed: markEmailed })

  } catch (err) {
    return toResponse(err)
  }
}
