// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Deleting a customer, and scheduling the annual points reset.

import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from './firebaseAdmin'
import { HttpError } from './auth'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface DeleteResult {
  /** False when the Auth user was already gone — a re-run, not a failure. */
  authDeleted: boolean
  /** Firestore documents actually removed. */
  docsDeleted: number
}

/**
 * Deletes a customer properly: the Auth login first, then their documents.
 *
 * The browser version could only ever delete the Firestore profile, so signing
 * back in produced a fresh blank account and the person was never really
 * removed. Its own comment had already noticed this was fixable — "that has
 * been wrong since Phase 00, adminAuth().deleteUser() is available" — and left
 * it on the old path.
 *
 * ── Order of operations ────────────────────────────────────────────────────
 * Auth goes first on purpose. If the second half fails, access is revoked and
 * some documents linger, which is findable by uid and safe. The other order
 * fails the wrong way: data gone, login still working, and the person walks
 * back in to a blank profile — exactly the behaviour being fixed.
 *
 * An already-missing Auth user is treated as success rather than an error, so
 * a half-finished delete can simply be run again.
 */
export async function deleteCustomerAccount(uid: string): Promise<DeleteResult> {
  const db = adminDb()

  const snap = await db.doc(`users/${uid}`).get()
  if (!snap.exists) throw new HttpError(404, 'That customer no longer exists.')
  if (snap.data()?.isStaff === true) {
    // Staff accounts are deleted through /api/admin/accounts, which also
    // clears their custom claims. Doing it here would leave a staff token
    // valid until it expired.
    throw new HttpError(400, 'That is a staff account. Delete it from Manage Users.')
  }

  let authDeleted = false
  try {
    await adminAuth().deleteUser(uid)
    authDeleted = true
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code !== 'auth/user-not-found') throw err
  }

  // Firestore does not cascade into subcollections, so the private documents
  // — phone number, avatar delete-hash — would otherwise be orphaned and
  // unreachable, holding personal data nothing lists.
  const batch = db.batch()
  const refs = [
    db.doc(`users/${uid}/private/contact`),
    db.doc(`users/${uid}/private/avatar`),
    db.doc(`users/${uid}`),
  ]
  refs.forEach(ref => batch.delete(ref))
  await batch.commit()

  return { authDeleted, docsDeleted: refs.length }
}

/**
 * Sets the date the annual points reset next runs.
 *
 * Rejects a date that is not in the future, which the browser never checked.
 * The reset is a daily cron that fires when today has reached the stored date,
 * so saving yesterday means every customer's balance is zeroed on the next
 * run — no confirmation, no second look. A typo in a date field should not be
 * able to do that.
 */
export async function setLoyaltyResetDate(dateStr: string): Promise<{ before: string | null }> {
  if (!DATE.test(dateStr)) throw new HttpError(400, 'Date must be YYYY-MM-DD.')

  const parsed = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, 'That is not a real date.')

  const today = new Date().toISOString().slice(0, 10)
  if (dateStr <= today) {
    throw new HttpError(400,
      'The reset date must be in the future. Setting it to today or earlier would zero every customer’s balance on the next nightly run.')
  }

  const ref = adminDb().doc('appSettings/loyaltyReset')
  const before = (await ref.get()).data()?.nextResetDate ?? null
  await ref.set({ nextResetDate: dateStr, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { before: before === null ? null : String(before) }
}
