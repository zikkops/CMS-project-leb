// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Clocking in and out at the café hub with the staff app (UPGRADE.md T3.12).
// The phone signs clockMessage() over a challenge from the same
// issueChallenge() sign-in uses, with the same checks: the challenge is used
// up before the signature is looked at, the key must be the one its id names,
// and the pulled staff record must still say staff. Recorded in timeEntries on
// the hub, which sends them up with its trading.

import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { consumeChallenge, hubFingerprintHex, pulledStaff, refused, verifiedKey } from './hubKeySignIn'
import { labelFor } from './hubApprovals'
import { isKeyId, isNonce } from '../staffKeys'
import { TIME_ENTRIES, clockMessage, nextDirection, type ClockDirection } from '../timeClock'
import { lastClockEntry } from './sessionClock'

// One reading of the last entry, shared with the sign-in clock (T6.6).
const lastEntry = lastClockEntry

/** Whether a registered phone's owner is clocked in now, and since when. */
export async function clockStatus(rawKeyId: unknown, { db = adminDb() }: { db?: Firestore } = {}): Promise<{ clockedIn: boolean; since: number | null }> {
  if (!isKeyId(rawKeyId)) throw new HttpError(400, 'Not a phone key.')
  const uid = (await db.doc(`staffKeys/${rawKeyId}`).get()).data()?.uid
  if (typeof uid !== 'string') throw new HttpError(401, 'This phone is not registered at this hub.')
  const last = await lastEntry(db, uid)
  return last?.direction === 'in' ? { clockedIn: true, since: last.at } : { clockedIn: false, since: null }
}

export async function clockWithKey(
  body: unknown,
  {
    db = adminDb(),
    now = Date.now(),
    hubFingerprint = process.env.BIG_CMS_HUB_CERT_SHA256,
  }: { db?: Firestore; now?: number; hubFingerprint?: string } = {},
): Promise<{ direction: ClockDirection; at: number; label: string; uid: string; role: unknown }> {
  const fingerprint = hubFingerprintHex(hubFingerprint)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!isKeyId(b.keyId) || !isNonce(b.nonce) || (b.direction !== 'in' && b.direction !== 'out')) throw new HttpError(400, 'Not a clock.')
  const keyId = b.keyId
  const direction = b.direction

  if (!(await consumeChallenge(db, keyId, b.nonce, now))) throw refused()
  const record = await verifiedKey(db, keyId, clockMessage(fingerprint, keyId, b.nonce, direction), b.signature)
  if (!record) throw refused()
  const staff = await pulledStaff(db, record.uid)
  if (!staff) throw new HttpError(403, 'This account cannot clock in here.')
  const branch = (await db.doc('hubMeta/device').get()).data()?.branch
  if (typeof branch !== 'string' || !branch) throw new HttpError(409, 'This hub is not paired with a branch yet.')

  // The same way twice is a mistake, not a second shift.
  if (nextDirection(await lastEntry(db, record.uid)) !== direction) {
    throw new HttpError(409, direction === 'in' ? 'You are already clocked in.' : 'You are not clocked in.')
  }
  const label = labelFor(staff)
  await db.collection(TIME_ENTRIES).add({
    uid: record.uid, name: typeof staff.firstName === 'string' ? staff.firstName : '', branch, direction,
    at: Timestamp.fromMillis(now), keyId, deviceName: record.deviceName ?? '',
  })
  return { direction, at: now, label, uid: record.uid, role: staff.role }
}
