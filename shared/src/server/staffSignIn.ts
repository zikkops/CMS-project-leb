// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Scan to sign in on the online till (UPGRADE.md T6.4). The rules are
// shared/src/staffSignIn.ts. Cloud only: a hub has its own sign-ins and refuses
// Firebase Admin calls.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { type Firestore } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRAND } from '../brand'
import { todayYmd } from '../dates'
import {
  MAX_STAFF_SIGNIN_PER_DAY, STAFF_SIGNIN_MS, STAFF_SIGNIN_REQUESTS,
  checkDigits, isSignInRequestId, isSignInSecret, signInState,
} from '../staffSignIn'

const BUDGET_DOC = 'appSettings/staffSignInBudget'
const hashOf = (value: string) => createHash('sha256').update(value).digest('hex')
const sameHash = (a: string, b: string) => {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

/** A device asks to be signed in. No sign-in needed, so a day's supply is capped. */
export async function askStaffSignIn({ db = adminDb(), now = Date.now() }: { db?: Firestore; now?: number } = {}): Promise<{ id: string; secret: string; code: string; expiresAt: number }> {
  const id = randomBytes(16).toString('base64url')
  const secret = randomBytes(32).toString('base64url')
  const expiresAt = now + STAFF_SIGNIN_MS
  const today = todayYmd(BRAND.locale.timezone, new Date(now))
  const refused = await db.runTransaction(async tx => {
    const budget = (await tx.get(db.doc(BUDGET_DOC))).data() ?? {}
    const used = budget.day === today ? Number(budget.used ?? 0) : 0
    if (used >= MAX_STAFF_SIGNIN_PER_DAY) return true
    tx.set(db.doc(BUDGET_DOC), { day: today, used: used + 1 }, { merge: true })
    tx.set(db.doc(`${STAFF_SIGNIN_REQUESTS}/${id}`), { secretHash: hashOf(secret), status: 'waiting', uid: '', expiresAt, createdAt: now })
    return false
  })
  if (refused) throw new HttpError(429, 'Too many sign-in requests today. Sign in with your email and password.')
  return { id, secret, code: checkDigits(id), expiresAt }
}

/** The approving phone checks the request is live before its owner confirms, and gets the check digits to compare. */
export async function peekStaffSignIn(id: unknown, { db = adminDb(), now = Date.now() }: { db?: Firestore; now?: number } = {}): Promise<{ code: string; state: string }> {
  if (!isSignInRequestId(id)) throw new HttpError(400, 'Not a sign-in request.')
  const snap = await db.doc(`${STAFF_SIGNIN_REQUESTS}/${id}`).get()
  if (!snap.exists) throw new HttpError(404, 'That sign-in has run out. Ask the device for a new code.')
  return { code: checkDigits(id), state: signInState(snap.data() ?? {}, now) }
}

/** The staff member's own phone approves: the request becomes theirs, once, while it waits. */
export async function approveStaffSignIn(caller: Caller, id: unknown, { db = adminDb(), now = Date.now() }: { db?: Firestore; now?: number } = {}): Promise<void> {
  if (!isSignInRequestId(id)) throw new HttpError(400, 'Not a sign-in request.')
  if (!caller.isStaff) throw new HttpError(403, 'Staff access required.')
  const ref = db.doc(`${STAFF_SIGNIN_REQUESTS}/${id}`)
  const ok = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists || signInState(snap.data() ?? {}, now) !== 'waiting') return false
    tx.update(ref, { status: 'approved', uid: caller.uid, approvedAt: now })
    return true
  })
  if (!ok) throw new HttpError(404, 'That sign-in has run out or was already used. Ask the device for a new code.')
}

/**
 * The device collects with its secret. Once approved: a custom token for the
 * person, made now, and the request is spent in the same step, so collecting
 * twice gets nothing. `mint` is the Admin SDK's createCustomToken; injected so
 * the verifier can run without Firebase.
 */
export async function collectStaffSignIn(
  body: unknown,
  { db = adminDb(), now = Date.now(), mint = (uid: string) => adminAuth().createCustomToken(uid) }: { db?: Firestore; now?: number; mint?: (uid: string) => Promise<string> } = {},
): Promise<{ state: 'waiting' | 'expired' | 'collected' } | { state: 'approved'; token: string; uid: string }> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!isSignInRequestId(b.id) || !isSignInSecret(b.secret)) throw new HttpError(400, 'Not a sign-in request.')
  const ref = db.doc(`${STAFF_SIGNIN_REQUESTS}/${b.id}`)
  const secretHash = hashOf(b.secret)
  const taken = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { state: 'expired' as const, uid: '' }
    const d = snap.data() ?? {}
    if (!sameHash(secretHash, String(d.secretHash ?? ''))) throw new HttpError(401, 'That is not this device\'s sign-in.')
    const state = signInState(d, now)
    if (state !== 'approved') return { state, uid: '' }
    tx.update(ref, { status: 'collected', collectedAt: now })
    return { state, uid: String(d.uid ?? '') }
  })
  if (taken.state !== 'approved') return { state: taken.state }
  if (!taken.uid) throw new HttpError(409, 'That sign-in names nobody.')
  return { state: 'approved', token: await mint(taken.uid), uid: taken.uid }
}
