// Turning a Firestore document into JSON and back without losing anything.
//
// ── Why this is not JSON.stringify ─────────────────────────────────────────
// A Firestore document is not JSON. It holds Timestamps, GeoPoints, document
// references, byte arrays, and numbers JSON has no spelling for. Hand any of
// them to JSON.stringify and you get something that looks fine and is not:
//
//   a Timestamp        becomes {_seconds, _nanoseconds}, and restores as a
//                      plain map — so every date in the system stops being a
//                      date, silently, and `timestampMs()` starts guessing
//   NaN / Infinity     become null
//   undefined          disappears from an object and becomes null in an array
//   a reference        becomes an enormous object graph of the whole client
//
// This repo has already lost a day to a Timestamp arriving where a string was
// expected — it printed "NaN-NaN-NaN" on every real receipt. A backup that
// does the same thing is worse, because the damage is discovered when it is
// restored, which is the worst possible moment.
//
// ── Why it takes callbacks ─────────────────────────────────────────────────
// It has no idea what a Timestamp is, on purpose: `classify` recognises the
// natives and `revive` rebuilds them, both supplied by the caller. That keeps
// firebase-admin out of a module that scripts/verify-backup.mjs can transpile
// and drive on its own — and it means the same codec would serve a different
// database without being rewritten.

/** The key that marks an encoded native. Chosen to be improbable in real data. */
export const TAG = '$fs'

/** What a native looks like once encoded: the kind, plus whatever it needs. */
export interface Tagged {
  [TAG]: string
  [field: string]: unknown
}

/** Recognises a Firestore native. Returns null for anything ordinary. */
export type Classify = (value: unknown) => { kind: string; data: Record<string, unknown> } | null

/** Rebuilds a native from what classify() produced. */
export type Revive = (kind: string, data: Record<string, unknown>) => unknown

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Real data is allowed to contain the tag key.
 *
 * A café will never write a field called `$fs`, right up until somebody
 * imports a spreadsheet that has one. An escape that only works when nobody
 * tries is not an escape, so a literal `$fs` key becomes `$$fs`, `$$fs`
 * becomes `$$$fs`, and decoding peels exactly one `$` back off.
 */
function escapeKey(key: string): string {
  return /^\$+fs$/.test(key) ? `$${key}` : key
}

function unescapeKey(key: string): string {
  return /^\$\$+fs$/.test(key) ? key.slice(1) : key
}

/** Numbers JSON cannot spell. Tagged rather than quietly turned into null. */
function oddNumber(value: number): string | null {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  return null
}

export function encode(value: unknown, classify: Classify): unknown {
  const native = classify(value)
  if (native) return { [TAG]: native.kind, ...native.data }

  if (typeof value === 'number') {
    const odd = oddNumber(value)
    return odd === null ? value : { [TAG]: 'num', value: odd }
  }

  if (Array.isArray(value)) {
    // undefined has no place in an array either — JSON would make it null,
    // and null is a value Firestore stores and means something different.
    return value.map(v => encode(v === undefined ? null : v, classify))
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      // Dropped, not nulled: Firestore rejects undefined on write, and a field
      // that was absent must come back absent rather than present-and-null.
      if (v === undefined) continue
      out[escapeKey(k)] = encode(v, classify)
    }
    return out
  }

  return value
}

export function decode(value: unknown, revive: Revive): unknown {
  if (Array.isArray(value)) return value.map(v => decode(v, revive))

  if (isPlainObject(value)) {
    const kind = value[TAG]
    if (typeof kind === 'string') {
      if (kind === 'num') {
        const raw = value.value
        return raw === 'NaN' ? Number.NaN : raw === 'Infinity' ? Infinity : raw === '-Infinity' ? -Infinity : Number.NaN
      }
      // Copy-then-delete rather than destructuring the tag into an unused
      // binding: the linter is right that an unused variable is a smell, and
      // this says "everything except the tag" without one.
      const data = { ...value }
      delete data[TAG]
      return revive(kind, data)
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[unescapeKey(k)] = decode(v, revive)
    return out
  }

  return value
}

/** One document, as it is written to and read from a backup file. */
export interface BackupLine {
  id: string
  data: Record<string, unknown>
}

export function encodeDoc(id: string, data: Record<string, unknown>, classify: Classify): BackupLine {
  return { id, data: encode(data, classify) as Record<string, unknown> }
}

export function decodeDoc(line: BackupLine, revive: Revive): { id: string; data: Record<string, unknown> } {
  return { id: line.id, data: decode(line.data, revive) as Record<string, unknown> }
}

/**
 * Whether a restored document matches what the backup holds.
 *
 * Compared as ENCODED forms rather than as live objects: two Timestamps for
 * the same instant are different object identities, and a deep-equality check
 * on natives is a comparison of class internals. Encoding both sides first
 * means the comparison is over the thing that was actually backed up.
 */
export function sameEncoded(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}

/** JSON with object keys in a fixed order, so field order cannot fake a difference. */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
  }
  if (typeof value === 'number' && oddNumber(value) !== null) return `"${oddNumber(value)}"`
  return JSON.stringify(value) ?? 'null'
}
