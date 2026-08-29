// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Recording a retail sale, and refunding one.
//
// ── The reason this moved ─────────────────────────────────────────────────
// The client version was careful code — a real runTransaction, quantities
// aggregated so a duplicated cart line couldn't half-deduct, legacy stock
// shapes handled. Its weakness was not the transaction. It was the prices.
//
// The browser read the product's price out of its own copy of the document,
// multiplied by the quantity, and sent `unitPrice`, `subtotal` and `total`
// along with the order. Firestore stored what it was given. A tampered client
// could record a $200 board product as a $0.01 sale, and the books would agree
// with it forever.
//
// This is the exact case Phase 00 was created for: "server-computed totals — a
// browser can't be trusted with a bill total. Today a tampered client costs
// you loyalty XP; with a POS it costs cash."
//
// So the request now carries only WHAT was bought, never what it was worth:
// productId, quantity, and which price list to use. Every figure is recomputed
// here from the stored product document.
//
// ── What deliberately stays in the browser ────────────────────────────────
// The invoice IMAGE. It is rendered with a canvas, which has no server
// equivalent short of a headless browser, and it was already generated after
// the transaction committed and attached separately. That structure is kept:
// the sale is a server fact, the picture of it is a follow-up PATCH.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRANCHES } from '../branches'
import { formatInvoiceNumber } from '../invoiceFormat'
import { readInvoicePrefixSetting } from './settings'
import { effectivePrice } from '../productPricing'

export type PriceType = 'retail' | 'wholesale'

/** What the browser is allowed to say. Note the absence of any money. */
export interface RequestedLine {
  productId: string
  quantity: number
  priceType: PriceType
}

export interface PurchaseInput {
  customerName: string
  branch: string
  lines: RequestedLine[]
}

export function parsePurchaseInput(body: Record<string, unknown>): PurchaseInput {
  const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : ''
  if (!customerName) throw new HttpError(400, 'A customer name is required.')

  const branch = typeof body.branch === 'string' ? body.branch.trim() : ''
  if (!(BRANCHES as readonly string[]).includes(branch)) {
    throw new HttpError(400, `Unknown branch: ${branch || '(none)'}`)
  }

  const raw = Array.isArray(body.lines) ? body.lines : []
  if (raw.length === 0) throw new HttpError(400, 'The cart is empty.')

  const lines: RequestedLine[] = raw.map((l, i) => {
    const line = (l ?? {}) as Record<string, unknown>
    const productId = typeof line.productId === 'string' ? line.productId.trim() : ''
    if (!productId) throw new HttpError(400, `Line ${i + 1} is missing a product.`)

    const quantity = Number(line.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new HttpError(400, `Line ${i + 1} has an invalid quantity.`)
    }

    const priceType = line.priceType === 'wholesale' ? 'wholesale' : 'retail'
    return { productId, quantity, priceType }
  })

  return { customerName, branch, lines }
}

/** The priced line as it is stored — every figure computed here. */
export interface PricedLine {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  priceType: PriceType
  subtotal: number
  sku?: string
}

export interface PurchaseResult {
  orderId: string
  invoiceNumber: string
  total: number
  items: PricedLine[]
}

/**
 * Read a product's stock as a per-branch map.
 *
 * Documents created before multi-branch support hold a flat number. Ported
 * verbatim from the client version rather than re-derived: a subtly different
 * reading of legacy stock would silently move the wrong branch's inventory.
 */
function normaliseStock(raw: unknown): Record<string, number> {
  if (typeof raw === 'number') {
    return Object.fromEntries(BRANCHES.map((b, i) => [b, i === 0 ? raw : 0]))
  }
  return { ...((raw as Record<string, number>) ?? {}) }
}

export async function createPurchaseOrder(
  caller: Caller,
  input: PurchaseInput,
): Promise<PurchaseResult> {
  const db = adminDb()

  // Duplicate cart entries for one product are summed before anything is read.
  // Two updates to the same document inside one transaction would otherwise
  // have the second overwrite the first, deducting only part of the quantity.
  const wanted = new Map<string, { quantity: number; priceType: PriceType }>()
  for (const line of input.lines) {
    const prev = wanted.get(line.productId)
    wanted.set(line.productId, {
      quantity: (prev?.quantity ?? 0) + line.quantity,
      // A cart holding the same product at two price types is ambiguous;
      // wholesale wins, because charging the lower of the two is the failure
      // that gets noticed and corrected rather than silently overcharging.
      priceType: prev?.priceType === 'wholesale' || line.priceType === 'wholesale' ? 'wholesale' : 'retail',
    })
  }

  const productIds = [...wanted.keys()]
  // Trade prices live in productWholesale, not on the public product doc.
  // Fetched up front: a transaction may not read after its first write, and
  // these are needed while pricing each line.
  const wholesaleById = new Map<string, number>()
  for (const id of productIds) {
    const w = await db.doc(`productWholesale/${id}`).get()
    const n = Number(w.data()?.wholesalePrice)
    if (Number.isFinite(n)) wholesaleById.set(id, n)
  }
  const counterRef = db.doc('appSettings/invoiceCounter')

  // Fetched up front for the same reason the trade prices above are: a
  // transaction may not read after its first write, and the prefix is needed
  // while formatting the number. It is a setting rather than part of the
  // counter's state, so reading it outside costs the transaction nothing.
  const prefix = await readInvoicePrefixSetting()

  return db.runTransaction(async tx => {
    const productRefs = productIds.map(id => db.doc(`products/${id}`))
    // Every read before every write — a Firestore transaction forbids the
    // reverse, and the counter has to be read here too.
    const [counterSnap, ...productSnaps] = await tx.getAll(counterRef, ...productRefs)

    const items: PricedLine[] = []

    productSnaps.forEach((snap, i) => {
      const productId = productIds[i]
      if (!snap.exists) throw new HttpError(404, 'A product in this sale no longer exists.')

      const data = snap.data() ?? {}
      const want = wanted.get(productId)!

      // THE POINT OF THIS WHOLE FILE: the price comes from the stored
      // document, never from the request.
      // effectivePrice() applies a running sale, so the till charges what the
      // shelf and the storefront show. Wholesale is untouched by an offer —
      // a trade price is negotiated, not discounted alongside retail.
      const retail = effectivePrice({
        price: Number(data.price ?? 0),
        salePrice: data.salePrice == null ? null : Number(data.salePrice),
        saleEndsAt: typeof data.saleEndsAt === 'string' ? data.saleEndsAt : null,
      })
      const wholesale = wholesaleById.get(productId) ?? null
      const unitPrice = want.priceType === 'wholesale' && wholesale != null ? wholesale : retail

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new HttpError(422, `"${data.name ?? productId}" has no valid price and cannot be sold.`)
      }

      const stock = normaliseStock(data.stock)
      const have = stock[input.branch] ?? 0
      if (have < want.quantity) {
        throw new HttpError(409, `Not enough stock of "${data.name ?? productId}" at ${input.branch}.`)
      }
      stock[input.branch] = have - want.quantity

      tx.update(productRefs[i], { stock, updatedAt: FieldValue.serverTimestamp() })

      items.push({
        productId,
        productName: String(data.name ?? productId),
        quantity: want.quantity,
        unitPrice,
        priceType: want.priceType,
        subtotal: Math.round(unitPrice * want.quantity * 100) / 100,
        ...(typeof data.sku === 'string' ? { sku: data.sku } : {}),
      })
    })

    const total = Math.round(items.reduce((s, it) => s + it.subtotal, 0) * 100) / 100

    // The invoice sequence is issued in the SAME transaction as the sale.
    // Issuing it beforehand burns a number whenever the sale then fails on
    // stock — gaps are tolerated in accounting, but there is no reason to
    // manufacture them.
    const issuedAt = new Date()
    const year = issuedAt.getFullYear()
    const counter = counterSnap.data() ?? {}
    const sequence = counter.year === year ? Number(counter.nextNumber ?? 0) + 1 : 1
    tx.set(counterRef, { year, nextNumber: sequence })
    const invoiceNumber = formatInvoiceNumber(sequence, issuedAt, prefix)

    const orderRef = db.collection('productPurchaseOrders').doc()
    tx.set(orderRef, {
      invoiceNumber,
      customerName: input.customerName,
      items,
      total,
      branch: input.branch,
      status: 'completed',
      invoiceUrl: null,
      processedBy: caller.uid,
      processedByEmail: caller.email ?? '',
      createdAt: FieldValue.serverTimestamp(),
      refundedAt: null,
      refundedBy: null,
      refundNote: null,
    })

    return { orderId: orderRef.id, invoiceNumber, total, items }
  })
}

export interface RefundResult {
  invoiceNumber: string
  total: number
}

export async function refundPurchaseOrder(
  caller: Caller,
  orderId: string,
  refundNote: string,
): Promise<RefundResult> {
  const db = adminDb()
  const orderRef = db.doc(`productPurchaseOrders/${orderId}`)

  return db.runTransaction(async tx => {
    const orderSnap = await tx.get(orderRef)
    if (!orderSnap.exists) throw new HttpError(404, 'That order no longer exists.')

    const order = orderSnap.data() ?? {}
    // Re-read inside the transaction: checking before it lets two refunds of
    // the same order both pass, returning the stock twice.
    if (order.status === 'refunded') throw new HttpError(409, 'That order has already been refunded.')

    const items = Array.isArray(order.items) ? (order.items as PricedLine[]) : []
    const back = new Map<string, number>()
    for (const it of items) back.set(it.productId, (back.get(it.productId) ?? 0) + Number(it.quantity ?? 0))

    const ids = [...back.keys()]
    const refs = ids.map(id => db.doc(`products/${id}`))
    const snaps = refs.length > 0 ? await tx.getAll(...refs) : []

    snaps.forEach((snap, i) => {
      // A product deleted since the sale simply has no stock to return. The
      // refund still stands — the customer's money is not contingent on the
      // catalogue still listing the item.
      if (!snap.exists) return
      const stock = normaliseStock(snap.data()?.stock)
      const branch = String(order.branch ?? BRANCHES[0])
      stock[branch] = (stock[branch] ?? 0) + (back.get(ids[i]) ?? 0)
      tx.update(refs[i], { stock, updatedAt: FieldValue.serverTimestamp() })
    })

    tx.update(orderRef, {
      status: 'refunded',
      refundedAt: FieldValue.serverTimestamp(),
      refundedBy: caller.email ?? caller.uid,
      refundNote: refundNote || null,
    })

    return {
      invoiceNumber: String(order.invoiceNumber ?? orderId),
      total: Number(order.total ?? 0),
    }
  })
}
