// Business settings — the values that change while the business runs.
//
// VAT, the exchange rate and the tips deduction were configuration, but ENV
// configuration: changing one meant editing a Vercel variable and waiting for
// a redeploy. That is the wrong shape for numbers a government or a central
// bank changes with a week's notice, and it is the gap that makes this a
// codebase rather than a product.
//
// ── Why this is safe, which is not obvious ─────────────────────────────────
// Making a rate editable usually means every historical document silently
// re-values the moment someone changes it. That is not the case here, and it
// is worth knowing why before touching any of this:
//
//   - a delivery stores its own `vatRate` (app/lib/server/deliveries.ts)
//   - an end-of-day report stores its own `exchangeRate` (server/endOfDay.ts)
//
// Both capture the rate that was actually applied, at the moment it was
// applied. So the value here only ever SEEDS a new record. Changing it cannot
// reach backwards. Keep it that way: the day something reads the live rate to
// display an old document is the day history starts moving.
//
// No 'use client' and no Firebase import here on purpose: app/lib/server/**
// and the route handler both import this, and pulling app/lib/firebase.ts in
// would put the client SDK in the server bundle. The listener lives in
// app/lib/useBusinessSettings.ts.
//
// ── Fail-safe, not fail-open ───────────────────────────────────────────────
// A missing or unreadable settings document falls back to the brand config,
// which is the same value the app used before this existed. It never falls
// back to zero — a VAT rate of 0 because Firestore hiccuped would under-charge
// silently, and nothing downstream would flag it.

import { BRAND } from './brand'
import { FALLBACK_INVOICE_PREFIX, INVOICE_PREFIX_PATTERN } from './invoiceFormat'

export const SETTINGS_DOC = 'appSettings/business'

export interface BusinessSettings {
  /** As a fraction: 0.11 is 11%. */
  vatRate: number
  /** Units of the secondary currency per 1 of the main one. */
  exchangeRate: number
  /** Fraction deducted from tips before distribution. */
  tipsDeductionRate: number
  /**
   * Staff meal discounts, as the fraction taken OFF.
   *
   * 0.7 means seventy percent off — staff pay thirty. Stored as "off" rather
   * than "pays" because that is how the rule is spoken ("staff get 70% off"),
   * and a field whose name disagrees with how people say it out loud is a
   * field somebody eventually inverts. The settings page shows both figures
   * side by side so the reading cannot be in doubt.
   *
   * Split by what is being bought, not by who is buying: food and drink carry
   * different margins, which is the whole reason a café sets two rates.
   */
  staffDiscountFood: number
  staffDiscountDrink: number
  /**
   * The letters an invoice number starts with, e.g. the AC of
   * AC-Q3-082026-0001.
   *
   * The odd one out here, and worth understanding before touching it. The
   * three rates above only ever SEED a new record, so changing one cannot
   * reach backwards. This does not seed anything — it is part of the identity
   * of a numbered series. Change it in July and invoice 0047 reads
   * AC-Q3-082026-0047 while 0048 reads XY-Q3-082026-0048: one sequence
   * wearing two names, which is exactly the thing an invoice number exists to
   * prevent.
   *
   * So it is chosen during setup and locked as soon as a number has been
   * issued. The lock lives in app/lib/server/settings.ts, where the counter
   * can actually be read.
   */
  invoicePrefix: string
}

/** The numeric settings, which share bounds checking and a form control. */
export type RateKey =
  | 'vatRate' | 'exchangeRate' | 'tipsDeductionRate'
  | 'staffDiscountFood' | 'staffDiscountDrink'

/** What the app used before any of this was editable. */
export const SETTINGS_DEFAULTS: BusinessSettings = {
  vatRate:           BRAND.locale.vatRate,
  exchangeRate:      BRAND.locale.exchangeRate,
  tipsDeductionRate: BRAND.tipsDeductionRate,
  invoicePrefix:     FALLBACK_INVOICE_PREFIX,
  // No staff discount until somebody sets one. A default that quietly took
  // money off every staff check would be a rate nobody chose.
  staffDiscountFood:  0,
  staffDiscountDrink: 0,
}

// Bounds, shared with the route so the form and the server agree on what is
// acceptable. Deliberately generous at the top end — Hungary charges 27% VAT,
// and a currency in trouble can carry a lot of zeros — and deliberately not
// zero-excluding, because a zero-rated jurisdiction is a real thing.
export const SETTINGS_LIMITS: Record<RateKey, { min: number; max: number }> = {
  vatRate:           { min: 0, max: 0.5 },
  exchangeRate:      { min: 1, max: 100_000_000 },
  tipsDeductionRate: { min: 0, max: 0.5 },
  // Up to 100% — a free staff meal is a real policy. Not above it: a discount
  // over the price would have the café paying its staff to eat.
  staffDiscountFood:  { min: 0, max: 1 },
  staffDiscountDrink: { min: 0, max: 1 },
}

/**
 * Reads one stored value, falling back to the brand default.
 *
 * Anything non-numeric, negative, or outside the accepted range is treated as
 * absent. A settings document edited by hand into nonsense should degrade to
 * the previous behaviour, not propagate the nonsense into an invoice.
 */
function readRate(raw: unknown, key: RateKey): number {
  const n = Number(raw)
  const { min, max } = SETTINGS_LIMITS[key]
  if (!Number.isFinite(n) || n < min || n > max) return SETTINGS_DEFAULTS[key]
  return n
}

/**
 * Reads the stored prefix, falling back rather than trusting.
 *
 * Same rule as the rates: a document edited by hand into something unusable
 * degrades to the default instead of propagating. Lower case is accepted and
 * upper-cased — that is a typo, not a different prefix, and rejecting it would
 * mean an invoice number that silently reads INV while the settings page shows
 * something else.
 */
export function readInvoicePrefix(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase()
  return INVOICE_PREFIX_PATTERN.test(s) ? s : SETTINGS_DEFAULTS.invoicePrefix
}

export function parseSettings(data: Record<string, unknown> | undefined): BusinessSettings {
  return {
    vatRate:           readRate(data?.vatRate, 'vatRate'),
    exchangeRate:      readRate(data?.exchangeRate, 'exchangeRate'),
    tipsDeductionRate: readRate(data?.tipsDeductionRate, 'tipsDeductionRate'),
    staffDiscountFood:  readRate(data?.staffDiscountFood, 'staffDiscountFood'),
    staffDiscountDrink: readRate(data?.staffDiscountDrink, 'staffDiscountDrink'),
    invoicePrefix:     readInvoicePrefix(data?.invoicePrefix),
  }
}
