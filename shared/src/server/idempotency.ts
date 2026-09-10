// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Reading a submission's idempotency key. See shared/src/requestKey.ts for
// what the key is and why these four writes need one.

import { HttpError } from './auth'
import { REQUEST_KEY_PATTERN } from '../requestKey'

/**
 * The request's key, if the browser sent one.
 *
 * Optional, so a page running older code still works — it simply gets no
 * protection against a doubled retry. Present but malformed is refused rather
 * than ignored: dropping it would switch the protection off without anyone
 * knowing. The key becomes a document id, so the pattern also keeps it to
 * characters a document id can hold.
 */
export function parseRequestId(body: Record<string, unknown>): string | null {
  const raw = body.requestId
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string' || !REQUEST_KEY_PATTERN.test(raw)) {
    throw new HttpError(400, 'Invalid request id.')
  }
  return raw
}

/** Whether a Firestore create() failed because the document already exists. */
export function alreadyExists(err: unknown): boolean {
  const e = (err ?? {}) as { code?: unknown; message?: unknown }
  // 6 is gRPC ALREADY_EXISTS, which is what the Admin SDK reports.
  return e.code === 6 || e.code === 'already-exists'
    || (typeof e.message === 'string' && /already exists/i.test(e.message))
}
