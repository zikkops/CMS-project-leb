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
