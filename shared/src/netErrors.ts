// Telling "the network failed" apart from "the server said no".
//
// They need opposite handling. When the server answers with a refusal —
// "that check is closed" — nothing was written, and the caller can say so and
// move on. When the connection drops, nothing is known: the request may never
// have left the phone, or it may have landed and only the reply been lost. A
// POS that treats the second like the first resends blind, and the kitchen
// cooks the order twice.
//
// And a browser reports a dropped connection in its own words — "Failed to
// fetch" in Chrome, "Load failed" in Safari — which were being shown to a
// waiter verbatim.
//
// No imports, so a verifier can transpile it standalone.

/** The request did not get an answer. Whether it arrived is unknown. */
export class NetworkError extends Error {
  readonly kind = 'network' as const
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

/**
 * Whether an error means "no answer", as opposed to an answer that was no.
 *
 * Deliberately narrow. A TypeError is only a network failure when its message
 * says so: `x is not a function` is also a TypeError, and classifying a bug as
 * "you're offline" would tell a waiter to wait for wifi that was never the
 * problem.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof NetworkError) return true
  const e = (err ?? {}) as { name?: unknown; message?: unknown; code?: unknown }
  const name = typeof e.name === 'string' ? e.name : ''
  const message = typeof e.message === 'string' ? e.message : ''
  // An aborted request — our own timeout — never got its answer either.
  if (name === 'AbortError' || name === 'TimeoutError') return true
  // Refreshing the ID token needs the network too.
  if (e.code === 'auth/network-request-failed') return true
  if (name === 'TypeError') {
    return /failed to fetch|load failed|networkerror|network request failed/i.test(message)
  }
  return false
}
