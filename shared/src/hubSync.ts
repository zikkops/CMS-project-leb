// What a café hub and the cloud agree on — POS software, stage 4.
//
// Pure: no Firestore, no network, no clock, so `npm run verify:hub-sync`
// asserts every rule here. The cloud's side is shared/src/server/hubDevices.ts,
// the hub's is shared/src/server/hubSync.ts; both only apply what this decides.
//
// ── Pairing ────────────────────────────────────────────────────────────────
// An admin asks the cloud for a one-time code for a branch. Somebody at the
// counter PC types it into the hub. The cloud swaps it for the hub's own
// credential — a device id and a secret, revocable from the admin panel — and
// never for the Firebase Admin key, which no café PC ever holds.
//
// ── Pulling ────────────────────────────────────────────────────────────────
// The cloud is master for the menu, the options, the products, the branch's
// table layout, three settings documents and who the staff are. The hub pulls
// a snapshot of exactly those (pullSpec) and planPull() works out what to
// write. Two things the hub keeps as it has them: a product's stock, because
// the hub counts what it sells, and every document the spec does not name —
// above all appSettings/invoiceCounter, the hub's receipt numbers.

/** No I, O, 0 or 1: read off a screen and typed on a till, they are the same letters. 32 of them, so a random byte picks one fairly. */
export const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const PAIRING_CODE_LENGTH = 10
/** Long enough to walk to the counter PC; short enough that a code on a sticky note is worthless tomorrow. */
export const PAIRING_CODE_MINUTES = 15

/**
 * A pairing code from random bytes. Ten letters of 32 is 50 bits: a guesser
 * with a quarter of an hour gets nowhere.
 */
export function pairingCodeFromBytes(bytes: ArrayLike<number>): string {
  if (bytes.length < PAIRING_CODE_LENGTH) throw new Error(`A pairing code needs ${PAIRING_CODE_LENGTH} random bytes.`)
  let code = ''
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) code += PAIRING_ALPHABET[bytes[i] & 31]
  return code
}

/** How a code is shown: two groups of five, easier to read out. */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

/**
 * A code as somebody typed it: any case, spaces and dashes forgiven. Anything
 * else is not a code at all, so a typo is told as a typo and never reaches the
 * cloud as a guess.
 */
export function normalizePairingCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.toUpperCase().replace(/[\s-]/g, '')
  if (code.length !== PAIRING_CODE_LENGTH) return null
  return [...code].every(c => PAIRING_ALPHABET.includes(c)) ? code : null
}

// ── The hub's credential ───────────────────────────────────────────────────

const DEVICE_ID = /^[A-Za-z0-9]{20}$/
const DEVICE_SECRET = /^[A-Za-z0-9_-]{43}$/

/** What a hub sends the cloud: `Hub <deviceId>.<secret>`. */
export function deviceAuthHeader(deviceId: string, secret: string): string {
  return `Hub ${deviceId}.${secret}`
}

/**
 * A hub's credential from an Authorization header, or null. Deliberately not
 * `Bearer`: a staff member's Firebase token can never be mistaken for a hub,
 * nor a hub's credential for a person.
 */
export function parseDeviceAuth(header: unknown): { deviceId: string; secret: string } | null {
  if (typeof header !== 'string' || !header.startsWith('Hub ')) return null
  const parts = header.slice(4).split('.')
  if (parts.length !== 2) return null
  const [deviceId, secret] = parts
  return DEVICE_ID.test(deviceId) && DEVICE_SECRET.test(secret) ? { deviceId, secret } : null
}

// ── What the cloud is master for ───────────────────────────────────────────

export interface PullSpec {
  collection: string
  /** Only these documents, when named. Anything else in the collection is the hub's own. */
  ids?: readonly string[]
  /** Fields the hub keeps as it has them once it holds the document. */
  keepLocal?: readonly string[]
}

/** The settings documents the till reads. Never the invoice counter, the error budget or anything else in appSettings. */
export const PULLED_SETTINGS = ['features', 'business', 'printing'] as const

/**
 * Why a counter PC cannot stop being the café hub yet, or none (owner's decision
 * S30): anything not yet in the cloud, or anything still open, would be left
 * behind on this PC.
 */
export function leaveHubReasons(s: { unsentDocs: number; unsentMoves: number; openChecks: number; openShift: boolean }): string[] {
  const reasons: string[] = []
  if (s.unsentDocs + s.unsentMoves > 0) {
    const n = s.unsentDocs + s.unsentMoves
    reasons.push(`${n === 1 ? 'One change has' : `${n} changes have`} not been sent to the cloud yet. Connect the internet and wait a few minutes for the hub to sync.`)
  }
  if (s.openChecks > 0) reasons.push(`${s.openChecks === 1 ? 'A table is' : `${s.openChecks} tables are`} still open. Close ${s.openChecks === 1 ? 'it' : 'them'} first.`)
  if (s.openShift) reasons.push('The drawer shift is still open. Close it with a count first.')
  return reasons
}

export function pullSpec(branch: string): PullSpec[] {
  return [
    { collection: 'menuCategories' },
    // A dish the hub's till marked sold out (UPGRADE.md T3.5) stays marked:
    // the hub is this branch's till, and the cloud does not know about it.
    { collection: 'menuItems', keepLocal: ['soldOut'] },
    { collection: 'modifierGroups' },
    // The hub counts what it sells. The cloud's figure is behind it until the
    // hub's sales go up, so it never overwrites the hub's.
    { collection: 'products', keepLocal: ['stock'] },
    { collection: 'branchTableLayouts', ids: [branch] },
    { collection: 'appSettings', ids: PULLED_SETTINGS },
    { collection: 'users' },
    // Staff phones' sign-in keys (stage 5), only those still in use and only
    // the key, its owner and its name. A key removed in the cloud leaves the
    // snapshot, so the hub deletes it and it signs nobody in.
    { collection: 'staffKeys' },
  ]
}

/**
 * The part of a staff account a hub may hold: what decides what they may do
 * at the till, and nothing else. Not their name, email, phone or points — a
 * café PC is not where a person's details should be copied to. A customer
 * account is not sent at all.
 */
export const STAFF_FIELDS = ['isStaff', 'role', 'branchIds', 'branchId', 'superadmin', 'sectionGrants', 'sectionRevocations'] as const

export function staffRecord(data: Record<string, unknown>): Record<string, unknown> | null {
  if (data.isStaff !== true) return null
  const out: Record<string, unknown> = {}
  for (const field of STAFF_FIELDS) {
    if (data[field] !== undefined) out[field] = data[field]
  }
  return out
}

export interface PulledDoc {
  collection: string
  id: string
  data: Record<string, unknown>
}

export type PullWrite =
  | { kind: 'set'; collection: string; id: string; data: Record<string, unknown> }
  | { kind: 'delete'; collection: string; id: string }

const pathOf = (collection: string, id: string) => `${collection}/${id}`

/**
 * What a hub writes to take in a snapshot from the cloud.
 *
 * - A document in the snapshot is written as the cloud has it, except the
 *   spec's `keepLocal` fields of one the hub already holds.
 * - A document the hub holds in a pulled collection — within `ids`, when the
 *   spec names them — that the snapshot lacks is deleted: a dish taken off the
 *   menu comes off the till.
 * - A document that would not change is not written, so an unchanged menu is
 *   no commit and wakes no screen.
 * - Anything in the snapshot the spec does not name is ignored: the cloud's
 *   answer cannot write the hub's receipt counter, or its checks.
 *
 * `local` is keyed `collection/id`. `same` compares two values; the hub passes
 * one that compares Timestamps by their instant. `holdLocal` says whether a
 * document's `keepLocal` fields are still the hub's: a product keeps the hub's
 * count only while it has stock movements the cloud does not have yet (S8).
 * Once they have landed, the cloud's count includes them, and it is taken.
 */
/**
 * Which documents keep their `keepLocal` fields in this pull, given the stock
 * the hub has sold and not yet sent up (`pending`, collection/id).
 *
 * A product's count is the hub's only while its movements are on the way (S8);
 * once they have landed the cloud's figure includes them, and is taken. Every
 * other kept field is the hub's for good: a dish its till marked sold out
 * (UPGRADE.md T3.5) is something the cloud never hears about, so a pull must
 * never clear it.
 */
export function holdLocalFor(pending: ReadonlySet<string>): (collection: string, id: string) => boolean {
  return (collection, id) => collection !== 'products' || pending.has(`${collection}/${id}`)
}

export function planPull(
  spec: readonly PullSpec[],
  local: ReadonlyMap<string, Record<string, unknown>>,
  snapshot: readonly PulledDoc[],
  same: (a: unknown, b: unknown) => boolean,
  holdLocal: (collection: string, id: string) => boolean = () => true,
): PullWrite[] {
  const byCollection = new Map(spec.map(s => [s.collection, s]))
  const covered = (collection: string, id: string) => {
    const s = byCollection.get(collection)
    return Boolean(s && (!s.ids || s.ids.includes(id)))
  }

  const writes: PullWrite[] = []
  const incoming = new Set<string>()
  for (const doc of snapshot) {
    if (!covered(doc.collection, doc.id) || doc.id.includes('/')) continue
    const path = pathOf(doc.collection, doc.id)
    if (incoming.has(path)) continue
    incoming.add(path)
    const held = local.get(path)
    const keep = holdLocal(doc.collection, doc.id) ? byCollection.get(doc.collection)?.keepLocal ?? [] : []
    const data: Record<string, unknown> = { ...doc.data }
    if (held) {
      for (const field of keep) {
        if (held[field] === undefined) delete data[field]
        else data[field] = held[field]
      }
    }
    if (held && same(held, data)) continue
    writes.push({ kind: 'set', collection: doc.collection, id: doc.id, data })
  }

  for (const path of local.keys()) {
    const cut = path.lastIndexOf('/')
    const collection = path.slice(0, cut)
    const id = path.slice(cut + 1)
    if (covered(collection, id) && !incoming.has(path)) writes.push({ kind: 'delete', collection, id })
  }
  return writes
}
