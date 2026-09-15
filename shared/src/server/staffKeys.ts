// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Staff phones' sign-in keys, the cloud's side — POS software, stage 5 (S12–S14).
// The rules and the signed messages are shared/src/staffKeys.ts; the hub's side
// is hubKeySignIn.ts.
//
// Registering is online and needs the staff member's normal sign-in (S13): the
// route that calls enrolStaffKey() checked their Firebase token, which is the
// cloud checking their password itself. The phone also proves it holds the
// private key. Neither the key nor the proof is a secret: the private key never
// leaves the phone's secure hardware.

import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { isRole } from '../roles'
import { MAX_KEYS_PER_STAFF, STAFF_KEYS, deviceName, enrolMessage, isKeyId } from '../staffKeys'

/** A key's id: the SHA-256 of its public key (SPKI DER), base64url. */
export function keyIdFor(publicKeyDer: Buffer): string {
  return createHash('sha256').update(publicKeyDer).digest('base64url')
}

/** A P-256 public key sent as base64 SPKI, which is what Android's Keystore gives, or null for anything else. */
export function readPublicKey(raw: unknown): { der: Buffer; key: KeyObject; keyId: string } | null {
  if (typeof raw !== 'string' || raw.length > 300 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null
  const der = Buffer.from(raw, 'base64')
  if (der.toString('base64') !== raw || der.length < 60 || der.length > 120) return null
  let key: KeyObject
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' })
  } catch {
    return null
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null
  return { der, key, keyId: keyIdFor(der) }
}

/** Whether a base64 DER ECDSA-SHA256 signature over a message was made by this key. Never throws. */
export function signatureValid(key: KeyObject, message: string, signature: unknown): boolean {
  if (typeof signature !== 'string' || signature.length > 200 || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false
  try {
    return verify('sha256', Buffer.from(message, 'utf8'), { key, dsaEncoding: 'der' }, Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}

/**
 * Registers the signed-in staff member's phone.
 *
 * Sending the same key again is an answer, not an error: a registration whose
 * reply was lost is retried. A key already registered to somebody else is
 * refused, and so is a fourth phone.
 */
export async function enrolStaffKey(
  caller: Caller,
  body: unknown,
  db: Firestore = adminDb(),
): Promise<{ keyId: string; already: boolean }> {
  if (!caller.isStaff || !isRole(caller.role)) throw new HttpError(403, 'Only staff accounts can register a phone for the till.')
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const pub = readPublicKey(b.publicKey)
  if (!pub) throw new HttpError(400, 'That is not a phone sign-in key.')
  if (!signatureValid(pub.key, enrolMessage(caller.uid, pub.keyId), b.proof)) {
    throw new HttpError(400, 'The phone did not prove it holds this key.')
  }
  const name = deviceName(b.deviceName)

  return db.runTransaction(async tx => {
    const ref = db.doc(`${STAFF_KEYS}/${pub.keyId}`)
    const snap = await tx.get(ref)
    const owned = await tx.get(db.collection(STAFF_KEYS).where('uid', '==', caller.uid))
    if (snap.exists) {
      const d = snap.data() ?? {}
      if (d.uid === caller.uid && !d.revokedAt) return { keyId: pub.keyId, already: true }
      throw new HttpError(409, 'This phone key is already registered.')
    }
    const active = owned.docs.filter(doc => !doc.data()?.revokedAt).length
    if (active >= MAX_KEYS_PER_STAFF) {
      throw new HttpError(409, `You already have ${MAX_KEYS_PER_STAFF} phones registered for the till. Remove one before adding another.`)
    }
    tx.create(ref, {
      uid: caller.uid,
      publicKey: pub.der.toString('base64'),
      deviceName: name,
      createdAt: FieldValue.serverTimestamp(),
      revokedAt: null,
      revokedBy: null,
    })
    return { keyId: pub.keyId, already: false }
  })
}

/**
 * Removes a phone: a lost phone, or a leaver's. Its owner or an admin. It stops
 * signing anyone in at each hub's next pull.
 */
export async function revokeStaffKey(
  caller: Caller,
  rawKeyId: unknown,
  db: Firestore = adminDb(),
): Promise<{ uid: string; deviceName: string; already: boolean }> {
  if (!isKeyId(rawKeyId)) throw new HttpError(400, 'Not a phone key.')
  const ref = db.doc(`${STAFF_KEYS}/${rawKeyId}`)
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That phone is not registered.')
    const d = snap.data() ?? {}
    if (d.uid !== caller.uid && caller.role !== 'admin' && !caller.superadmin) {
      throw new HttpError(403, 'Only the phone\'s owner or an admin can remove it.')
    }
    const out = { uid: String(d.uid ?? ''), deviceName: deviceName(d.deviceName) }
    if (d.revokedAt) return { ...out, already: true }
    tx.update(ref, { revokedAt: FieldValue.serverTimestamp(), revokedBy: caller.uid })
    return { ...out, already: false }
  })
}
