// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Signing staff in at a café hub with their phone's key — POS software, stage 5
// (S12–S14). The rules are shared/src/staffKeys.ts; registering a phone is the
// cloud's side, staffKeys.ts in this folder.
//
// Works with no internet: the hub holds the registered keys and the staff
// records it pulled. The phone asks for a challenge, signs it after a
// fingerprint or face (S12), and the hub checks the signature against the
// pulled key before opening a session until 05:00 (S14).
//
// A manager approving somebody else's sign-in (hubApprovals.ts) uses the same
// challenge and the same signature check, over a message naming the request.

import { createHash, randomBytes } from 'node:crypto'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { startHubSession, type HubCaller } from './hubSession'
import { keyIdFor, readPublicKey, signatureValid } from './staffKeys'
import { isRole } from '../roles'
import { normalizeFingerprint } from '../hubNetwork'
import { timestampMs } from '../timestamps'
import { CHALLENGE_MS, STAFF_KEYS, isKeyId, isNonce, signInMessage, staffKeyRecord, type StaffKeyRecord } from '../staffKeys'

const CHALLENGES = 'hubChallenges'

const hashOf = (value: string) => createHash('sha256').update(value).digest('hex')

/** One answer for every way a key sign-in fails, so a guesser learns nothing about which part was wrong. */
export const refused = () => new HttpError(401, 'The phone could not be signed in. Try again.')

/** This hub's own certificate fingerprint as hex, or a 503 when the hub has no café-wifi door. */
export function hubFingerprintHex(raw: string | undefined = process.env.BIG_CMS_HUB_CERT_SHA256): string {
  const fingerprint = normalizeFingerprint(raw)
  if (!fingerprint) {
    throw new HttpError(503, 'This hub is not set up for phones. On the counter PC, set "hubLan": true in the POS app\'s config.json.')
  }
  return fingerprint
}

/**
 * A one-time challenge for a registered phone.
 *
 * One outstanding per key: asking again replaces the last, so a phone tapping
 * Sign in repeatedly, or anyone on the wifi asking over and over, leaves at most
 * one challenge per registered phone on the hub. Stored under its hash.
 */
export async function issueChallenge(
  rawKeyId: unknown,
  { db = adminDb(), now = Date.now() }: { db?: Firestore; now?: number } = {},
): Promise<{ nonce: string; expiresAt: number }> {
  if (!isKeyId(rawKeyId)) throw new HttpError(400, 'Not a phone key.')
  const record = staffKeyRecord((await db.doc(`${STAFF_KEYS}/${rawKeyId}`).get()).data() ?? {})
  if (!record) {
    throw new HttpError(401, 'This phone is not registered at this hub. Register it while the internet is up, then wait for the hub\'s next sync.')
  }
  const nonce = randomBytes(32).toString('base64url')
  const expiresAt = now + CHALLENGE_MS
  const earlier = await db.collection(CHALLENGES).where('keyId', '==', rawKeyId).get()
  const batch = db.batch()
  for (const doc of earlier.docs) batch.delete(doc.ref)
  batch.set(db.doc(`${CHALLENGES}/${hashOf(nonce)}`), { keyId: rawKeyId, expiresAt: Timestamp.fromMillis(expiresAt) })
  await batch.commit()
  return { nonce, expiresAt }
}

/**
 * Uses up a challenge: true only when it existed, was given to this key, and
 * had not run out. Used up either way, BEFORE any signature is checked, so a
 * wrong signature costs the challenge and cannot be retried against it.
 */
export async function consumeChallenge(db: Firestore, keyId: string, nonce: string, now: number): Promise<boolean> {
  const ref = db.doc(`${CHALLENGES}/${hashOf(nonce)}`)
  const challenge = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    tx.delete(ref)
    return snap.data() ?? null
  })
  return Boolean(challenge && challenge.keyId === keyId && timestampMs(challenge.expiresAt, 0) > now)
}

/**
 * The registered key that made this signature over this message, or null. The
 * key must be the one its id names: a pulled record cannot swap in another key.
 */
export async function verifiedKey(db: Firestore, keyId: string, message: string, signature: unknown): Promise<StaffKeyRecord | null> {
  const record = staffKeyRecord((await db.doc(`${STAFF_KEYS}/${keyId}`).get()).data() ?? {})
  const pub = record ? readPublicKey(record.publicKey) : null
  if (!record || !pub || keyIdFor(pub.der) !== keyId) return null
  return signatureValid(pub.key, message, signature) ? record : null
}

/** The staff record the hub pulled, when it still says staff with a role; null otherwise. */
export async function pulledStaff(db: Firestore, uid: string): Promise<Record<string, unknown> | null> {
  const staff = (await db.doc(`users/${uid}`).get()).data()
  return staff && staff.isStaff === true && isRole(staff.role) ? staff : null
}

/** A hub session for a pulled staff record, until 05:00 (S14, S17). */
export function sessionForStaff(uid: string, staff: Record<string, unknown>, now: number): Promise<{ token: string; caller: HubCaller }> {
  return startHubSession({
    uid,
    staff: true,
    role: staff.role,
    branchIds: Array.isArray(staff.branchIds) ? staff.branchIds : typeof staff.branchId === 'string' ? [staff.branchId] : [],
    superadmin: staff.superadmin === true,
  }, now)
}

/**
 * Signs a staff member in with their phone's signature over a challenge.
 *
 * The message names this hub's own certificate fingerprint, so a signature made
 * for a machine pretending to be the hub does not work here.
 */
export async function signInWithKey(
  body: unknown,
  {
    db = adminDb(),
    now = Date.now(),
    hubFingerprint = process.env.BIG_CMS_HUB_CERT_SHA256,
  }: { db?: Firestore; now?: number; hubFingerprint?: string } = {},
): Promise<{ token: string; caller: HubCaller }> {
  const fingerprint = hubFingerprintHex(hubFingerprint)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!isKeyId(b.keyId) || !isNonce(b.nonce)) throw new HttpError(400, 'Not a phone sign-in.')
  const keyId = b.keyId
  const nonce = b.nonce

  if (!(await consumeChallenge(db, keyId, nonce, now))) throw refused()
  const record = await verifiedKey(db, keyId, signInMessage(fingerprint, keyId, nonce), b.signature)
  if (!record) throw refused()

  // The staff record the hub pulled decides who they are now (stage 4).
  const staff = await pulledStaff(db, record.uid)
  if (!staff) throw new HttpError(403, 'This account cannot sign in to the till.')
  return sessionForStaff(record.uid, staff, now)
}
