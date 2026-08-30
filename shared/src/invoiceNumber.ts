'use client'

// Invoice numbering: OB-Q1-092026-0001
//
//   OB        fixed prefix
//   Q1        the quarter the invoice was issued in
//   09        the month, two digits
//   2026      the year
//   0001      the sequence, four digits
//
// QUARTERS ARE CALENDAR QUARTERS — Q1 = Jan–Mar, Q2 = Apr–Jun, Q3 = Jul–Sep,
// Q4 = Oct–Dec. (The spec example "OB-Q1-092026-0001" paired Q1 with month 09;
// confirmed as an illustration, not a July fiscal year.) If that ever changes,
// set FISCAL_YEAR_START_MONTH below and future numbers shift accordingly —
// numbers already issued are stored on their invoice and never recomputed.
//
// The sequence resets each calendar year, and is shared by wholesale orders and
// counter sales so the business has one invoice series.

import { authedFetch, unwrap } from './apiClient'

// Formatting lives in invoiceFormat.ts so route handlers can share it.
export { formatInvoiceNumber, quarterOf } from './invoiceFormat'

// There is no client-side counter any more, and there never usefully was
// one. appSettings/invoiceCounter is `allow write: if false`, so the
// transaction that used to live here returned permission-denied for every
// caller — including an admin, which the note it replaced insisted was fine.
// The invoice just silently never appeared.
//
// Numbers are minted server-side now: /api/admin/invoice-number for staff,
// and GET /api/wholesale/orders for a shop's own browser. Both call
// issueInvoiceNumber() in app/lib/server/invoiceNumber.ts.

/**
 * The next invoice number, minted by the server.
 *
 * Every call burns a sequence number, so this is not something to retry
 * blindly or call speculatively — ask for a number when you are about to use
 * it. Gaps are normal and accepted in accounting; two invoices sharing a
 * number is not.
 */
export async function nextFormattedInvoiceNumber(): Promise<string> {
  const data = await unwrap(await authedFetch('/api/admin/invoice-number', 'GET'))
  const invoiceNumber = typeof data.invoiceNumber === 'string' ? data.invoiceNumber : ''
  if (!invoiceNumber) throw new Error('The server did not return an invoice number.')
  return invoiceNumber
}
