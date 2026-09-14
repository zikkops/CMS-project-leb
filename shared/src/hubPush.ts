// What a café hub sends up to the cloud — POS software, stage 4.
//
// Owner's decisions (14 Sep 2026): the hub is master for its branch's trading,
// and stock goes up as MOVEMENTS, not counts (S8). The cloud's stock count
// stays the true one — deliveries and stock counts entered in admin still
// count — and it adds each movement a hub sends ("−1 Mug at Main"). Sending a
// count instead would wipe out every delivery the cloud recorded while the hub
// was offline.
//
// Pure, and asserted by verify:hub-sync. The hub's side is
// shared/src/server/hubSync.ts; the cloud's is hubDevices.ts.

/** The documents a hub is master for and sends up as they stand. */
export const PUSHED_COLLECTIONS = ['checks', 'kitchenTickets', 'drawerShifts', 'branchDrawers', 'activityLog'] as const

/** Where a hub records its stock movements until the cloud has them. */
export const MOVES_COLLECTION = 'hubStockMoves'

/** The count a movement changes, per collection: products count `stock.<branch>`, supplies `quantity.<branch>`. */
export const STOCK_FIELDS: Readonly<Record<string, string>> = { products: 'stock', supplies: 'quantity' }

/** How many changes go up in one request. A long outage goes up in several. */
export const PUSH_BATCH = 200

export interface PushedDoc {
  collection: string
  id: string
  data: Record<string, unknown> | null
}

export interface StockMove {
  /** The movement's own id, so the cloud applies it once however often it arrives. */
  id: string
  collection: string
  docId: string
  branch: string
  delta: number
}

const plainId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.includes('/')

/**
 * A movement from an increment the hub's server code made, or null when the
 * field is not a branch's stock count. `stock.Main` on a product is;
 * `price` is not, and neither is a nested path deeper than one branch.
 */
export function moveFromIncrement(collection: string, docId: string, fieldPath: string, delta: number): Omit<StockMove, 'id'> | null {
  const field = STOCK_FIELDS[collection]
  if (!field || !Number.isFinite(delta) || delta === 0) return null
  const parts = fieldPath.split('.')
  if (parts.length !== 2 || parts[0] !== field || !parts[1]) return null
  return { collection, docId, branch: parts[1], delta }
}

/** The field a movement changes on the cloud. */
export function moveField(move: Pick<StockMove, 'collection' | 'branch'>): string {
  return `${STOCK_FIELDS[move.collection]}.${move.branch}`
}

/**
 * Why the cloud refuses a movement a hub sent, or null.
 *
 * A hub moves its own branch's stock and nothing else: a credential for Main
 * cannot take stock off Second's shelf. Nor can it send an absurd number,
 * which is a bug on the hub, not a sale.
 */
export function moveProblem(raw: unknown, branch: string): string | null {
  if (!raw || typeof raw !== 'object') return 'Not a stock movement.'
  const m = raw as Partial<StockMove>
  if (!plainId(m.id)) return 'A stock movement needs its id.'
  if (typeof m.collection !== 'string' || !STOCK_FIELDS[m.collection]) return 'Only product and supply stock moves.'
  if (!plainId(m.docId)) return 'A stock movement names what it moves.'
  if (m.branch !== branch) return `A hub for ${branch} moves only ${branch}'s stock.`
  if (typeof m.delta !== 'number' || !Number.isFinite(m.delta) || m.delta === 0 || Math.abs(m.delta) > 100_000) {
    return 'A stock movement is a real, sensible number.'
  }
  return null
}

/**
 * Why the cloud refuses a document a hub sent, or null.
 *
 * Only what a hub is master for, only its own branch's, and never a deletion:
 * the till's server code never deletes a check, a ticket or a shift, so a
 * hub asking to is a hub that is wrong.
 */
export function pushProblem(raw: unknown, branch: string): string | null {
  if (!raw || typeof raw !== 'object') return 'Not a document.'
  const doc = raw as Partial<PushedDoc>
  if (typeof doc.collection !== 'string' || !(PUSHED_COLLECTIONS as readonly string[]).includes(doc.collection)) {
    return `${String(doc.collection)} is not something a hub sends.`
  }
  if (!plainId(doc.id)) return 'Not a document id.'
  if (doc.data === null) return 'A hub does not delete what it sends.'
  if (!doc.data || typeof doc.data !== 'object' || Array.isArray(doc.data)) return 'Not a document.'
  switch (doc.collection) {
    case 'checks':
    case 'kitchenTickets':
    case 'drawerShifts':
      return doc.data.branch === branch ? null : `A hub for ${branch} sends only ${branch}'s ${doc.collection}.`
    case 'branchDrawers':
      return doc.id === branch ? null : `A hub for ${branch} sends only ${branch}'s drawer.`
    default:
      return null
  }
}
