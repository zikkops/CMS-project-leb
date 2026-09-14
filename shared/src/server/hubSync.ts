// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The café hub's side of the cloud — POS software, stage 4: pairing, and
// pulling what the cloud is master for. What to pull and how to take it in is
// shared/src/hubSync.ts; the cloud's side is hubDevices.ts.
//
// The hub's credential lives in its own database (hubMeta/device), a file on
// the counter PC. It opens this hub's pulls and nothing else, and an admin
// takes it away from Settings → Café Hubs when a PC walks out of the building.
//
// Pulls run every two minutes from the server's start (pos/instrumentation.ts),
// and straight after pairing. Nothing waits on one: a till keeps trading on
// what the hub already holds, and a failed pull is shown on the hub's page.

import { Timestamp } from 'firebase-admin/firestore'
import { adminDb, hubDbPath } from './firebaseAdmin'
import { HttpError } from './auth'
import { encodeHubValue, type HubStore } from './hubStore'
import { stable } from '../backupCodec'
import { BRANCHES } from '../branches'
import { timestampMs } from '../timestamps'
import { deviceAuthHeader, normalizePairingCode, planPull, pullSpec, type PulledDoc } from '../hubSync'

const DEVICE_DOC = 'hubMeta/device'
const PULL_DOC = 'hubMeta/pull'
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
}

interface SyncState {
  lastPullAt: number | null
  lastChanged: number
  lastError: string | null
  running: boolean
}

// On globalThis, as the hub's database handle is: a dev server can load this
// module more than once, and one process has one sync.
function syncState(): SyncState {
  const g = globalThis as { __bigCmsHubSyncState?: SyncState }
  g.__bigCmsHubSyncState ??= { lastPullAt: null, lastChanged: 0, lastError: null, running: false }
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

/** Pairs this hub with the cloud using a code from Settings → Café Hubs, then takes a first snapshot. */
export async function pairHub(rawCode: unknown, fetchImpl: Fetch = fetch): Promise<HubPairing> {
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
  void pullFromCloud(fetchImpl).catch(() => { /* shown on the hub's page */ })
  return { deviceId: body.deviceId, branch: body.branch, name: String(body.name ?? ''), pairedAt, cloudUrl, revoked: false }
}

/**
 * Takes a snapshot from the cloud into a hub's store, in one commit.
 * The store is a parameter so verify:hub-sync can take one into a second
 * database; the hub passes its own.
 */
export async function applySnapshot(
  store: HubStore,
  branch: string,
  docs: readonly { collection: string; id: string; data: unknown }[],
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
  const writes = planPull(spec, local, snapshot, same)
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
    const last = (await db.doc(PULL_DOC).get()).data()?.digest
    const url = `${credential.cloudUrl}/api/hub-sync/pull${typeof last === 'string' ? `?digest=${encodeURIComponent(last)}` : ''}`
    const { status, body } = await cloudFetch(fetchImpl, url, {
      headers: { Authorization: deviceAuthHeader(credential.deviceId, credential.secret) },
    })
    if (status === 401) {
      // Only a credential the cloud refuses gets a 401 from that route: kept
      // as unpaired, so the page says so and the hub stops asking every two minutes in vain.
      await db.doc(DEVICE_DOC).update({ revoked: true })
      throw new HttpError(409, typeof body.error === 'string' ? body.error : 'The cloud no longer accepts this hub. Pair it again.')
    }
    if (status !== 200) throw new HttpError(502, typeof body.error === 'string' ? body.error : `The cloud answered ${status}.`)

    let result = { unchanged: true, written: 0, deleted: 0 }
    if (body.unchanged !== true) {
      const docs = Array.isArray(body.docs) ? body.docs as { collection: string; id: string; data: unknown }[] : []
      result = { unchanged: false, ...(await applySnapshot(db as unknown as HubStore, credential.branch, docs)) }
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

/** Starts pulling every two minutes. Once per process; nothing on a server that is not a hub. */
export function startHubSync(fetchImpl: Fetch = fetch): void {
  if (!hubDbPath()) return
  const g = globalThis as { __bigCmsHubSyncStarted?: boolean }
  if (g.__bigCmsHubSyncStarted) return
  g.__bigCmsHubSyncStarted = true
  const tick = async () => {
    try {
      if (await readCredential()) await pullFromCloud(fetchImpl)
    } catch { /* recorded in the status */ }
    setTimeout(tick, PULL_EVERY_MS).unref?.()
  }
  setTimeout(tick, 3_000).unref?.()
}

/** What the hub's page shows. Never the secret. */
export async function hubSyncStatus(): Promise<HubSyncStatus> {
  hubOnly()
  const pairing = await readPairing()
  const state = syncState()
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
  }
}
