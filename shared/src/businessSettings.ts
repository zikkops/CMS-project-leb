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
//   - a delivery stores its own `vatRate` (shared/src/server/deliveries.ts)
//   - an end-of-day report stores its own `exchangeRate` (server/endOfDay.ts)
//
// Both capture the rate that was actually applied, at the moment it was
// applied. So the value here only ever SEEDS a new record. Changing it cannot
// reach backwards. Keep it that way: the day something reads the live rate to
// display an old document is the day history starts moving.
//
// No 'use client' and no Firebase import here on purpose: shared/src/server/**
// and the route handler both import this, and pulling shared/src/firebase.ts in
// would put the client SDK in the server bundle. The listener lives in
// shared/src/useBusinessSettings.ts.
//
// ── Fail-safe, not fail-open ───────────────────────────────────────────────
// A missing or unreadable settings document falls back to the brand config,
// which is the same value the app used before this existed. It never falls
// back to zero — a VAT rate of 0 because Firestore hiccuped would under-charge
// silently, and nothing downstream would flag it.

import { BRAND } from './brand'
import { FALLBACK_INVOICE_PREFIX, INVOICE_PREFIX_PATTERN } from './invoiceFormat'

export const SETTINGS_DOC = 'appSettings/business'

/**
 * A VAT rate that takes effect on a day, not the moment somebody saves it.
 *
 * Rates change by decree with a start date — Lebanon approved 12% in early
 * 2026 without it being in force by mid-year. Entering it the night before and
 * hoping is how a day's receipts go out at the wrong rate either side of
 * midnight. `from` is a calendar day in the café's timezone, compared as a
 * 'YYYY-MM-DD' string like every other day in this codebase (dates.ts).
 */
export interface VatChange {
  rate: number
  from: string
}

export interface BusinessSettings {
  /** As a fraction: 0.11 is 11%. The rate in force until `vatNext` starts. */
  vatRate: number
  /** The next rate and the day it starts, or null. Read through vatRateOn(), never directly. */
  vatNext: VatChange | null
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
   * The margin a dish should make on its price before VAT, as a fraction —
   * 0.7 is 70%, a food cost of 30%. Used only to SUGGEST a price from the
   * recipe cost; nothing is ever charged from it.
   *
   * Split the same way as the staff discount, by station: drinks carry a
   * higher margin than food almost everywhere, which is why one global
   * figure would suggest overpriced plates or underpriced coffee.
   */
  targetMarginFood: number
  targetMarginDrink: number
  /**
   * The service charge put on each new check, as a fraction (UPGRADE.md T3.8),
   * and only while the serviceCharge switch is on. Copied onto a check when it
   * opens, so changing it re-prices nothing already open. 0: none.
   */
  serviceChargeRate: number
  /**
   * What one loyalty point is worth in dollars, for valuing the points
   * liability (UPGRADE.md T7.14). 0 is not set: the report then shows points
   * only, never a guessed value.
   */
  pointValueUsd: number
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
   * issued. The lock lives in shared/src/server/settings.ts, where the counter
   * can actually be read.
   */
  invoicePrefix: string
}

/** The numeric settings, which share bounds checking and a form control. */
export type RateKey =
  | 'vatRate' | 'exchangeRate' | 'tipsDeductionRate'
  | 'staffDiscountFood' | 'staffDiscountDrink'
  | 'targetMarginFood' | 'targetMarginDrink' | 'serviceChargeRate' | 'pointValueUsd'

/** What the app used before any of this was editable. */
export const SETTINGS_DEFAULTS: BusinessSettings = {
  vatRate:           BRAND.locale.vatRate,
  vatNext:           null,
  exchangeRate:      BRAND.locale.exchangeRate,
  tipsDeductionRate: BRAND.tipsDeductionRate,
  invoicePrefix:     FALLBACK_INVOICE_PREFIX,
  // No staff discount until somebody sets one. A default that quietly took
  // money off every staff check would be a rate nobody chose.
  staffDiscountFood:  0,
  staffDiscountDrink: 0,
  // Common rules of thumb, not law: restaurants aim for a food cost around
  // 28–35% of the price and 15–25% on non-alcoholic drinks and coffee. Only a
  // suggestion is ever made from these, so a sensible default does no harm;
  // every café should set its own.
  targetMarginFood:  0.7,
  targetMarginDrink: 0.8,
  // None until the owner sets one: a charge nobody chose must never appear on a bill.
  serviceChargeRate: 0,
  // Not set until the owner says what a point is worth.
  pointValueUsd: 0,
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
  // Short of 100%: no price makes a 100% margin on something that costs money.
  targetMarginFood:  { min: 0, max: 0.95 },
  targetMarginDrink: { min: 0, max: 0.95 },
  // serviceRate() in checks.ts ignores anything above 30% as well.
  serviceChargeRate: { min: 0, max: 0.3 },
  // A point worth more than a dollar is a typo for a percentage, not a scheme.
  pointValueUsd:     { min: 0, max: 1 },
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

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Reads a stored next-rate, or null.
 *
 * Same fail-safe as readRate(): anything unusable is treated as absent, so a
 * hand-edited document degrades to "no change scheduled" rather than billing
 * at a nonsense rate. The day must be a real one — 2027-02-30 matches the
 * pattern and is not a date.
 */
export function readVatNext(raw: unknown): VatChange | null {
  if (!raw || typeof raw !== 'object') return null
  const { rate, from } = raw as { rate?: unknown; from?: unknown }
  const n = Number(rate)
  const { min, max } = SETTINGS_LIMITS.vatRate
  if (rate === null || rate === '' || !Number.isFinite(n) || n < min || n > max) return null
  const day = String(from ?? '')
  const m = YMD.exec(day)
  if (!m) return null
  // UTC here only to ask whether the day exists — no timezone decides anything.
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null
  return { rate: n, from: day }
}

/**
 * The VAT rate in force on a day.
 *
 * The one place that answers it. A check closing, a delivery being received
 * and the settings page all ask this rather than reading vatRate, so on the
 * start day every one of them changes at the café's midnight together — not
 * whenever somebody remembers to edit a number.
 */
export function vatRateOn(s: Pick<BusinessSettings, 'vatRate' | 'vatNext'>, ymd: string): number {
  return s.vatNext && ymd >= s.vatNext.from ? s.vatNext.rate : s.vatRate
}

export function parseSettings(data: Record<string, unknown> | undefined): BusinessSettings {
  return {
    vatRate:           readRate(data?.vatRate, 'vatRate'),
    vatNext:           readVatNext(data?.vatNext),
    exchangeRate:      readRate(data?.exchangeRate, 'exchangeRate'),
    tipsDeductionRate: readRate(data?.tipsDeductionRate, 'tipsDeductionRate'),
    staffDiscountFood:  readRate(data?.staffDiscountFood, 'staffDiscountFood'),
    staffDiscountDrink: readRate(data?.staffDiscountDrink, 'staffDiscountDrink'),
    targetMarginFood:  readRate(data?.targetMarginFood, 'targetMarginFood'),
    targetMarginDrink: readRate(data?.targetMarginDrink, 'targetMarginDrink'),
    serviceChargeRate: readRate(data?.serviceChargeRate, 'serviceChargeRate'),
    pointValueUsd:     readRate(data?.pointValueUsd, 'pointValueUsd'),
    invoicePrefix:     readInvoicePrefix(data?.invoicePrefix),
  }
}
