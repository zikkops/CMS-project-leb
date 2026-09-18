// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Emails a closed check's receipt (UPGRADE.md T3.7). The rules are
// shared/src/receiptEmail.ts; sending is server/email.ts. The address is used
// for this send and nowhere else. A café hub holds no mail key (its server's
// environment is an allowlist), so there this answers why, and nothing breaks.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { readSettings } from './settings'
import { emailConfigured, sendEmail } from './email'
import { BRAND } from '../brand'
import type { Check } from '../checks'
import { buildReceipt, receiptBlockedReason, receiptToText, RECEIPT_WIDTHS } from '../receipt'
import { receiptOptionsFor } from '../receiptOptions'
import { RECEIPT_EMAILS_PER_CHECK, readReceiptEmail, receiptEmailSubject } from '../receiptEmail'

export async function emailReceipt(checkId: string, rawEmail: unknown): Promise<{ sent: boolean; reason: string | null; receiptNumber: string; branch: string }> {
  const to = readReceiptEmail(rawEmail)
  if (!to) throw new HttpError(400, 'That is not an email address.')
  if (!checkId || checkId.includes('/')) throw new HttpError(400, 'Missing check id.')

  const ref = adminDb().doc(`checks/${checkId}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That check does not exist.')
  const check = { id: snap.id, ...snap.data() } as Check & { receiptEmails?: number }
  const blocked = receiptBlockedReason(check)
  if (blocked) throw new HttpError(409, blocked)
  if ((check.receiptEmails ?? 0) >= RECEIPT_EMAILS_PER_CHECK) {
    throw new HttpError(429, `This receipt has been emailed ${RECEIPT_EMAILS_PER_CHECK} times already. Print it instead.`)
  }
  const receiptNumber = check.receiptNumber ?? ''
  if (!emailConfigured()) {
    return { sent: false, reason: 'Email is not set up on this till. Print the receipt instead.', receiptNumber, branch: check.branch }
  }

  const { exchangeRate } = await readSettings()
  const text = receiptToText(buildReceipt(check, receiptOptionsFor(exchangeRate)), RECEIPT_WIDTHS.wide)
  const result = await sendEmail({ to, subject: receiptEmailSubject(BRAND.name, receiptNumber), text })
  if (!result.sent) {
    console.error('[receipt email] not sent:', result.reason)
    return { sent: false, reason: 'The email did not go. Check the address, or print the receipt instead.', receiptNumber, branch: check.branch }
  }
  await ref.update({ receiptEmails: FieldValue.increment(1) })
  return { sent: true, reason: null, receiptNumber, branch: check.branch }
}
