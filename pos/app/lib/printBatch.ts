// Which tickets to print, as a pure decision.
//
// Pulled out of useAutoPrint so it can be asserted against rather than argued
// about. The first version lived inside a useEffect and was reasoned correct —
// and it was not: switching the KDS from Kitchen to Bar handed it the bar
// pass's whole current list with nothing marking it as a new subscription, so
// every ticket already on that pass would have printed at once. The exact
// backlog failure the hook's own header says it prevents. A decision this easy
// to get wrong by reading belongs somewhere a script can run it.
//
// No imports on purpose — not even types — so scripts/verify-printing.mjs can
// transpile it standalone.

export interface PrintBatchState {
  /** Ids already handled under any scope. Never forgotten while the page lives. */
  seen: ReadonlySet<string>
  /** The scope whose first snapshot has been absorbed as history, or null. */
  primedScope: string | null
}

export interface PrintBatchInput {
  /**
   * What the screen is subscribed to — branch and station filter. A change of
   * scope is a new listener, and a new listener's first snapshot is history.
   */
  scope: string
  /** The current list, for the current scope. */
  ids: readonly string[]
  /** Still waiting for the first snapshot of this scope. */
  ticketsLoading: boolean
  /** Still waiting for the printer configuration. */
  settingsLoading: boolean
  /** Whether this device prints at all. */
  on: boolean
}

export interface PrintBatchResult {
  state: PrintBatchState
  /** Ids to print now, in list order. */
  print: string[]
}

export const EMPTY_PRINT_STATE: PrintBatchState = { seen: new Set(), primedScope: null }

export function nextPrintBatch(prev: PrintBatchState, input: PrintBatchInput): PrintBatchResult {
  // Nothing is decided until both answers are in. Deciding early would absorb
  // a list as history under the wrong conditions, and the first real batch
  // after it would be skipped or, worse, doubled.
  if (input.ticketsLoading || input.settingsLoading) return { state: prev, print: [] }

  const seen = new Set(prev.seen)

  // First snapshot of this scope — on mount, or after a station switch.
  // Everything in it was already on the pass before this screen was looking,
  // so it is recorded and not printed.
  if (prev.primedScope !== input.scope) {
    for (const id of input.ids) seen.add(id)
    return { state: { seen, primedScope: input.scope }, print: [] }
  }

  const fresh = input.ids.filter(id => !seen.has(id))
  // Marked whether or not this device prints: a ticket that arrived while
  // printing was off is history the moment printing is switched on, not a
  // backlog waiting to come out.
  for (const id of fresh) seen.add(id)

  return {
    state: { seen, primedScope: prev.primedScope },
    print: input.on ? fresh : [],
  }
}

// ── Receipts on close ──────────────────────────────────────────────────────
//
// A different shape from tickets, because the listener is different. Receipts
// come from a listener on recently CLOSED checks, limited to the newest ten,
// and that limit is a trap: when a check is refunded it leaves the "closed"
// query, and the eleventh-newest closed check slides into the window as an
// "added" change. A decision keyed only on "added, and not seen before" would
// print that old check's receipt — a customer from an hour ago, on the bar
// printer, mid-service.
//
// So a watermark: the newest closedAt in the subscription's first snapshot.
// Only a check closed AFTER it can print. It is taken from the documents, which
// carry server time, never from this device's clock — a till whose clock is
// five minutes slow must not decide what counts as new.
//
// State is per subscription. The hook starts a fresh one each time it
// subscribes, so there is no stale list for a toggle or a reconnect to replay.

export interface ReceiptDoc {
  id: string
  status: string
  /** closedAt in ms, or NaN while a server timestamp has not resolved. */
  closedAtMs: number
}

export interface ReceiptBatchState {
  primed: boolean
  /** Newest closedAt present when the subscription started. */
  watermark: number
  seen: ReadonlySet<string>
}

export const EMPTY_RECEIPT_STATE: ReceiptBatchState = { primed: false, watermark: 0, seen: new Set() }

/**
 * @param docs     everything in the current snapshot — used only to prime
 * @param changes  what changed in it: Firestore's added and modified documents
 */
export function nextReceiptBatch(
  prev: ReceiptBatchState,
  docs: readonly ReceiptDoc[],
  changes: readonly ReceiptDoc[],
): { state: ReceiptBatchState; print: string[] } {
  if (!prev.primed) {
    let watermark = 0
    for (const d of docs) if (Number.isFinite(d.closedAtMs) && d.closedAtMs > watermark) watermark = d.closedAtMs
    return {
      state: { primed: true, watermark, seen: new Set(docs.map(d => d.id)) },
      print: [],
    }
  }

  const seen = new Set(prev.seen)
  const print: string[] = []
  for (const c of changes) {
    if (seen.has(c.id)) continue
    if (c.status !== 'closed') continue
    // Unresolved: not marked seen, so the modified change that carries the
    // real time gets its turn.
    if (!Number.isFinite(c.closedAtMs)) continue
    // Closed before this screen was listening — including the old check a
    // refund pushes back into the window. History, and remembered as such.
    if (c.closedAtMs <= prev.watermark) { seen.add(c.id); continue }
    seen.add(c.id)
    print.push(c.id)
  }
  return { state: { primed: true, watermark: prev.watermark, seen }, print }
}
