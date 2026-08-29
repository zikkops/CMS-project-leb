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

export const SETTINGS_DOC = 'appSettings/business'

export interface BusinessSettings {
  /** As a fraction: 0.11 is 11%. */
  vatRate: number
  /** Units of the secondary currency per 1 of the main one. */
  exchangeRate: number
  /** Fraction deducted from tips before distribution. */
  tipsDeductionRate: number
}

/** What the app used before any of this was editable. */
export const SETTINGS_DEFAULTS: BusinessSettings = {
  vatRate:           BRAND.locale.vatRate,
  exchangeRate:      BRAND.locale.exchangeRate,
  tipsDeductionRate: BRAND.tipsDeductionRate,
}

// Bounds, shared with the route so the form and the server agree on what is
// acceptable. Deliberately generous at the top end — Hungary charges 27% VAT,
// and a currency in trouble can carry a lot of zeros — and deliberately not
// zero-excluding, because a zero-rated jurisdiction is a real thing.
export const SETTINGS_LIMITS = {
  vatRate:           { min: 0, max: 0.5 },
  exchangeRate:      { min: 1, max: 100_000_000 },
  tipsDeductionRate: { min: 0, max: 0.5 },
} as const

/**
 * Reads one stored value, falling back to the brand default.
 *
 * Anything non-numeric, negative, or outside the accepted range is treated as
 * absent. A settings document edited by hand into nonsense should degrade to
 * the previous behaviour, not propagate the nonsense into an invoice.
 */
function readRate(raw: unknown, key: keyof BusinessSettings): number {
  const n = Number(raw)
  const { min, max } = SETTINGS_LIMITS[key]
  if (!Number.isFinite(n) || n < min || n > max) return SETTINGS_DEFAULTS[key]
  return n
}

export function parseSettings(data: Record<string, unknown> | undefined): BusinessSettings {
  return {
    vatRate:           readRate(data?.vatRate, 'vatRate'),
    exchangeRate:      readRate(data?.exchangeRate, 'exchangeRate'),
    tipsDeductionRate: readRate(data?.tipsDeductionRate, 'tipsDeductionRate'),
  }
}
