// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The café hub's side of the cloud — POS software, stage 4: pairing, sending
// its trading up, pulling what the cloud is master for, and fetching receipt
// number blocks. The rules are shared/src/hubSync.ts (pairing, pulling),
// shared/src/hubPush.ts (sending up) and shared/src/receiptBlocks.ts; the
// cloud's side is hubDevices.ts.
//
// The hub's credential lives in its own database (hubMeta/device), a file on
// the counter PC. It opens this hub's sync and nothing else, and an admin
// takes it away from Settings → Café Hubs when a PC walks out of the building.
//
// Sync runs every two minutes from the server's start (pos/instrumentation.ts),
// and straight after pairing: send up, then pull, then receipt numbers. Sending
// first means a pull finds the hub's stock movements already in the cloud's
// count. Nothing waits on sync: a till keeps trading on what the hub holds,
// and each failure is shown on the hub's page.

import { Timestamp } from 'firebase-admin/firestore'
import { adminDb, hubDbPath } from './firebaseAdmin'
import { networkInterfaces } from 'node:os'
import { hubLink, lanAddresses, normalizeFingerprint, type NetInterface } from '../hubNetwork'
import { HttpError } from './auth'
import { encodeHubValue, type HubStore } from './hubStore'
import { stable } from '../backupCodec'
import { BRANCHES } from '../branches'
import { invoicePeriod } from '../invoiceFormat'
import { timestampMs } from '../timestamps'
import { deviceAuthHeader, normalizePairingCode, planPull, pullSpec, type PulledDoc } from '../hubSync'
import { MOVES_COLLECTION, PUSHED_COLLECTIONS, PUSH_BATCH, type PushedDoc, type StockMove } from '../hubPush'
import { addBlock, needsReceipts, readBlocks, receiptsLeft } from '../receiptBlocks'

const DEVICE_DOC = 'hubMeta/device'
const PULL_DOC = 'hubMeta/pull'
const RECEIPTS_DOC = 'hubMeta/receipts'
const PUSHED_UP_TO = 'pushedSeq'
export const PULL_EVERY_MS = 2 * 60_000

type Fetch = typeof fetch

/**
 * Where the cloud is: an https origin, or http on this machine for
 * development. Only the origin is kept, so a path in the setting cannot send a
 * hub's credential to some other route.
 */
export function cloudBaseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let url: URL
  try { url = new URL(raw.trim()) } catch { return null }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.origin
  return null
}

export interface HubPairing {
  deviceId: string
  branch: string
  name: string
  pairedAt: number
  cloudUrl: string
  revoked: boolean
}

export interface HubSyncStatus {
  paired: boolean
  revoked: boolean
  branch: string | null
  name: string | null
  pairedAt: number | null
  cloudConfigured: boolean
  lastPullAt: number | null
  lastChanged: number
  lastError: string | null
  /** Receipt numbers left for this café year. */
  receiptsLeft: number
  receiptError: string | null
  lastPushAt: number | null
  pushError: string | null
  /** Stock movements the cloud does not have yet. */
  movesWaiting: number
  /** Where phones on the café wifi reach this hub, encrypted (S11), or null while that is off. */
  lan: HubLan | null
}

export interface HubLan {
  port: number
  fingerprint: string
  addresses: string[]
  /** What the counter screen's QR says, one per address. */
  links: string[]
}

/**
 * The encrypted door the Windows app put in front of this hub (desktop/hubLan.js),
 * from what it passed in the environment. Null when it did not: the hub is then
 * on this PC only.
 */
export function hubLanStatus(
  env: Record<string, string | undefined> = process.env,
  interfaces: Record<string, NetInterface[] | undefined> = networkInterfaces(),
): HubLan | null {
  const port = Number(env.BIG_CMS_HUB_LAN_PORT)
  const fingerprint = env.BIG_CMS_HUB_CERT_SHA256 ?? ''
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !normalizeFingerprint(fingerprint)) return null
  const addresses = lanAddresses(interfaces, port)
  const links = addresses.map(a => hubLink(a, fingerprint)).filter((l): l is string => l !== null)
  return { port, fingerprint, addresses, links }
}

interface SyncState {
  lastPullAt: number | null
  lastChanged: number
  lastError: string | null
  receiptError: string | null
  lastPushAt: number | null
  pushError: string | null
  running: boolean
  pushing: boolean
}

// On globalThis, as the hub's database handle is: a dev server can load this
// module more than once, and one process has one sync.
function syncState(): SyncState {
  const g = globalThis as { __bigCmsHubSyncState?: SyncState }
  g.__bigCmsHubSyncState ??= {
    lastPullAt: null, lastChanged: 0, lastError: null, receiptError: null,
    lastPushAt: null, pushError: null, running: false, pushing: false,
  }
  return g.__bigCmsHubSyncState
}

function hubOnly(): void {
  if (!hubDbPath()) throw new HttpError(404, 'Not found.')
}

async function readCredential(): Promise<(HubPairing & { secret: string }) | null> {
  const d = (await adminDb().doc(DEVICE_DOC).get()).data()
  if (!d || typeof d.deviceId !== 'string' || typeof d.secret !== 'string' || typeof d.cloudUrl !== 'string') return null
  return {
    deviceId: d.deviceId,
    secret: d.secret,
    branch: String(d.branch ?? ''),
    name: String(d.name ?? ''),
    pairedAt: timestampMs(d.pairedAt, 0),
    cloudUrl: d.cloudUrl,
    revoked: d.revoked === true,
  }
}

/** This hub's pairing, without its secret. */
export async function readPairing(): Promise<HubPairing | null> {
  const credential = await readCredential()
  if (!credential) return null
  const { secret: _secret, ...pairing } = credential
  return pairing
}

async function cloudFetch(fetchImpl: Fetch, url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: Response
  try {
    res = await fetchImpl(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(30_000) })
  } catch {
    throw new HttpError(503, 'The hub could not reach the cloud. This needs the internet; the till keeps working without it.')
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  return { status: res.status, body }
}

/**
 * Pairs this hub with the cloud using a code from Settings → Café Hubs, then
 * syncs straight away. `followUp` false leaves that to the caller
 * (verify:hub-sync does it step by step).
 */
export async function pairHub(rawCode: unknown, fetchImpl: Fetch = fetch, followUp = true): Promise<HubPairing> {
  hubOnly()
  const existing = await readCredential()
  if (existing && !existing.revoked) throw new HttpError(409, `This hub is already paired, for ${existing.branch}.`)
  const code = normalizePairingCode(rawCode)
  if (!code) throw new HttpError(400, 'That is not a pairing code. It is ten letters and numbers, like ABCDE-FGH23.')
  const cloudUrl = cloudBaseUrl(process.env.BIG_CMS_CLOUD_URL)
  if (!cloudUrl) throw new HttpError(503, 'This hub does not know where the cloud is. The Windows app sets that when it starts the hub.')

  const { status, body } = await cloudFetch(fetchImpl, `${cloudUrl}/api/hub-sync/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (status !== 200 || typeof body.deviceId !== 'string' || typeof body.secret !== 'string' || typeof body.branch !== 'string') {
    throw new HttpError(status >= 400 && status < 500 ? 400 : 502,
      typeof body.error === 'string' ? body.error : 'The cloud did not pair this hub.')
  }
  if (!(BRANCHES as readonly string[]).includes(body.branch)) {
    throw new HttpError(502, `The cloud paired this hub for "${body.branch}", a branch this version of the POS does not have.`)
  }

  const pairedAt = Date.now()
  const db = adminDb()
  await db.doc(DEVICE_DOC).set({
    deviceId: body.deviceId,
    secret: body.secret,
    branch: body.branch,
    name: String(body.name ?? ''),
    cloudUrl,
    pairedAt: Timestamp.fromMillis(pairedAt),
    revoked: false,
  })
  // A new pairing takes a whole snapshot, whatever was pulled before it.
  await db.doc(PULL_DOC).set({ digest: null })
  if (followUp) void syncOnce(fetchImpl)
  return { deviceId: body.deviceId, branch: body.branch, name: String(body.name ?? ''), pairedAt, cloudUrl, revoked: false }
}

// ── Sending the hub's trading up ───────────────────────────────────────────

/**
 * The next batch to send up from a store's change log after `fromSeq`: every
 * document the hub is master for, as it stands now, and every stock movement
 * still waiting. `toSeq` is how far the batch covers, including changes with
 * nothing to send (a pull's writes, a session), so the hub moves past them.
 */
export async function collectPush(
  store: HubStore,
  fromSeq: number,
): Promise<{ docs: PushedDoc[]; moves: StockMove[]; toSeq: number }> {
  const changes = store.changesSince(fromSeq, PUSH_BATCH)
  if (changes.length === 0) return { docs: [], moves: [], toSeq: fromSeq }
  const docs: PushedDoc[] = []
  const moves: StockMove[] = []
  const seen = new Set<string>()
  for (const change of changes) {
    if (change.deleted || seen.has(change.path)) continue
    seen.add(change.path)
    if ((PUSHED_COLLECTIONS as readonly string[]).includes(change.collection)) {
      const snap = await store.doc(change.path).get()
      if (snap.exists) docs.push({ collection: change.collection, id: change.id, data: encodeHubValue(snap.data()) as Record<string, unknown> })
    } else if (change.collection === MOVES_COLLECTION) {
      const d = (await store.doc(change.path).get()).data()
      if (d) moves.push({ id: change.id, collection: String(d.collection), docId: String(d.docId), branch: String(d.branch), delta: Number(d.delta) })
    }
  }
  return { docs, moves, toSeq: changes[changes.length - 1].seq }
}

/**
 * Sends everything the cloud does not have yet, batch by batch, and moves the
 * hub's place in its change log only after the cloud answers. A batch the
 * cloud refuses stops the sending and is shown on the hub's page; it is sent
 * again next time, never skipped.
 */
export async function pushToCloud(fetchImpl: Fetch = fetch): Promise<{ docs: number; moves: number }> {
  hubOnly()
  const state = syncState()
  if (state.pushing) return { docs: 0, moves: 0 }
  state.pushing = true
  try {
    const credential = await readCredential()
    if (!credential || credential.revoked) return { docs: 0, moves: 0 }
    const store = adminDb() as unknown as HubStore
    let sentDocs = 0
    let sentMoves = 0
    for (let round = 0; round < 100; round++) {
      const from = Number(store.readMeta(PUSHED_UP_TO) ?? 0)
      const batch = await collectPush(store, from)
      if (batch.toSeq === from) break
      if (batch.docs.length > 0 || batch.moves.length > 0) {
        const { status, body } = await cloudFetch(fetchImpl, `${credential.cloudUrl}/api/hub-sync/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: deviceAuthHeader(credential.deviceId, credential.secret) },
          body: JSON.stringify({ seq: batch.toSeq, docs: batch.docs, moves: batch.moves }),
        })
        if (status !== 200) {
          throw new HttpError(502, typeof body.error === 'string' ? body.error : `The cloud answered ${status} when sent this hub's trading.`)
        }
        // The cloud has these movements now, so a pull may take its count back.
        if (batch.moves.length > 0) {
          const done = store.batch()
          for (const move of batch.moves) done.delete(store.doc(`${MOVES_COLLECTION}/${move.id}`))
          await done.commit()
        }
        sentDocs += batch.docs.length
        sentMoves += batch.moves.length
      }
      store.writeMeta(PUSHED_UP_TO, String(batch.toSeq))
    }
    state.lastPushAt = Date.now()
    state.pushError = null
    return { docs: sentDocs, moves: sentMoves }
  } catch (err) {
    state.pushError = err instanceof HttpError ? err.message : 'Sending to the cloud failed. The hub log has the details.'
    if (!(err instanceof HttpError)) console.error('[hub] sending to the cloud failed:', err)
    throw err
  } finally {
    state.pushing = false
  }
}

// ── Pulling what the cloud is master for ───────────────────────────────────

/**
 * Takes a snapshot from the cloud into a hub's store, in one commit. A
 * product's count stays the hub's only while `pending` names it: it has stock
 * movements the cloud does not have yet (S8). The store is a parameter so
 * verify:hub-sync can take one into a second database; the hub passes its own.
 */
export async function applySnapshot(
  store: HubStore,
  branch: string,
  docs: readonly { collection: string; id: string; data: unknown }[],
  pending?: ReadonlySet<string>,
): Promise<{ written: number; deleted: number }> {
  const spec = pullSpec(branch)
  const local = new Map<string, Record<string, unknown>>()
  for (const s of spec) {
    for (const doc of (await store.collection(s.collection).get()).docs) {
      local.set(`${s.collection}/${doc.id}`, doc.data() ?? {})
    }
  }
  const snapshot: PulledDoc[] = docs.map(d => ({
    collection: String(d.collection),
    id: String(d.id),
    data: store.decodeValue(d.data) as Record<string, unknown>,
  }))
  // Compared as they would be stored, so two Timestamps for one instant are the same.
  const same = (a: unknown, b: unknown) => stable(encodeHubValue(a)) === stable(encodeHubValue(b))
  const holdLocal = pending ? (collection: string, id: string) => pending.has(`${collection}/${id}`) : undefined
  const writes = planPull(spec, local, snapshot, same, holdLocal)
  if (writes.length === 0) return { written: 0, deleted: 0 }

  const batch = store.batch()
  for (const w of writes) {
    const ref = store.doc(`${w.collection}/${w.id}`)
    if (w.kind === 'set') batch.set(ref, w.data)
    else batch.delete(ref)
  }
  await batch.commit()
  return {
    written: writes.filter(w => w.kind === 'set').length,
    deleted: writes.filter(w => w.kind === 'delete').length,
  }
}

/** Which products and supplies have stock movements the cloud does not have yet. */
export async function pendingStock(store: HubStore): Promise<Set<string>> {
  const waiting = (await store.collection(MOVES_COLLECTION).get()).docs
  return new Set(waiting.map(d => `${String(d.data()?.collection)}/${String(d.data()?.docId)}`))
}

/** One pull: the snapshot, unless the cloud says it is unchanged since the last. */
export async function pullFromCloud(fetchImpl: Fetch = fetch): Promise<{ unchanged: boolean; written: number; deleted: number }> {
  hubOnly()
  const state = syncState()
  if (state.running) return { unchanged: true, written: 0, deleted: 0 }
  state.running = true
  try {
    const credential = await readCredential()
    if (!credential) throw new HttpError(409, 'This hub is not paired yet.')
    if (credential.revoked) throw new HttpError(409, 'An admin unpaired this hub. Pair it again with a new code.')

    const db = adminDb()
    const store = db as unknown as HubStore
    const last = (await db.doc(PULL_DOC).get()).data()?.digest
    const url = `${credential.cloudUrl}/api/hub-sync/pull${typeof last === 'string' ? `?digest=${encodeURIComponent(last)}` : ''}`
    const { status, body } = await cloudFetch(fetchImpl, url, {
      headers: { Authorization: deviceAuthHeader(credential.deviceId, credential.secret) },
    })
    if (status === 401) {
      // Only a credential the cloud refuses gets a 401 from that route: kept
      // as unpaired, so the page says so and the hub stops asking in vain.
      await db.doc(DEVICE_DOC).update({ revoked: true })
      throw new HttpError(409, typeof body.error === 'string' ? body.error : 'The cloud no longer accepts this hub. Pair it again.')
    }
    if (status !== 200) throw new HttpError(502, typeof body.error === 'string' ? body.error : `The cloud answered ${status}.`)

    let result = { unchanged: true, written: 0, deleted: 0 }
    if (body.unchanged !== true) {
      const docs = Array.isArray(body.docs) ? body.docs as { collection: string; id: string; data: unknown }[] : []
      result = { unchanged: false, ...(await applySnapshot(store, credential.branch, docs, await pendingStock(store))) }
      if (typeof body.digest === 'string') await db.doc(PULL_DOC).set({ digest: body.digest, pulledAt: Timestamp.now() })
    }
    state.lastPullAt = Date.now()
    state.lastChanged = result.written + result.deleted
    state.lastError = null
    return result
  } catch (err) {
    state.lastError = err instanceof HttpError ? err.message : 'The last pull failed. The hub log has the details.'
    if (!(err instanceof HttpError)) console.error('[hub] a pull from the cloud failed:', err)
    throw err
  } finally {
    state.running = false
  }
}

// ── Receipt numbers ────────────────────────────────────────────────────────

/**
 * Fetches a block of receipt numbers when fewer than RECEIPT_REFILL_AT are
 * left for this café year (owner's decision S9), while the hub is online.
 * Nothing when it has enough, or is not paired.
 */
export async function refillReceipts(fetchImpl: Fetch = fetch, now = new Date()): Promise<{ added: boolean; left: number }> {
  hubOnly()
  const state = syncState()
  const db = adminDb()
  const { year } = invoicePeriod(now)
  const held = readBlocks((await db.doc(RECEIPTS_DOC).get()).data()?.blocks)
  const left = receiptsLeft(held, year)
  try {
    const credential = await readCredential()
    if (!credential || credential.revoked || !needsReceipts(held, year)) return { added: false, left }
    const { status, body } = await cloudFetch(fetchImpl, `${credential.cloudUrl}/api/hub-sync/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: deviceAuthHeader(credential.deviceId, credential.secret) },
      body: JSON.stringify({ have: left }),
    })
    if (status !== 200) {
      throw new HttpError(502, typeof body.error === 'string' ? body.error : `The cloud answered ${status} when asked for receipt numbers.`)
    }
    const [block] = readBlocks([{ year: body.year, first: body.first, last: body.last, next: body.next }])
    if (!block || block.year !== year || block.next !== block.first) {
      throw new HttpError(502, 'The cloud sent receipt numbers this hub cannot use.')
    }
    const total = await db.runTransaction(async tx => {
      const ref = db.doc(RECEIPTS_DOC)
      const blocks = addBlock(readBlocks((await tx.get(ref)).data()?.blocks), block)
      tx.set(ref, { blocks }, { merge: true })
      return receiptsLeft(blocks, year)
    })
    state.receiptError = null
    return { added: true, left: total }
  } catch (err) {
    state.receiptError = err instanceof HttpError ? err.message : 'Fetching receipt numbers failed. The hub log has the details.'
    if (!(err instanceof HttpError)) console.error('[hub] fetching receipt numbers failed:', err)
    throw err
  }
}

/** Send up, pull, then receipt numbers. Each failure is recorded on its own and stops nothing else. */
export async function syncOnce(fetchImpl: Fetch = fetch): Promise<void> {
  try { await pushToCloud(fetchImpl) } catch { /* recorded in the status */ }
  try { await pullFromCloud(fetchImpl) } catch { /* recorded in the status */ }
  try { await refillReceipts(fetchImpl) } catch { /* recorded in the status */ }
}

/** Starts syncing every two minutes. Once per process; nothing on a server that is not a hub. */
export function startHubSync(fetchImpl: Fetch = fetch): void {
  if (!hubDbPath()) return
  const g = globalThis as { __bigCmsHubSyncStarted?: boolean }
  if (g.__bigCmsHubSyncStarted) return
  g.__bigCmsHubSyncStarted = true
  const tick = async () => {
    try {
      if (await readCredential()) await syncOnce(fetchImpl)
    } catch { /* recorded in the status */ }
    setTimeout(tick, PULL_EVERY_MS).unref?.()
  }
  setTimeout(tick, 3_000).unref?.()
}

/** What the hub's page shows. Never the secret. */
export async function hubSyncStatus(now = new Date()): Promise<HubSyncStatus> {
  hubOnly()
  const pairing = await readPairing()
  const state = syncState()
  const db = adminDb()
  const blocks = readBlocks((await db.doc(RECEIPTS_DOC).get()).data()?.blocks)
  const waiting = (await db.collection(MOVES_COLLECTION).get()).size
  return {
    paired: Boolean(pairing),
    revoked: pairing?.revoked ?? false,
    branch: pairing?.branch ?? null,
    name: pairing?.name ?? null,
    pairedAt: pairing?.pairedAt ?? null,
    cloudConfigured: Boolean(cloudBaseUrl(process.env.BIG_CMS_CLOUD_URL)),
    lastPullAt: state.lastPullAt,
    lastChanged: state.lastChanged,
    lastError: state.lastError,
    receiptsLeft: receiptsLeft(blocks, invoicePeriod(now).year),
    receiptError: state.receiptError,
    lastPushAt: state.lastPushAt,
    pushError: state.pushError,
    movesWaiting: waiting,
    lan: hubLanStatus(),
  }
}
