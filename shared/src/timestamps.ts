// Reading a Firestore timestamp, whatever shape it arrived in.
//
// A field written with FieldValue.serverTimestamp() does not have one shape on
// the way back — it has several, depending on who read it and how:
//
//   client SDK listener        a Timestamp instance, with toMillis()
//   a plain object copy        { seconds, nanoseconds }
//   Admin SDK via Response.json { _seconds, _nanoseconds }
//   a test fixture             an ISO string
//
// The trap is that the obvious conversion is silently wrong for the commonest
// one. `new Date(timestamp)` calls valueOf(), which on a Firestore Timestamp
// returns a zero-padded sort key like "063924391800.000000000" — and Date
// cannot parse that. The result is Invalid Date, which does not throw; it
// formats as "NaN-NaN-NaN NaN:NaN" and prints on a receipt that way. That is
// exactly what receipt.ts did with closedAt, while its verifier passed,
// because the fixture used a string.
//
// Before this existed the same field was being read three different ways in
// three files. One reader, with every shape handled, is the fix for all of
// them and for the next one.
//
// No imports on purpose, so a verifier can transpile it standalone.

/**
 * Milliseconds since the epoch, or `fallback` when the value is missing or
 * unreadable.
 *
 * A fallback rather than a throw: a server timestamp is briefly absent on a
 * document written a moment ago, while it resolves, and "just now" is the
 * right reading of that — not an error, and not 1970.
 */
export function timestampMs(raw: unknown, fallback: number): number {
  if (raw === null || raw === undefined) return fallback

  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : fallback

  if (typeof raw === 'string') {
    const ms = Date.parse(raw)
    return Number.isFinite(ms) ? ms : fallback
  }

  if (raw instanceof Date) {
    const ms = raw.getTime()
    return Number.isFinite(ms) ? ms : fallback
  }

  if (typeof raw === 'object') {
    const t = raw as {
      toMillis?: () => number
      seconds?: number; nanoseconds?: number
      _seconds?: number; _nanoseconds?: number
    }
    if (typeof t.toMillis === 'function') {
      const ms = t.toMillis()
      if (Number.isFinite(ms)) return ms
    }
    const seconds = typeof t.seconds === 'number' ? t.seconds
      : typeof t._seconds === 'number' ? t._seconds
      : undefined
    if (seconds !== undefined && Number.isFinite(seconds)) {
      const nanos = typeof t.nanoseconds === 'number' ? t.nanoseconds
        : typeof t._nanoseconds === 'number' ? t._nanoseconds
        : 0
      return seconds * 1000 + Math.floor(nanos / 1e6)
    }
  }

  return fallback
}
