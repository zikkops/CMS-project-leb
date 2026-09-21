// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// A manager approving a sign-in at a café hub — POS software, stage 5 (owner's
// decisions S6, S15–S17, S19). The rules and the signed messages are
// shared/src/staffApprovals.ts.
//
// Two kinds of request, answered the same way:
//   - a PERSON whose phone has no fingerprint: the session is theirs;
//   - a KITCHEN SCREEN (S19), a shared tablet: the session belongs to the screen,
//     in the kitchen crew role with the 'kds' scope, the kitchen display only.
//
// Works with no internet, like every hub sign-in: the people, the keys and the
// staff records are the ones the hub pulled.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { startHubSession, type HubCaller } from './hubSession'
import { consumeChallenge, hubFingerprintHex, pulledStaff, refused, sessionForStaff, verifiedKey } from './hubKeySignIn'
import { deviceName, isKeyId, isNonce } from '../staffKeys'
import { readFirstName, staffLabel } from '../staffProfiles'
import { timestampMs } from '../timestamps'
import {
  APPROVALS, APPROVAL_MS, SCREEN_ROLE, SCREEN_SCOPE, SCREEN_UID_PREFIX, approvalProblem, approvalState, approveMessage,
  denyMessage, isApprovalId, isApprovalSecret, type ApprovalStatus,
} from '../staffApprovals'

const hashOf = (value: string) => createHash('sha256').update(value).digest('hex')

const roleWords = (role: unknown) => (typeof role === 'string' ? role.replace(/_/g, ' ') : 'staff member')

/** How a pulled staff record is named to a manager: first name, or "a barista" (S15, S18). */
export const labelFor = (staff: Record<string, unknown>) => staffLabel(staff.firstName, roleWords(staff.role))

/** Where this hub's own pairing is kept (hubSync.ts): the branch a kitchen screen serves. */
const DEVICE_DOC = 'hubMeta/device'

export type RequestKind = 'person' | 'screen'

const kindOf = (data: Record<string, unknown>): RequestKind => (data.kind === 'screen' ? 'screen' : 'person')

export interface Person {
  uid: string
  label: string
}

/** Who can ask: the staff the hub pulled, by first name. Nothing else about them. */
export async function listPeople({ db = adminDb() }: { db?: Firestore } = {}): Promise<Person[]> {
  const snap = await db.collection('users').where('isStaff', '==', true).get()
  return snap.docs
    // Somebody with no first name yet is listed by role, and says so, so the
    // counter's list tells whoever set the café up what is missing (UPGRADE.md T1.17).
    .map(doc => {
      const data = doc.data() ?? {}
      return { uid: doc.id, label: readFirstName(data.firstName) ? labelFor(data) : `${labelFor(data)} (no first name yet)` }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * A request for a manager's approval: a person on a phone with no fingerprint
 * (`uid` chosen from the list), or a kitchen screen (`kind: 'screen'`, S19).
 *
 * One waiting request per person: asking again replaces the last. The device
 * gets a secret to collect the answer with; the hub keeps only its hash.
 */
export async function askApproval(
  body: unknown,
  { db = adminDb(), now = Date.now() }: { db?: Firestore; now?: number } = {},
): Promise<{ id: string; secret: string; expiresAt: number; label: string; kind: RequestKind }> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const kind: RequestKind = b.kind === 'screen' ? 'screen' : 'person'
  const uid = kind === 'person' && typeof b.uid === 'string' && b.uid && !b.uid.includes('/') ? b.uid : ''
  const staff = uid ? await pulledStaff(db, uid) : null
  if (kind === 'person' && !staff) throw new HttpError(400, 'Choose who you are from the list.')

  const id = randomBytes(16).toString('base64url')
  const secret = randomBytes(32).toString('base64url')
  const expiresAt = now + APPROVAL_MS
  const batch = db.batch()
  if (kind === 'person') {
    const earlier = await db.collection(APPROVALS).where('uid', '==', uid).get()
    for (const doc of earlier.docs) if (doc.data()?.status === 'waiting') batch.delete(doc.ref)
  }
  batch.set(db.doc(`${APPROVALS}/${id}`), {
    kind,
    uid: kind === 'person' ? uid : null,
    deviceName: deviceName(b.deviceName),
    secretHash: hashOf(secret),
    status: 'waiting',
    createdAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(expiresAt),
    approvedBy: null,
  })
  await batch.commit()
  return { id, secret, expiresAt, kind, label: staff ? labelFor(staff) : 'a kitchen screen' }
}

export interface WaitingRequest {
  id: string
  kind: RequestKind
  label: string
  deviceName: string
  createdAt: number
  expiresAt: number
}

/** Requests still waiting for a manager, oldest first. First names and device names only. */
export async function listWaiting({ db = adminDb(), now = Date.now() }: { db?: Firestore; now?: number } = {}): Promise<WaitingRequest[]> {
  const snap = await db.collection(APPROVALS).where('status', '==', 'waiting').get()
  const out: WaitingRequest[] = []
  for (const doc of snap.docs) {
    const d = doc.data() ?? {}
    const expiresAt = timestampMs(d.expiresAt, 0)
    if (!(expiresAt > now)) continue
    const kind = kindOf(d)
    let label = 'a kitchen screen'
    if (kind === 'person') {
      const staff = await pulledStaff(db, String(d.uid ?? ''))
      if (!staff) continue
      label = labelFor(staff)
    }
    out.push({ id: doc.id, kind, label, deviceName: deviceName(d.deviceName), createdAt: timestampMs(d.createdAt, 0), expiresAt })
  }
  return out.sort((a, b) => a.createdAt - b.createdAt)
}

export interface Answered {
  decision: 'approved' | 'denied'
  kind: RequestKind
  approverUid: string
  approverRole: unknown
  approverLabel: string
  requestedUid: string
  requestedLabel: string
  deviceName: string
}

type AnswerOptions = { db?: Firestore; now?: number; hubFingerprint?: string }

/**
 * A manager answers one request with their own phone's signature (S16).
 *
 * The challenge is used up before the signature is checked. The signed message
 * names this hub, this request, the manager's key and the answer, so an
 * approval cannot be replayed for another request, at another hub, or as a
 * refusal. Their pulled staff record must say manager or admin, and nobody
 * answers their own request.
 */
async function answerRequest(
  body: unknown,
  decision: 'approved' | 'denied',
  { db = adminDb(), now = Date.now(), hubFingerprint = process.env.BIG_CMS_HUB_CERT_SHA256 }: AnswerOptions,
): Promise<Answered> {
  const fingerprint = hubFingerprintHex(hubFingerprint)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!isApprovalId(b.id) || !isKeyId(b.keyId) || !isNonce(b.nonce)) throw new HttpError(400, 'Not an approval.')
  const id = b.id
  const keyId = b.keyId
  const nonce = b.nonce

  if (!(await consumeChallenge(db, keyId, nonce, now))) throw refused()
  const message = decision === 'approved'
    ? approveMessage(fingerprint, id, keyId, nonce)
    : denyMessage(fingerprint, id, keyId, nonce)
  const key = await verifiedKey(db, keyId, message, b.signature)
  if (!key) throw refused()
  const approver = await pulledStaff(db, key.uid)
  if (!approver) throw new HttpError(403, 'This account cannot answer sign-in requests.')

  const ref = db.doc(`${APPROVALS}/${id}`)
  const requested = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That request is no longer there.')
    const d = snap.data() ?? {}
    if (approvalState(d, timestampMs(d.expiresAt, 0), now) !== 'waiting') {
      throw new HttpError(409, 'That request has run out or was already answered.')
    }
    const kind = kindOf(d)
    const requestedUid = kind === 'screen' ? `${SCREEN_UID_PREFIX}${id}` : String(d.uid ?? '')
    const problem = approvalProblem({ uid: key.uid, role: approver.role }, requestedUid)
    if (problem) throw new HttpError(403, problem)
    tx.update(ref, decision === 'approved'
      ? { status: 'approved', approvedBy: key.uid, approvedAt: FieldValue.serverTimestamp() }
      : { status: 'denied', deniedBy: key.uid, deniedAt: FieldValue.serverTimestamp() })
    return { kind, requestedUid, deviceName: deviceName(d.deviceName) }
  })

  const requestedStaff = requested.kind === 'person' ? await pulledStaff(db, requested.requestedUid) : null
  return {
    decision,
    kind: requested.kind,
    approverUid: key.uid,
    approverRole: approver.role,
    approverLabel: labelFor(approver),
    requestedUid: requested.requestedUid,
    requestedLabel: requested.kind === 'screen' ? 'a kitchen screen' : requestedStaff ? labelFor(requestedStaff) : 'a staff member',
    deviceName: requested.deviceName,
  }
}

/** A manager approves one request with their fingerprint (S16). */
export function approveRequest(body: unknown, options: AnswerOptions = {}): Promise<Answered> {
  return answerRequest(body, 'approved', options)
}

/**
 * A manager turns one request down with their fingerprint. The same proof as
 * approving, so nobody else on the café wifi can refuse somebody's request.
 */
export function denyRequest(body: unknown, options: AnswerOptions = {}): Promise<Answered> {
  return answerRequest(body, 'denied', options)
}

/**
 * The asking device collects its answer with its secret.
 *
 * Approved: the request is marked collected and a session is made now, until
 * 05:00 (S17, S19). For a person, it is theirs. For a kitchen screen, it is the
 * screen's: `screen:<id>`, the kitchen crew role, the 'kds' scope, this hub's
 * branch. No token was stored while it waited, and collecting twice gets
 * nothing the second time. Denied: the device is told so.
 */
export async function collectApproval(
  body: unknown,
  { db = adminDb(), now = Date.now() }: { db?: Firestore; now?: number } = {},
): Promise<{ status: ApprovalStatus | 'expired'; kind?: RequestKind; token?: string; caller?: HubCaller; approvedBy?: string }> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!isApprovalId(b.id) || !isApprovalSecret(b.secret)) throw new HttpError(400, 'Not a request.')
  const id = b.id
  const secretHash = Buffer.from(hashOf(b.secret), 'hex')
  const ref = db.doc(`${APPROVALS}/${id}`)

  const taken = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That request is no longer there.')
    const d = snap.data() ?? {}
    const stored = Buffer.from(String(d.secretHash ?? ''), 'hex')
    if (stored.length !== secretHash.length || !timingSafeEqual(stored, secretHash)) throw new HttpError(401, 'That is not this phone\'s request.')
    const state = approvalState(d, timestampMs(d.expiresAt, 0), now)
    if (state !== 'approved') return { state, kind: kindOf(d), uid: '', approvedBy: '' }
    tx.update(ref, { status: 'collected', collectedAt: FieldValue.serverTimestamp() })
    return { state, kind: kindOf(d), uid: String(d.uid ?? ''), approvedBy: String(d.approvedBy ?? '') }
  })
  if (taken.state !== 'approved') return { status: taken.state, kind: taken.kind }

  if (taken.kind === 'screen') {
    const pairing = (await db.doc(DEVICE_DOC).get()).data()
    const { token, caller } = await startHubSession({
      device: 'Kitchen screen',
      uid: `${SCREEN_UID_PREFIX}${id}`,
      staff: true,
      role: SCREEN_ROLE,
      scope: SCREEN_SCOPE,
      branchIds: typeof pairing?.branch === 'string' ? [pairing.branch] : [],
    }, now)
    return { status: 'approved', kind: 'screen', token, caller, approvedBy: taken.approvedBy }
  }

  const staff = await pulledStaff(db, taken.uid)
  if (!staff) throw new HttpError(403, 'This account cannot sign in to the till.')
  const { token, caller } = await sessionForStaff(taken.uid, staff, now, 'Phone, with a manager\'s approval')
  return { status: 'approved', kind: 'person', token, caller, approvedBy: taken.approvedBy }
}
