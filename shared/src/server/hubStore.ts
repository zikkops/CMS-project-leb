// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The café hub's own database. POS software, stage 3.
//
// ── What this is ───────────────────────────────────────────────────────────
// In software mode the counter PC is the café's hub, and the till's server
// code has to run there with no internet. That code — checks.ts, tickets.ts,
// drawer.ts, a hundred-odd reads and writes, most of them in transactions — is
// written against the Firestore Admin SDK. Rewriting it for a second database
// would make two copies of every rule about money, and two copies drift.
//
// So the hub gets a database with the same shape instead: the part of the
// Admin SDK that code uses — doc(), collection(), where / orderBy / limit,
// getAll, runTransaction, set / update / create / delete, batch, and the
// FieldValue sentinels — over a SQLite file (node:sqlite, built into the Node
// that ships inside Electron). adminDb() hands this out on a hub, and the
// server code runs unchanged. scripts/verify-hub.mjs runs the real checks,
// tickets and drawer code over it.
//
// ── What it has to get right, because Firestore does ───────────────────────
// - Transactions retry on contention. Every document read records the version
//   it saw, and every query records what it returned; at commit both are
//   checked again, and if anything moved the whole callback runs again, up to
//   five times, as the SDK does. A query is RE-RUN, not just its documents
//   re-checked: two waiters opening table 8 both see "no open check", and only
//   running the query again sees the check the other one just made.
// - A read after the first write is refused, as Firestore refuses it, so code
//   that works on the hub cannot fail in the cloud. The same goes for
//   undefined, a sentinel inside an array, and an array inside an array.
// - A missing field matches no filter and no ordering. update() refuses a
//   missing document and create() an existing one, with the SDK's error codes:
//   6 is what idempotency.ts looks for.
// - Every value comes back as what went in. Timestamps stay Timestamps, stored
//   with the same tags as a backup line (backupCodec.ts), so a hub row and a
//   backup of the cloud are one format.
//
// Commit is synchronous, because node:sqlite is: checking what a transaction
// read and writing what it wrote happen in one turn of the event loop, and no
// other request can land in between. One process owns the file.
//
// Not here: listeners (the hub's clients follow the change log instead),
// count and aggregate queries, collection groups, cursors, field masks. The
// till's server code calls none of them, and calling one fails loudly rather
// than answering wrongly.

import { randomBytes } from 'node:crypto'
import { FieldValue, GeoPoint, Timestamp } from 'firebase-admin/firestore'
import { decode, encode, stable, type Classify, type Revive } from '../backupCodec'

// ── The SQLite it runs on ─────────────────────────────────────────────────

export type SqlValue = string | number | bigint | null

/** The part of a node:sqlite statement used here, so a test can hand in its own. */
export interface SqlStatement {
  run(...params: SqlValue[]): { lastInsertRowid: number | bigint }
  get(...params: SqlValue[]): unknown
  all(...params: SqlValue[]): unknown[]
}

/** The part of node:sqlite's DatabaseSync used here. */
export interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
}

// WAL with FULL sync: a counter PC loses power mid-service, and a payment that
// was answered "ok" has to be on disk when it comes back.
const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  CREATE TABLE IF NOT EXISTS docs (
    path TEXT PRIMARY KEY,
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS docs_collection ON docs(collection);
  CREATE INDEX IF NOT EXISTS docs_branch ON docs(collection, json_extract(data, '$.branch'));
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    deleted INTEGER NOT NULL,
    at INTEGER NOT NULL
  );
`

// ── Errors, with the codes the Admin SDK uses ─────────────────────────────

const CODE_NAMES: Record<number, string> = {
  3: 'INVALID_ARGUMENT', 5: 'NOT_FOUND', 6: 'ALREADY_EXISTS', 10: 'ABORTED',
}

export class HubStoreError extends Error {
  constructor(public readonly code: number, message: string) {
    super(`${code} ${CODE_NAMES[code] ?? 'UNKNOWN'}: ${message}`)
    this.name = 'HubStoreError'
  }
}

// ── Paths and ids ─────────────────────────────────────────────────────────

type Data = Record<string, unknown>

function segments(path: string): string[] {
  const parts = String(path).split('/')
  if (parts.some(p => p === '')) throw new HubStoreError(3, `Invalid path "${path}".`)
  return parts
}

function docParts(path: string): { collection: string; id: string } {
  const parts = segments(path)
  if (parts.length % 2 !== 0) throw new HubStoreError(3, `"${path}" is not a document path.`)
  return { collection: parts.slice(0, -1).join('/'), id: parts[parts.length - 1] }
}

function checkCollectionPath(path: string): string {
  if (segments(path).length % 2 !== 1) throw new HubStoreError(3, `"${path}" is not a collection path.`)
  return path
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Twenty random characters, as Firestore's own ids. 248 = 4 × 62, so no character is likelier. */
function autoId(): string {
  let id = ''
  while (id.length < 20) {
    for (const b of randomBytes(32)) {
      if (b < 248 && id.length < 20) id += ID_CHARS[b % 62]
    }
  }
  return id
}

// ── Values ────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Data {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function getPath(data: unknown, field: string): unknown {
  let node = data
  for (const part of field.split('.')) {
    if (!isPlainObject(node)) return undefined
    node = node[part]
  }
  return node
}

const DELETE = Symbol('delete')

/**
 * A FieldValue sentinel, read once when the write is made.
 *
 * The SDK's sentinels keep their operand in fields it does not document
 * (`operand`, `elements`). Reading them here, at the call, means a firebase-admin
 * upgrade that renames one fails the write with a sentence — and fails
 * verify:hub — rather than incrementing by undefined.
 */
class Transform {
  constructor(
    readonly kind: string,
    readonly operand: number = 0,
    readonly elements: unknown[] = [],
  ) {}

  resolve(existing: unknown, now: Timestamp): unknown {
    switch (this.kind) {
      case 'FieldValue.serverTimestamp': return now
      // Not a number, or not there: Firestore sets the operand.
      case 'FieldValue.increment': return typeof existing === 'number' ? existing + this.operand : this.operand
      case 'FieldValue.minimum': return typeof existing === 'number' ? Math.min(existing, this.operand) : this.operand
      case 'FieldValue.maximum': return typeof existing === 'number' ? Math.max(existing, this.operand) : this.operand
      case 'FieldValue.arrayUnion': {
        const list = Array.isArray(existing) ? [...existing] : []
        const seen = new Set(list.map(valueKey))
        for (const e of this.elements) {
          const k = valueKey(e)
          if (!seen.has(k)) { seen.add(k); list.push(e) }
        }
        return list
      }
      case 'FieldValue.arrayRemove': {
        const drop = new Set(this.elements.map(valueKey))
        return Array.isArray(existing) ? existing.filter(e => !drop.has(valueKey(e))) : []
      }
      case 'FieldValue.delete': return DELETE
      default: throw new HubStoreError(3, `The hub does not support ${this.kind}().`)
    }
  }
}

function toTransform(value: FieldValue, where: string): Transform {
  const kind = String((value as unknown as { methodName?: unknown }).methodName ?? 'FieldValue')
  const raw = value as unknown as { operand?: unknown; elements?: unknown }
  if (kind === 'FieldValue.increment' || kind === 'FieldValue.minimum' || kind === 'FieldValue.maximum') {
    if (typeof raw.operand !== 'number') {
      throw new HubStoreError(3, `${kind}() arrived without a number the hub can read (field "${where}").`)
    }
    return new Transform(kind, raw.operand)
  }
  if (kind === 'FieldValue.arrayUnion' || kind === 'FieldValue.arrayRemove') {
    if (!Array.isArray(raw.elements)) {
      throw new HubStoreError(3, `${kind}() arrived without elements the hub can read (field "${where}").`)
    }
    return new Transform(kind, 0, raw.elements.map((e, i) => prepare(e, `${where}.${i}`, true)))
  }
  if (kind === 'FieldValue.serverTimestamp' || kind === 'FieldValue.delete') return new Transform(kind)
  throw new HubStoreError(3, `The hub does not support ${kind}() (field "${where}").`)
}

/**
 * Copies a value at the moment it is written, refusing what Firestore refuses.
 *
 * Copied now rather than at commit because the SDK serialises at the call: a
 * caller that changes its object after tx.set() has not changed the write.
 */
function prepare(value: unknown, where: string, inArray: boolean): unknown {
  const field = where || '(document)'
  if (value === undefined) {
    throw new HubStoreError(3, `Cannot use "undefined" as a Firestore value (found in field "${field}").`)
  }
  if (value instanceof FieldValue) {
    if (inArray) throw new HubStoreError(3, `A FieldValue cannot be used inside an array (found in field "${field}").`)
    return toTransform(value, field)
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return value
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new HubStoreError(3, `An invalid Date (found in field "${field}").`)
    return Timestamp.fromDate(value)
  }
  if (value instanceof Timestamp || value instanceof GeoPoint || value instanceof LocalDocumentReference) return value
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (Array.isArray(value)) {
    return value.map((v, i) => {
      if (Array.isArray(v)) throw new HubStoreError(3, `An array cannot hold an array (found in field "${field}").`)
      return prepare(v, `${where}.${i}`, true)
    })
  }
  if (isPlainObject(value)) {
    const out: Data = {}
    for (const [k, v] of Object.entries(value)) out[k] = prepare(v, where ? `${where}.${k}` : k, inArray)
    return out
  }
  const type = (value as { constructor?: { name?: string } })?.constructor?.name ?? typeof value
  throw new HubStoreError(3, `Couldn't serialize a value of type "${type}" (found in field "${field}").`)
}

/** Resolves the sentinels in a value against what was there. A delete is only allowed where Firestore allows it. */
function materialise(value: unknown, existing: unknown, now: Timestamp, where: string, allowDelete: boolean): unknown {
  if (value instanceof Transform) {
    if (value.kind === 'FieldValue.delete' && !allowDelete) {
      throw new HubStoreError(3,
        `FieldValue.delete() can only be used in update() or set() with {merge: true} (found in field "${where}").`)
    }
    return value.resolve(existing, now)
  }
  if (isPlainObject(value)) {
    const out: Data = {}
    for (const [k, v] of Object.entries(value)) {
      const r = materialise(v, isPlainObject(existing) ? existing[k] : undefined, now, where ? `${where}.${k}` : k, false)
      if (r !== DELETE) out[k] = r
    }
    return out
  }
  return value
}

/** set() with merge: maps merge field by field, all the way down. */
function mergeInto(target: Data, data: Data, now: Timestamp): Data {
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Transform) {
      const r = v.resolve(target[k], now)
      if (r === DELETE) delete target[k]
      else target[k] = r
    } else if (isPlainObject(v)) {
      if (!isPlainObject(target[k])) target[k] = {}
      mergeInto(target[k] as Data, v, now)
    } else {
      target[k] = v
    }
  }
  return target
}

/**
 * Every increment in a write's data, as [field path, amount]. An update's keys
 * are field paths already; a merge nests them in maps.
 */
function increments(data: Data, keysArePaths: boolean, prefix = ''): [string, number][] {
  const found: [string, number][] = []
  for (const [key, value] of Object.entries(data)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value instanceof Transform) {
      if (value.kind === 'FieldValue.increment') found.push([path, value.operand])
    } else if (!keysArePaths && isPlainObject(value)) {
      found.push(...increments(value, false, path))
    }
  }
  return found
}

/** update(): each key is a field path, and its value replaces what is at that path. */
function updatePath(target: Data, field: string, value: unknown, now: Timestamp): void {
  const parts = field.split('.')
  const last = parts[parts.length - 1]
  const deleting = value instanceof Transform && value.kind === 'FieldValue.delete'
  let node = target
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(node[part])) {
      if (deleting) return
      node[part] = {}
    }
    node = node[part] as Data
  }
  const r = materialise(value, node[last], now, field, true)
  if (r === DELETE) delete node[last]
  else node[last] = r
}

// ── Ordering and matching, in Firestore's order of types ──────────────────

function typeRank(v: unknown): number {
  if (v === null) return 0
  if (typeof v === 'boolean') return 1
  if (typeof v === 'number') return 2
  if (v instanceof Timestamp) return 3
  if (typeof v === 'string') return 4
  if (Buffer.isBuffer(v)) return 5
  if (v instanceof LocalDocumentReference) return 6
  if (v instanceof GeoPoint) return 7
  if (Array.isArray(v)) return 8
  return 9
}

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0)

export function compareValues(a: unknown, b: unknown): number {
  const ra = typeRank(a)
  const rb = typeRank(b)
  if (ra !== rb) return sign(ra - rb)
  switch (ra) {
    case 0: return 0
    case 1: return sign(Number(a) - Number(b))
    case 2: {
      const x = a as number
      const y = b as number
      if (Number.isNaN(x)) return Number.isNaN(y) ? 0 : -1
      if (Number.isNaN(y)) return 1
      return sign(x - y)
    }
    case 3: {
      const x = a as Timestamp
      const y = b as Timestamp
      return x.seconds !== y.seconds ? sign(x.seconds - y.seconds) : sign(x.nanoseconds - y.nanoseconds)
    }
    case 4: return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0
    case 5: return sign(Buffer.compare(a as Buffer, b as Buffer))
    case 6: return compareValues((a as LocalDocumentReference).path, (b as LocalDocumentReference).path)
    case 7: {
      const x = a as GeoPoint
      const y = b as GeoPoint
      return x.latitude !== y.latitude ? sign(x.latitude - y.latitude) : sign(x.longitude - y.longitude)
    }
    case 8: {
      const x = a as unknown[]
      const y = b as unknown[]
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const c = compareValues(x[i], y[i])
        if (c !== 0) return c
      }
      return sign(x.length - y.length)
    }
    default: {
      const x = a as Data
      const y = b as Data
      const kx = Object.keys(x).sort()
      const ky = Object.keys(y).sort()
      for (let i = 0; i < Math.min(kx.length, ky.length); i++) {
        if (kx[i] !== ky[i]) return kx[i] < ky[i] ? -1 : 1
        const c = compareValues(x[kx[i]], y[ky[i]])
        if (c !== 0) return c
      }
      return sign(kx.length - ky.length)
    }
  }
}

const equal = (a: unknown, b: unknown) => compareValues(a, b) === 0

type Op = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any'
const OPS = new Set<string>(['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains', 'array-contains-any'])
const LIST_OPS = new Set<string>(['in', 'not-in', 'array-contains-any'])
const INEQUALITY_OPS = new Set<string>(['!=', '<', '<=', '>', '>=', 'not-in'])

interface Filter { field: string; op: Op; value: unknown }
interface Order { field: string; dir: 'asc' | 'desc' }

function matches(data: Data, f: Filter): boolean {
  const v = getPath(data, f.field)
  // A missing field matches nothing — not even != or not-in.
  if (v === undefined) return false
  const list = Array.isArray(f.value) ? f.value : []
  switch (f.op) {
    case '==': return equal(v, f.value)
    case '!=': return v !== null && !equal(v, f.value)
    // A range only ever matches values of the same type.
    case '<': return typeRank(v) === typeRank(f.value) && compareValues(v, f.value) < 0
    case '<=': return typeRank(v) === typeRank(f.value) && compareValues(v, f.value) <= 0
    case '>': return typeRank(v) === typeRank(f.value) && compareValues(v, f.value) > 0
    case '>=': return typeRank(v) === typeRank(f.value) && compareValues(v, f.value) >= 0
    case 'in': return list.some(x => equal(v, x))
    case 'not-in': return v !== null && !list.some(x => equal(v, x))
    case 'array-contains': return Array.isArray(v) && v.some(x => equal(x, f.value))
    case 'array-contains-any': return Array.isArray(v) && v.some(x => list.some(y => equal(x, y)))
  }
}

/** A Firestore-shaped key for "is this the same value", as arrayUnion needs. */
function valueKey(v: unknown): string {
  return stable(encode(v, classify))
}

const classify: Classify = value => {
  if (value instanceof Timestamp) return { kind: 'ts', data: { s: value.seconds, n: value.nanoseconds } }
  if (value instanceof GeoPoint) return { kind: 'geo', data: { lat: value.latitude, lng: value.longitude } }
  if (value instanceof LocalDocumentReference) return { kind: 'ref', data: { path: value.path } }
  if (Buffer.isBuffer(value)) return { kind: 'bytes', data: { b64: value.toString('base64') } }
  return null
}

// A field SQLite may pre-filter on: plain names only, so nothing reaches the SQL text unchecked.
const SQL_FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/

/** Every read lets the event loop turn, as a read over a network does, so concurrent requests interleave. */
const yieldTurn = () => new Promise<void>(resolve => setImmediate(resolve))

// ── Snapshots ─────────────────────────────────────────────────────────────

export class LocalDocumentSnapshot {
  constructor(
    readonly ref: LocalDocumentReference,
    private readonly raw: string | null,
    /** The change sequence number of the last write; 0 when missing. */
    readonly version: number,
  ) {}

  get id(): string { return this.ref.id }
  get exists(): boolean { return this.raw !== null }

  /** A fresh copy every call: changing it changes nothing stored. */
  data(): Data | undefined {
    return this.raw === null ? undefined : this.ref.firestore.decodeRow(this.raw)
  }

  get(field: string): unknown {
    return getPath(this.data(), field)
  }
}

export class LocalQuerySnapshot {
  constructor(readonly docs: LocalDocumentSnapshot[]) {}
  get empty(): boolean { return this.docs.length === 0 }
  get size(): number { return this.docs.length }
  forEach(fn: (doc: LocalDocumentSnapshot) => void): void { this.docs.forEach(fn) }
}

// ── References and queries ────────────────────────────────────────────────

export class LocalQuery {
  constructor(
    readonly firestore: HubStore,
    /** The collection this reads. */
    readonly path: string,
    readonly filters: readonly Filter[] = [],
    readonly orders: readonly Order[] = [],
    readonly max: number | null = null,
  ) {}

  where(field: unknown, op: string, value: unknown): LocalQuery {
    if (typeof field !== 'string' || !field) throw new HubStoreError(3, 'The hub supports field paths written as strings.')
    if (!OPS.has(op)) throw new HubStoreError(3, `Unknown query operator "${op}".`)
    if (LIST_OPS.has(op) && (!Array.isArray(value) || value.length === 0)) {
      throw new HubStoreError(3, `"${op}" needs a non-empty array.`)
    }
    if (value instanceof FieldValue) throw new HubStoreError(3, 'A FieldValue cannot be used in a query.')
    const prepared = prepare(value, field, false)
    return new LocalQuery(this.firestore, this.path, [...this.filters, { field, op: op as Op, value: prepared }], this.orders, this.max)
  }

  orderBy(field: unknown, dir: 'asc' | 'desc' = 'asc'): LocalQuery {
    if (typeof field !== 'string' || !field) throw new HubStoreError(3, 'The hub supports field paths written as strings.')
    if (dir !== 'asc' && dir !== 'desc') throw new HubStoreError(3, `Unknown direction "${String(dir)}".`)
    return new LocalQuery(this.firestore, this.path, this.filters, [...this.orders, { field, dir }], this.max)
  }

  limit(n: number): LocalQuery {
    if (!Number.isInteger(n) || n < 1) throw new HubStoreError(3, 'A limit must be a whole number above zero.')
    return new LocalQuery(this.firestore, this.path, this.filters, this.orders, n)
  }

  async get(): Promise<LocalQuerySnapshot> {
    await yieldTurn()
    return new LocalQuerySnapshot(this.firestore.runQuery(this))
  }
}

export class LocalCollectionReference extends LocalQuery {
  constructor(firestore: HubStore, path: string) {
    super(firestore, checkCollectionPath(path))
  }

  get id(): string { return segments(this.path).pop() as string }

  doc(id?: string): LocalDocumentReference {
    return new LocalDocumentReference(this.firestore, this.path, id === undefined ? autoId() : String(id))
  }

  async add(data: Data): Promise<LocalDocumentReference> {
    const ref = this.doc()
    await ref.create(data)
    return ref
  }
}

export class LocalDocumentReference {
  constructor(readonly firestore: HubStore, private readonly collectionPath: string, readonly id: string) {
    if (!id || id.includes('/')) throw new HubStoreError(3, `Invalid document id "${id}".`)
  }

  get path(): string { return `${this.collectionPath}/${this.id}` }
  get parent(): LocalCollectionReference { return new LocalCollectionReference(this.firestore, this.collectionPath) }
  collection(path: string): LocalCollectionReference { return new LocalCollectionReference(this.firestore, `${this.path}/${path}`) }
  isEqual(other: unknown): boolean { return other instanceof LocalDocumentReference && other.path === this.path }

  async get(): Promise<LocalDocumentSnapshot> {
    await yieldTurn()
    return this.firestore.readDoc(this)
  }

  async set(data: Data, options?: { merge?: boolean }): Promise<{ writeTime: Timestamp }> {
    return this.firestore.commitWrites([setWrite(this, data, options)])
  }

  async update(data: Data): Promise<{ writeTime: Timestamp }> {
    return this.firestore.commitWrites([updateWrite(this, data)])
  }

  async create(data: Data): Promise<{ writeTime: Timestamp }> {
    return this.firestore.commitWrites([createWrite(this, data)])
  }

  async delete(): Promise<{ writeTime: Timestamp }> {
    return this.firestore.commitWrites([{ kind: 'delete', path: this.path }])
  }
}

// ── Writes ────────────────────────────────────────────────────────────────

type Write =
  | { kind: 'set'; path: string; data: Data; merge: boolean }
  | { kind: 'update'; path: string; data: Data }
  | { kind: 'create'; path: string; data: Data }
  | { kind: 'delete'; path: string }

function refOf(target: unknown): LocalDocumentReference {
  if (!(target instanceof LocalDocumentReference)) throw new HubStoreError(3, 'Expected a document reference from the hub.')
  return target
}

function documentData(data: unknown): Data {
  if (!isPlainObject(data)) throw new HubStoreError(3, 'A document must be an object.')
  return prepare(data, '', false) as Data
}

function setWrite(target: unknown, data: unknown, options?: { merge?: boolean; mergeFields?: unknown }): Write {
  if (options && options.mergeFields !== undefined) throw new HubStoreError(3, 'The hub does not support mergeFields.')
  return { kind: 'set', path: refOf(target).path, data: documentData(data), merge: options?.merge === true }
}

function updateWrite(target: unknown, data: unknown): Write {
  if (!isPlainObject(data)) throw new HubStoreError(3, 'The hub supports update(ref, { field: value }) only.')
  const out: Data = {}
  for (const [field, value] of Object.entries(data)) {
    segments(field.replace(/\./g, '/'))
    out[field] = prepare(value, field, false)
  }
  return { kind: 'update', path: refOf(target).path, data: out }
}

function createWrite(target: unknown, data: unknown): Write {
  return { kind: 'create', path: refOf(target).path, data: documentData(data) }
}

function applyWrite(w: Write, current: Data | null, now: Timestamp): Data | null {
  switch (w.kind) {
    case 'delete': return null
    case 'create':
      if (current) throw new HubStoreError(6, `Document already exists: ${w.path}`)
      return materialise(w.data, undefined, now, '', false) as Data
    case 'set':
      return w.merge ? mergeInto(current ?? {}, w.data, now) : materialise(w.data, undefined, now, '', false) as Data
    case 'update': {
      if (!current) throw new HubStoreError(5, `No document to update: ${w.path}`)
      for (const [field, value] of Object.entries(w.data)) updatePath(current, field, value, now)
      return current
    }
  }
}

export class LocalTransaction {
  readonly writes: Write[] = []
  readonly docReads = new Map<string, number>()
  readonly queryReads: { query: LocalQuery; signature: string }[] = []

  constructor(private readonly store: HubStore) {}

  private beforeRead(): void {
    if (this.writes.length > 0) {
      throw new HubStoreError(3, 'Firestore transactions require all reads to be executed before all writes.')
    }
  }

  private noteDoc(snap: LocalDocumentSnapshot): LocalDocumentSnapshot {
    if (!this.docReads.has(snap.ref.path)) this.docReads.set(snap.ref.path, snap.version)
    return snap
  }

  get(target: LocalDocumentReference): Promise<LocalDocumentSnapshot>
  get(target: LocalQuery): Promise<LocalQuerySnapshot>
  async get(target: LocalDocumentReference | LocalQuery): Promise<LocalDocumentSnapshot | LocalQuerySnapshot> {
    this.beforeRead()
    await yieldTurn()
    if (target instanceof LocalDocumentReference) return this.noteDoc(this.store.readDoc(target))
    if (target instanceof LocalQuery) {
      const docs = this.store.runQuery(target)
      this.queryReads.push({ query: target, signature: signature(docs) })
      return new LocalQuerySnapshot(docs)
    }
    throw new HubStoreError(3, 'Expected a document reference or a query from the hub.')
  }

  async getAll(...targets: unknown[]): Promise<LocalDocumentSnapshot[]> {
    this.beforeRead()
    await yieldTurn()
    return targets.filter(t => t instanceof LocalDocumentReference)
      .map(t => this.noteDoc(this.store.readDoc(t as LocalDocumentReference)))
  }

  set(ref: unknown, data: unknown, options?: { merge?: boolean }): this {
    this.writes.push(setWrite(ref, data, options))
    return this
  }

  update(ref: unknown, data: unknown): this {
    this.writes.push(updateWrite(ref, data))
    return this
  }

  create(ref: unknown, data: unknown): this {
    this.writes.push(createWrite(ref, data))
    return this
  }

  delete(ref: unknown): this {
    this.writes.push({ kind: 'delete', path: refOf(ref).path })
    return this
  }
}

export class LocalWriteBatch {
  private readonly writes: Write[] = []
  private committed = false

  constructor(private readonly store: HubStore) {}

  set(ref: unknown, data: unknown, options?: { merge?: boolean }): this { this.writes.push(setWrite(ref, data, options)); return this }
  update(ref: unknown, data: unknown): this { this.writes.push(updateWrite(ref, data)); return this }
  create(ref: unknown, data: unknown): this { this.writes.push(createWrite(ref, data)); return this }
  delete(ref: unknown): this { this.writes.push({ kind: 'delete', path: refOf(ref).path }); return this }

  async commit(): Promise<{ writeTime: Timestamp }[]> {
    if (this.committed) throw new HubStoreError(3, 'This batch has already been committed.')
    this.committed = true
    const { writeTime } = this.store.commitWrites(this.writes)
    return this.writes.map(() => ({ writeTime }))
  }
}

function signature(docs: LocalDocumentSnapshot[]): string {
  return docs.map(d => `${d.ref.path}@${d.version}`).join('\n')
}

// ── The store ─────────────────────────────────────────────────────────────

/** One document written, as the hub's clients and the cloud sync follow it. */
export interface HubChange {
  seq: number
  path: string
  collection: string
  id: string
  deleted: boolean
  at: number
}

interface DocRow { path: string; data: string; version: number }

export interface HubStoreOptions {
  /**
   * Told of every increment a commit makes, with the document, the field and
   * the amount. What it returns is written as a new document in
   * `journalCollection` IN THE SAME COMMIT, so an increment and its record land
   * together or not at all — and a transaction that runs again records nothing
   * twice, because nothing is recorded until it commits. The hub records its
   * stock movements this way (shared/src/hubPush.ts). Null records nothing.
   */
  journal?: (collection: string, id: string, field: string, delta: number) => Record<string, unknown> | null
  journalCollection?: string
}

export class HubStore {
  private readonly listeners = new Set<(changes: HubChange[]) => void>()
  private retries = 0
  private readonly stmt: {
    readDoc: SqlStatement
    upsert: SqlStatement
    remove: SqlStatement
    logChange: SqlStatement
    since: SqlStatement
    lastSeq: SqlStatement
    readMeta: SqlStatement
    writeMeta: SqlStatement
  }

  constructor(private readonly sql: SqlDatabase, private readonly options: HubStoreOptions = {}) {
    sql.exec(SCHEMA)
    this.stmt = {
      readDoc: sql.prepare('SELECT path, data, version FROM docs WHERE path = ?'),
      upsert: sql.prepare(
        'INSERT INTO docs (path, collection, id, data, version, updated_at) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(path) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at'),
      remove: sql.prepare('DELETE FROM docs WHERE path = ?'),
      logChange: sql.prepare('INSERT INTO changes (path, collection, id, deleted, at) VALUES (?, ?, ?, ?, ?)'),
      since: sql.prepare('SELECT seq, path, collection, id, deleted, at FROM changes WHERE seq > ? ORDER BY seq LIMIT ?'),
      lastSeq: sql.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM changes'),
      readMeta: sql.prepare('SELECT value FROM meta WHERE key = ?'),
      writeMeta: sql.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    }
  }

  private readonly revive: Revive = (kind, data) => {
    switch (kind) {
      case 'ts': return new Timestamp(Number(data.s), Number(data.n))
      case 'geo': return new GeoPoint(Number(data.lat), Number(data.lng))
      case 'ref': return this.doc(String(data.path))
      case 'bytes': return Buffer.from(String(data.b64), 'base64')
      default: throw new HubStoreError(3, `A stored value of unknown kind "${kind}".`)
    }
  }

  decodeRow(raw: string): Data {
    return decode(JSON.parse(raw), this.revive) as Data
  }

  /** A value tagged as a backup line is (a pulled snapshot), rebuilt with this store's Timestamps and references. */
  decodeValue(value: unknown): unknown {
    return decode(value, this.revive)
  }

  doc(path: string): LocalDocumentReference {
    const { collection, id } = docParts(path)
    return new LocalDocumentReference(this, collection, id)
  }

  collection(path: string): LocalCollectionReference {
    return new LocalCollectionReference(this, path)
  }

  batch(): LocalWriteBatch {
    return new LocalWriteBatch(this)
  }

  async getAll(...targets: unknown[]): Promise<LocalDocumentSnapshot[]> {
    await yieldTurn()
    return targets.filter(t => t instanceof LocalDocumentReference).map(t => this.readDoc(t as LocalDocumentReference))
  }

  async runTransaction<T>(fn: (tx: LocalTransaction) => Promise<T>, options?: { maxAttempts?: number }): Promise<T> {
    const attempts = options?.maxAttempts ?? 5
    for (let attempt = 1; ; attempt++) {
      const tx = new LocalTransaction(this)
      // A throw from the callback is the caller's answer, never retried.
      const result = await fn(tx)
      if (this.commit(tx.writes, tx)) return result
      if (attempt >= attempts) {
        throw new HubStoreError(10, 'Transaction aborted: these documents kept changing while it ran.')
      }
      this.retries++
    }
  }

  readDoc(ref: LocalDocumentReference): LocalDocumentSnapshot {
    const row = this.stmt.readDoc.get(ref.path) as DocRow | undefined
    return new LocalDocumentSnapshot(ref, row ? row.data : null, row ? Number(row.version) : 0)
  }

  runQuery(query: LocalQuery): LocalDocumentSnapshot[] {
    // Equality on a plain string or number narrows in SQLite first; every
    // filter is then applied here, which is the answer that counts.
    let text = 'SELECT path, data, version FROM docs WHERE collection = ?'
    const params: SqlValue[] = [query.path]
    for (const f of query.filters) {
      const narrowable = typeof f.value === 'string' || (typeof f.value === 'number' && Number.isFinite(f.value))
      if (f.op === '==' && narrowable && SQL_FIELD.test(f.field)) {
        text += ` AND json_extract(data, '$.${f.field}') = ?`
        params.push(f.value as string | number)
      }
    }
    const rows = this.sql.prepare(text).all(...params) as DocRow[]

    let found = rows.map(r => ({ row: r, id: docParts(r.path).id, data: this.decodeRow(r.data) }))
      .filter(d => query.filters.every(f => matches(d.data, f)))

    // With no ordering asked for, an inequality orders by its own field first,
    // as Firestore does; and whatever remains is ordered by document id.
    const orders: Order[] = [...query.orders]
    if (orders.length === 0) {
      const inequality = query.filters.find(f => INEQUALITY_OPS.has(f.op))
      if (inequality) orders.push({ field: inequality.field, dir: 'asc' })
    }
    found = found.filter(d => orders.every(o => getPath(d.data, o.field) !== undefined))
    const tieDir = orders.length ? orders[orders.length - 1].dir : 'asc'
    found.sort((a, b) => {
      for (const o of orders) {
        const c = compareValues(getPath(a.data, o.field), getPath(b.data, o.field))
        if (c !== 0) return o.dir === 'asc' ? c : -c
      }
      const c = a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      return tieDir === 'asc' ? c : -c
    })
    if (query.max !== null) found = found.slice(0, query.max)

    const collection = new LocalCollectionReference(this, query.path)
    return found.map(d => new LocalDocumentSnapshot(collection.doc(d.id), d.row.data, Number(d.row.version)))
  }

  commitWrites(writes: Write[]): { writeTime: Timestamp } {
    let writeTime = Timestamp.now()
    this.commit(writes, null, t => { writeTime = t })
    return { writeTime }
  }

  /**
   * Checks what a transaction read and, if nothing moved, writes what it wrote.
   * False means it has to run again. Synchronous from start to end.
   */
  private commit(writes: Write[], tx: LocalTransaction | null, onTime?: (t: Timestamp) => void): boolean {
    if (tx) {
      for (const [path, version] of tx.docReads) {
        const row = this.stmt.readDoc.get(path) as DocRow | undefined
        if ((row ? Number(row.version) : 0) !== version) return false
      }
      for (const { query, signature: seen } of tx.queryReads) {
        if (signature(this.runQuery(query)) !== seen) return false
      }
    }
    if (writes.length === 0) return true

    // Every write is worked out before anything is stored, so a write that is
    // refused — update() on a missing document — leaves nothing half-done.
    const now = Timestamp.now()
    onTime?.(now)
    const working = new Map<string, Data | null>()
    for (const w of writes) {
      const current = working.has(w.path) ? working.get(w.path) ?? null : this.currentData(w.path)
      working.set(w.path, applyWrite(w, current, now))
    }
    // Increments recorded in the same commit as the increments themselves.
    const { journal, journalCollection } = this.options
    if (journal && journalCollection) {
      for (const w of writes) {
        if (w.kind !== 'update' && !(w.kind === 'set' && w.merge)) continue
        const { collection, id } = docParts(w.path)
        if (collection === journalCollection) continue
        for (const [field, delta] of increments(w.data, w.kind === 'update')) {
          const entry = journal(collection, id, field, delta)
          if (entry) working.set(`${journalCollection}/${autoId()}`, { ...entry, at: now })
        }
      }
    }
    const encoded = [...working].map(([path, data]) => ({
      path, ...docParts(path), json: data === null ? null : JSON.stringify(encode(data, classify)),
    }))

    const at = Date.now()
    const changes: HubChange[] = []
    this.sql.exec('BEGIN IMMEDIATE')
    try {
      for (const e of encoded) {
        const seq = Number(this.stmt.logChange.run(e.path, e.collection, e.id, e.json === null ? 1 : 0, at).lastInsertRowid)
        if (e.json === null) this.stmt.remove.run(e.path)
        else this.stmt.upsert.run(e.path, e.collection, e.id, e.json, seq, at)
        changes.push({ seq, path: e.path, collection: e.collection, id: e.id, deleted: e.json === null, at })
      }
      this.sql.exec('COMMIT')
    } catch (err) {
      this.sql.exec('ROLLBACK')
      throw err
    }

    for (const listener of this.listeners) {
      try { listener(changes) } catch (err) { console.error('[hub] a change listener failed:', err) }
    }
    return true
  }

  private currentData(path: string): Data | null {
    const row = this.stmt.readDoc.get(path) as DocRow | undefined
    return row ? this.decodeRow(row.data) : null
  }

  /** Told after every commit, with what it wrote. Returns the unsubscribe. */
  onChange(listener: (changes: HubChange[]) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The change log after a sequence number, oldest first. */
  changesSince(seq: number, max = 500): HubChange[] {
    return (this.stmt.since.all(seq, max) as Record<string, unknown>[]).map(r => ({
      seq: Number(r.seq), path: String(r.path), collection: String(r.collection), id: String(r.id),
      deleted: Number(r.deleted) === 1, at: Number(r.at),
    }))
  }

  lastSeq(): number {
    return Number((this.stmt.lastSeq.get() as { seq: number | bigint }).seq)
  }

  /**
   * Bookkeeping that is not data: how far the hub has sent its changes up.
   * Kept outside the change log on purpose — recording "sent up to 40" as a
   * document would itself be change 41, and the hub would never be done.
   */
  readMeta(key: string): string | null {
    const row = this.stmt.readMeta.get(key) as { value: string } | undefined
    return row ? row.value : null
  }

  writeMeta(key: string, value: string): void {
    this.stmt.writeMeta.run(key, value)
  }

  /** How many transactions had to run again. For the verifier and the hub's health line. */
  stats(): { retries: number } {
    return { retries: this.retries }
  }
}

/** A value as it leaves the hub for a browser: tagged as a backup line is, so a Timestamp arrives as one. */
export function encodeHubValue(value: unknown): unknown {
  return encode(value, classify)
}

export function openHubStore(sql: SqlDatabase, options: HubStoreOptions = {}): HubStore {
  return new HubStore(sql, options)
}
