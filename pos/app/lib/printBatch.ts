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
