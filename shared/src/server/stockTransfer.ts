// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Moving stock between branches.
//
// This ran in the browser as a Firestore transaction. The transaction itself
// was correct — all reads before all writes, every quantity checked before
// anything moved — but the browser chose the branches, and nothing checked
// they existed.
//
// A transfer to a branch name that is not configured succeeds: Firestore
// happily writes stock.Whatever = 5. The stock leaves the source branch, lands
// under a key nothing renders, and shows up later as unexplained shrinkage
// with a matching surplus nobody can find. That is the same class of bug as
// the supplies page reading quantity['Beirut'] and reporting an empty
// warehouse.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { BRANCHES, normalizeStock } from '../branches'

const MAX_QTY = 100_000

export interface TransferLine {
  productId: string
  productName: string
  quantity: number
}

export interface TransferInput {
  fromBranch: string
  toBranch: string
  items: TransferLine[]
}

export function parseTransferInput(body: Record<string, unknown>): TransferInput {
  const fromBranch = String(body.fromBranch ?? '').trim()
  const toBranch = String(body.toBranch ?? '').trim()

  for (const [value, label] of [[fromBranch, 'Source'], [toBranch, 'Destination']] as const) {
    if (!(BRANCHES as readonly string[]).includes(value)) {
      throw new HttpError(400, `${label} branch is not one of this system's branches: ${value || '(none)'}`)
    }
  }
  // Not merely pointless: the two updates would both target the same map key,
  // and the second would overwrite the first — so the "transfer" would silently
  // add or lose stock depending on ordering.
  if (fromBranch === toBranch) {
    throw new HttpError(400, 'Pick two different branches.')
  }

  const raw = Array.isArray(body.items) ? body.items : []
  if (raw.length === 0) throw new HttpError(400, 'Nothing to transfer.')

  const seen = new Set<string>()
  const items = raw.map((row, i) => {
    const r = (row ?? {}) as Record<string, unknown>
    const productId = String(r.productId ?? '').trim()
    if (!productId) throw new HttpError(400, `Line ${i + 1} is missing its product.`)

    // The same product twice would be read once and written twice inside the
    // transaction, so only the last line's quantity would take effect while
    // the stock check passed on each individually.
    if (seen.has(productId)) throw new HttpError(400, `Line ${i + 1} repeats a product. Combine the lines.`)
    seen.add(productId)

    const quantity = Number(r.quantity)
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QTY) {
      throw new HttpError(400, `Line ${i + 1}: quantity must be a whole number between 1 and ${MAX_QTY.toLocaleString()}.`)
    }
    return { productId, productName: String(r.productName ?? '').trim().slice(0, 200), quantity }
  })

  return { fromBranch, toBranch, items }
}

/**
 * Moves every line, or none of them.
 *
 * Quantities come from the request but the STOCK does not — each product's
 * on-hand figure is read inside the transaction and checked there, so a
 * browser cannot talk the server into moving more than exists by sending a
 * stale count.
 */
export async function transferStock(
  input: TransferInput,
  requestId: string | null = null,
): Promise<{ moved: number; names: string[]; duplicate?: boolean }> {
  const db = adminDb()
  const refs = input.items.map(i => db.doc(`products/${i.productId}`))
  // A transfer creates no document of its own — it rewrites stock — so there
  // was nothing a retry could recognise, and a lost reply followed by a second
  // press moved the stock twice. The marker is that document: written in the
  // same transaction as the move, keyed by the request, and read first.
  //
  // stockTransfers has no rule on purpose. Only this server code touches it,
  // and Firestore denies a client anything unmatched.
  const markerRef = requestId ? db.doc(`stockTransfers/${requestId}`) : null

  const outcome = await db.runTransaction(async tx => {
    if (markerRef) {
      const marker = await tx.get(markerRef)
      if (marker.exists) {
        const names = marker.data()?.names
        return { names: Array.isArray(names) ? names.map(String) : [], duplicate: true }
      }
    }
    const snaps = await tx.getAll(...refs)
    const resolved: string[] = []

    // Every read and every check before any write — a Firestore transaction
    // forbids the reverse, and a partial transfer is worse than none.
    snaps.forEach((snap, i) => {
      const line = input.items[i]
      if (!snap.exists) throw new HttpError(404, `${line.productName || line.productId} no longer exists.`)
      const stock = normalizeStock(snap.data()?.stock)
      const available = stock[input.fromBranch] ?? 0
      if (available < line.quantity) {
        throw new HttpError(409,
          `${line.productName || line.productId}: only ${available} at ${input.fromBranch}, tried to move ${line.quantity}.`)
      }
      resolved.push(String(snap.data()?.name ?? line.productName ?? line.productId))
    })

    snaps.forEach((snap, i) => {
      const line = input.items[i]
      const stock = normalizeStock(snap.data()?.stock)
      stock[input.fromBranch] = (stock[input.fromBranch] ?? 0) - line.quantity
      stock[input.toBranch] = (stock[input.toBranch] ?? 0) + line.quantity
      tx.update(refs[i], { stock, updatedAt: FieldValue.serverTimestamp() })
    })

    if (markerRef) {
      tx.set(markerRef, {
        fromBranch: input.fromBranch,
        toBranch: input.toBranch,
        items: input.items,
        names: resolved,
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    return { names: resolved, duplicate: false }
  })

  return {
    moved: input.items.reduce((n, i) => n + i.quantity, 0),
    names: outcome.names,
    ...(outcome.duplicate ? { duplicate: true } : {}),
  }
}
