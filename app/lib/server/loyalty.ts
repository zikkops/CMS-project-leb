// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Resolving a pending loyalty transaction: approve (credit points) or reject.
//
// ── Why this had to move off the client ───────────────────────────────────
// Approving credits points to every account named on the transaction. The old
// client version read each user document, added the amount, and wrote the new
// total back from the browser — so the browser supplied the resulting balance.
// Firestore rules let loyalty staff write balance fields, and a rule cannot
// check arithmetic, so nothing anywhere verified that the number written bore
// any relation to the transaction being approved.
//
// Two things follow from doing it here instead:
//
//   1. The amount comes from the STORED transaction, never from the request.
//      The caller names a document and an action; it does not get to say how
//      many points that is worth.
//
//   2. Increments are atomic. The read-then-write pattern the client used
//      loses a concurrent award — two managers approving two transactions for
//      the same customer at the same moment, and one credit vanishes. Both
//      read the same starting balance, both write their own total, last write
//      wins. FieldValue.increment() has no such window.
//
// It also lets branch scoping become real. A manager's queue was filtered by
// the QUERY that populated it, which is a UI convenience — a crafted call could
// approve a transaction from any branch. requireSection() gives us the caller's
// branches, so that is now enforced rather than displayed.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { TABLE_CHECKIN_POINTS } from '../loyaltyTiers'

export type ResolveAction = 'approve' | 'reject'

export interface ResolveInput {
  id: string
  action: ResolveAction
  /** Required when rejecting — the customer is shown this. */
  reason?: string
}

export function parseResolveInput(body: Record<string, unknown>): ResolveInput {
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) throw new HttpError(400, 'Missing transaction id.')

  const action = body.action
  if (action !== 'approve' && action !== 'reject') {
    throw new HttpError(400, 'Action must be approve or reject.')
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (action === 'reject' && !reason) {
    throw new HttpError(400, 'A reason is required when rejecting.')
  }

  return { id, action, reason: reason || undefined }
}

export interface ResolveResult {
  label: string
  credited: number
  /** Accounts named on the transaction that no longer exist. */
  missingUsers: string[]
}

function txLabel(data: FirebaseFirestore.DocumentData): string {
  if (data.type === 'check') {
    return `Check #${data.checkNumber || '—'} — $${Number(data.totalAmount ?? 0).toFixed(2)}`
  }
  return `Event — ${data.eventName || '—'}`
}

/**
 * Resolve one pending transaction.
 *
 * Everything happens in a single transaction so the status flip, the credits
 * and the audit row cannot land apart. In particular: a crash between "credit
 * the points" and "mark it approved" would leave a pending transaction whose
 * points had already been paid out, and approving it again would pay twice.
 */
export async function resolveTransaction(
  caller: Caller,
  input: ResolveInput,
): Promise<ResolveResult> {
  const db = adminDb()
  const ref = db.doc(`transactions/${input.id}`)

  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That submission no longer exists.')

    const data = snap.data() ?? {}

    // Re-checked inside the transaction, not before it. Checking first and
    // writing after leaves a window where two managers both see 'pending' and
    // both approve — which credits the points twice.
    if (data.status !== 'pending') {
      throw new HttpError(409, `That submission has already been ${data.status}.`)
    }

    // Branch scoping, enforced rather than merely displayed. Admins are
    // unscoped by design (branchIds is empty for them and the role check is
    // what grants oversight); a manager is limited to their own branches.
    if (caller.role !== 'admin' && caller.branchIds.length > 0) {
      if (!caller.branchIds.includes(String(data.branchId))) {
        throw new HttpError(403, 'That submission belongs to another branch.')
      }
    }

    const userIds: string[] = Array.isArray(data.userId)
      ? data.userId.filter((u): u is string => typeof u === 'string')
      : []

    // From the stored document. Never from the request body — the caller says
    // which transaction, not what it is worth.
    const amount = Number(data.pointsAmount ?? 0)
    if (!Number.isFinite(amount) || amount < 0) {
      throw new HttpError(422, 'That submission has an invalid point amount and cannot be approved.')
    }

    const missingUsers: string[] = []

    if (input.action === 'approve') {
      // Every account is read before anything is written: a Firestore
      // transaction forbids a read after a write.
      const userRefs = userIds.map(uid => db.doc(`users/${uid}`))
      const userSnaps = userRefs.length > 0 ? await tx.getAll(...userRefs) : []

      userSnaps.forEach((userSnap, i) => {
        if (!userSnap.exists) { missingUsers.push(userIds[i]); return }
        // Both counters rise together. Only `points` falls when spent, which
        // is what keeps tier status tied to what was earned.
        tx.update(userRefs[i], {
          points: FieldValue.increment(amount),
          pointsEarned: FieldValue.increment(amount),
        })
      })

      tx.update(ref, {
        status: 'approved',
        approvedBy: caller.uid,
        approvedAt: FieldValue.serverTimestamp(),
      })
    } else {
      tx.update(ref, {
        status: 'rejected',
        rejectedBy: caller.uid,
        rejectedAt: FieldValue.serverTimestamp(),
        rejectionReason: input.reason ?? '',
      })
    }

    tx.set(db.collection('transactionLog').doc(), {
      transactionId: input.id,
      action: input.action === 'approve' ? 'approved' : 'rejected',
      performedBy: caller.uid,
      branchId: data.branchId ?? null,
      createdAt: FieldValue.serverTimestamp(),
    })

    return {
      label: txLabel(data),
      credited: input.action === 'approve' ? amount * (userIds.length - missingUsers.length) : 0,
      missingUsers,
    }
  })
}

// ── Redemptions ───────────────────────────────────────────────────────────
// Same shape of problem as approving a transaction, in the other direction:
// the browser used to read the balance, subtract the cost, and write the
// remainder. It supplied the resulting figure, so a tampered client could
// spend a reward and set any balance it liked — and two confirmations at the
// same moment both read the same starting balance, so one deduction was lost
// and the customer got a free reward.

export interface ResolveRedemptionInput {
  id: string
  action: ResolveAction
  reason?: string
}

export function parseRedemptionInput(body: Record<string, unknown>): ResolveRedemptionInput {
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) throw new HttpError(400, 'Missing redemption id.')

  const action = body.action
  if (action !== 'approve' && action !== 'reject') {
    throw new HttpError(400, 'Action must be approve or reject.')
  }

  // Unlike a transaction rejection, a reason is optional here — the original
  // client flow allowed an empty one and stored null.
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  return { id, action, reason: reason || undefined }
}

export interface RedemptionResult {
  itemName: string
  spent: number
}

/**
 * Confirm (deduct and mark redeemed) or reject one pending redemption.
 *
 * The cost comes from the stored redemption, and sufficiency is re-checked
 * INSIDE the transaction — checking before it leaves a window where two
 * confirmations both see enough balance and the account goes negative.
 */
export async function resolveRedemption(
  caller: Caller,
  input: ResolveRedemptionInput,
): Promise<RedemptionResult> {
  const db = adminDb()
  const ref = db.doc(`redemptions/${input.id}`)

  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That redemption no longer exists.')

    const data = snap.data() ?? {}
    if (data.status !== 'pending') {
      throw new HttpError(409, `That redemption has already been ${data.status}.`)
    }

    if (caller.role !== 'admin' && caller.branchIds.length > 0) {
      if (!caller.branchIds.includes(String(data.branchId))) {
        throw new HttpError(403, 'That redemption belongs to another branch.')
      }
    }

    const cost = Number(data.coinCost ?? 0)
    if (!Number.isFinite(cost) || cost < 0) {
      throw new HttpError(422, 'That redemption has an invalid cost and cannot be confirmed.')
    }

    if (input.action === 'approve') {
      const userRef = db.doc(`users/${data.userId}`)
      const userSnap = await tx.get(userRef)
      if (!userSnap.exists) throw new HttpError(404, 'That customer account no longer exists.')

      const balance = Number(userSnap.data()?.points ?? 0)
      if (balance < cost) {
        throw new HttpError(409, 'That customer no longer has enough points for this reward.')
      }

      // Only the spendable balance moves. pointsEarned is the running total
      // that sets tier status; deducting it here would demote a customer for
      // redeeming, which is how you teach people not to redeem.
      tx.update(userRef, { points: FieldValue.increment(-cost) })

      tx.update(ref, {
        status: 'redeemed',
        confirmedBy: caller.uid,
        confirmedAt: FieldValue.serverTimestamp(),
      })
    } else {
      tx.update(ref, {
        status: 'rejected',
        rejectedAt: FieldValue.serverTimestamp(),
        rejectionReason: input.reason ?? null,
      })
    }

    tx.set(db.collection('transactionLog').doc(), {
      type: 'redemption',
      action: input.action === 'approve' ? 'confirmed' : 'rejected',
      redemptionId: input.id,
      userId: data.userId ?? null,
      itemId: data.itemId ?? null,
      itemName: data.itemName ?? null,
      coinCost: cost,
      performedBy: caller.uid,
      branchId: data.branchId ?? null,
      createdAt: FieldValue.serverTimestamp(),
    })

    return {
      itemName: String(data.itemName ?? 'Reward'),
      spent: input.action === 'approve' ? cost : 0,
    }
  })
}

// ── Manual balance correction ─────────────────────────────────────────────
// Staff setting a customer's balance or earned-total directly, from
// /admin/loyalty/customers. Used to fix a mis-award, or as a goodwill gesture.
//
// Absolute values rather than deltas, matching what the form asks for — an
// admin types the number they want the customer to have. That makes this the
// one points operation where last-write-wins is the correct semantics: two
// admins typing different corrections should end with the second one's answer,
// not with their edits summed.
//
// It moved off the client for the same reason as the rest: rules permit
// loyalty staff to write balance fields and cannot check what is written, so
// the audit trail was the only record of a correction — written by the same
// browser making it, and trivially skippable.

export interface AdjustBalanceInput {
  uid: string
  points?: number
  pointsEarned?: number
}

export function parseAdjustInput(body: Record<string, unknown>): AdjustBalanceInput {
  const uid = typeof body.uid === 'string' ? body.uid.trim() : ''
  if (!uid) throw new HttpError(400, 'Missing customer id.')

  const read = (v: unknown, label: string): number | undefined => {
    if (v === undefined || v === null) return undefined
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label} must be a non-negative number.`)
    return Math.round(n)
  }

  const points = read(body.points, 'Points')
  const pointsEarned = read(body.pointsEarned, 'Points earned')
  if (points === undefined && pointsEarned === undefined) {
    throw new HttpError(400, 'Nothing to change.')
  }

  return { uid, points, pointsEarned }
}

export interface AdjustResult {
  label: string
  before: { points: number; pointsEarned: number }
  after: { points: number; pointsEarned: number }
}

export async function adjustCustomerBalance(
  caller: Caller,
  input: AdjustBalanceInput,
): Promise<AdjustResult> {
  const db = adminDb()
  const ref = db.doc(`users/${input.uid}`)

  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That customer no longer exists.')

    const data = snap.data() ?? {}

    // A staff account's balance is not a thing to be edited from the customer
    // screen. Without this, an id typed into the wrong field could rewrite a
    // colleague's document through a form that only ever meant to touch
    // customers.
    if (data.isStaff === true) {
      throw new HttpError(400, 'That account is a staff account, not a customer.')
    }

    const before = {
      points: Number(data.points ?? 0),
      pointsEarned: Number(data.pointsEarned ?? 0),
    }
    const after = {
      points: input.points ?? before.points,
      pointsEarned: input.pointsEarned ?? before.pointsEarned,
    }

    tx.update(ref, {
      ...(input.points !== undefined ? { points: after.points } : {}),
      ...(input.pointsEarned !== undefined ? { pointsEarned: after.pointsEarned } : {}),
      pointsAdjustedBy: caller.uid,
      pointsAdjustedAt: FieldValue.serverTimestamp(),
    })

    return {
      label: String(data.email || data.username || input.uid),
      before,
      after,
    }
  })
}

// ── Table check-in ────────────────────────────────────────────────────────
// A flat award when staff check a reservation in. No approval cycle: the staff
// member doing it is already authorised, which is the whole point of the
// instant award.
//
// The client version had a defect the others didn't: nothing stopped it
// running twice. It read the balance, added the award and wrote the total —
// so checking the same reservation in again simply awarded again. The guard
// below is a re-read of `checkedIn` INSIDE the transaction, which is the only
// place it can be checked without a race.

export interface CheckinInput {
  reservationId: string
}

export function parseCheckinInput(body: Record<string, unknown>): CheckinInput {
  const reservationId = typeof body.reservationId === 'string' ? body.reservationId.trim() : ''
  if (!reservationId) throw new HttpError(400, 'Missing reservation id.')
  return { reservationId }
}

export interface CheckinResult {
  label: string
  awarded: number
  /** True when the booking had no linked account, so nothing was credited. */
  guestBooking: boolean
}

export async function checkInReservation(
  caller: Caller,
  input: CheckinInput,
): Promise<CheckinResult> {
  const db = adminDb()
  const ref = db.doc(`tableReservations/${input.reservationId}`)

  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That reservation no longer exists.')

    const data = snap.data() ?? {}

    if (data.checkedIn === true) {
      throw new HttpError(409, 'That reservation is already checked in.')
    }
    if (data.status !== 'approved') {
      throw new HttpError(409, `Only an approved reservation can be checked in — this one is ${data.status}.`)
    }
    if (caller.role !== 'admin' && caller.branchIds.length > 0) {
      if (!caller.branchIds.includes(String(data.branch))) {
        throw new HttpError(403, 'That reservation belongs to another branch.')
      }
    }

    // A table can be booked by phone number alone, with no account behind it.
    // That is a normal booking, not an error — it just earns nobody points.
    const userId = typeof data.userId === 'string' ? data.userId : ''
    let guestBooking = true

    if (userId) {
      const userSnap = await tx.get(db.doc(`users/${userId}`))
      if (userSnap.exists) {
        guestBooking = false
        tx.update(db.doc(`users/${userId}`), {
          points: FieldValue.increment(TABLE_CHECKIN_POINTS),
          pointsEarned: FieldValue.increment(TABLE_CHECKIN_POINTS),
        })
      }
    }

    tx.update(ref, {
      checkedIn: true,
      checkedInAt: FieldValue.serverTimestamp(),
      checkedInBy: caller.uid,
    })

    const tables: number[] = Array.isArray(data.tableNumbers) ? data.tableNumbers : []
    return {
      label: `${data.branch ?? '—'} — Table${tables.length > 1 ? 's' : ''} ${tables.join(', ')}`,
      awarded: guestBooking ? 0 : TABLE_CHECKIN_POINTS,
      guestBooking,
    }
  })
}

// ── Annual points reset ───────────────────────────────────────────────────
// Zeroes every customer's balance once a year.
//
// ── What was wrong with the old one ───────────────────────────────────────
// It ran in the BROWSER, fired by whichever staff member happened to load the
// admin dashboard on or after the reset date, in 500-document batches.
//
// Its comment argued that no lock was needed because a double run is a
// harmless no-op — zeroing an already-zero value. That much is true. The hole
// is the other failure: it pushed `nextResetDate` a year forward BEFORE
// touching any customer. Close that tab halfway through and you get a date
// saying "not due for a year", half the customers reset and half not, no
// error, and no retry. The wrong half keep their balances for an extra year.
//
// ── How this one behaves ──────────────────────────────────────────────────
// RESUMABLE BY CONSTRUCTION. It repeatedly queries for accounts that still
// have something to reset and processes them in batches. A document that has
// been zeroed no longer matches, so a run that dies partway simply has less to
// do next time — there is no cursor to lose.
//
// The date advances only after a pass finds nothing left. Until then the reset
// stays due, which is exactly the property the old version lacked.

const RESET_BATCH = 400

export interface ResetResult {
  status: 'seeded' | 'not-due' | 'complete'
  cycle?: string
  nextResetDate?: string
  customersReset: number
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function oneYearAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Run the reset if it is due.
 *
 * `force` skips the date check for a manual run; it does not skip anything
 * else, so forcing twice is still the harmless no-op the old comment described.
 */
export async function runAnnualReset(force = false): Promise<ResetResult> {
  const db = adminDb()
  const settingsRef = db.doc('appSettings/loyaltyReset')
  const snap = await settingsRef.get()

  if (!snap.exists) {
    // Never configured. Seed it rather than silently never resetting — but do
    // not also run on the same pass, or first-ever deploy wipes everyone.
    const seeded = oneYearAfter(todayStr())
    await settingsRef.set({ nextResetDate: seeded }, { merge: true })
    return { status: 'seeded', nextResetDate: seeded, customersReset: 0 }
  }

  const cycle = String(snap.data()?.nextResetDate ?? '')
  if (!force && (!cycle || todayStr() < cycle)) {
    return { status: 'not-due', nextResetDate: cycle, customersReset: 0 }
  }

  // Only accounts with something to zero. Both fields are checked because a
  // manual correction can move the balance without the earned-total, so
  // neither one alone is a complete set.
  let customersReset = 0
  for (const field of ['pointsEarned', 'points'] as const) {
    for (;;) {
      const due = await db.collection('users')
        .where(field, '>', 0)
        .limit(RESET_BATCH)
        .get()
      if (due.empty) break

      const batch = db.batch()
      due.docs.forEach(d => {
        batch.update(d.ref, {
          points: 0,
          pointsEarned: 0,
          pointsResetAt: FieldValue.serverTimestamp(),
          pointsResetCycle: cycle,
        })
      })
      await batch.commit()
      customersReset += due.size
    }
  }

  // Only now. Everything above is idempotent, so a crash before this point
  // leaves the reset still due and the next run finishes it.
  const nextResetDate = oneYearAfter(cycle || todayStr())
  await settingsRef.set({ nextResetDate, lastResetAt: FieldValue.serverTimestamp() }, { merge: true })

  return { status: 'complete', cycle, nextResetDate, customersReset }
}
