'use client'

import { auth } from './firebase'
import { NetworkError, isNetworkFailure } from './netErrors'
import { createRequestKeys } from './requestKey'

// The browser half of every call into app/api/**.
//
// Extracted from adminAuth.ts, where it started life private to the account
// routes. The Phase 00 standing rule moves each privileged mutation behind a
// route handler as it is touched, so every such migration needs this — and the
// alternative to sharing it is a second copy of ID-token handling per module,
// which is exactly the kind of duplication that drifts.
//
// This is deliberately one of the very few shared helpers in app/lib (see
// CONTRIBUTING.md — uploadImage() is the other). Most modules here are
// independent on purpose; token plumbing is not the place to prove that point.

/**
 * Calls a route handler with the caller's current Firebase ID token.
 *
 * getIdToken() returns the cached token and refreshes it only when it is
 * within five minutes of expiry, so this is not a network round trip on every
 * call. It does NOT force a refresh: a stale *claim* is a different problem,
 * solved by the claimsUpdatedAt stamp in adminAuth.ts.
 */
export interface FetchOptions {
  /**
   * Give up after this long and throw a NetworkError.
   *
   * Opt-in, not a default. A waiter's phone on the edge of the café wifi can
   * hang on a request indefinitely, and "Sending…" forever is worse than an
   * error; but an admin importing images legitimately waits, and a blanket
   * timeout would break that to fix something it never had.
   */
  timeoutMs?: number
}

export async function authedFetch(
  path: string,
  method: string,
  body?: unknown,
  opts: FetchOptions = {},
): Promise<Response> {
  const user = auth.currentUser
  if (!user) throw new Error('Session expired — please sign in again.')

  let token: string
  try {
    token = await user.getIdToken()
  } catch (err) {
    if (isNetworkFailure(err)) throw new NetworkError('No connection — could not reach the server.')
    throw err
  }

  const controller = opts.timeoutMs ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs) : null
  try {
    return await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    })
  } catch (err) {
    // Re-thrown as one kind with one message, instead of the browser's own
    // wording — "Failed to fetch", "Load failed" — reaching a waiter.
    if (isNetworkFailure(err)) {
      throw new NetworkError(controller?.signal.aborted
        ? 'The server did not answer in time.'
        : 'No connection — could not reach the server.')
    }
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Unwraps a route response, throwing the server's own message.
 *
 * Route handlers return `{ error }` already written for a human (see
 * toResponse in shared/src/server/auth.ts), so this passes it straight through
 * rather than inventing a second set of copy that then drifts from the first.
 */
export async function unwrap(res: Response): Promise<Record<string, unknown>> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'Something went wrong. Please try again.'
    )
  }
  return data as Record<string, unknown>
}

// ── Submissions that must not happen twice ─────────────────────────────────
// See shared/src/requestKey.ts. One set of keys for the life of the page: a
// reload starts fresh, which is the right reading of "I reloaded to see what
// happened".
const requestKeys = createRequestKeys(() => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
})

/**
 * POSTs a submission with an idempotency key, so pressing Save again after a
 * lost reply cannot record it twice.
 *
 * The key is settled — the next submission of this kind becomes a new one —
 * on ANY answer, refusal included: when the server says no, nothing was
 * written. Only no answer keeps it, which is exactly the case where the
 * person cannot know whether it worked, and so the case where the message
 * has to tell them trying again is safe.
 *
 * `identity` is what the key is hashed from, when that is not the whole body.
 * A wholesale order carries an invoice drawn in the browser just before it is
 * sent; if the invoice were part of the key, a redrawn one would make the
 * retry look like a new order — the very doubling this exists to stop.
 */
export async function postOnce(
  kind: string,
  path: string,
  body: Record<string, unknown>,
  identity?: unknown,
): Promise<Response> {
  const requestId = requestKeys.keyFor(kind, identity === undefined ? body : identity)
  let res: Response
  try {
    res = await authedFetch(path, 'POST', { ...body, requestId })
  } catch (err) {
    if (isNetworkFailure(err)) {
      throw new NetworkError(
        'No connection — it may or may not have been saved. Trying again is safe: it will not be saved twice.')
    }
    throw err
  }
  requestKeys.settled(kind)
  return res
}
