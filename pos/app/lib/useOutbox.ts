'use client'

// The counter device's outbox, wired to a browser — Phase 04, slice 7c.
//
// Where the queue is kept, how an action is sent, and when it tries again. The
// decisions are all in outbox.ts, which has no browser in it and is asserted by
// `npm run verify:offline`; this file is only the plumbing around them. Keep it
// that way: logic that lands here is logic nothing tests.
//
// localStorage rather than IndexedDB. The queue is a few dozen small objects,
// it has to survive a reload and a closed lid, and a synchronous read on mount
// is what lets the first render already know an order is waiting — an async
// one would show "nothing queued" for a frame, on the screen whose whole job
// is to say what has not been sent yet. Firestore's IndexedDB cache still
// carries the READS; this is only the writes.

import { useCallback, useEffect, useRef, useState } from 'react'
import { backend } from './backend'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import {
  EMPTY_OUTBOX, enqueue, replay, resolveStuck, waitingFor, changeDiffers,
  type OutboxAction, type OutboxState, type SendOutcome,
} from './outbox'
import { startLoad } from '@big-cms/shared/startLoad'

const STORAGE_KEY = 'pos.outbox.v1'
const DEVICE_KEY = 'pos.counterDevice'

/**
 * How long one queued action waits for an answer before the replay gives up
 * and leaves it queued. Same figure as a Send from a waiter's phone, for the
 * same reason: the connection coming back is not the same as it being good.
 */
const SEND_TIMEOUT_MS = 15_000

/** Retried every 20s while there is anything to send — see the note on sync(). */
const RETRY_MS = 20_000

/** A key, in the shape the server already accepts. Same as newBatchKey on the check page. */
export function newKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`
}

function load(): OutboxState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_OUTBOX
    const parsed = JSON.parse(raw) as Partial<OutboxState>
    if (!parsed || !Array.isArray(parsed.queue)) return EMPTY_OUTBOX
    return { queue: parsed.queue, stuck: parsed.stuck ?? null }
  } catch (err) {
    // Starting empty is the only thing that can be done, but it is not a quiet
    // event: what was in there was somebody's orders.
    console.error('[outbox] could not read the queue — starting empty:', err)
    return EMPTY_OUTBOX
  }
}

/** What this device is holding, for the Sign out warning (T6.1). */
export function queuedOnThisDevice(): { queued: number; stuck: boolean } {
  const state = load()
  return { queued: state.queue.length, stuck: state.stuck !== null }
}

function save(state: OutboxState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (err) {
    console.error('[outbox] could not save the queue:', err)
  }
}

const usd = (n: number) => `$${n.toFixed(2)}`
const lbp = (n: number) => `${Math.round(n).toLocaleString('en-US')} LBP`

/**
 * Sends one queued action through the same routes everything else uses.
 *
 * Every kind carries the key the server already honours — the check's own id,
 * a batchKey, a paymentKey — so a replay of something that in fact landed is
 * recognised rather than repeated. That is what makes retrying safe, and it is
 * the reason this can be as blunt as it is.
 *
 * The outcome is the distinction the whole queue turns on: no answer means try
 * again, an answer that was no means stop and tell somebody.
 */
async function sendAction(
  action: OutboxAction,
  notify: (text: string) => void,
): Promise<SendOutcome> {
  try {
    if (action.kind === 'open') {
      await backend().request('POST', '/api/pos/checks', {
        branch: action.branch,
        tableNumber: action.tableNumber,
        guestCount: action.guestCount,
        // The device named the check. Replaying an open the server already has
        // returns that same check instead of "table 4 is already open" (7b).
        openId: action.checkId,
      }, { timeoutMs: SEND_TIMEOUT_MS })
    } else if (action.kind === 'lines') {
      await backend().request('POST', '/api/pos/checks', {
        checkId: action.checkId,
        batchKey: action.batchKey,
        lines: action.lines,
        // Recorded as already made, at the time it was made, with no kitchen
        // ticket — the owner's decision: during an outage the counter is the
        // kitchen, and a ticket for a coffee somebody drank an hour ago is
        // worse than no ticket at all.
        madeOfflineAt: action.at,
      }, { timeoutMs: SEND_TIMEOUT_MS })
    } else {
      const data = await backend().request('PATCH', '/api/pos/checks', {
        checkId: action.checkId,
        action: 'pay',
        paymentKey: action.paymentKey,
        ...action.payment,
      }, { timeoutMs: SEND_TIMEOUT_MS })
      const p = (data.payment ?? {}) as { changeUsd?: number; changeLbp?: number }
      const actual = { changeUsd: Number(p.changeUsd ?? 0), changeLbp: Number(p.changeLbp ?? 0) }
      if (changeDiffers(action.expected, actual)) {
        // The customer left with the change the counter worked out. Nothing can
        // be corrected now, so the useful thing is to say the drawer will be
        // out by the difference, before the count says so at the end of the day.
        notify(
          `Table change differs: the till says ${usd(actual.changeUsd)} + ${lbp(actual.changeLbp)}, ` +
          `the counter handed over ${usd(action.expected?.changeUsd ?? 0)} + ${lbp(action.expected?.changeLbp ?? 0)}. ` +
          'The drawer will be out by the difference.',
        )
      }
    }
    return { ok: true }
  } catch (err) {
    if (isNetworkFailure(err)) {
      return { ok: false, retry: true, reason: err instanceof Error ? err.message : 'No connection.' }
    }
    return {
      ok: false,
      retry: false,
      reason: err instanceof Error ? err.message : 'The server would not take it.',
    }
  }
}

export interface Outbox {
  /** What is still waiting, in the order it happened. */
  queue: OutboxAction[]
  queued: number
  /** The action a refusal stopped at, and why. Null while the queue can flow. */
  stuck: { id: string; reason: string } | null
  /** The browser's view of the connection. Not proof the server is reachable. */
  online: boolean
  syncing: boolean
  /** Things a person needs to be told about a replay, newest last. */
  notices: string[]
  /** False until localStorage has been read — nothing is known before that. */
  loaded: boolean
  add: (action: OutboxAction) => void
  sync: () => void
  resolve: (how: 'retry' | 'drop') => void
  dismissNotices: () => void
  waiting: (checkId: string) => number
}

export function useOutbox(): Outbox {
  const [state, setState] = useState<OutboxState>(EMPTY_OUTBOX)
  const [loaded, setLoaded] = useState(false)
  const [online, setOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [notices, setNotices] = useState<string[]>([])

  // The queue is read inside callbacks that must not be rebuilt every time it
  // changes — a replay in flight would otherwise be looking at a stale copy of
  // it, which is how an action gets sent twice.
  const current = useRef<OutboxState>(EMPTY_OUTBOX)
  const running = useRef(false)

  const put = useCallback((next: OutboxState) => {
    current.current = next
    setState(next)
    save(next)
  }, [])

  // The queue is kept in this browser, so it is read once mounted.
  useEffect(() => {
    startLoad(() => {
      const first = load()
      current.current = first
      setState(first)
      setOnline(navigator.onLine)
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  const sync = useCallback(async () => {
    if (running.current) return
    const now = current.current
    if (now.queue.length === 0) return
    // A refusal nobody has looked at yet stops the queue — replay() enforces
    // that too, but not calling it keeps the "Syncing…" flicker off the screen.
    if (now.stuck) return
    // Signed out, or auth has not settled: a request would throw an error
    // about the session, which is neither "no answer" nor the server refusing
    // the action, and sticking the queue on it would be wrong.
    if (!backend().signedIn()) return

    running.current = true
    setSyncing(true)
    try {
      const r = await replay(now, a => sendAction(a, text => setNotices(n => [...n, text])))
      put({ queue: r.queue, stuck: r.stuck })
    } finally {
      running.current = false
      setSyncing(false)
    }
  }, [put])

  // Tried on a timer as well as on the browser's own "online" event, because
  // that event means an interface came up, not that anything is reachable: a
  // café router that is up with no line to the world never fires it, and that
  // is the outage this is for. Cheap — it returns immediately when the queue
  // is empty, which is nearly always.
  useEffect(() => {
    if (!loaded) return
    startLoad(sync)
    const onOnline = () => { void sync() }
    window.addEventListener('online', onOnline)
    const id = setInterval(() => { void sync() }, RETRY_MS)
    return () => {
      window.removeEventListener('online', onOnline)
      clearInterval(id)
    }
  }, [loaded, sync])

  const add = useCallback((action: OutboxAction) => {
    put(enqueue(current.current, action))
    void sync()
  }, [put, sync])

  const resolve = useCallback((how: 'retry' | 'drop') => {
    put(resolveStuck(current.current, how))
    void sync()
  }, [put, sync])

  return {
    queue: state.queue,
    queued: state.queue.length,
    stuck: state.stuck,
    online,
    syncing,
    notices,
    loaded,
    add,
    sync: () => { void sync() },
    resolve,
    dismissNotices: () => setNotices([]),
    waiting: (checkId: string) => waitingFor(state, checkId),
  }
}

// ── Which device this is ───────────────────────────────────────────────────
// Offline is for the counter device and nothing else (owner's decision): one
// queue per branch, so there is never a question of two devices disagreeing
// about a table. A waiter's phone that lost the wifi says so and stops, which
// is the honest answer — the order goes to the counter, ten steps away.
//
// Marked per device, kept on the device. Nothing about it is a permission:
// what anybody may do is still their role.

async function registerWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('/pos/sw.js', {
      scope: '/pos/',
      // Never serve the worker itself from the browser's HTTP cache — the
      // header in next.config.ts says the same thing; both, because either one
      // alone has been known to be ignored.
      updateViaCache: 'none',
    })
  } catch (err) {
    // The till still works, it just will not work offline. Say so in the log;
    // the screen says it separately, from `supported`.
    console.error('[counter] the service worker did not register:', err)
  }
}

async function unregisterWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map(r => r.unregister()))
    const names = await caches.keys()
    await Promise.all(names.filter(n => n.startsWith('pos-counter-')).map(n => caches.delete(n)))
  } catch (err) {
    console.error('[counter] could not remove the service worker:', err)
  }
}

export function useCounterDevice(): {
  isCounter: boolean
  loaded: boolean
  supported: boolean
  setCounter: (on: boolean) => void
} {
  const [isCounter, setIsCounter] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [supported, setSupported] = useState(true)

  useEffect(() => {
    startLoad(() => {
      let on = false
      try { on = localStorage.getItem(DEVICE_KEY) === 'yes' } catch { on = false }
      setIsCounter(on)
      setSupported('serviceWorker' in navigator)
      setLoaded(true)
      // Registered on every load rather than only when the switch is flipped: a
      // worker can be evicted, and a till that quietly stopped being able to work
      // offline would only be discovered during the outage.
      if (on) void registerWorker()
    })
  }, [])

  const setCounter = useCallback((on: boolean) => {
    try { localStorage.setItem(DEVICE_KEY, on ? 'yes' : 'no') } catch { /* private mode: this load only */ }
    setIsCounter(on)
    if (on) void registerWorker()
    else void unregisterWorker()
  }, [])

  return { isCounter, loaded, supported, setCounter }
}
