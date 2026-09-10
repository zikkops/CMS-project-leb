// Pure invoice-number formatting. Deliberately NOT 'use client' and with no
// Firebase import, so both the browser and route handlers can use it — the
// sequence is issued server-side (the counter document is admin-only in the
// rules) while the string is rendered in both places.
//
// Format: XX-Q1-012026-0001
//   XX      the business's own prefix — see invoicePrefix in businessSettings
//   Q1      calendar quarter — Q1 = Jan–Mar … Q4 = Oct–Dec
//   01      month, two digits
//   2026    year
//   0001    sequence, four digits, resets each calendar year
//
// The prefix used to be the literal 'OB', the initials of the café this was
// forked from. It is a per-business setting now, chosen once during setup and
// then locked — see shared/src/server/settings.ts for why locking matters.

import { BRAND } from './brand'
import { zonedParts } from './dates'

// 1 = January (calendar quarters). Set to 7 for a July–June fiscal year.
export const FISCAL_YEAR_START_MONTH = 1

// Used when no prefix has been chosen and the brand config names none. Not the
// old café's initials on purpose: a fresh install should not inherit somebody
// else's letterhead, and a neutral default is obviously a placeholder to the
// person setting the business up.
export const FALLBACK_INVOICE_PREFIX = 'INV'

/**
 * What a prefix is allowed to be.
 *
 * Upper-case letters and digits only, and short. It is printed on an invoice,
 * typed into accounting software, and read down a phone — punctuation and
 * spaces make all three worse. The hyphen is excluded deliberately: it
 * separates the parts of the number, so a prefix containing one would make the
 * format ambiguous to anything parsing it back apart.
 */
export const INVOICE_PREFIX_PATTERN = /^[A-Z0-9]{2,6}$/

/**
 * The year, month and quarter an invoice belongs to, in the café's timezone.
 *
 * These used to come from getFullYear() and getMonth(), which read the zone of
 * whatever machine runs them — and invoices are numbered on the server, whose
 * host is usually UTC. A check closed at 01:00 in Beirut on 1 October was
 * numbered into Q3 and September; the first hours of a new year were numbered
 * into the old year's sequence and labelled with it. A quarter printed on an
 * invoice is what VAT is filed against, so it has to be the café's quarter.
 *
 * It looked right in development because the development machine is in
 * Beirut. Nothing about the code was right; the machine happened to agree.
 */
export function invoicePeriod(
  issuedAt: Date,
  timeZone: string = BRAND.locale.timezone,
): { year: number; month: number; quarter: number } {
  const { year, month } = zonedParts(issuedAt, timeZone)
  const offset = (month - 1 - (FISCAL_YEAR_START_MONTH - 1) + 12) % 12
  return { year, month, quarter: Math.floor(offset / 3) + 1 }
}

export function quarterOf(date: Date, timeZone: string = BRAND.locale.timezone): number {
  return invoicePeriod(date, timeZone).quarter
}

export function formatInvoiceNumber(
  sequence: number,
  issuedAt: Date = new Date(),
  prefix: string = FALLBACK_INVOICE_PREFIX,
  timeZone: string = BRAND.locale.timezone,
): string {
  const { year, month, quarter } = invoicePeriod(issuedAt, timeZone)
  const mm = String(month).padStart(2, '0')
  return `${prefix}-Q${quarter}-${mm}${year}-${String(sequence).padStart(4, '0')}`
}

// Validates a number that arrived from a browser before it goes anywhere near
// an outgoing email.
//
// Deliberately STRUCTURAL rather than pinned to the configured prefix. Two
// reasons, and the first is a live bug waiting to happen: re-approving an old
// wholesale order reuses the invoice number already on it, so a number issued
// under a previous prefix comes back through this check. Pinning the current
// prefix would reject the business's own older invoices. The second is simply
// that this is a format check — whether a prefix is the RIGHT one is a
// question about settings, not about whether a string is well formed.
export const INVOICE_NUMBER_PATTERN = /^[A-Z0-9]{2,6}-Q[1-4]-\d{6}-\d{4,}$/

// The invoice image is drawn on a canvas in the browser and uploaded through
// /api/upload-image, so its URL arrives with the request rather than being
// produced by the server. It has to be one of ours: the URL is emailed out
// and shown to the shop, so an arbitrary link would ride along under our name.
//
// Shared rather than written out at each call site — the submission route had
// this check and the staff decision route did not, which is exactly the kind
// of gap a copied regex leaves behind.
export const INVOICE_IMAGE_URL_PATTERN = /^https:\/\/i\.ibb\.co\/[\w./-]+$/
