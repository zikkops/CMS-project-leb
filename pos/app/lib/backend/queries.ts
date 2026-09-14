// What the till watches: every live list and document, as a plan any backend
// can run.
//
// POS software, stage 2 (vault: "POS Software (Local Hub) - Scope"). The till's
// screens used to build Firestore queries inline, which tied every one of them
// to the cloud. They now ask for a PosQuery; planQuery() turns it into a plain
// description, and each backend runs that description its own way — the cloud
// backend as a Firestore listener, the hub (stage 3) over its local copy with
// runPlan(). One plan, so the two cannot mean different things by "the open
// checks at this branch".
//
// No imports, so `npm run verify:backend` can compile this file alone.
//
// ── Every plan is scoped, and that is load-bearing ─────────────────────────
// Firestore bills a read per document delivered. A listener on every check
// rather than the open ones at a branch reads the whole history on first
// load. So every plan over checks, tickets or drawer shifts carries a branch
// filter, and isScoped() is asserted for every query the till can make. The
// menu, modifiers and products are whole collections on purpose: a café's menu
// is a few hundred documents, and a waiter needs all of it within two taps.

export type TimestampValue = { timestampMs: number }
export type FilterValue = string | number | readonly string[] | TimestampValue

export interface Filter {
  field: string
  op: '==' | 'in' | '>='
  value: FilterValue
}

export interface QueryPlan {
  collection: string
  /** One document by id, instead of a query. */
  docId?: string
  where: readonly Filter[]
  orderBy?: { field: string; direction: 'asc' | 'desc' }
  limit?: number
}

export type PosQuery =
  | { kind: 'openChecks'; branch: string }
  | { kind: 'check'; checkId: string }
  | { kind: 'stationTickets'; branch: string; station: string | null; statuses: readonly string[] }
  | { kind: 'readyTickets'; branch: string }
  | { kind: 'closedChecks'; branch: string; max: number }
  | { kind: 'checksClosedSince'; branch: string; sinceMs: number; ceiling: number }
  | { kind: 'recentClosedReceipts'; branch: string }
  | { kind: 'openShift'; branch: string }
  | { kind: 'menuCategories' }
  | { kind: 'menuItems' }
  | { kind: 'modifierGroups' }
  | { kind: 'products' }

/** Whole collections by design — see the note above. Everything else is scoped. */
export const WHOLE_COLLECTIONS: readonly string[] = ['menuCategories', 'menuItems', 'modifierGroups', 'products']

const eq = (field: string, value: string): Filter => ({ field, op: '==', value })

export function planQuery(q: PosQuery): QueryPlan {
  switch (q.kind) {
    case 'openChecks':
      return { collection: 'checks', where: [eq('branch', q.branch), eq('status', 'open')] }
    case 'check':
      return { collection: 'checks', docId: q.checkId, where: [] }
    case 'stationTickets':
      // A null station is every pass on one screen: small cafés have one
      // monitor for the whole kitchen.
      return {
        collection: 'kitchenTickets',
        where: [
          eq('branch', q.branch),
          ...(q.station ? [eq('station', q.station)] : []),
          { field: 'status', op: 'in', value: q.statuses },
        ],
        orderBy: { field: 'sentAt', direction: 'asc' },
      }
    case 'readyTickets':
      return {
        collection: 'kitchenTickets',
        where: [eq('branch', q.branch), eq('status', 'ready')],
        orderBy: { field: 'sentAt', direction: 'asc' },
      }
    case 'closedChecks':
      // Refunded checks stay on the review list. A refund that disappears from
      // it is a refund nobody can find afterwards.
      return {
        collection: 'checks',
        where: [eq('branch', q.branch), { field: 'status', op: 'in', value: ['closed', 'refunded'] }],
        orderBy: { field: 'closedAt', direction: 'desc' },
        limit: q.max,
      }
    case 'checksClosedSince':
      return {
        collection: 'checks',
        where: [
          eq('branch', q.branch),
          { field: 'status', op: 'in', value: ['closed', 'refunded'] },
          { field: 'closedAt', op: '>=', value: { timestampMs: q.sinceMs } },
        ],
        orderBy: { field: 'closedAt', direction: 'desc' },
        limit: q.ceiling,
      }
    case 'recentClosedReceipts':
      // The newest ten: this watches for closings, it does not list them.
      return {
        collection: 'checks',
        where: [eq('branch', q.branch), eq('status', 'closed')],
        orderBy: { field: 'closedAt', direction: 'desc' },
        limit: 10,
      }
    case 'openShift':
      return { collection: 'drawerShifts', where: [eq('branch', q.branch), { field: 'status', op: 'in', value: ['open', 'closing'] }] }
    case 'menuCategories':
    case 'menuItems':
    case 'modifierGroups':
    case 'products':
      return { collection: q.kind, where: [] }
  }
}

/** A plan reads a bounded slice: one document, a small collection by design, or one branch's documents. */
export function isScoped(plan: QueryPlan): boolean {
  if (plan.docId !== undefined) return plan.docId.length > 0
  if (WHOLE_COLLECTIONS.includes(plan.collection)) return true
  return plan.where.some(f => f.field === 'branch' && f.op === '==' && typeof f.value === 'string' && f.value.length > 0)
}

export interface LocalDoc {
  id: string
  data: Record<string, unknown>
}

const isTimestampValue = (v: FilterValue): v is TimestampValue =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'timestampMs' in v

function matches(value: unknown, f: Filter, toMs: (v: unknown) => number): boolean {
  if (value === undefined || value === null) return false
  if (f.op === '==') return value === f.value
  if (f.op === 'in') return Array.isArray(f.value) && (f.value as readonly unknown[]).includes(value)
  if (isTimestampValue(f.value)) {
    const ms = toMs(value)
    return Number.isFinite(ms) && ms >= f.value.timestampMs
  }
  return typeof value === typeof f.value && (value as number | string) >= (f.value as number | string)
}

function sortKey(value: unknown, toMs: (v: unknown) => number): number | string {
  if (typeof value === 'number' || typeof value === 'string') return value
  const ms = toMs(value)
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
}

/**
 * Runs a plan over documents held locally — what the hub will do (stage 3),
 * the way Firestore runs it in the cloud.
 *
 * Firestore's rules, kept: a document missing a field it is filtered or
 * ordered on is not in the result (a check with no closedAt is not "closed
 * since" anything), and ties in the order fall back to the document id, in
 * the same direction. `toMs` reads a timestamp field whatever shape it arrived
 * in — timestampMs() in the app.
 */
export function runPlan(plan: QueryPlan, docs: readonly LocalDoc[], toMs: (v: unknown) => number): LocalDoc[] {
  if (plan.docId !== undefined) return docs.filter(d => d.id === plan.docId).slice(0, 1)
  let out = docs.filter(d => plan.where.every(f => matches(d.data[f.field], f, toMs)))
  if (plan.orderBy) {
    const { field, direction } = plan.orderBy
    out = out.filter(d => d.data[field] !== undefined && d.data[field] !== null)
    out = [...out].sort((a, b) => {
      const x = sortKey(a.data[field], toMs)
      const y = sortKey(b.data[field], toMs)
      const c = x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      return direction === 'asc' ? c : -c
    })
  }
  return plan.limit !== undefined ? out.slice(0, Math.max(0, plan.limit)) : out
}
