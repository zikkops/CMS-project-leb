// What a product actually costs right now.
//
// A product has a list price and, optionally, a sale price with an end date.
// Three places need to agree on which of those applies: the storefront that
// shows it, the admin list that reviews it, and the till that charges it. If
// they disagree, a customer is quoted one number and charged another — so the
// rule lives here once and all three read it.
//
// No React, no Firebase: shared/src/server/** imports this too.

export interface Priced {
  price: number
  /** Absent or null means not on offer. */
  salePrice?: number | null
  /** 'YYYY-MM-DD', inclusive. Absent means the sale has no end. */
  saleEndsAt?: string | null
}

/** Today in local time as YYYY-MM-DD — the same shape the date input produces. */
export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Whether a sale is running today.
 *
 * The end date is INCLUSIVE: "Sale ends 30 September" reads to everyone as
 * still on sale on the 30th, and a customer who arrives that afternoon
 * expecting the price on the shelf is right to.
 *
 * A sale price that is not below the list price is not a sale, and is ignored
 * rather than shown — otherwise a typo produces a "SAVE -12%" badge.
 */
export function saleIsActive(p: Priced, today: string = todayKey()): boolean {
  if (p.salePrice == null) return false
  if (!(p.salePrice < p.price)) return false
  if (!p.saleEndsAt) return true
  return today <= p.saleEndsAt
}

/** The price to charge and to display, sale applied when one is running. */
export function effectivePrice(p: Priced, today: string = todayKey()): number {
  return saleIsActive(p, today) ? (p.salePrice as number) : p.price
}

/**
 * How much off, as a whole percent, or null when nothing is off.
 *
 * Rounded for display only — the money comes from effectivePrice(), never
 * from re-applying this percentage, which would reintroduce the rounding.
 */
export function discountPercent(p: Priced, today: string = todayKey()): number | null {
  if (!saleIsActive(p, today) || p.price <= 0) return null
  return Math.round((1 - (p.salePrice as number) / p.price) * 100)
}
