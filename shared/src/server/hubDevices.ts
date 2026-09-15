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

const DEVICES = 'hubDevices'
const CODES = 'hubPairingCodes'
const RECEIPT_BLOCKS = 'hubReceiptBlocks'
const APPLIED_MOVES = 'hubAppliedMoves'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export interface HubDevice {
  id: string
  branch: string
  name: string
}

export interface HubDeviceRow extends HubDevice {
  pairedAt: number | null
  pairedByEmail: string
  lastSeenAt: number | null
  revoked: boolean
  revokedAt: number | null
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
  return { id: snap.id, branch: String(d.branch), name: String(d.name ?? '') }
}

/** Every hub, for the admin panel. Never a secret or its hash. */
export async function listDevices(): Promise<HubDeviceRow[]> {
  const snap = await adminDb().collection(DEVICES).orderBy('pairedAt', 'desc').get()
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
    }
  })
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
      for (const doc of staff.docs) {
        const record = staffRecord(doc.data() ?? {})
        if (record) {
          docs.push({ collection: 'users', id: doc.id, data: record })
          staffIds.add(doc.id)
        }
      }
    } else if (spec.collection === STAFF_KEYS) {
      // Keys still in use, of people still staff: a leaver's phone signs nobody in.
      const keys = await db.collection(STAFF_KEYS).where('revokedAt', '==', null).get()
      for (const doc of keys.docs) {
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
  seq: number
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

  const revive: Revive = (kind, data) => {
    switch (kind) {
      case 'ts': return new Timestamp(Number(data.s), Number(data.n))
      case 'geo': return new GeoPoint(Number(data.lat), Number(data.lng))
      case 'ref': return db.doc(String(data.path))
      case 'bytes': return Buffer.from(String(data.b64), 'base64')
      default: throw new HttpError(400, `A value of unknown kind "${kind}".`)
    }
  }

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
  return { docs: docs.length, moves: applied, movesAlreadyApplied: already, seq }
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
