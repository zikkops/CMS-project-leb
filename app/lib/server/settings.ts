// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Business settings: the VAT rate, the exchange rate, the tips deduction, and
// the invoice prefix.
//
// These are written here rather than from the browser for the Phase 00 reason
// — a value that decides what a customer is charged is not a value a browser
// gets to set. The rules deny writes to this document entirely; this is the
// only path in.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import {
  SETTINGS_DOC, SETTINGS_LIMITS, SETTINGS_DEFAULTS, readInvoicePrefix,
  type BusinessSettings, type RateKey,
} from '../businessSettings'
import { INVOICE_PREFIX_PATTERN } from '../invoiceFormat'

// businessSettings.ts is deliberately free of React and Firebase so both
// sides can share the bounds. The listener lives in useBusinessSettings.ts,
// which must never be imported from here.

function rate(raw: unknown, key: RateKey, label: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number.`)
  const { min, max } = SETTINGS_LIMITS[key]
  if (n < min || n > max) {
    throw new HttpError(400, `${label} must be between ${min} and ${max}.`)
  }
  return n
}

export function parseSettingsInput(body: Record<string, unknown>): BusinessSettings {
  const rawPrefix = String(body.invoicePrefix ?? '').trim().toUpperCase()
  if (!rawPrefix) throw new HttpError(400, 'An invoice prefix is required.')
  if (!INVOICE_PREFIX_PATTERN.test(rawPrefix)) {
    throw new HttpError(400,
      'The invoice prefix must be 2 to 6 letters or digits, with no spaces, hyphens or punctuation.')
  }

  return {
    // Percentages arrive as fractions, the same way they are stored and the
    // same way computeTotals() consumes them. The form does the ÷100, so a
    // stray "11" here would be a 1100% VAT rate — which the bounds reject
    // rather than quietly bill.
    vatRate:           rate(body.vatRate, 'vatRate', 'VAT rate'),
    exchangeRate:      rate(body.exchangeRate, 'exchangeRate', 'Exchange rate'),
    tipsDeductionRate: rate(body.tipsDeductionRate, 'tipsDeductionRate', 'Tips deduction'),
    invoicePrefix:     rawPrefix,
  }
}

export async function readSettings(): Promise<BusinessSettings> {
  const snap = await adminDb().doc(SETTINGS_DOC).get()
  if (!snap.exists) return SETTINGS_DEFAULTS
  const d = snap.data() ?? {}
  return {
    vatRate:           Number(d.vatRate ?? SETTINGS_DEFAULTS.vatRate),
    exchangeRate:      Number(d.exchangeRate ?? SETTINGS_DEFAULTS.exchangeRate),
    tipsDeductionRate: Number(d.tipsDeductionRate ?? SETTINGS_DEFAULTS.tipsDeductionRate),
    invoicePrefix:     readInvoicePrefix(d.invoicePrefix),
  }
}

/**
 * Just the prefix, for the two places that mint a number.
 *
 * Its own function rather than readSettings() at the call site so that
 * issuing a number does not depend on the rest of the settings document
 * parsing cleanly. A broken exchange rate should not stop an invoice.
 */
export async function readInvoicePrefixSetting(): Promise<string> {
  try {
    const snap = await adminDb().doc(SETTINGS_DOC).get()
    return readInvoicePrefix(snap.data()?.invoicePrefix)
  } catch {
    return SETTINGS_DEFAULTS.invoicePrefix
  }
}

/**
 * Whether any invoice actually carries a number yet.
 *
 * Deliberately NOT the counter. appSettings/invoiceCounter moves every time a
 * number is minted, including the ones that get burnt when a later step fails
 * — and setting a business up means exercising the sale and wholesale flows,
 * which burns several before anything real exists. Reading the counter would
 * lock the prefix during setup, on the strength of invoices nobody ever
 * issued. On this project it stood at 5 with no document carrying a number.
 *
 * The honest question is whether an invoice exists, so this asks the documents.
 * orderBy() skips documents missing the field entirely, so each of these is one
 * cheap read against an automatic single-field index rather than a scan.
 *
 * A burnt number does leave a gap at the start of the series. Gaps are normal
 * in accounting and far preferable to renumbering, so the counter is left
 * alone rather than reset when the prefix is chosen.
 */
export async function invoicesIssued(): Promise<boolean> {
  for (const collection of ['wholesaleOrders', 'productPurchaseOrders']) {
    const snap = await adminDb().collection(collection)
      .orderBy('invoiceNumber').limit(1).get()
    if (!snap.empty) return true
  }
  return false
}

export interface SettingChange {
  field: string
  before: number | string
  after: number | string
}

/**
 * Writes the settings and returns what changed.
 *
 * The diff is returned rather than logged here so the route can put it in the
 * activity log as before/after pairs. "Someone changed the VAT rate" is not a
 * useful audit entry; "VAT 11% -> 12%, by name, at time" is the entry an
 * accountant actually needs when an invoice looks wrong.
 *
 * ── The invoice prefix is not like the others ──────────────────────────────
 * The three rates only ever seed a NEW record — a delivery stores the VAT it
 * was charged, an end-of-day report stores the rate it used — so changing one
 * cannot reach backwards.
 *
 * The prefix is part of the identity of a numbered series. Changing it after
 * numbers have gone out leaves one sequence wearing two names: 0047 issued as
 * AC-Q3-082026-0047 and 0048 as XY-Q3-082026-0048, with nothing on either
 * saying they belong together. That is precisely what an invoice number exists
 * to prevent, and no amount of care at the call site fixes it afterwards.
 *
 * So it is refused once the counter has moved. Setup is the moment to choose
 * it; after that the honest answer is that it cannot be changed, not that it
 * can be changed and the consequences are the user's problem.
 */
export async function writeSettings(
  input: BusinessSettings,
  actor: { uid: string; email: string },
): Promise<{ changes: SettingChange[] }> {
  const before = await readSettings()

  if (input.invoicePrefix !== before.invoicePrefix && await invoicesIssued()) {
    throw new HttpError(409,
      `Invoice numbers have already been issued as ${before.invoicePrefix}-…, so the prefix can no longer ` +
      'be changed. Changing it now would leave one numbered series with two different names on it.')
  }

  const changes: SettingChange[] = (Object.keys(input) as (keyof BusinessSettings)[])
    .filter(k => before[k] !== input[k])
    .map(k => ({ field: k, before: before[k], after: input[k] }))

  // Nothing moved — don't stamp the document or write an audit entry saying a
  // change happened when none did.
  if (changes.length === 0) return { changes }

  await adminDb().doc(SETTINGS_DOC).set({
    ...input,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  }, { merge: true })

  return { changes }
}
