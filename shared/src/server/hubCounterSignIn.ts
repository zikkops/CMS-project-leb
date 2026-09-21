// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Signing in on the counter PC with your own phone — POS software, stage 5
// (owner's decisions S24–S25). The rules and the signed message are
// shared/src/counterSignIn.ts.
//
// Works with no internet, like every hub sign-in: the people, their keys and
// their staff records are the ones the hub pulled.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { startHubSession, type HubCaller } from './hubSession'
import { consumeChallenge, hubFingerprintHex, pulledStaff, refused, verifiedKey } from './hubKeySignIn'
import { labelFor } from './hubApprovals'
import { isKeyId, isNonce } from '../staffKeys'
import { approvalState, isApprovalId, isApprovalSecret } from '../staffApprovals'
import { timestampMs } from '../timestamps'
import {
  COUNTER_IDLE_MS, COUNTER_REQUESTS, COUNTER_REQUEST_MS, counterCodeFromBytes, counterSignInMessage, isCounterCode, isCounterHost, signInLink,
} from '../counterSignIn'

const hashOf = (value: string) => createHash('sha256').update(value).digest('hex')

/** A code is stored only as a hash with its request's id, so a copy of the hub's database shows no codes. */
const codeHash = (id: string, code: string) => hashOf(`${id}:${code}`)

const sameHash = (a: string, b: string) => {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

/**
 * The counter PC asks to sign somebody in (S24). One waiting request per person:
 * tapping your name again replaces the last. The screen gets the code to show and
 * a secret to collect the session with; the hub keeps only hashes of both.
 *
 * With no name (T6.3, "Scan to sign in"), the request is open: whoever's key
 * approves it, having scanned the QR on this screen, is the person signed in.
 * One open request waits at a time. The QR text comes back only when the hub
 * has its café-wifi certificate, since the phone checks that fingerprint.
 */
export async function askCounterSignIn(
  body: unknown,
  { db = adminDb(), now = Date.now(), host, hubFingerprint = process.env.BIG_CMS_HUB_CERT_SHA256 }: { db?: Firestore; now?: number; host: unknown; hubFingerprint?: string },
): Promise<{ id: string; secret: string; code: string; expiresAt: number; label: string; link: string | null }> {
  if (!isCounterHost(host)) {
    throw new HttpError(403, 'Signing in by phone is for the counter PC itself. On a phone, sign in with your fingerprint in the staff app.')
  }
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const open = b.open === true
  const uid = !open && typeof b.uid === 'string' && b.uid && !b.uid.includes('/') ? b.uid : ''
  const staff = uid ? await pulledStaff(db, uid) : null
  if (!open && !staff) throw new HttpError(400, 'Choose who you are from the list.')

  const id = randomBytes(16).toString('base64url')
  const secret = randomBytes(32).toString('base64url')
  const code = counterCodeFromBytes(randomBytes(4))
  const expiresAt = now + COUNTER_REQUEST_MS
  const batch = db.batch()
  const earlier = await db.collection(COUNTER_REQUESTS).where('uid', '==', uid).get()
  for (const doc of earlier.docs) if (doc.data()?.status === 'waiting') batch.delete(doc.ref)
  batch.set(db.doc(`${COUNTER_REQUESTS}/${id}`), {
    uid,
    codeHash: codeHash(id, code),
    secretHash: hashOf(secret),
    status: 'waiting',
    createdAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(expiresAt),
    approvedAt: null,
  })
  await batch.commit()
  let link: string | null = null
  try { link = signInLink(hubFingerprintHex(hubFingerprint), id, code) } catch { link = null }
  return { id, secret, code, expiresAt, label: staff ? labelFor(staff) : 'whoever scans', link }
}

/**
 * The person approves from their own phone, with their fingerprint (S24): a
 * signature over the code on the counter screen. The challenge is used up
 * before the signature is checked. Only the key's owner's own waiting request
 * with that code is approved, so nobody signs somebody else in, and a request
 * started on another screen, showing another code, is not.
 */
export async function approveCounterSignIn(
  body: unknown,
  { db = adminDb(), now = Date.now(), hubFingerprint = process.env.BIG_CMS_HUB_CERT_SHA256 }: { db?: Firestore; now?: number; hubFingerprint?: string } = {},
): Promise<{ uid: string; role: unknown; label: string }> {
  const fingerprint = hubFingerprintHex(hubFingerprint)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!isCounterCode(b.code) || !isKeyId(b.keyId) || !isNonce(b.nonce)) throw new HttpError(400, 'Not a counter sign-in.')
  const { code, keyId, nonce } = b as { code: string; keyId: string; nonce: string }
  // Scanned (T6.3): the QR named the request, so it is that one or none.
  const requestId = isApprovalId(b.requestId) ? b.requestId : null

  if (!(await consumeChallenge(db, keyId, nonce, now))) throw refused()
  const key = await verifiedKey(db, keyId, counterSignInMessage(fingerprint, code, keyId, nonce), b.signature)
  if (!key) throw refused()
  const staff = await pulledStaff(db, key.uid)
  if (!staff) throw new HttpError(403, 'This account cannot sign in to the till.')

  const matched = await db.runTransaction(async tx => {
    if (requestId) {
      // The request scanned: waiting, in time, its code, and either this person's
      // own or open, in which case the key's owner claims it.
      const doc = await tx.get(db.doc(`${COUNTER_REQUESTS}/${requestId}`))
      const d = doc.data() ?? {}
      const ok = doc.exists && d.status === 'waiting' && timestampMs(d.expiresAt, 0) > now
        && sameHash(codeHash(doc.id, code), String(d.codeHash ?? '')) && (d.uid === key.uid || d.uid === '')
      if (!ok) return false
      tx.update(doc.ref, { status: 'approved', approvedAt: FieldValue.serverTimestamp(), keyId, uid: key.uid })
      return true
    }
    const snap = await tx.get(db.collection(COUNTER_REQUESTS).where('uid', '==', key.uid))
    const found = snap.docs.find(doc => {
      const d = doc.data() ?? {}
      return d.status === 'waiting' && timestampMs(d.expiresAt, 0) > now && sameHash(codeHash(doc.id, code), String(d.codeHash ?? ''))
    })
    if (!found) return false
    tx.update(found.ref, { status: 'approved', approvedAt: FieldValue.serverTimestamp(), keyId })
    return true
  })
  if (!matched) {
    throw new HttpError(404, 'No counter is waiting for you with that code. Tap your name on the counter again, and type the new code.')
  }
  return { uid: key.uid, role: staff.role, label: labelFor(staff) }
}

/**
 * The counter collects the session with its secret, once approved: a session for
 * the person, ending after COUNTER_IDLE_MS without a tap (S25), and at 05:00 at
 * the latest. Made now, so no token waits in the hub; collecting twice gets
 * nothing the second time.
 */
export async function collectCounterSignIn(
  body: unknown,
  { db = adminDb(), now = Date.now() }: { db?: Firestore; now?: number } = {},
): Promise<{ status: 'waiting' | 'approved' | 'expired' | 'collected'; token?: string; caller?: HubCaller }> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!isApprovalId(b.id) || !isApprovalSecret(b.secret)) throw new HttpError(400, 'Not a counter sign-in.')
  const ref = db.doc(`${COUNTER_REQUESTS}/${b.id}`)
  const secretHash = hashOf(b.secret)

  const taken = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That sign-in is no longer there. Tap your name again.')
    const d = snap.data() ?? {}
    if (!sameHash(secretHash, String(d.secretHash ?? ''))) throw new HttpError(401, 'That is not this screen\'s sign-in.')
    const state = approvalState(d, timestampMs(d.expiresAt, 0), now)
    if (state !== 'approved') return { state: state === 'denied' ? 'expired' as const : state, uid: '' }
    tx.update(ref, { status: 'collected', collectedAt: FieldValue.serverTimestamp() })
    return { state, uid: String(d.uid ?? '') }
  })
  if (taken.state !== 'approved') return { status: taken.state }

  const staff = await pulledStaff(db, taken.uid)
  if (!staff) throw new HttpError(403, 'This account cannot sign in to the till.')
  const { token, caller } = await startHubSession({
    uid: taken.uid,
    staff: true,
    role: staff.role,
    branchIds: Array.isArray(staff.branchIds) ? staff.branchIds : typeof staff.branchId === 'string' ? [staff.branchId] : [],
    superadmin: staff.superadmin === true,
    idleMs: COUNTER_IDLE_MS,
  }, now)
  return { status: 'approved', token, caller }
}
