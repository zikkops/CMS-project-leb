// What an error report is allowed to contain, and how two of them are judged
// to be the same error. Phase 05 groundwork, 12 Sep 2026.
//
// The error boundaries in all three apps have carried the same comment since
// they were written: "Console is not monitoring, and this is not a substitute
// for it. It is the seam." This is the sink behind that seam — kept in the
// project's own Firebase rather than sent to a third party (owner's decision,
// 12 Sep 2026), with a `reportError()` transport seam so Sentry can be added
// later without touching a single call site.
//
// ── Why a fingerprint, and why the server computes it ──────────────────────
// One document per DISTINCT error, with a count, rather than one document per
// occurrence. A render error in a loop is not a hundred problems, it is one
// problem a hundred times — and writing a hundred documents for it turns a bug
// into a bill. Keying by fingerprint bounds the cost structurally.
//
// The browser never chooses the key. An unauthenticated caller that picks its
// own document id picks which document to overwrite.
//
// ── Why redaction is not optional ──────────────────────────────────────────
// /api/errors cannot require a signed-in caller: a customer on the public site
// hits an error boundary while signed out, and that is exactly the error worth
// hearing about. So anything a browser sends is untrusted and may carry
// whatever happened to be in a message — an email, a token, a query string.
// It is cut down to a whitelist, truncated, and scrubbed before it is stored.
//
// No imports, so a verifier can transpile it standalone.

export type AppName = 'web' | 'admin' | 'pos'

/** What a browser is allowed to send. Anything else in the body is ignored. */
export interface ErrorReportInput {
  app: AppName
  message: string
  stack?: string
  /** Next's own error id — the one number a person can read down the phone. */
  digest?: string
  /** Path only. A query string is stripped rather than trusted to be harmless. */
  path?: string
  at?: string
}

export interface ErrorReport {
  app: AppName
  message: string
  stack: string
  digest: string
  path: string
  at: string
  /** Stable across occurrences of the same fault. The document id. */
  fingerprint: string
}

/**
 * Caps. Generous enough to diagnose from, small enough that a document cannot
 * be used as storage — the stack is the only field worth real room.
 */
export const LIMITS = { message: 300, stack: 4000, path: 200, digest: 64 } as const

/** A report is refused above this, before anything is parsed. */
export const MAX_BODY_BYTES = 16_000

export function isAppName(value: unknown): value is AppName {
  return value === 'web' || value === 'admin' || value === 'pos'
}

export function truncate(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value : ''
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/**
 * Removes what should never have been in the text in the first place.
 *
 * Deliberately blunt and deliberately first: it runs before storage, not
 * before display, because a redaction that happens at display time is a
 * redaction that has already been written down.
 */
export function redact(text: string): string {
  return text
    // A query string can carry anything — a token, an email, a booking id.
    .replace(/([?&][^\s"']*)/g, '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    // JWTs, which is what a leaked Firebase ID token looks like.
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_-]*/g, '[token]')
    .replace(/\b[Bb]earer\s+[A-Za-z0-9._-]+/g, '[token]')
    // Anything long enough to be a key rather than a word.
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .replace(/\+\d[\d\s-]{7,}\d/g, '[phone]')
}

/** The path, with the query and hash gone. Never a full URL. */
export function redactPath(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : ''
  if (!s) return ''
  const withoutOrigin = s.replace(/^[a-z]+:\/\/[^/]+/i, '')
  const path = withoutOrigin.split('?')[0].split('#')[0]
  return truncate(redact(path), LIMITS.path)
}

/**
 * The message with the parts that differ between occurrences taken out, so the
 * same fault fingerprints the same way.
 *
 * "Cannot read x of check abc123" and "…of check def456" are one bug. Without
 * this they are two documents, then two hundred, and the count that was
 * supposed to say "this is happening constantly" says 1 next to each.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#uuid')
    .replace(/["'`][^"'`]*["'`]/g, '#str')
    // Any word carrying a digit: an id, a table number, a line number, a
    // quantity. Digits alone are not enough — a check id like `abc123` would
    // normalize to `abc#` and `def456` to `def#`, which is two documents for
    // one fault, which is the failure this function exists to prevent.
    .replace(/\b\w*\d\w*\b/g, '#')
    .trim()
    .toLowerCase()
}

/** The first line of the stack that is actually a frame. */
export function firstFrame(stack: unknown): string {
  const s = typeof stack === 'string' ? stack : ''
  for (const line of s.split('\n')) {
    const t = line.trim()
    if (t.startsWith('at ')) {
      // The build hash in a chunk filename changes on every deploy; keeping it
      // would fingerprint the same fault differently after each one.
      return t.replace(/[?&][^\s)]*/g, '').replace(/[0-9a-f]{8,}/gi, '#')
    }
  }
  return ''
}

/**
 * A stable id for this fault, safe as a Firestore document id.
 *
 * FNV-1a rather than a crypto hash: this runs in a browser and on the server,
 * needs no import in either, and is not a security boundary — two different
 * faults colliding costs a muddled count, not a leak.
 */
export function fingerprintOf(app: string, message: string, stack?: string): string {
  const basis = `${app}|${normalizeMessage(message)}|${firstFrame(stack)}`
  let h = 0x811c9dc5
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i)
    // >>> 0 keeps it an unsigned 32-bit value; Math.imul does the 32-bit
    // multiply that a plain * would silently turn into a float.
    h = Math.imul(h, 0x01000193) >>> 0
  }
  let h2 = 0x27d4eb2f
  for (let i = basis.length - 1; i >= 0; i--) {
    h2 ^= basis.charCodeAt(i)
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0
  }
  const safeApp = isAppName(app) ? app : 'web'
  return `${safeApp}-${h.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

/** Whitelist, scrub, truncate, fingerprint. The only way a report is built. */
export function buildReport(input: ErrorReportInput): ErrorReport {
  const app: AppName = isAppName(input.app) ? input.app : 'web'
  const message = truncate(redact(typeof input.message === 'string' ? input.message : ''), LIMITS.message)
  const stack = truncate(redact(typeof input.stack === 'string' ? input.stack : ''), LIMITS.stack)
  return {
    app,
    message: message || 'An error with no message.',
    stack,
    // Next's digest is a hex id and carries nothing of its own.
    digest: truncate(typeof input.digest === 'string' ? input.digest.replace(/[^\w-]/g, '') : '', LIMITS.digest),
    path: redactPath(input.path),
    at: typeof input.at === 'string' ? input.at : '',
    fingerprint: fingerprintOf(app, message, stack),
  }
}

// ── The browser's own restraint ────────────────────────────────────────────
// The server bounds what it stores; this bounds what is sent. A component
// erroring in a render loop can call an error boundary hundreds of times a
// second, and the first thing anybody would notice is the network tab.

/** Not the same fault twice inside this. */
export const REPORT_WINDOW_MS = 60_000

/** Nor more than this many in one page load, whatever they are. */
export const MAX_PER_LOAD = 5

export interface ThrottleState {
  /** fingerprint → when it was last sent. */
  seen: Record<string, number>
  sent: number
}

export const EMPTY_THROTTLE: ThrottleState = { seen: {}, sent: 0 }

export function shouldReport(
  state: ThrottleState,
  fingerprint: string,
  nowMs: number,
): { send: boolean; state: ThrottleState; reason: string } {
  if (state.sent >= MAX_PER_LOAD) {
    return { send: false, state, reason: 'enough from this page load' }
  }
  const last = state.seen[fingerprint]
  if (typeof last === 'number' && nowMs - last < REPORT_WINDOW_MS) {
    return { send: false, state, reason: 'already reported just now' }
  }
  return {
    send: true,
    state: { seen: { ...state.seen, [fingerprint]: nowMs }, sent: state.sent + 1 },
    reason: '',
  }
}
