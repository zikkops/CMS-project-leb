'use client'

// Invoices for wholesale orders.
//
// Deliberately reuses drawInvoiceCanvas() from productPurchases rather than
// drawing a second invoice layout: one invoice design across the business,
// and `PurchaseItem` already carries a `priceType: 'wholesale'` variant. The
// numbers come from the same nextInvoiceNumber() sequence, so wholesale and
// counter sales share one series — which is what an accountant expects.
//
// Rendered in the browser because it's a <canvas>, then re-hosted through the
// same imgbb path every other image in this app uses. That's what makes the
// invoice a durable URL the shop can download and the email can link to.

import { auth } from './firebase'
import { drawInvoiceCanvas, type PurchaseItem } from './productPurchases'
import { nextFormattedInvoiceNumber } from './invoiceNumber'
import { uploadImage } from './media'
import type { WholesaleOrder, WholesaleOrderItem } from './wholesale'

export interface GeneratedInvoice {
  invoiceNumber: string
  invoiceUrl:    string
}

// Draws an invoice straight from the shop's cart, before the order document
// exists — that's what lets the submission email carry the invoice rather than
// waiting for approval. The invoice number identifies it; the order id isn't
// needed on the document itself.
//
// A number is therefore issued for every submitted order, including ones later
// rejected, so the sequence will have gaps. That's normal and expected in
// accounting systems, and preferable to renumbering after the fact.
export async function generateInvoiceForCart(input: {
  shopName:      string
  items:         WholesaleOrderItem[]
  totalUsd:      number
  issuedByEmail: string
}): Promise<GeneratedInvoice> {
  // The number comes from the server: the counter document is admin-only in
  // the rules, so a shop running the transaction itself gets a 403.
  const idToken = await auth.currentUser?.getIdToken()
  const res = await fetch('/api/wholesale/orders', {
    headers: { Authorization: `Bearer ${idToken}` },
  })
  if (!res.ok) throw new Error('Could not issue an invoice number.')
  const { invoiceNumber } = await res.json() as { invoiceNumber: string }

  const canvas = drawInvoiceCanvas(
    invoiceNumber,
    input.shopName,
    'Wholesale',
    input.items.map(i => ({
      productId:    i.productId,
      productName:  i.name,
      quantity:  i.quantity,
      unitPrice: i.unitPrice,
      priceType: 'wholesale' as const,
      subtotal:  Math.round(i.unitPrice * i.quantity * 100) / 100,
      sku:       i.sku,
    })),
    input.totalUsd,
    input.issuedByEmail,
    new Date(),
    'completed',
  )

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not render the invoice.'))), 'image/png'),
  )
  const file = new File([blob], `invoice-${invoiceNumber}.png`, { type: 'image/png' })
  const { url } = await uploadImage(file)

  return { invoiceNumber, invoiceUrl: url }
}

function toPurchaseItems(order: WholesaleOrder): PurchaseItem[] {
  return order.items.map(i => ({
    productId:    i.productId,
    productName:  i.name,
    quantity:  i.quantity,
    unitPrice: i.unitPrice,
    priceType: 'wholesale' as const,
    subtotal:  Math.round(i.unitPrice * i.quantity * 100) / 100,
    sku:       i.sku,
  }))
}

/**
 * Draws the invoice and uploads it, returning the number and URL.
 *
 * It used to stamp the order document itself with a client updateDoc. That was
 * a redundant write: setStatus() calls this and then PATCHes
 * /api/wholesale/orders with the same invoiceNumber and invoiceUrl, so the
 * order was written twice with identical values moments apart. The route now
 * sets invoicedAt too, which is the one field the client write was
 * contributing.
 *
 * The drawing and the upload stay here — the invoice is a <canvas>, which only
 * exists in a browser.
 */
export async function generateWholesaleInvoice(
  order: WholesaleOrder,
  issuedByEmail: string,
): Promise<GeneratedInvoice> {
  // Reuse an already-issued number rather than burning a new one on a
  // re-approval; regenerating should replace the image, not the identity.
  const invoiceNumber = order.invoiceNumber || await nextFormattedInvoiceNumber()

  const canvas = drawInvoiceCanvas(
    invoiceNumber,
    order.shopName || order.accountEmail,
    'Wholesale',
    toPurchaseItems(order),
    order.totalUsd,
    issuedByEmail,
    order.createdAt ? new Date(order.createdAt.seconds * 1000) : new Date(),
    'completed',
  )

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not render the invoice.'))), 'image/png'),
  )
  const file = new File([blob], `invoice-${invoiceNumber}.png`, { type: 'image/png' })
  const { url } = await uploadImage(file)

  return { invoiceNumber, invoiceUrl: url }
}
