// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// SKU allocation. A SKU is printed on a shelf label and on past invoices, so
// a number issued once is issued forever — the counter only ever moves
// forward, and gaps are expected.
//
// Extracted from app/api/admin/sku/route.ts so /api/admin/products can
// allocate one in the same request that creates the product, rather than the
// browser fetching a SKU and then posting it back. A number the browser holds
// between two calls is a number that can be dropped, reused, or swapped.

import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { formatSku } from '../skuFormat'

/** The CSV import allocates a block; nothing legitimately needs more. */
export const MAX_BATCH = 500

/**
 * Reserves a consecutive block and formats one SKU per name.
 *
 * The whole block is reserved in a single transaction, so an import cannot
 * interleave its numbers with a product somebody adds by hand at the same
 * moment. `names` supplies only the letters in the code — nothing is stored
 * here and the name is not trusted for anything else.
 */
export async function allocateSkus(names: string[]): Promise<string[]> {
  if (names.length === 0) throw new HttpError(400, 'No name supplied.')
  if (names.length > MAX_BATCH) {
    throw new HttpError(400, `Too many SKUs requested at once (max ${MAX_BATCH}).`)
  }

  const db = adminDb()
  const counterRef = db.doc('appSettings/skuCounter')

  let first = 1
  await db.runTransaction(async tx => {
    const snap = await tx.get(counterRef)
    const current = (snap.data()?.nextNumber as number | undefined) ?? 0
    first = current + 1
    tx.set(counterRef, { nextNumber: current + names.length }, { merge: true })
  })

  return names.map((name, i) => formatSku(name, first + i))
}
