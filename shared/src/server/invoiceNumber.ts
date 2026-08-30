// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The invoice counter. One sequence shared by counter sales and wholesale, so
// the business has a single invoice series rather than two that both start at
// 0001.
//
// ── Why this file exists ───────────────────────────────────────────────────
// The same counter transaction had been written three times: once in the
// browser (shared/src/invoiceNumber.ts), once in the wholesale route, and once
// inside createPurchaseOrder(). The browser copy could not work at all —
// appSettings/invoiceCounter is `allow write: if false`, so it returned
// permission-denied for every caller including an admin, and the invoice
// simply never appeared. Its own comment still claimed an admin could run it.
//
// createPurchaseOrder() deliberately keeps its own copy. It reads the counter
// inside the SAME transaction as the product prices and stock, so a sale
// either gets its number and its stock movement together or gets neither.
// Extracting it would mean issuing a number in one transaction and the sale in
// another, and a crash between them would burn a number on a sale that never
// happened. Two implementations, one reason, written down here so the next
// person does not "fix" the duplication.

import { adminDb } from './firebaseAdmin'
import { formatInvoiceNumber } from '../invoiceFormat'
import { readInvoicePrefixSetting } from './settings'

/**
 * Issues the next invoice number and advances the counter atomically.
 *
 * Gaps are possible when a later step fails, which is normal and accepted in
 * accounting systems — a burnt number is far better than two invoices sharing
 * one.
 */
export async function issueInvoiceNumber(): Promise<{ invoiceNumber: string; sequence: number; issuedAt: Date }> {
  const db = adminDb()
  const ref = db.doc('appSettings/invoiceCounter')
  const issuedAt = new Date()
  const year = issuedAt.getFullYear()

  // Read before the transaction, not inside it. The prefix is a setting
  // rather than part of the counter's own state, and a read of an unrelated
  // document inside the transaction would widen what a concurrent write can
  // make it retry against for no benefit.
  const prefix = await readInvoicePrefixSetting()

  const sequence = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const data = snap.data() ?? {}
    // The sequence restarts each calendar year; the year stored alongside it
    // is what makes that a reset rather than a collision.
    const next = data.year === year ? (data.nextNumber ?? 0) + 1 : 1
    tx.set(ref, { year, nextNumber: next }, { merge: true })
    return next
  })

  return { invoiceNumber: formatInvoiceNumber(sequence, issuedAt, prefix), sequence, issuedAt }
}
