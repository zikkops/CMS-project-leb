'use client'

// The hub backend — software mode, POS software stage 3.
//
// On a café hub the till's data lives on the counter PC. Who is signed in is a
// hub session: today's Firebase sign-in, checked once by the hub and good until
// the end of the night (shared/src/hubSession.ts), until phone sign-in replaces
// it in stage 5. Writes go to the same routes as online.
//
// Live queries are ONE change feed per screen (/api/hub/changes) plus a plain
// request per query (/api/hub/query), asked again when the feed says a write
// touched it. Not a stream per query: a browser allows six connections to one
// address over plain HTTP, and the floor alone watches seven things — the
// seventh stream, and every write after it, waited forever. See the changes
// route for the story.
//
// The session is kept in localStorage. It has to survive a reload, and a reload
// in the middle of an outage has no Firebase to ask. It is only good on this
// hub, and only until the night ends.

import { decode, type Revive } from '@big-cms/shared/backupCodec'
import { NetworkError } from '@big-cms/shared/netErrors'
import { unwrap } from '@big-cms/shared/apiClient'
import type { Role } from '@big-cms/shared/roles'
import { TOUCH_EVERY_MS } from '@big-cms/shared/counterSignIn'
import { compareResults, planQuery, planTouches, type LocalDoc, type ResultState } from './queries'
import type { PosBackend } from './types'
import { personLabel } from '../signOut'

const SESSION_KEY = 'pos-hub-session'
const SESSION_EVENT = 'pos-hub-session'

export interface HubSession {
  token: string
  expiresAt: number
  uid: string
  email: string | null
  /** The first name the hub pulled, for a shared screen to say who is signed in (T6.2). */
  name?: string | null
  role: Role | null
  branchIds: string[]
  superadmin: boolean
  /** 'kds' for a kitchen screen (S19). */
  scope?: 'kds' | null
  /** A counter PC sign-in (S25) ends after this long without a tap. */
  idleMs?: number | null
}

/** The session on this device, or null when there is none or it has run out. */
export function readHubSession(now = Date.now()): HubSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as HubSession
    if (typeof s?.token !== 'string' || typeof s.expiresAt !== 'number' || !(s.expiresAt > now)) return null
    return s
  } catch {
    return null
  }
}

function announce(): void {
  window.dispatchEvent(new Event(SESSION_EVENT))
}

export function clearHubSession(): void {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* private mode: nothing was kept */ }
  announce()
}

/** Swaps a fresh Firebase sign-in for a hub session. Throws the hub's own refusal. */
export async function startHubSessionFromFirebase(idToken: string): Promise<HubSession> {
  let res: Response
  try {
    res = await fetch('/api/hub/session', { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } })
  } catch {
    throw new NetworkError('No connection — could not reach the hub.')
  }
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok || typeof data.token !== 'string') {
    throw new Error(typeof data.error === 'string' ? data.error : 'The hub did not sign you in.')
  }
  return keepHubSession(data.token, data)
}

/**
 * Takes a session the staff app signed in with the phone's key (stage 5) and
 * handed to this page (tokenFromHandoff). The hub is asked who it is, so the
 * page stores what the hub says, never what the address said.
 */
export async function adoptHubSession(token: string): Promise<HubSession> {
  let res: Response
  try {
    res = await fetch('/api/hub/session', { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    throw new NetworkError('No connection — could not reach the hub.')
  }
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The phone sign-in has run out. Sign in again.')
  return keepHubSession(token, data)
}

function keepHubSession(token: string, data: Record<string, unknown>): HubSession {
  const session: HubSession = {
    token,
    expiresAt: Number(data.expiresAt),
    uid: String(data.uid ?? ''),
    email: typeof data.email === 'string' ? data.email : null,
    name: typeof data.name === 'string' && data.name ? data.name : null,
    role: typeof data.role === 'string' ? data.role as Role : null,
    branchIds: Array.isArray(data.branchIds) ? data.branchIds.filter((b): b is string => typeof b === 'string') : [],
    superadmin: data.superadmin === true,
    scope: data.scope === 'kds' ? 'kds' : null,
    idleMs: typeof data.idleMs === 'number' && data.idleMs > 0 ? data.idleMs : null,
  }
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* kept for this page only */ }
  announce()
  return session
}

/** Signs this device's session out at the hub, then here. Signed out here even when the hub cannot be reached. */
export async function signOutHubSession(): Promise<void> {
  const session = readHubSession()
  if (session) {
    try {
      await fetch('/api/hub/session', { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } })
    } catch { /* the hub ends it by itself when it goes idle */ }
  }
  clearHubSession()
}

/** Tells the hub the till saw a tap (S25). A session the hub no longer has is signed out here. */
async function touchHubSession(session: HubSession): Promise<void> {
  try {
    const res = await fetch('/api/hub/session', { method: 'PATCH', headers: { Authorization: `Bearer ${session.token}` } })
    if (res.status === 401) clearHubSession()
  } catch { /* no answer: the next tap tries again */ }
}

// ── A counter PC sign-in ends after its idle limit without a tap (S25) ────
//
// The hub enforces it; this signs the screen out when it happens rather than at
// the next refused request, and tells the hub about taps. Only taps count: the
// screens' own background requests never keep a session alive.

let idleWatch: { token: string; stop: () => void } | null = null

function followIdle(session: HubSession | null): void {
  if (!session?.idleMs) {
    idleWatch?.stop()
    idleWatch = null
    return
  }
  if (idleWatch?.token === session.token) return
  idleWatch?.stop()
  const idleMs = session.idleMs
  let lastTap = Date.now()
  let lastTouch = Date.now()
  const onTap = () => {
    lastTap = Date.now()
    if (lastTap - lastTouch >= TOUCH_EVERY_MS) {
      lastTouch = lastTap
      void touchHubSession(session)
    }
  }
  const events = ['pointerdown', 'keydown', 'wheel'] as const
  for (const e of events) window.addEventListener(e, onTap, { passive: true })
  const timer = setInterval(() => {
    if (Date.now() - lastTap >= idleMs) void signOutHubSession()
  }, 5_000)
  idleWatch = {
    token: session.token,
    stop: () => {
      clearInterval(timer)
      for (const e of events) window.removeEventListener(e, onTap)
    },
  }
}

export interface CounterRequest {
  id: string
  secret: string
  code: string
  expiresAt: number
  label: string
}

async function counterCall(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    })
  } catch {
    throw new NetworkError('No connection — could not reach the hub.')
  }
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `The hub refused that (${res.status}).`)
  return data
}

/** Who can sign in on the counter PC: the staff the hub pulled, by first name (S24). */
export async function counterPeople(): Promise<{ uid: string; label: string }[]> {
  const data = await counterCall('GET', '/api/hub/counter-signin?view=people')
  return Array.isArray(data.people) ? data.people as { uid: string; label: string }[] : []
}

/** The counter PC asks to sign this person in, and gets the code to show (S24). */
export async function askCounterSignIn(uid: string): Promise<CounterRequest> {
  const data = await counterCall('POST', '/api/hub/counter-signin', { action: 'ask', uid })
  return {
    id: String(data.id ?? ''), secret: String(data.secret ?? ''), code: String(data.code ?? ''),
    expiresAt: Number(data.expiresAt ?? 0), label: String(data.label ?? ''),
  }
}

/** Whether the person's phone has approved yet. Approved: the session is taken and kept here. */
export async function collectCounterSignIn(request: CounterRequest): Promise<'waiting' | 'expired' | 'collected' | HubSession> {
  const data = await counterCall('POST', '/api/hub/counter-signin', { action: 'collect', id: request.id, secret: request.secret })
  if (data.status === 'approved' && typeof data.token === 'string') return adoptHubSession(data.token)
  return data.status === 'expired' || data.status === 'collected' ? data.status : 'waiting'
}

/** Told now, and whenever the session starts, ends, or runs out at the end of the night. */
export function watchHubSession(onChange: (session: HubSession | null) => void): () => void {
  let live = true
  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = () => {
    if (!live) return
    clearTimeout(timer)
    const s = readHubSession()
    // Ends on its own at the end of the night, without a reload. setTimeout
    // cannot wait longer than about 24.8 days, which no session comes near.
    if (s) timer = setTimeout(fire, Math.min(s.expiresAt - Date.now() + 1000, 2 ** 31 - 1))
    followIdle(s)
    onChange(s)
  }
  const onStorage = (e: StorageEvent) => { if (e.key === SESSION_KEY) fire() }
  window.addEventListener(SESSION_EVENT, fire)
  window.addEventListener('storage', onStorage)
  queueMicrotask(fire)
  return () => {
    live = false
    clearTimeout(timer)
    window.removeEventListener(SESSION_EVENT, fire)
    window.removeEventListener('storage', onStorage)
  }
}

/** A stored Timestamp as it reaches the till: the fields and methods the screens read. */
export class HubTimestamp {
  constructor(readonly seconds: number, readonly nanoseconds: number) {}
  toMillis(): number { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6) }
  toDate(): Date { return new Date(this.toMillis()) }
  isEqual(other: unknown): boolean {
    return other instanceof HubTimestamp && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds
  }
}

// The same tags the hub stores and sends (backupCodec), rebuilt for a browser.
const revive: Revive = (kind, data) => {
  switch (kind) {
    case 'ts': return new HubTimestamp(Number(data.s), Number(data.n))
    case 'geo': return { latitude: Number(data.lat), longitude: Number(data.lng) }
    case 'ref': return { path: String(data.path) }
    case 'bytes': return String(data.b64)
    default: return null
  }
}

const authHeader = (session: HubSession) => ({ Authorization: `Bearer ${session.token}` })

const refusal = async (res: Response): Promise<Error> => {
  const data = await res.json().catch(() => ({})) as { error?: unknown }
  return new Error(typeof data.error === 'string' ? data.error : `The hub refused that (${res.status}).`)
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Reads server-sent events from a response body, one call per message.
 * A read that fails is the connection going, and says so as a NetworkError;
 * anything thrown by `onEvent` is a bug and is not dressed up as bad wifi.
 */
async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (data: string) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch {
      throw new NetworkError('The connection to the hub dropped.')
    }
    if (chunk.done) return
    buffer += decoder.decode(chunk.value, { stream: true })
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, ''))
      if (data.length > 0) onEvent(data.join('\n'))
    }
  }
}

// ── The change feed: one stream, shared by every watch on the screen ───────

type FeedEvent =
  | { kind: 'connected'; seq: number }
  | { kind: 'changes'; seq: number; touched: { collection: string; id: string }[] }

const feedListeners = new Set<(event: FeedEvent) => void>()
let feed: AbortController | null = null

function emit(event: FeedEvent): void {
  for (const listener of [...feedListeners]) {
    try { listener(event) } catch (err) { console.error('[hub] a watch failed on a change:', err) }
  }
}

function startFeed(): void {
  const controller = new AbortController()
  feed = controller
  void (async () => {
    let delay = 1000
    try {
      while (!controller.signal.aborted) {
        const session = readHubSession()
        // Signed out: each watch says so when it next asks. A later sign-in
        // mounts new screens, and their watches start the feed again.
        if (!session) return
        try {
          let res: Response
          try {
            res = await fetch('/api/hub/changes', { headers: authHeader(session), signal: controller.signal, cache: 'no-store' })
          } catch {
            throw new NetworkError('No connection — could not reach the hub.')
          }
          if (res.status === 401) { clearHubSession(); return }
          if (!res.ok || !res.body) {
            console.error('[hub] the change feed was refused:', (await refusal(res)).message)
            return
          }
          delay = 1000
          await readEvents(res.body, data => {
            const parsed = JSON.parse(data) as { seq: number; touched?: { collection: string; id: string }[] }
            emit(parsed.touched
              ? { kind: 'changes', seq: Number(parsed.seq), touched: parsed.touched }
              : { kind: 'connected', seq: Number(parsed.seq) })
          })
        } catch (err) {
          if (controller.signal.aborted) return
          // A dropped connection is retried, as a Firestore listener retries.
          if (!(err instanceof NetworkError)) console.error('[hub] the change feed failed:', err)
        }
        if (controller.signal.aborted) return
        await sleep(delay)
        delay = Math.min(delay * 2, 10_000)
      }
    } finally {
      if (feed === controller) feed = null
    }
  })()
}

function subscribeFeed(listener: (event: FeedEvent) => void): () => void {
  feedListeners.add(listener)
  if (!feed) startFeed()
  return () => {
    feedListeners.delete(listener)
    if (feedListeners.size === 0 && feed) {
      feed.abort()
      feed = null
    }
  }
}

export const hubBackend: PosBackend = {
  kind: 'hub',

  watchAuth: onChange => watchHubSession(s => onChange(Boolean(s))),
  signOut: () => signOutHubSession(),

  signedIn: () => Boolean(readHubSession()),
  signedInAs: () => personLabel(readHubSession()),

  watch(q, onData, onError) {
    const plan = planQuery(q)
    const url = `/api/hub/query?q=${encodeURIComponent(JSON.stringify(q))}`
    let stopped = false
    let loading = false
    // The change log position the last answer was read at, and the newest
    // write heard of since that could change it. Asking again only when the
    // second is past the first means a feed connecting just after the first
    // answer costs nothing, and a write during a request costs one more.
    let seenSeq = -1
    let wanted = -1
    let state: ResultState | null = null
    let retry: ReturnType<typeof setTimeout> | undefined

    const stop = () => { stopped = true; clearTimeout(retry) }

    // One request at a time.
    const load = async (): Promise<void> => {
      if (stopped || loading) return
      loading = true
      try {
        do {
          const session = readHubSession()
          if (!session) { stop(); onError(new Error('Not signed in.')); return }
          let res: Response
          let body: { docs?: { id: string; data: unknown }[]; seq?: number }
          try {
            res = await fetch(url, { headers: authHeader(session), cache: 'no-store' })
            if (res.ok) body = await res.json()
            else body = {}
          } catch {
            // No answer: again shortly, and again whenever the feed reconnects.
            clearTimeout(retry)
            retry = setTimeout(() => void load(), 2000)
            return
          }
          if (stopped) return
          if (res.status === 401) { stop(); clearHubSession(); onError(await refusal(res)); return }
          if (!res.ok) { stop(); onError(await refusal(res)); return }
          seenSeq = Math.max(seenSeq, Number(body.seq ?? -1))
          const answer = body.docs ?? []
          const compared = compareResults(state, answer)
          state = compared.state
          if (compared.changed) {
            const docs: LocalDoc[] = answer.map(d => ({ id: d.id, data: decode(d.data, revive) as Record<string, unknown> }))
            const changed = new Set(compared.changed)
            onData({ docs, changed: docs.filter(d => changed.has(d.id)) })
          }
        } while (!stopped && wanted > seenSeq)
      } finally {
        loading = false
      }
    }

    const unsubscribe = subscribeFeed(event => {
      // A write elsewhere cannot change this answer. A feed that has just
      // (re)connected cannot say what it missed, so its position counts as a
      // write that might have.
      if (event.kind === 'changes' && !event.touched.some(c => planTouches(plan, c))) return
      wanted = Math.max(wanted, event.seq)
      if (wanted > seenSeq) void load()
    })
    void load()

    return () => { stop(); unsubscribe() }
  },

  async request(method, path, body, opts) {
    const session = readHubSession()
    if (!session) throw new Error('Session expired — please sign in again.')
    const controller = opts?.timeoutMs ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), opts?.timeoutMs) : null
    let res: Response
    try {
      res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeader(session) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      })
    } catch {
      // No answer, or our own timeout: whether it arrived is unknown, which is
      // exactly what the outbox's keys are for.
      throw new NetworkError('No connection — could not reach the hub.')
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (res.status === 401) clearHubSession()
    return unwrap(res)
  },
}
