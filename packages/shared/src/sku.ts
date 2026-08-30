'use client'

// Client side of SKU allocation. The counter itself is server-side (see
// app/api/admin/sku/route.ts) — this only asks for the next number.
//
// Formatting is re-exported from skuFormat.ts so callers have one import, the
// same shape invoiceNumber.ts uses for invoice numbers.

import { auth } from './firebase'

export { formatSku, skuLetters, isValidSku, SKU_PATTERN } from './skuFormat'

async function allocate(names: string[]): Promise<string[]> {
  const idToken = await auth.currentUser?.getIdToken()
  const res = await fetch('/api/admin/sku', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ names }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Could not allocate a SKU.')
  if (!Array.isArray(data.skus) || data.skus.length !== names.length) {
    throw new Error('SKU service returned an unexpected response.')
  }
  return data.skus as string[]
}

// One SKU for one new product.
export async function nextSku(name: string): Promise<string> {
  const [sku] = await allocate([name])
  return sku
}

// A consecutive block, for the CSV import. One round trip and one transaction,
// so an import does not interleave its numbers with a product being added by hand.
export async function nextSkuBatch(names: string[]): Promise<string[]> {
  if (names.length === 0) return []
  return allocate(names)
}
