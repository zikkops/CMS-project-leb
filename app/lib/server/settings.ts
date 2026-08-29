// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Business settings: the VAT rate, the exchange rate and the tips deduction.
//
// These are written here rather than from the browser for the Phase 00 reason
// — a value that decides what a customer is charged is not a value a browser
// gets to set. The rules deny writes to this document entirely; this is the
// only path in.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import {
  SETTINGS_DOC, SETTINGS_LIMITS, SETTINGS_DEFAULTS,
  type BusinessSettings,
} from '../businessSettings'

// businessSettings.ts is deliberately free of React and Firebase so both
// sides can share the bounds. The listener lives in useBusinessSettings.ts,
// which must never be imported from here.

function rate(raw: unknown, key: keyof BusinessSettings, label: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number.`)
  const { min, max } = SETTINGS_LIMITS[key]
  if (n < min || n > max) {
    throw new HttpError(400, `${label} must be between ${min} and ${max}.`)
  }
  return n
}

export function parseSettingsInput(body: Record<string, unknown>): BusinessSettings {
  return {
    // Percentages arrive as fractions, the same way they are stored and the
    // same way computeTotals() consumes them. The form does the ÷100, so a
    // stray "11" here would be a 1100% VAT rate — which the bounds reject
    // rather than quietly bill.
    vatRate:           rate(body.vatRate, 'vatRate', 'VAT rate'),
    exchangeRate:      rate(body.exchangeRate, 'exchangeRate', 'Exchange rate'),
    tipsDeductionRate: rate(body.tipsDeductionRate, 'tipsDeductionRate', 'Tips deduction'),
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
  }
}

/**
 * Writes the settings and returns what changed.
 *
 * The diff is returned rather than logged here so the route can put it in the
 * activity log as before/after pairs. "Someone changed the VAT rate" is not a
 * useful audit entry; "VAT 11% -> 12%, by name, at time" is the entry an
 * accountant actually needs when an invoice looks wrong.
 */
export async function writeSettings(
  input: BusinessSettings,
  actor: { uid: string; email: string },
): Promise<{ changes: { field: string; before: number; after: number }[] }> {
  const before = await readSettings()

  const changes = (Object.keys(input) as (keyof BusinessSettings)[])
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
