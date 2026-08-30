'use client'

import { auth } from './firebase'

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
export async function authedFetch(path: string, method: string, body?: unknown): Promise<Response> {
  const user = auth.currentUser
  if (!user) throw new Error('Session expired — please sign in again.')
  const token = await user.getIdToken()

  return fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
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
