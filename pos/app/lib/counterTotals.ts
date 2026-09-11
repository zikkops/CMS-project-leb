// What the counter till may charge for, and what it cannot price at all.
//
// Pulled out of the counter screen after two money bugs in a row got through
// everything this repo has: tsc, three builds, five verifiers and a look in a
// browser. Both were the same shape — the arithmetic in
// shared/src/payments.ts was right, and the wrong FIGURE was handed to it —
// and neither was catchable, because the figure was worked out inline in a
// React component, where nothing can assert on it. That is the gap this
// module closes; scripts/verify-counter.mjs is the point of it.
//
// ── The rule the two bugs broke ────────────────────────────────────────────
// A customer is charged for what is on the CHECK. Not what is on the screen
// (a draft is an item somebody tapped, and tapping is not ordering), and never
// a total with a hole in it (a line this device cannot price is not worth
// zero). Both mistakes take real money in the wrong direction, and neither
// errors at the time.
//
// Pure: no React, no browser, no Firestore, and no value imports — the type
// import below is erased at compile — so the verifier transpiles it standalone.

import type { OutboxAction } from './outbox'

/** The menu price of an item on this device, or null if it cannot be priced. */
export type PriceLookup = (refId: string) => number | null

const r2 = (n: number) => Math.round(n * 100) / 100

export interface QueuedTotal {
  usd: number
  /**
   * A queued line could not be priced here at all.
   *
   * Not the same as zero, and the difference is the whole reason this flag
   * exists: a device that reloads mid-outage can have a cold or partial menu
   * cache, and treating a missing item as free understates the bill silently.
   * The till refuses to take money against an unknown total instead.
   */
  unknown: boolean
}

/** What one queued batch came to. */
export function batchUsd(
  action: Extract<OutboxAction, { kind: 'lines' }>,
  priceOf: PriceLookup,
): QueuedTotal {
  // What the batch carried when it was rung up wins over any lookup: it was
  // priced when the menu was known to be there.
  if (typeof action.displayUsd === 'number' && Number.isFinite(action.displayUsd)) {
    return { usd: r2(action.displayUsd), unknown: false }
  }
  let usd = 0
  let unknown = false
  for (const raw of action.lines) {
    const refId = String((raw as { refId?: unknown }).refId ?? '')
    const quantity = Number((raw as { quantity?: unknown }).quantity ?? 0)
    const price = priceOf(refId)
    if (price === null || !Number.isFinite(price)) { unknown = true; continue }
    usd += price * quantity
  }
  return { usd: r2(usd), unknown }
}

/** Everything queued for one check, and whether any of it could not be priced. */
export function queuedUsd(
  queue: readonly OutboxAction[],
  checkId: string,
  priceOf: PriceLookup,
): QueuedTotal {
  let usd = 0
  let unknown = false
  for (const a of queue) {
    if (a.kind !== 'lines' || a.checkId !== checkId) continue
    const batch = batchUsd(a, priceOf)
    usd += batch.usd
    if (batch.unknown) unknown = true
  }
  return { usd: r2(usd), unknown }
}

/** Tapped on screen, not yet rung up. Shown to staff, never charged for. */
export function draftsUsd(drafts: readonly { unitPrice: number; quantity: number }[]): number {
  return r2(drafts.reduce((s, d) => s + d.unitPrice * d.quantity, 0))
}

/**
 * What the check will actually come to: what the server already has, plus what
 * is queued for it. The drafts are deliberately not a parameter — they cannot
 * be added by mistake if they are not in the room.
 */
export function checkDue(liveNet: number, queued: QueuedTotal): number {
  return r2(liveNet + queued.usd)
}

export interface AppliedPayment { appliedLbp: number }

/**
 * The payments on the check, plus the ones still queued, in order.
 *
 * `apply` is passed in rather than imported so this stays free of value
 * imports — the caller hands in shared/src/payments.applyPayment, which is the
 * same function the server settles with, so what this screen says is owed is
 * what the server will say when the queue lands.
 */
export function replayApplied(
  existing: readonly AppliedPayment[],
  queue: readonly OutboxAction[],
  checkId: string,
  due: number,
  rate: number,
  apply: (
    due: number,
    list: readonly AppliedPayment[],
    rate: number,
    payment: { tender: 'cash' | 'card'; currency: 'USD' | 'LBP'; amount: number },
  ) => { ok: boolean; appliedLbp?: number },
): AppliedPayment[] {
  const list: AppliedPayment[] = existing.map(p => ({ appliedLbp: p.appliedLbp }))
  for (const a of queue) {
    if (a.kind !== 'pay' || a.checkId !== checkId) continue
    const r = apply(due, list, rate, a.payment)
    // A payment the arithmetic refuses is not on the check — counting it would
    // show a bill as part-paid when nothing was taken.
    if (r.ok && typeof r.appliedLbp === 'number') list.push({ appliedLbp: r.appliedLbp })
  }
  return list
}

/**
 * Why this till will not take money right now, in words a person can act on,
 * or null when it will.
 *
 * Returning the reason rather than a boolean is the point: a disabled button
 * with no explanation is how somebody ends up taking the cash anyway and
 * sorting it out later.
 */
export function takeBlocked(state: {
  draftCount: number
  totalUnknown: boolean
  settled: boolean
}): string | null {
  if (state.draftCount > 0) {
    return 'Ring the items up first. Money is taken against what is on the check, not what is on the screen.'
  }
  if (state.totalUnknown) {
    return 'Part of this check cannot be priced on this device yet, so the total is not known. Wait for the connection rather than guess at it.'
  }
  if (state.settled) return 'This check is already paid in full.'
  return null
}
