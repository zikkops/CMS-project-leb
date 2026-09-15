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

import { createHash, randomBytes } from 'node:crypto'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { startHubSession, type HubCaller } from './hubSession'
import { keyIdFor, readPublicKey, signatureValid } from './staffKeys'
import { isRole } from '../roles'
import { normalizeFingerprint } from '../hubNetwork'
import { timestampMs } from '../timestamps'
import { CHALLENGE_MS, STAFF_KEYS, isKeyId, isNonce, signInMessage, staffKeyRecord } from '../staffKeys'

const CHALLENGES = 'hubChallenges'

const hashOf = (value: string) => createHash('sha256').update(value).digest('hex')

/** One answer for every way a key sign-in fails, so a guesser learns nothing about which part was wrong. */
const refused = () => new HttpError(401, 'The phone could not be signed in. Try again.')

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
 * Signs a staff member in with their phone's signature over a challenge.
 *
 * The challenge is used up BEFORE the signature is checked, so a wrong
 * signature costs the challenge and cannot be retried against it. The message
 * names this hub's own certificate fingerprint, so a signature made for a
 * machine pretending to be the hub does not work here.
 */
export async function signInWithKey(
  body: unknown,
  {
    db = adminDb(),
    now = Date.now(),
    hubFingerprint = process.env.BIG_CMS_HUB_CERT_SHA256,
  }: { db?: Firestore; now?: number; hubFingerprint?: string } = {},
): Promise<{ token: string; caller: HubCaller }> {
  const fingerprint = normalizeFingerprint(hubFingerprint)
  if (!fingerprint) {
    throw new HttpError(503, 'This hub is not set up for phones. On the counter PC, set "hubLan": true in the POS app\'s config.json.')
  }
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!isKeyId(b.keyId) || !isNonce(b.nonce)) throw new HttpError(400, 'Not a phone sign-in.')
  const keyId = b.keyId
  const nonce = b.nonce

  const ref = db.doc(`${CHALLENGES}/${hashOf(nonce)}`)
  const challenge = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    tx.delete(ref)
    return snap.data() ?? null
  })
  if (!challenge || challenge.keyId !== keyId || !(timestampMs(challenge.expiresAt, 0) > now)) throw refused()

  const record = staffKeyRecord((await db.doc(`${STAFF_KEYS}/${keyId}`).get()).data() ?? {})
  const pub = record ? readPublicKey(record.publicKey) : null
  // The key is the one its id names: a pulled record cannot swap in another key.
  if (!record || !pub || keyIdFor(pub.der) !== keyId) throw refused()
  if (!signatureValid(pub.key, signInMessage(fingerprint, keyId, nonce), b.signature)) throw refused()

  // The staff record the hub pulled decides who they are now (stage 4).
  const staff = (await db.doc(`users/${record.uid}`).get()).data()
  if (!staff || staff.isStaff !== true || !isRole(staff.role)) {
    throw new HttpError(403, 'This account cannot sign in to the till.')
  }
  return startHubSession({
    uid: record.uid,
    staff: true,
    role: staff.role,
    branchIds: Array.isArray(staff.branchIds) ? staff.branchIds : typeof staff.branchId === 'string' ? [staff.branchId] : [],
    superadmin: staff.superadmin === true,
  }, now)
}
