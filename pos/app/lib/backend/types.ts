// The seam every till screen reads and writes through — POS software, stage 2.
//
// Online mode is the cloud backend (cloud.ts): Firestore listeners and the
// Next routes, exactly what the screens used to call themselves. Software mode
// (stage 3) adds a hub backend that answers the same calls from the café's
// counter PC. A screen asks for a PosQuery and makes requests; it never knows
// which one answered.

import type { LocalDoc, PosQuery } from './queries'

export interface Snapshot {
  /** The documents the query matches now. */
  docs: LocalDoc[]
  /** Added or changed since the previous snapshot. The first snapshot lists every document. */
  changed: LocalDoc[]
}

export interface RequestOptions {
  /** Give up after this long and fail as "no answer" — isNetworkFailure() is true for it. */
  timeoutMs?: number
}

export interface PosBackend {
  /** Where the till's data lives: the cloud (online mode) or the café's hub (software mode). */
  readonly kind: 'cloud' | 'hub'
  /** Called once sign-in has settled, and again whenever it changes. Returns an unsubscribe. */
  watchAuth(onChange: (signedIn: boolean) => void): () => void
  /** Whether somebody is signed in at this moment. */
  signedIn(): boolean
  /** Signs this device out. Never throws: signed out here even if the other end cannot be told. */
  signOut(): Promise<void>
  /** A live query. Returns an unsubscribe. */
  watch(query: PosQuery, onSnapshot: (snapshot: Snapshot) => void, onError: (err: unknown) => void): () => void
  /**
   * A write, or a one-off read, through a route. Resolves with the route's
   * answer; throws the route's own refusal, or a network failure when there is
   * no answer — the distinction every retry in the till depends on.
   */
  request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, opts?: RequestOptions): Promise<Record<string, unknown>>
}
