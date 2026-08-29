// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Bulk product import, from a mapped CSV.
//
// The browser used to write each row itself, one document at a time. That
// stopped working the moment the products collection went server-only, and it
// was the last place a product could be written from a browser at all — so
// this is not a port of that loop, it is the same job done where the rules
// can be trusted.
//
// The browser still parses the file, maps the columns and decides what each
// row means. That is presentation work and it belongs there. What moves here
// is every write, plus the validation the loop never had.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { BRANCHES } from '../branches'
import { allocateSkus } from './sku'
import { setWholesalePrice } from './products'

const MAX_ROWS = 2_000
const MAX_PRICE = 100_000

export interface ImportRow {
  /** Present when the CSV carried one; matched before name. */
  sku?: string
  name: string
  category: string
  description: string
  players: string
  duration: string
  age: string
  price: number
  wholesalePrice: number | null
  /** Only the branches the CSV actually mapped — see applyStock below. */
  stock: Record<string, number> | null
  image: string
}

export interface ImportResult {
  created: number
  updated: number
  unchanged: number
  skippedNoName: number
  skippedUnknownSku: number
  categoriesCreated: string[]
}

function str(raw: unknown, maxLen = 200): string {
  return String(raw ?? '').trim().slice(0, maxLen)
}

function price(raw: unknown, label: string, row: number): number {
  const n = Number(raw ?? 0)
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) {
    throw new HttpError(400, `Row ${row}: ${label} must be a number between 0 and ${MAX_PRICE.toLocaleString()}.`)
  }
  return Math.round(n * 100) / 100
}

export function parseImportRows(body: Record<string, unknown>): ImportRow[] {
  const raw = Array.isArray(body.rows) ? body.rows : []
  if (raw.length === 0) throw new HttpError(400, 'Nothing to import.')
  if (raw.length > MAX_ROWS) {
    throw new HttpError(400, `Too many rows at once (max ${MAX_ROWS.toLocaleString()}). Split the file.`)
  }

  return raw.map((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>
    const n = i + 1

    // Null means "the CSV had no stock column mapped", which is different
    // from "every branch is zero" — one leaves stock alone, the other sets
    // it to nothing. Conflating them would let a description-only import
    // wipe the shelves.
    let stock: Record<string, number> | null = null
    if (row.stock && typeof row.stock === 'object') {
      stock = {}
      for (const [branch, value] of Object.entries(row.stock as Record<string, unknown>)) {
        if (!(BRANCHES as readonly string[]).includes(branch)) {
          throw new HttpError(400, `Row ${n}: unknown branch "${branch}".`)
        }
        const q = Number(value)
        if (!Number.isInteger(q) || q < 0 || q > 1_000_000) {
          throw new HttpError(400, `Row ${n}: stock for ${branch} must be a whole number of at least 0.`)
        }
        stock[branch] = q
      }
    }

    const wholesaleRaw = row.wholesalePrice
    return {
      sku: row.sku ? str(row.sku, 40) : undefined,
      name: str(row.name),
      category: str(row.category, 100),
      description: str(row.description, 4000),
      players: str(row.players, 50),
      duration: str(row.duration, 50),
      age: str(row.age, 20),
      price: price(row.price, 'price', n),
      wholesalePrice: wholesaleRaw === null || wholesaleRaw === undefined || wholesaleRaw === ''
        ? null
        : price(wholesaleRaw, 'wholesale price', n),
      stock,
      image: str(row.image, 2000),
    }
  })
}

/**
 * Applies the rows, creating what is new and patching what already exists.
 *
 * Matched on SKU first and name second, because a SKU is the thing that is
 * meant to be stable — a product can be renamed, and an import that matched
 * only on name would create a duplicate of it.
 *
 * A row whose SKU is not recognised is SKIPPED rather than created. A SKU in
 * the file that the system has never issued means the file and the system
 * disagree about what exists, and inventing a product from it would bury that
 * rather than surface it.
 */
export async function runImport(rows: ImportRow[]): Promise<ImportResult> {
  const db = adminDb()

  const [productSnap, categorySnap] = await Promise.all([
    db.collection('products').get(),
    db.collection('productCategories').get(),
  ])

  const byId = new Map(productSnap.docs.map(d => [d.id, d.data()]))
  const bySku = new Map<string, string>()
  const byName = new Map<string, string>()
  productSnap.docs.forEach(d => {
    const data = d.data()
    if (typeof data.sku === 'string' && data.sku) bySku.set(data.sku.toLowerCase(), d.id)
    if (typeof data.name === 'string' && data.name) byName.set(data.name.toLowerCase(), d.id)
  })

  const categories = new Set(categorySnap.docs.map(d => String(d.data().name ?? '')))
  const categoriesCreated: string[] = []

  const result: ImportResult = {
    created: 0, updated: 0, unchanged: 0,
    skippedNoName: 0, skippedUnknownSku: 0, categoriesCreated,
  }

  // Work out the creates first so their SKUs come from one allocation. A
  // number per row would interleave with anything else being added while the
  // import runs.
  const creates: ImportRow[] = []
  const updates: { id: string; row: ImportRow }[] = []

  for (const row of rows) {
    if (!row.name && !row.sku) { result.skippedNoName++; continue }

    if (row.sku) {
      const id = bySku.get(row.sku.toLowerCase())
      if (!id) { result.skippedUnknownSku++; continue }
      updates.push({ id, row })
      continue
    }
    if (!row.name) { result.skippedNoName++; continue }

    const id = byName.get(row.name.toLowerCase())
    if (id) updates.push({ id, row })
    else creates.push(row)
  }

  for (const row of [...creates, ...updates.map(u => u.row)]) {
    if (row.category && !categories.has(row.category)) {
      await db.collection('productCategories').add({
        name: row.category, createdAt: FieldValue.serverTimestamp(),
      })
      categories.add(row.category)
      categoriesCreated.push(row.category)
    }
  }

  const skus = creates.length > 0 ? await allocateSkus(creates.map(r => r.name)) : []

  for (let i = 0; i < creates.length; i++) {
    const row = creates[i]
    const ref = await db.collection('products').add({
      name: row.name, category: row.category, description: row.description,
      players: row.players, duration: row.duration, age: row.age,
      price: row.price, salePrice: null, saleEndsAt: null, image: row.image,
      stock: row.stock ?? {},
      sku: skus[i],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    // Never onto the product document — it is world-readable.
    await setWholesalePrice(ref.id, row.wholesalePrice)
    result.created++
  }

  for (const { id, row } of updates) {
    const existing = byId.get(id) ?? {}
    const patch: Record<string, unknown> = {}

    for (const key of ['name', 'category', 'description', 'players', 'duration', 'age', 'image'] as const) {
      if (row[key] && row[key] !== existing[key]) patch[key] = row[key]
    }
    if (row.price !== existing.price) patch.price = row.price

    // Merged, not replaced: a file mapping only one branch's column must not
    // zero the others.
    if (row.stock) {
      patch.stock = { ...(existing.stock ?? {}), ...row.stock }
    }

    if (Object.keys(patch).length === 0 && row.wholesalePrice == null) {
      result.unchanged++
      continue
    }
    if (Object.keys(patch).length > 0) {
      await db.doc(`products/${id}`).update({ ...patch, updatedAt: FieldValue.serverTimestamp() })
    }
    if (row.wholesalePrice != null) await setWholesalePrice(id, row.wholesalePrice)
    result.updated++
  }

  return result
}
