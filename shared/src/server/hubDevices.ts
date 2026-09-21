// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The cloud's side of a café hub — POS software, stage 4: pairing codes, the
// hubs' credentials, and the snapshot a hub pulls. The rules are
// shared/src/hubSync.ts; the hub's side is hubSync.ts in this folder.
//
// Two server-only collections, no Firestore rule, so no rules deploy:
//   hubPairingCodes/{sha256(code)}  one-time, fifteen minutes, made by an admin
//   hubDevices/{deviceId}           a paired hub: branch, name, sha256 of its secret
//
// Neither a code nor a secret is ever stored as itself. A copy of the database
// — a backup, an export — holds nothing a PC could pair or pull with.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { DocumentReference, FieldValue, GeoPoint, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRANCHES } from '../branches'
import { decode, encode, stable, type Classify, type Revive } from '../backupCodec'
import type { Firestore } from 'firebase-admin/firestore'
import { timestampMs } from '../timestamps'
import {
  PAIRING_CODE_LENGTH, PAIRING_CODE_MINUTES, normalizePairingCode, pairingCodeFromBytes, parseDeviceAuth,
  pullSpec, staffRecord, type PulledDoc,
} from '../hubSync'

import { RECEIPT_BLOCK_SIZE, RECEIPT_REFILL_AT, reserveBlock, type ReceiptBlock } from '../receiptBlocks'
import { invoicePeriod } from '../invoiceFormat'
import { PUSH_BATCH, moveField, moveProblem, pushProblem, type PushedDoc, type StockMove } from '../hubPush'
import { STAFF_KEYS, staffKeyRecord } from '../staffKeys'
import { STAFF_PROFILES, readFirstName } from '../staffProfiles'
import { HELD_ITEMS, caughtUp, handBackProblem, heldSummary, isHeldDecision, onlineSinceOf, type HeldStatus } from '../hubFallback'
import { isSessionId, pendingEnds, readSessionReport, type ReportedSession } from '../hubSessions'

const DEVICES = 'hubDevices'
const CODES = 'hubPairingCodes'
const RECEIPT_BLOCKS = 'hubReceiptBlocks'
const APPLIED_MOVES = 'hubAppliedMoves'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export interface HubDevice {
  id: string
  branch: string
  name: string
  /** When an admin switched this hub's branch to the online till (S21), or null while the hub trades it. */
  onlineSince?: number | null
  /** When the hub last said it had nothing left to send up. */
  caughtUpAt?: number | null
}

export interface HubDeviceRow extends HubDevice {
  pairedAt: number | null
  pairedByEmail: string
  lastSeenAt: number | null
  revoked: boolean
  revokedAt: number | null
  onlineSince: number | null
  onlineByEmail: string
  caughtUpAt: number | null
  /** What this hub sent up while its branch traded online, still waiting for a manager (S22). */
  heldWaiting: number
  /** Who is signed in at this hub, as it last reported (T6.5), and when. */
  sessions: ReportedSession[]
  sessionsAt: number | null
  /** Sessions an admin asked to end, not yet gone from the hub's report. */
  endSessions: string[]
}

/** A one-time code for pairing a hub at a branch. Returned once; stored as a hash. */
export async function createPairingCode(
  caller: Caller,
  input: { branch: unknown; name: unknown },
  now = Date.now(),
): Promise<{ code: string; expiresAt: number; branch: string; name: string }> {
  const branch = String(input.branch ?? '')
  if (!(BRANCHES as readonly string[]).includes(branch)) throw new HttpError(400, 'Choose a branch for the hub.')
  const name = String(input.name ?? '').trim().slice(0, 60)
  if (!name) throw new HttpError(400, 'Give the hub a name, like "Counter PC".')

  const code = pairingCodeFromBytes(randomBytes(PAIRING_CODE_LENGTH))
  const expiresAt = now + PAIRING_CODE_MINUTES * 60_000
  await adminDb().doc(`${CODES}/${sha256(code)}`).create({
    branch,
    name,
    createdBy: caller.uid,
    createdByEmail: caller.email ?? '',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(expiresAt),
    usedAt: null,
    deviceId: null,
  })
  return { code, expiresAt, branch, name }
}

/**
 * Swaps a pairing code for a hub's credential, once.
 *
 * One refusal for a code that never existed, was used, or ran out: telling
 * them apart tells a guesser which codes are real. The secret is returned here
 * and never again — the cloud keeps only its hash.
 */
export async function pairDevice(
  rawCode: unknown,
  now = Date.now(),
): Promise<{ deviceId: string; secret: string; branch: string; name: string; pairedBy: { uid: string; email: string | null } }> {
  const code = normalizePairingCode(rawCode)
  if (!code) throw new HttpError(400, 'That is not a pairing code. It is ten letters and numbers, like ABCDE-FGH23.')

  const db = adminDb()
  const codeRef = db.doc(`${CODES}/${sha256(code)}`)
  const deviceRef = db.collection(DEVICES).doc()
  const secret = randomBytes(32).toString('base64url')

  return db.runTransaction(async tx => {
    const snap = await tx.get(codeRef)
    const d = snap.data()
    if (!d || d.usedAt || timestampMs(d.expiresAt, 0) <= now || !(BRANCHES as readonly string[]).includes(String(d.branch))) {
      throw new HttpError(400, 'That pairing code does not work. Codes work once, for fifteen minutes: ask an admin for a new one.')
    }
    tx.update(codeRef, { usedAt: FieldValue.serverTimestamp(), deviceId: deviceRef.id })
    tx.set(deviceRef, {
      branch: String(d.branch),
      name: String(d.name ?? ''),
      secretHash: sha256(secret),
      pairedAt: FieldValue.serverTimestamp(),
      pairedBy: String(d.createdBy ?? ''),
      pairedByEmail: String(d.createdByEmail ?? ''),
      lastSeenAt: null,
      revokedAt: null,
      revokedBy: null,
    })
    return {
      deviceId: deviceRef.id,
      secret,
      branch: String(d.branch),
      name: String(d.name ?? ''),
      pairedBy: { uid: String(d.createdBy ?? ''), email: typeof d.createdByEmail === 'string' && d.createdByEmail ? d.createdByEmail : null },
    }
  })
}

/** The hub making this request, by its credential. 401 for anything else, including a hub an admin unpaired. */
export async function deviceFromRequest(request: Request, now = Date.now()): Promise<HubDevice> {
  const auth = parseDeviceAuth(request.headers.get('authorization'))
  if (!auth) throw new HttpError(401, 'This hub is not paired.')
  const ref = adminDb().doc(`${DEVICES}/${auth.deviceId}`)
  const snap = await ref.get()
  const d = snap.data()
  const given = Buffer.from(sha256(auth.secret), 'hex')
  const stored = Buffer.from(String(d?.secretHash ?? ''), 'hex')
  // Compared in constant time, so how long a refusal takes says nothing about the secret.
  if (!d || stored.length !== given.length || !timingSafeEqual(given, stored)) {
    throw new HttpError(401, 'This hub is not paired.')
  }
  if (d.revokedAt) throw new HttpError(401, 'An admin unpaired this hub. Pair it again from Settings → Café Hubs.')
  if (!(BRANCHES as readonly string[]).includes(String(d.branch))) throw new HttpError(403, 'This hub belongs to a branch that no longer exists.')

  // Seen, at most every ten minutes: a pull every two minutes must not be a
  // database write every two minutes.
  if (now - timestampMs(d.lastSeenAt, 0) > 10 * 60_000) {
    await ref.update({ lastSeenAt: FieldValue.serverTimestamp() })
  }
  return {
    id: snap.id,
    branch: String(d.branch),
    name: String(d.name ?? ''),
    onlineSince: onlineSinceOf(d),
    caughtUpAt: timestampMs(d.caughtUpAt, 0) || null,
  }
}

/** Every hub, for the admin panel. Never a secret or its hash. */
export async function listDevices(db: Firestore = adminDb()): Promise<HubDeviceRow[]> {
  const snap = await db.collection(DEVICES).orderBy('pairedAt', 'desc').get()
  const waiting = await db.collection(HELD_ITEMS).where('status', '==', 'waiting').get()
  const heldBy = new Map<string, number>()
  for (const item of waiting.docs) {
    const id = String(item.data()?.deviceId ?? '')
    heldBy.set(id, (heldBy.get(id) ?? 0) + 1)
  }
  return snap.docs.map(doc => {
    const d = doc.data() ?? {}
    return {
      id: doc.id,
      branch: String(d.branch ?? ''),
      name: String(d.name ?? ''),
      pairedAt: timestampMs(d.pairedAt, 0) || null,
      pairedByEmail: String(d.pairedByEmail ?? ''),
      lastSeenAt: timestampMs(d.lastSeenAt, 0) || null,
      revoked: Boolean(d.revokedAt),
      revokedAt: timestampMs(d.revokedAt, 0) || null,
      onlineSince: onlineSinceOf(d),
      onlineByEmail: String(d.onlineByEmail ?? ''),
      caughtUpAt: timestampMs(d.caughtUpAt, 0) || null,
      heldWaiting: heldBy.get(doc.id) ?? 0,
      sessions: readSessionReport(d.sessions),
      sessionsAt: timestampMs(d.sessionsAt, 0) || null,
      endSessions: Array.isArray(d.endSessions) ? d.endSessions.filter(isSessionId) : [],
    }
  })
}

/**
 * A hub reports who is signed in there (T6.5), with every sync. Kept on its row
 * for the admin panel, and answered with the sessions an admin asked to end
 * that the hub still reports: once one is gone from the report, it ended, and
 * the request is dropped.
 */
export async function noteSessions(device: HubDevice, raw: unknown, db: Firestore = adminDb()): Promise<string[]> {
  const sessions = readSessionReport(raw)
  const ref = db.doc(`${DEVICES}/${device.id}`)
  return db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() ?? {}
    const end = pendingEnds(Array.isArray(d.endSessions) ? d.endSessions : [], sessions)
    tx.update(ref, { sessions, sessionsAt: FieldValue.serverTimestamp(), endSessions: end })
    return end
  })
}

/** An admin asks a hub to end one of its sessions (T6.5); it happens at the hub's next sync. */
export async function requestEndSession(rawId: unknown, sessionId: unknown, db: Firestore = adminDb()): Promise<{ hub: HubDevice; session: ReportedSession }> {
  const id = deviceIdOf(rawId)
  if (!id || !isSessionId(sessionId)) throw new HttpError(400, 'Choose a session to end.')
  const ref = db.doc(`${DEVICES}/${id}`)
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'There is no such café hub.')
    const d = snap.data() ?? {}
    const session = readSessionReport(d.sessions).find(s => s.id === sessionId)
    if (!session) throw new HttpError(404, 'That session is no longer listed. It may have ended already.')
    tx.update(ref, { endSessions: FieldValue.arrayUnion(sessionId) })
    return { hub: { id: snap.id, branch: String(d.branch ?? ''), name: String(d.name ?? ''), onlineSince: onlineSinceOf(d), caughtUpAt: timestampMs(d.caughtUpAt, 0) || null }, session }
  })
}

const deviceIdOf = (rawId: unknown) => (typeof rawId === 'string' && /^[A-Za-z0-9]{20}$/.test(rawId) ? rawId : '')

/**
 * Switches a hub's branch to the online till while the counter PC is out of
 * action (S21): the lock comes off at once, and what the hub sends up from now
 * on is held for a manager (S22). Switching twice is an answer, not an error.
 */
export async function startOnlineTrading(caller: Caller, rawId: unknown, db: Firestore = adminDb()): Promise<HubDevice & { already: boolean }> {
  const id = deviceIdOf(rawId)
  if (!id) throw new HttpError(400, 'Missing hub.')
  const ref = db.doc(`${DEVICES}/${id}`)
  return db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data()
    if (!d) throw new HttpError(404, 'That hub does not exist.')
    const device = { id, branch: String(d.branch ?? ''), name: String(d.name ?? '') }
    if (d.revokedAt) throw new HttpError(409, 'That hub is unpaired, so its branch already trades online.')
    if (onlineSinceOf(d) !== null) return { ...device, already: true }
    tx.update(ref, {
      onlineSince: FieldValue.serverTimestamp(),
      onlineBy: caller.uid,
      onlineByEmail: caller.email ?? '',
      caughtUpAt: null,
    })
    return { ...device, already: false }
  })
}

/**
 * Hands a branch back to its hub (S23): only once the hub has been in touch
 * with nothing left unsent since the branch went online, and the online till
 * has no open table, no open drawer shift, and nothing from the hub still
 * waiting for a manager. The hub clears its old trading when it hears.
 */
export async function handBackToHub(caller: Caller, rawId: unknown, db: Firestore = adminDb()): Promise<HubDevice> {
  const id = deviceIdOf(rawId)
  if (!id) throw new HttpError(400, 'Missing hub.')
  const ref = db.doc(`${DEVICES}/${id}`)
  return db.runTransaction(async tx => {
    const d = (await tx.get(ref)).data()
    if (!d) throw new HttpError(404, 'That hub does not exist.')
    const branch = String(d.branch ?? '')
    const [open, drawer, held] = await Promise.all([
      tx.get(db.collection('checks').where('branch', '==', branch).where('status', '==', 'open').limit(100)),
      tx.get(db.doc(`branchDrawers/${branch}`)),
      tx.get(db.collection(HELD_ITEMS).where('deviceId', '==', id).where('status', '==', 'waiting').limit(100)),
    ])
    const problem = handBackProblem({
      branch,
      revoked: Boolean(d.revokedAt),
      onlineSince: onlineSinceOf(d),
      caughtUpAt: timestampMs(d.caughtUpAt, 0) || null,
      openChecks: open.size,
      openShift: Boolean(drawer.data()?.openShiftId),
      heldWaiting: held.size,
    })
    if (problem) throw new HttpError(409, problem)
    tx.update(ref, {
      onlineSince: null,
      caughtUpAt: null,
      handedBackAt: FieldValue.serverTimestamp(),
      handedBackBy: caller.uid,
      handedBackByEmail: caller.email ?? '',
    })
    return { id, branch, name: String(d.name ?? '') }
  })
}

/**
 * Notes that a hub whose branch trades online has nothing left to send up, from
 * how far it says it has sent and how far its change log goes. Written once per
 * spell online, not at every pull. Returns whether it wrote.
 */
export async function noteCaughtUp(device: HubDevice, sent: unknown, latest: unknown, db: Firestore = adminDb()): Promise<boolean> {
  const since = device.onlineSince ?? null
  if (since === null || !caughtUp(sent, latest)) return false
  if (device.caughtUpAt != null && device.caughtUpAt >= since) return false
  await db.doc(`${DEVICES}/${device.id}`).update({ caughtUpAt: FieldValue.serverTimestamp() })
  return true
}

/** Unpairs a hub: its credential stops working at its next pull. Unpairing twice is not an error. */
export async function revokeDevice(caller: Caller, rawId: unknown): Promise<HubDevice & { already: boolean }> {
  const id = typeof rawId === 'string' && /^[A-Za-z0-9]{20}$/.test(rawId) ? rawId : ''
  if (!id) throw new HttpError(400, 'Missing hub.')
  const db = adminDb()
  const ref = db.doc(`${DEVICES}/${id}`)
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const d = snap.data()
    if (!d) throw new HttpError(404, 'That hub does not exist.')
    const device = { id, branch: String(d.branch ?? ''), name: String(d.name ?? '') }
    if (d.revokedAt) return { ...device, already: true }
    tx.update(ref, { revokedAt: FieldValue.serverTimestamp(), revokedBy: caller.uid, revokedByEmail: caller.email ?? '' })
    return { ...device, already: false }
  })
}

/**
 * What a hub pulls: the documents the cloud is master for, for its branch
 * (pullSpec), with staff accounts cut down to what the till needs.
 */
export async function buildPullSnapshot(device: HubDevice): Promise<PulledDoc[]> {
  const db = adminDb()
  const docs: PulledDoc[] = []
  const staffIds = new Set<string>()
  for (const spec of pullSpec(device.branch)) {
    if (spec.collection === 'users') {
      const staff = await db.collection('users').where('isStaff', '==', true).get()
      const profiles = staff.docs.length > 0
        ? await db.getAll(...staff.docs.map(doc => db.doc(`${STAFF_PROFILES}/${doc.id}`)))
        : []
      const firstNames = new Map(profiles.map(p => [p.id, readFirstName(p.data()?.firstName)]))
      for (const doc of staff.docs) {
        const record = staffRecord(doc.data() ?? {})
        if (record) {
          // Their first name, from the server-only profile an admin keeps (S15,
          // S18), and nothing else about them: a manager approving a sign-in
          // needs to know who is asking.
          const firstName = firstNames.get(doc.id)
          docs.push({ collection: 'users', id: doc.id, data: firstName ? { ...record, firstName } : record })
          staffIds.add(doc.id)
        }
      }
    } else if (spec.collection === STAFF_KEYS) {
      // Keys still in use, of people still staff: a leaver's phone signs nobody in.
      // Only keys whose attestation was checked at registration (S20): a key
      // stored without one signs nobody in, however it got there.
      const keys = await db.collection(STAFF_KEYS).where('revokedAt', '==', null).get()
      for (const doc of keys.docs) {
        if (!doc.data()?.attestation) continue
        const record = staffKeyRecord(doc.data() ?? {})
        if (record && staffIds.has(record.uid)) docs.push({ collection: STAFF_KEYS, id: doc.id, data: { ...record } })
      }
    } else if (spec.ids) {
      const snaps = await db.getAll(...spec.ids.map(id => db.doc(`${spec.collection}/${id}`)))
      for (const snap of snaps) if (snap.exists) docs.push({ collection: spec.collection, id: snap.id, data: snap.data() ?? {} })
    } else {
      const snap = await db.collection(spec.collection).get()
      for (const doc of snap.docs) docs.push({ collection: spec.collection, id: doc.id, data: doc.data() ?? {} })
    }
  }
  return docs
}

/**
 * A block of receipt numbers for a hub (owner's decision S9), reserved off the
 * counter the cloud issues its own receipts from, in one transaction, and
 * written down: which hub, which numbers, when.
 *
 * Refused while the hub says it still has RECEIPT_REFILL_AT or more. A request
 * whose reply was lost and gets sent again, or a hub stuck in a loop, must not
 * burn block after block of the café's numbering.
 */
export async function reserveReceiptBlock(device: HubDevice, have: unknown, now = new Date()): Promise<ReceiptBlock> {
  const left = Number(have)
  if (Number.isFinite(left) && left >= RECEIPT_REFILL_AT) {
    throw new HttpError(409, `This hub still has ${left} receipt numbers; it gets more below ${RECEIPT_REFILL_AT}.`)
  }
  const { year } = invoicePeriod(now)
  const db = adminDb()
  const counterRef = db.doc('appSettings/invoiceCounter')
  const logRef = db.collection(RECEIPT_BLOCKS).doc()
  return db.runTransaction(async tx => {
    const snap = await tx.get(counterRef)
    const { block, counter } = reserveBlock(snap.data(), year, RECEIPT_BLOCK_SIZE)
    tx.set(counterRef, counter, { merge: true })
    tx.set(logRef, {
      deviceId: device.id, branch: device.branch, name: device.name,
      year, first: block.first, last: block.last, reservedAt: FieldValue.serverTimestamp(),
    })
    return block
  })
}

export interface PushResult {
  docs: number
  moves: number
  movesAlreadyApplied: number
  /** Items held for a manager because the hub's branch trades online (S22). */
  held: number
  /** Whether the hub's branch trades on the online till, so the hub stops taking orders. */
  tradingOnline: boolean
  seq: number
}

// Firestore's values back from a hub's tagged copy, for this database.
function reviver(db: Firestore): Revive {
  return (kind, data) => {
    switch (kind) {
      case 'ts': return new Timestamp(Number(data.s), Number(data.n))
      case 'geo': return new GeoPoint(Number(data.lat), Number(data.lng))
      case 'ref': return db.doc(String(data.path))
      case 'bytes': return Buffer.from(String(data.b64), 'base64')
      default: throw new HttpError(400, `A value of unknown kind "${kind}".`)
    }
  }
}

const heldDocId = (deviceId: string, collection: string, docId: string) => `${deviceId}_${collection}_${docId}`
const heldMoveId = (deviceId: string, moveId: string) => `${deviceId}_move_${moveId}`

/**
 * Holds a push for a manager instead of applying it (S22). A document is held
 * as it stands, and sent again after a change is waiting again with the new
 * version. A movement is held once, and not at all when the cloud already
 * applied it before the branch went online. Activity is written as usual: it
 * records what happened on the counter PC, and changes nobody's trading.
 */
async function holdPush(device: HubDevice, docs: PushedDoc[], moves: StockMove[], db: Firestore): Promise<number> {
  const base = { deviceId: device.id, hubName: device.name, branch: device.branch, status: 'waiting' satisfies HeldStatus, decidedBy: null, decidedByEmail: null, decidedAt: null }
  let held = 0
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch()
    for (const raw of docs.slice(i, i + 400)) {
      if (raw.collection === 'activityLog') {
        batch.set(db.doc(`${raw.collection}/${raw.id}`), { ...(decode(raw.data, reviver(db)) as Record<string, unknown>), hubId: device.id, branch: device.branch })
        continue
      }
      // A clock-in (UPGRADE.md T3.12) is a record of who was at work, not
      // trading: it moves no money and has no online version to disagree
      // with, so it is written as it stands, never held for a manager.
      if (raw.collection === 'timeEntries') {
        batch.set(db.doc(`${raw.collection}/${raw.id}`), decode(raw.data, reviver(db)) as Record<string, unknown>)
        continue
      }
      batch.set(db.doc(`${HELD_ITEMS}/${heldDocId(device.id, raw.collection, raw.id)}`), {
        ...base, kind: 'doc', collection: raw.collection, docId: raw.id, data: raw.data, move: null,
        summary: heldSummary(raw.collection, raw.data), heldAt: FieldValue.serverTimestamp(),
      })
      held++
    }
    await batch.commit()
  }
  for (const move of moves) {
    const item = db.doc(`${HELD_ITEMS}/${heldMoveId(device.id, move.id)}`)
    const marker = db.doc(`${APPLIED_MOVES}/${device.id}_${move.id}`)
    const [itemSnap, markerSnap] = await db.getAll(item, marker)
    if (itemSnap.exists || markerSnap.exists) continue
    await item.create({
      ...base, kind: 'move', collection: move.collection, docId: move.docId, data: null,
      move: { id: move.id, collection: move.collection, docId: move.docId, branch: move.branch, delta: move.delta },
      summary: heldSummary(move.collection, null, move), heldAt: FieldValue.serverTimestamp(),
    })
    held++
  }
  return held
}

/**
 * Takes in what a hub sends up (owner's decision S8): its checks, tickets,
 * shifts, drawer and activity as they stand, and its stock movements.
 *
 * All or nothing: one refused item refuses the request and names it, so the
 * hub never moves its place in the change log past something the cloud did
 * not take. Documents are written as the hub has them — it is master for its
 * branch's trading, and the online POS for that branch is view-only (S10). A
 * movement is applied once however often it arrives: a marker per movement is
 * created in the same transaction as its increment. A movement for a product
 * or supply the cloud no longer has is marked and skipped, never allowed to
 * stop the rest.
 *
 * `db` is where the data goes, a parameter so verify:hub-sync can send into a
 * second database; the hub's own record stays in the cloud's.
 */
export async function applyPush(device: HubDevice, body: unknown, db: Firestore = adminDb()): Promise<PushResult> {
  const b = (body ?? {}) as { docs?: unknown; moves?: unknown; seq?: unknown }
  const docs = Array.isArray(b.docs) ? b.docs : []
  const moves = Array.isArray(b.moves) ? b.moves : []
  const seq = Number(b.seq)
  if (!Number.isInteger(seq) || seq < 0) throw new HttpError(400, 'A push says how far the hub has sent up to.')
  if (docs.length + moves.length > 2 * PUSH_BATCH) throw new HttpError(413, 'Too much in one push.')
  for (const doc of docs) {
    const problem = pushProblem(doc, device.branch)
    if (problem) throw new HttpError(400, problem)
  }
  for (const move of moves) {
    const problem = moveProblem(move, device.branch)
    if (problem) throw new HttpError(400, problem)
  }

  if (device.onlineSince != null) {
    const held = await holdPush(device, docs as PushedDoc[], moves as StockMove[], db)
    await adminDb().doc(`${DEVICES}/${device.id}`).update({ pushedSeq: seq, lastPushAt: FieldValue.serverTimestamp() })
    return { docs: 0, moves: 0, movesAlreadyApplied: 0, held, tradingOnline: true, seq }
  }

  const revive = reviver(db)
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch()
    for (const raw of docs.slice(i, i + 400) as PushedDoc[]) {
      const data = decode(raw.data, revive) as Record<string, unknown>
      // An activity entry says which hub it came from, since its author signed in there.
      batch.set(db.doc(`${raw.collection}/${raw.id}`), raw.collection === 'activityLog'
        ? { ...data, hubId: device.id, branch: device.branch }
        : data)
    }
    await batch.commit()
  }

  let applied = 0
  let already = 0
  for (const move of moves as StockMove[]) {
    const marker = db.doc(`${APPLIED_MOVES}/${device.id}_${move.id}`)
    const target = db.doc(`${move.collection}/${move.docId}`)
    const outcome = await db.runTransaction(async tx => {
      const [markerSnap, targetSnap] = await tx.getAll(marker, target)
      if (markerSnap.exists) return 'already'
      tx.create(marker, {
        deviceId: device.id, branch: device.branch, collection: move.collection, docId: move.docId,
        delta: move.delta, applied: targetSnap.exists, at: FieldValue.serverTimestamp(),
      })
      if (targetSnap.exists) tx.update(target, { [moveField(move)]: FieldValue.increment(move.delta) })
      return 'applied'
    })
    if (outcome === 'applied') applied++
    else already++
  }

  await adminDb().doc(`${DEVICES}/${device.id}`).update({ pushedSeq: seq, lastPushAt: FieldValue.serverTimestamp() })
  return { docs: docs.length, moves: applied, movesAlreadyApplied: already, held: 0, tradingOnline: false, seq }
}

export interface HeldItemRow {
  id: string
  deviceId: string
  hubName: string
  branch: string
  kind: 'doc' | 'move'
  collection: string
  docId: string
  /** What the counter PC sent up, in one line. */
  summary: string
  /** The same document as the cloud has it now, in one line, or null when the cloud has none. Null for a movement. */
  cloudNow: string | null
  heldAt: number | null
  status: HeldStatus
  decidedByEmail: string
  decidedAt: number | null
}

/** What hubs sent up while their branch traded online, newest first, for the managers deciding it (S22). */
export async function listHeldItems(db: Firestore = adminDb()): Promise<HeldItemRow[]> {
  const snap = await db.collection(HELD_ITEMS).orderBy('heldAt', 'desc').limit(300).get()
  const rows = snap.docs.map(doc => ({ doc, d: doc.data() ?? {} }))
  const targets = rows.filter(r => r.d.kind === 'doc').map(r => db.doc(`${String(r.d.collection)}/${String(r.d.docId)}`))
  const now = new Map<string, Record<string, unknown> | null>()
  if (targets.length > 0) {
    for (const snapNow of await db.getAll(...targets)) now.set(snapNow.ref.path, snapNow.exists ? snapNow.data() ?? {} : null)
  }
  return rows.map(({ doc, d }) => {
    const collection = String(d.collection ?? '')
    const docId = String(d.docId ?? '')
    const current = d.kind === 'doc' ? now.get(`${collection}/${docId}`) ?? null : null
    const status: HeldStatus = d.status === 'applied' || d.status === 'dismissed' ? d.status : 'waiting'
    return {
      id: doc.id,
      deviceId: String(d.deviceId ?? ''),
      hubName: String(d.hubName ?? ''),
      branch: String(d.branch ?? ''),
      kind: d.kind === 'move' ? 'move' : 'doc',
      collection,
      docId,
      summary: String(d.summary ?? ''),
      cloudNow: current ? heldSummary(collection, current) : null,
      heldAt: timestampMs(d.heldAt, 0) || null,
      status,
      decidedByEmail: String(d.decidedByEmail ?? ''),
      decidedAt: timestampMs(d.decidedAt, 0) || null,
    }
  })
}

/**
 * A manager's decision on one held item (S22). Apply writes the counter PC's
 * version of the document over the cloud's, or applies the movement once, as a
 * push would have. Dismiss leaves the cloud as it is. Either way it is decided
 * once: a second decision is refused. A manager decides only for their own
 * branches; an admin for any.
 */
export async function decideHeldItem(
  caller: Caller,
  rawId: unknown,
  rawDecision: unknown,
  db: Firestore = adminDb(),
): Promise<{ id: string; decision: 'apply' | 'dismiss'; branch: string; hubName: string; summary: string }> {
  const id = typeof rawId === 'string' && rawId.length <= 400 && /^[A-Za-z0-9_\-.:@+~]+$/.test(rawId) ? rawId : ''
  if (!id) throw new HttpError(400, 'Missing item.')
  if (!isHeldDecision(rawDecision)) throw new HttpError(400, 'Apply or dismiss.')
  const ref = db.doc(`${HELD_ITEMS}/${id}`)
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const d = snap.data()
    if (!d) throw new HttpError(404, 'That item is not there.')
    const branch = String(d.branch ?? '')
    const everywhere = caller.role === 'admin' || caller.superadmin
    if (!everywhere && !(caller.branchIds ?? []).includes(branch)) throw new HttpError(403, `Only a manager at ${branch} or an admin decides this.`)
    if (d.status !== 'waiting') throw new HttpError(409, 'Somebody has already decided this one.')
    const out = { id, decision: rawDecision, branch, hubName: String(d.hubName ?? ''), summary: String(d.summary ?? '') }

    if (rawDecision === 'apply' && d.kind === 'move') {
      const move = d.move as StockMove
      const problem = moveProblem(move, branch)
      if (problem) throw new HttpError(400, problem)
      const marker = db.doc(`${APPLIED_MOVES}/${String(d.deviceId)}_${move.id}`)
      const target = db.doc(`${move.collection}/${move.docId}`)
      const [markerSnap, targetSnap] = await tx.getAll(marker, target)
      if (!markerSnap.exists) {
        tx.create(marker, {
          deviceId: String(d.deviceId), branch, collection: move.collection, docId: move.docId,
          delta: move.delta, applied: targetSnap.exists, at: FieldValue.serverTimestamp(), heldItem: id,
        })
        if (targetSnap.exists) tx.update(target, { [moveField(move)]: FieldValue.increment(move.delta) })
      }
    } else if (rawDecision === 'apply') {
      const pushed = { collection: String(d.collection ?? ''), id: String(d.docId ?? ''), data: d.data as Record<string, unknown> | null }
      const problem = pushProblem(pushed, branch)
      if (problem) throw new HttpError(400, problem)
      tx.set(db.doc(`${pushed.collection}/${pushed.id}`), decode(pushed.data, reviver(db)) as Record<string, unknown>)
    }
    tx.update(ref, {
      status: (rawDecision === 'apply' ? 'applied' : 'dismissed') satisfies HeldStatus,
      decidedBy: caller.uid,
      decidedByEmail: caller.email ?? '',
      decidedAt: FieldValue.serverTimestamp(),
    })
    return out
  })
}

// Firestore's values, tagged as a backup line tags them, so the hub gets a
// Timestamp back as a Timestamp.
const classify: Classify = value => {
  if (value instanceof Timestamp) return { kind: 'ts', data: { s: value.seconds, n: value.nanoseconds } }
  if (value instanceof GeoPoint) return { kind: 'geo', data: { lat: value.latitude, lng: value.longitude } }
  if (value instanceof DocumentReference) return { kind: 'ref', data: { path: value.path } }
  if (Buffer.isBuffer(value)) return { kind: 'bytes', data: { b64: value.toString('base64') } }
  if (value && typeof value === 'object' && typeof (value as { path?: unknown }).path === 'string'
    && typeof (value as { firestore?: unknown }).firestore === 'object') {
    // A reference from something Firestore-shaped that is not the Admin SDK's own class.
    return { kind: 'ref', data: { path: (value as { path: string }).path } }
  }
  return null
}

/**
 * A snapshot as it goes over the wire, in a fixed order, and a digest of it.
 * A hub that sends the digest it last took in is told "unchanged" rather than
 * sent the menu again every two minutes.
 */
export function encodeSnapshot(docs: readonly PulledDoc[]): { docs: { collection: string; id: string; data: unknown }[]; digest: string } {
  const ordered = [...docs].sort((a, b) =>
    a.collection === b.collection ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.collection < b.collection ? -1 : 1)
  const encoded = ordered.map(d => ({ collection: d.collection, id: d.id, data: encode(d.data, classify) }))
  return { docs: encoded, digest: sha256(stable(encoded)) }
}
