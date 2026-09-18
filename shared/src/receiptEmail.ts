// Emailing a receipt from the till (UPGRADE.md T3.7). The rules, and nothing
// else: pure, asserted by verify:receipt.
//
// The address is typed at the till for this one receipt and is never stored:
// not on the check, not in the activity log. A customer who wants their
// receipts kept is a loyalty member, whose account already has an address.
// The receipt is the same text the printer gets (buildReceipt() and
// receiptToText() at 42 columns), so the email and the paper cannot disagree.

/** How many times one check's receipt may be emailed: a mistyped address, then the right one, and one spare. */
export const RECEIPT_EMAILS_PER_CHECK = 3

/**
 * An email address as typed, or null when it is not one. Deliberately plain:
 * one @, something on each side, a dot in the domain, no spaces, within the
 * 254 characters an address can have. The mail service is the real judge;
 * this stops a phone number or a name being sent as an address.
 */
export function readReceiptEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim()
  if (email.length < 6 || email.length > 254) return null
  if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/.test(email)) return null
  return email
}

export function receiptEmailSubject(businessName: string, receiptNumber: string): string {
  return `Your receipt from ${businessName} (${receiptNumber})`
}
