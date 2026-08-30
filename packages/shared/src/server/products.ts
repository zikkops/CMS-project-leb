// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The product catalogue: what is for sale, what it costs, and what is on
// offer.
//
// Two things were wrong with editing this from the browser, and one of them
// destroyed data.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { todayKey } from '../productPricing'
import { BRANCHES } from '../branches'

const MAX_PRICE = 100_000

function text(raw: unknown, label: string, { required = false, maxLen = 200 } = {}): string {
  const v = String(raw ?? '').trim()
  if (required && !v) throw new HttpError(400, `${label} is required.`)
  return v.slice(0, maxLen)
}

function money(raw: unknown, label: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) {
    throw new HttpError(400, `${label} must be a number between 0 and ${MAX_PRICE.toLocaleString()}.`)
  }
  return Math.round(n * 100) / 100
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface ProductInput {
  name: string
  category: string
  description: string
  players: string
  duration: string
  age: string
  price: number
  salePrice: number | null
  saleEndsAt: string | null
  image: string
}

export function parseProductInput(body: Record<string, unknown>): ProductInput {
  const price = money(body.price, 'Price')

  // Blank clears the offer. An empty string arrives from an emptied number
  // input and must not read as zero — a product priced free by accident is a
  // worse outcome than a rejected save.
  const rawSale = body.salePrice
  const salePrice = rawSale === '' || rawSale === null || rawSale === undefined
    ? null
    : money(rawSale, 'Sale price')

  if (salePrice != null && salePrice >= price) {
    throw new HttpError(400, 'A sale price has to be below the normal price.')
  }

  const rawEnds = body.saleEndsAt
  let saleEndsAt: string | null = null
  if (rawEnds !== '' && rawEnds !== null && rawEnds !== undefined) {
    const v = String(rawEnds).trim()
    if (!DATE.test(v)) throw new HttpError(400, 'Sale end date must be YYYY-MM-DD.')
    // A sale that ended before it was saved would display as not-on-offer with
    // no explanation of why the price did not change.
    if (v < todayKey()) throw new HttpError(400, 'That sale end date has already passed.')
    saleEndsAt = v
  }
  if (saleEndsAt && salePrice == null) {
    throw new HttpError(400, 'Set a sale price, or clear the end date.')
  }

  return {
    name: text(body.name, 'Product name', { required: true }),
    category: text(body.category, 'Category', { maxLen: 100 }),
    description: text(body.description, 'Description', { maxLen: 4000 }),
    players: text(body.players, 'Players', { maxLen: 50 }),
    duration: text(body.duration, 'Duration', { maxLen: 50 }),
    age: text(body.age, 'Age', { maxLen: 20 }),
    price,
    salePrice,
    saleEndsAt,
    image: text(body.image, 'Image', { maxLen: 2000 }),
  }
}

/**
 * The trade price, parsed separately because it is stored separately.
 *
 * It used to be a field on the product document. That document is
 * world-readable so the storefront works signed out, which means every field
 * on it is public no matter what the UI chooses to show — wholesale cost, and
 * therefore retail margin, included. firestore.rules had already worked this
 * out and described a productWholesale collection for exactly this reason;
 * the collection existed, was empty, and nothing wrote to it.
 *
 * Returns null to mean "no trade price", which is also how the document is
 * deleted rather than left holding a stale figure.
 */
export function parseWholesalePrice(raw: unknown): number | null {
  if (raw === '' || raw === null || raw === undefined) return null
  return money(raw, 'Wholesale price')
}

/** Writes or clears the gated trade price for a product. */
export async function setWholesalePrice(productId: string, price: number | null): Promise<void> {
  const ref = adminDb().doc(`productWholesale/${productId}`)
  if (price == null) { await ref.delete().catch(() => {}); return }
  await ref.set({ productId, wholesalePrice: price, updatedAt: FieldValue.serverTimestamp() })
}

/** Trade prices by product id, for the screens allowed to see them. */
export async function readWholesalePrices(): Promise<Record<string, number>> {
  const snap = await adminDb().collection('productWholesale').get()
  const out: Record<string, number> = {}
  snap.docs.forEach(d => {
    const n = Number(d.data().wholesalePrice)
    if (Number.isFinite(n)) out[d.id] = n
  })
  return out
}

/**
 * Starting stock, accepted on create only.
 *
 * Keyed to the configured branches and nothing else — a count filed under a
 * branch that does not exist is stock nothing will ever show, and the same
 * shape of bug as a transfer to an unconfigured branch.
 */
export function parseStartingStock(raw: unknown): Record<string, number> {
  const given = (raw ?? {}) as Record<string, unknown>
  const stock: Record<string, number> = {}
  for (const b of BRANCHES) {
    const n = Number(given[b] ?? 0)
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
      throw new HttpError(400, `Starting stock for ${b} must be a whole number of at least 0.`)
    }
    stock[b] = n
  }
  return stock
}

export async function createProduct(
  input: ProductInput,
  sku: string,
  stock: Record<string, number>,
): Promise<{ id: string }> {
  const ref = await adminDb().collection('products').add({
    ...input,
    sku,
    // The only place stock is ever written from a form. After this it moves
    // through a sale, a transfer or the import — see updateProduct.
    stock,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id }
}

/**
 * Edits a product — everything except its stock and its SKU.
 *
 * **Stock is deliberately not writable here.** The edit form held a copy of
 * the stock map, loaded when the form opened, and spread it back on save. So
 * correcting a typo in a description reverted every sale, transfer and
 * delivery that had happened while the form sat open. The figures simply went
 * backwards, with no error and nothing in the log to explain it.
 *
 * Stock moves through receiving, a sale, or a transfer. Never through an
 * edit. ProductInput has no stock field at all, so this cannot regress by
 * someone adding one back to the form.
 *
 * The SKU is likewise absent: it is printed on labels and past invoices, so
 * renaming a product must not rewrite it.
 */
export async function updateProduct(id: string, input: ProductInput): Promise<{ before: Record<string, unknown> }> {
  const ref = adminDb().doc(`products/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That product no longer exists.')
  await ref.update({ ...input, updatedAt: FieldValue.serverTimestamp() })
  return { before: snap.data() ?? {} }
}

export async function deleteProduct(id: string): Promise<{ name: string; before: Record<string, unknown> }> {
  const ref = adminDb().doc(`products/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That product no longer exists.')
  const before = snap.data() ?? {}
  await ref.delete()
  // Otherwise the trade price outlives the product it belonged to.
  await adminDb().doc(`productWholesale/${id}`).delete().catch(() => {})
  return { name: String(before.name ?? id), before }
}

// ── Categories ────────────────────────────────────────────────────────────

export async function createProductCategory(name: string): Promise<{ id: string }> {
  const clean = text(name, 'Category name', { required: true, maxLen: 100 })
  const db = adminDb()
  const existing = await db.collection('productCategories').where('name', '==', clean).limit(1).get()
  if (!existing.empty) throw new HttpError(409, `There is already a category called "${clean}".`)
  const ref = await db.collection('productCategories').add({ name: clean, createdAt: FieldValue.serverTimestamp() })
  return { id: ref.id }
}

/**
 * Deletes a category, refusing while products are still filed under it.
 *
 * A product stores its category as a NAME, not an id, so deleting the
 * category left products pointing at a label that no longer exists in the
 * list. They do not error — they drop out of the category filter and stop
 * being findable that way, which is the same silent disappearance as the menu
 * and the order template.
 */
export async function deleteProductCategory(name: string): Promise<{ name: string }> {
  const db = adminDb()
  const clean = text(name, 'Category name', { required: true, maxLen: 100 })

  const used = await db.collection('products').where('category', '==', clean).get()
  if (!used.empty) {
    const names = used.docs.slice(0, 3).map(d => String(d.data().name ?? d.id))
    const more = used.size > 3 ? `, and ${used.size - 3} more` : ''
    throw new HttpError(409,
      `${used.size} product${used.size === 1 ? ' is' : 's are'} still in "${clean}" — ${names.join(', ')}${more}. Move ${used.size === 1 ? 'it' : 'them'} first.`)
  }

  const match = await db.collection('productCategories').where('name', '==', clean).limit(1).get()
  if (match.empty) throw new HttpError(404, 'That category no longer exists.')
  await match.docs[0].ref.delete()
  return { name: clean }
}
