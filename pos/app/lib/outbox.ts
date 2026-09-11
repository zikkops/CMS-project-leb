// The counter device's outbox — Phase 04, slice 7c. The logic, and nothing else.
//
// Only the counter device works offline (owner's decision, 12 Sep 2026): one
// queue per branch, not one per waiter's phone, so there is never a question
// of two devices disagreeing about a table. What it did while the connection
// was down waits here, in order, and is replayed when it comes back.
//
// ── Why replay is safe ─────────────────────────────────────────────────────
// Every action carries the key the server already honours: a check opened
// offline carries its own id (openId — 7b), items carry a batchKey, a payment
// carries a paymentKey. Replaying something that in fact already landed is
// recognised, never repeated. So a replay can always be retried.
//
// ── Why a refusal stops the queue ──────────────────────────────────────────
// Later actions usually depend on earlier ones — items for a table whose open
// was refused, a payment on a check that could not be opened. Pressing on
// would turn one problem into a string of confusing ones. So the queue stops
// at the first refusal and names it, for a person to look at.
//
// No React, no browser storage and no fetch here: the caller passes in how to
// send, so a verifier can drive it.

export type OutboxAction =
  | {
      kind: 'open'
      /** The outbox's own id for this entry. */
      id: string
      /** The check's id, chosen on the device (7b). Later actions name it. */
      checkId: string
      branch: string
      tableNumber: number
      guestCount: number
      at: string
    }
  | {
      kind: 'lines'
      id: string
      checkId: string
      batchKey: string
      /** The line requests exactly as the route takes them. */
      lines: Record<string, unknown>[]
      /** Recorded as made at this time, with no kitchen ticket. */
      at: string
    }
  | {
      kind: 'pay'
      id: string
      checkId: string
      paymentKey: string
      payment: { tender: 'cash' | 'card'; currency: 'USD' | 'LBP'; amount: number }
      /**
       * The change the counter actually handed over, worked out on the device.
       *
       * The server works the change out again on arrival, from the bill rate
       * the check is fixed at — which the device may not have had while it was
       * offline. The money is already in the customer's hand by then, so this
       * is not something to correct silently: it is recorded so the counter can
       * be told the drawer will be out, and by how much.
       */
      expected?: { changeUsd: number; changeLbp: number }
      at: string
    }

export type SendOutcome =
  | { ok: true }
  /** No answer — the connection is still down, or dropped mid-send. Try again later. */
  | { ok: false; retry: true; reason: string }
  /** The server answered no. Nothing more is sent until a person looks at it. */
  | { ok: false; retry: false; reason: string }

export interface OutboxState {
  queue: OutboxAction[]
  /** The action a refusal stopped at, and why. Null while the queue can flow. */
  stuck: { id: string; reason: string } | null
}

export const EMPTY_OUTBOX: OutboxState = { queue: [], stuck: null }

/** Adds an action to the end. A stuck queue still accepts more; it only stops sending. */
export function enqueue(state: OutboxState, action: OutboxAction): OutboxState {
  return { ...state, queue: [...state.queue, action] }
}

/**
 * Sends what is waiting, in order, until something fails.
 *
 * Sent actions leave the queue. A failure with no answer leaves everything
 * from it onward in place for next time; a refusal does the same and marks
 * the queue stuck on that action. A queue that is already stuck sends
 * nothing — somebody has to clear it first (see resolveStuck).
 */
export async function replay(
  state: OutboxState,
  send: (action: OutboxAction) => Promise<SendOutcome>,
): Promise<OutboxState & { sent: number }> {
  if (state.stuck) return { ...state, sent: 0 }
  const queue = [...state.queue]
  let sent = 0
  while (queue.length > 0) {
    const outcome = await send(queue[0])
    if (outcome.ok) {
      queue.shift()
      sent++
      continue
    }
    return {
      queue,
      stuck: outcome.retry ? null : { id: queue[0].id, reason: outcome.reason },
      sent,
    }
  }
  return { queue, stuck: null, sent }
}

/**
 * A person has looked at the stuck action. Either retry it as it is (after
 * fixing the cause elsewhere — say, closing the other check on that table),
 * or drop it and everything that depended on it: later actions naming the
 * same check. Dropping is the answer to "that table was never really ours".
 */
export function resolveStuck(state: OutboxState, how: 'retry' | 'drop'): OutboxState {
  if (!state.stuck) return state
  if (how === 'retry') return { ...state, stuck: null }
  const stuckAction = state.queue.find(a => a.id === state.stuck!.id)
  if (!stuckAction) return { queue: state.queue, stuck: null }
  const dead = stuckAction.checkId
  return {
    queue: state.queue.filter(a => a.id !== stuckAction.id && !(stuckAction.kind === 'open' && a.checkId === dead)),
    stuck: null,
  }
}

/**
 * Whether the change the server worked out differs from what the counter
 * handed over while it was offline.
 *
 * The server settles a bill in lira at the check's own rate, and a device that
 * was offline when it took the money may have been working from an older one.
 * By the time the difference is known the customer has gone, so this decides
 * one thing only: whether somebody is told the drawer will be short.
 *
 * The thresholds are the smallest amounts that can actually be handed over —
 * half a cent and one lira. Below those the two answers are the same answer
 * written differently, and a warning about a rounding artefact is a warning
 * nobody reads the next time.
 */
export function changeDiffers(
  expected: { changeUsd: number; changeLbp: number } | undefined,
  actual: { changeUsd: number; changeLbp: number },
): boolean {
  if (!expected) return false
  return Math.abs(expected.changeUsd - actual.changeUsd) >= 0.005
    || Math.abs(expected.changeLbp - actual.changeLbp) >= 1
}

/** How many actions each check has waiting — for "2 items and a payment not yet sent" on screen. */
export function waitingFor(state: OutboxState, checkId: string): number {
  return state.queue.filter(a => a.checkId === checkId).length
}
