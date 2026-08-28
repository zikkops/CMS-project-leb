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

import { doc, runTransaction } from 'firebase/firestore'
import { db } from './firebase'

// Formatting lives in invoiceFormat.ts so route handlers can share it.
export { formatInvoiceNumber, quarterOf } from './invoiceFormat'
import { formatInvoiceNumber } from './invoiceFormat'

// NOTE: this client-side counter only works for an ADMIN. appSettings is
// `allow write: if hasRole(['admin'])`, so any other caller gets a 403 here.
// Wholesale accounts therefore ask the server for a number instead — see
// issueInvoiceNumber() in app/api/wholesale/orders/route.ts.

// Atomic sequential counter, shared with counter sales so the business has one
// invoice series rather than two that both start at 0001. Resets each calendar
// year. Gaps are possible if a later step fails, which is normal and accepted
// in accounting systems.
export async function nextInvoiceSequence(): Promise<{ sequence: number; issuedAt: Date }> {
  const counterRef = doc(db, 'appSettings', 'invoiceCounter')
  const issuedAt = new Date()
  const year = issuedAt.getFullYear()
  let sequence = 1

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef)
    const data = snap.data() ?? {}
    sequence = data.year === year ? (data.nextNumber ?? 0) + 1 : 1
    tx.set(counterRef, { year, nextNumber: sequence })
  })

  return { sequence, issuedAt }
}

export async function nextFormattedInvoiceNumber(): Promise<string> {
  const { sequence, issuedAt } = await nextInvoiceSequence()
  return formatInvoiceNumber(sequence, issuedAt)
}
