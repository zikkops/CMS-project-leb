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
//
// ── On a café hub ──────────────────────────────────────────────────────────
// A hub numbers receipts from the blocks the cloud reserved for it
// (shared/src/receiptBlocks.ts, owner's decision S9), never from a counter of
// its own: a hub counting from 1 would print numbers the cloud has already
// given out. With no block for this year, closing is refused with a reason,
// and the check stays open until the hub is online long enough to fetch one.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb, hubDbPath } from './firebaseAdmin'
import { HttpError } from './auth'
import { formatInvoiceNumber, invoicePeriod } from '../invoiceFormat'
import { readInvoicePrefixSetting } from './settings'
import { readBlocks, takeReceipt } from '../receiptBlocks'

/**
 * Where every issued number is written down (UPGRADE.md T7.10), in the SAME
 * transaction that issues it, so the receipt sequence report can tell a number
 * burnt on a failed close from one that was never issued at all.
 * Server-only: no Firestore rule, so no rules deploy. One document per
 * number, keyed by year and sequence, so a transaction that runs again writes
 * the same document rather than a second one.
 */
export const RECEIPT_LOG = 'receiptLog'

export function receiptLogEntry(year: number, sequence: number, invoiceNumber: string, purpose: string) {
  return {
    path: `${RECEIPT_LOG}/${year}-${sequence}`,
    data: { year, sequence, number: invoiceNumber, purpose: purpose.slice(0, 120), issuedAt: FieldValue.serverTimestamp() },
  }
}

/**
 * Issues the next invoice number and advances the counter atomically.
 *
 * Gaps are possible when a later step fails, which is normal and accepted in
 * accounting systems — a burnt number is far better than two invoices sharing
 * one.
 */
export async function issueInvoiceNumber(purpose = 'a check'): Promise<{ invoiceNumber: string; sequence: number; issuedAt: Date }> {
  const db = adminDb()
  const issuedAt = new Date()
  // The café's year, not the host's. The counter resets on it, and a UTC host
  // would have reset two hours late and numbered the new year's first receipts
  // into the old sequence. See invoicePeriod().
  const { year } = invoicePeriod(issuedAt)

  // Read before the transaction, not inside it. The prefix is a setting
  // rather than part of the counter's own state, and a read of an unrelated
  // document inside the transaction would widen what a concurrent write can
  // make it retry against for no benefit.
  const prefix = await readInvoicePrefixSetting()

  if (hubDbPath()) {
    const ref = db.doc('hubMeta/receipts')
    const sequence = await db.runTransaction(async tx => {
      const snap = await tx.get(ref)
      const taken = takeReceipt(readBlocks(snap.data()?.blocks), year)
      if (!taken.ok) throw new HttpError(409, taken.reason)
      tx.set(ref, { blocks: taken.blocks }, { merge: true })
      const log = receiptLogEntry(year, taken.sequence, formatInvoiceNumber(taken.sequence, issuedAt, prefix), purpose)
      tx.set(db.doc(log.path), log.data)
      return taken.sequence
    })
    return { invoiceNumber: formatInvoiceNumber(sequence, issuedAt, prefix), sequence, issuedAt }
  }

  const ref = db.doc('appSettings/invoiceCounter')
  const sequence = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const data = snap.data() ?? {}
    // The sequence restarts each calendar year; the year stored alongside it
    // is what makes that a reset rather than a collision.
    const next = data.year === year ? (data.nextNumber ?? 0) + 1 : 1
    tx.set(ref, { year, nextNumber: next }, { merge: true })
    const log = receiptLogEntry(year, next, formatInvoiceNumber(next, issuedAt, prefix), purpose)
    tx.set(db.doc(log.path), log.data)
    return next
  })

  return { invoiceNumber: formatInvoiceNumber(sequence, issuedAt, prefix), sequence, issuedAt }
}
