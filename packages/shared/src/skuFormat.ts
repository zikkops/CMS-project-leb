// Pure SKU formatting. Deliberately NOT 'use client' and with no Firebase
// import, so the browser, route handlers and scripts/ all share one definition
// — same reasoning as invoiceFormat.ts, which pairs with invoiceNumber.ts.
//
// Format: ob-SKU0001
//   ob-     fixed prefix
//   SKU     first three letters of the product name, uppercased
//   0001    sequence, four digits, ONE global series across every product
//
// The sequence is global rather than per-prefix: a single counter can be
// incremented atomically, so two products added at the same moment cannot collide.
// Per-prefix counters would need one counter document per prefix and a
// collision window on each.
//
// A SKU is issued once and then never recomputed. Renaming a product does NOT
// change its SKU — the letters are a mnemonic, not a key, and a printed label
// or a past invoice has to keep meaning the same thing.

// Names are messy: "UNO No mercy", "2 players", "Shot in the Dark: …".
// Take letters only, so digits and punctuation can't land in a SKU, and pad
// short names so every SKU is the same width.
export function skuLetters(name: string): string {
  const letters = (name ?? '').replace(/[^a-zA-Z]/g, '').toUpperCase()
  if (letters.length === 0) return 'XXX'
  return letters.slice(0, 3).padEnd(3, 'X')
}

export function formatSku(name: string, sequence: number): string {
  return `ob-${skuLetters(name)}${String(sequence).padStart(4, '0')}`
}

// Used by the route to validate anything that arrives from a browser, and by
// the backfill to recognise a product that already has one.
export const SKU_PATTERN = /^ob-[A-Z]{3}\d{4,}$/

export function isValidSku(value: unknown): value is string {
  return typeof value === 'string' && SKU_PATTERN.test(value)
}

// The sequence back out of a SKU, for the backfill's "where did we get to"
// check. Returns 0 for anything unparseable rather than throwing — a stray
// hand-typed value should not stop a backfill.
export function sequenceOfSku(sku: unknown): number {
  if (!isValidSku(sku)) return 0
  return parseInt(sku.slice(6), 10) || 0
}
