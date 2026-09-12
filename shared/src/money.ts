// Converting and rounding money.
//
// Prices are held in the main currency (USD) and converted for payment in the
// secondary one (LBP) at the rate configured in business settings. This module
// is where that conversion and its rounding rule live, so there is one answer
// to "what does the customer actually pay" rather than one per screen.
//
// No React, no Firebase — the till, the bill and the end-of-day report all
// need the same arithmetic.

/**
 * The bill total rounds to the nearest 100 in the secondary currency.
 *
 * ── Why the TOTAL and not each line ────────────────────────────────────────
 * Rounding every line and rounding once at the end give different answers, and
 * the difference is visible: ten lines each rounded up by 40 LBP is 400 LBP a
 * customer can point at on a receipt whose lines do not add up to its total.
 * So lines stay exact and the rounding happens once, at the bottom, where it
 * is a single visible adjustment rather than a drift nobody can account for.
 *
 * ── Why 100 and not 1,000 ──────────────────────────────────────────────────
 * The smallest note in circulation is 1,000, so a total ending in 300 cannot
 * be settled exactly in cash. That is fine and deliberate: this is the figure
 * on the bill, and cash settlement rounds again at the drawer — a card or a
 * transfer pays the exact figure. Conflating the two would mean a card
 * customer paying a cash-rounded amount.
 */
export const LBP_ROUNDING = 100

/**
 * A price, as a customer should read it: `$8.50`, never `$8.5`.
 *
 * Found by looking at the menu rather than by any test. Every price on the
 * customer site and in the admin was a bare `${item.price}`, so a coffee at
 * 4.5 read `$4.5` and one at 11 read `$11` — sitting in a column beside
 * `$9.25`, which only looked right because it happened to have two decimals.
 * Nothing was wrong with the number; a price is a rendered thing, and half a
 * rendered price is a typo on a menu.
 *
 * It lives here rather than in each page for the same reason the conversion
 * does: one answer to what a figure looks like. The POS carries its own
 * one-line `money()` per screen and is correct; new code should use this.
 */
export function formatUsd(amount: number): string {
  // Not Number.isFinite(amount) ? '—' : … as a silent fallback. A price that
  // cannot be rendered is a data problem, and an em dash where a figure
  // belongs is how a menu quietly stops selling something.
  if (!Number.isFinite(amount)) return '$0.00'
  return `$${amount.toFixed(2)}`
}

/** Exact conversion, no rounding. What a line is worth. */
export function usdToLbp(usd: number, rate: number): number {
  return usd * rate
}

/**
 * A bill total in the secondary currency, rounded to the nearest 100.
 *
 * Half-up on the .5 case, which is what people expect and what every till in
 * the country does. Deliberately not Math.round on the raw figure — that
 * rounds to 1, and the whole point is the hundred.
 */
export function roundLbpTotal(lbp: number): number {
  return Math.round(lbp / LBP_ROUNDING) * LBP_ROUNDING
}

/**
 * A bill: exact in the main currency, rounded in the secondary one.
 *
 * Returns both, plus the adjustment, because a receipt should be able to show
 * the rounding as its own line rather than leaving a customer to work out why
 * the numbers do not tie up.
 */
export interface BillTotals {
  /** Exact, in the main currency. Never rounded to a hundred of anything. */
  usd: number
  /** Exact conversion, before rounding. */
  lbpExact: number
  /** What the customer is asked for. */
  lbp: number
  /** lbp − lbpExact. Negative when rounded down. Zero most of the time. */
  rounding: number
}

/**
 * The VAT inside a total that already includes it.
 *
 * Prices include VAT (owner's decision, 11 Sep 2026), so VAT is never added
 * on top: it is the share of what the customer paid that was tax. At 11%,
 * $10.00 carries $0.99 — 10 × 0.11 / 1.11 — not $1.10.
 */
export function vatIncluded(total: number, vatRate: number): number {
  if (!(vatRate > 0)) return 0
  return Math.round(total * vatRate / (1 + vatRate) * 100) / 100
}

export function billTotals(usd: number, rate: number): BillTotals {
  const lbpExact = usdToLbp(usd, rate)
  const lbp = roundLbpTotal(lbpExact)
  return {
    usd: Math.round(usd * 100) / 100,
    lbpExact,
    lbp,
    rounding: Math.round((lbp - lbpExact) * 100) / 100,
  }
}
