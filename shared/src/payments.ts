// Taking payment on a check — the arithmetic, and nothing else.
//
// Phase 04, slice 1. No React and no Firebase: the till's payment screen, the
// route that records a payment and the receipt all need the same answer to
// "how much is left" and "how much change", and two answers is how a drawer
// stops reconciling.
//
// ── The unit ───────────────────────────────────────────────────────────────
// A balance is compared in LBP, exact, and judged settled by the bill rounding
// rule in money.ts. Prices are held in USD, but a check paid partly in lira can
// only be settled the way the customer was asked for it — to the nearest 100.
// Compared in USD instead, a lira-paid check would sit a fraction of a cent
// short forever and never close.
//
// ── The rate ───────────────────────────────────────────────────────────────
// One rate per check, taken at the first payment and stored on it (billRate).
// A rate change between the first and second payment of a split must not
// change what the first one was worth.
//
// ── Decisions this encodes (owner, 11 Sep 2026) ────────────────────────────
//   Cash paid in USD gets change in whole dollars, the remainder in LBP.
//   Cash paid in LBP gets change in LBP.
//   A card is charged what is owed and never more, so a card gives no change.
//   Lira change is rounded to the smallest note, and the rounding is recorded
//   so the drawer count can account for it rather than absorb it.

import { roundLbpTotal } from './money'

export type Tender = 'cash' | 'card'
export type PayCurrency = 'USD' | 'LBP'

/** The smallest lira note. Cash cannot be handed over or back finer than this. */
export const CASH_LBP_STEP = 1000

/** What a payment key may look like — a randomUUID() fits. */
export const PAYMENT_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/

/** Anything larger is a typo, not a table. */
export const PAYMENT_LIMITS = { USD: 100_000, LBP: 10_000_000_000 } as const

export interface PaymentRequest {
  tender: Tender
  currency: PayCurrency
  /** Handed over (cash) or charged (card), in `currency`. */
  amount: number
}

export interface Payment extends PaymentRequest {
  /** Idempotency key — a resent payment is recognised, not taken twice. */
  key: string
  /** What went against the bill, in LBP exact at the check's rate. */
  appliedLbp: number
  changeUsd: number
  changeLbp: number
  /** changeLbp minus the exact lira owed back: the note rounding, kept for the drawer. */
  changeRounding: number
  at: unknown
  by: string
  byEmail: string
}

export interface Balance {
  dueLbpExact: number
  paidLbpExact: number
  /** Still owed, as the customer would be asked for it in lira: to the nearest 100. */
  remainingLbp: number
  /** Still owed in USD, rounded UP to the cent — a customer cannot pay a fraction of one. */
  remainingUsd: number
  settled: boolean
}

export type PaymentOutcome =
  | { ok: true; appliedLbp: number; changeUsd: number; changeLbp: number; changeRounding: number }
  | { ok: false; reason: string }

export function valueInLbp(amount: number, currency: PayCurrency, rate: number): number {
  return currency === 'USD' ? amount * rate : amount
}

/**
 * Where a check stands.
 *
 * Settled when what is left rounds to nothing by the bill rule: a customer
 * asked for 895,900 who pays 895,900 has paid, even if the exact figure was
 * 895,860 or 895,940.
 */
export function balance(
  dueUsd: number,
  payments: readonly Pick<Payment, 'appliedLbp'>[],
  rate: number,
): Balance {
  const dueLbpExact = dueUsd * rate
  const paidLbpExact = payments.reduce((s, p) => s + p.appliedLbp, 0)
  const left = dueLbpExact - paidLbpExact
  const remainingLbp = Math.max(0, roundLbpTotal(left))
  const settled = remainingLbp === 0
  return {
    dueLbpExact,
    paidLbpExact,
    remainingLbp,
    // 1e-9 absorbs float noise so an exact $10.00 does not read as $10.01.
    remainingUsd: settled ? 0 : Math.ceil(left / rate * 100 - 1e-9) / 100,
    settled,
  }
}

/** Why this request is not a payment, or null. Checked before any arithmetic. */
export function paymentRequestProblem(req: PaymentRequest): string | null {
  if (req.tender !== 'cash' && req.tender !== 'card') return 'Choose cash or card.'
  if (req.currency !== 'USD' && req.currency !== 'LBP') return 'Choose USD or LBP.'
  const a = req.amount
  if (typeof a !== 'number' || !Number.isFinite(a) || a <= 0) return 'Enter an amount above zero.'
  if (a > PAYMENT_LIMITS[req.currency]) return 'That amount is too large to be right.'
  if (req.currency === 'USD' && Math.abs(a * 100 - Math.round(a * 100)) > 1e-6) {
    return 'Dollars go to the cent, no further.'
  }
  if (req.currency === 'LBP') {
    if (!Number.isInteger(a)) return 'Lira are whole numbers.'
    if (req.tender === 'cash' && a % CASH_LBP_STEP !== 0) {
      return `Lira cash comes in notes of ${CASH_LBP_STEP.toLocaleString('en-US')} and up.`
    }
  }
  return null
}

/**
 * What a new payment does to the check.
 *
 * Refuses rather than clamps: a card amount above what is owed is a keying
 * mistake that would put money on somebody's statement the café then has to
 * give back, and the waiter should see it before the card is charged, not
 * after.
 */
export function applyPayment(
  dueUsd: number,
  payments: readonly Pick<Payment, 'appliedLbp'>[],
  rate: number,
  req: PaymentRequest,
): PaymentOutcome {
  if (!(rate > 0) || !Number.isFinite(rate)) return { ok: false, reason: 'No exchange rate is set.' }
  const problem = paymentRequestProblem(req)
  if (problem) return { ok: false, reason: problem }

  const before = balance(dueUsd, payments, rate)
  if (before.settled) return { ok: false, reason: 'Nothing is left to pay on this check.' }

  const value = valueInLbp(req.amount, req.currency, rate)
  const left = before.dueLbpExact - before.paidLbpExact

  if (req.tender === 'card') {
    const max = req.currency === 'USD' ? before.remainingUsd : before.remainingLbp
    if (req.amount > max + 1e-9) {
      const shown = req.currency === 'USD'
        ? `$${max.toFixed(2)}`
        : `${max.toLocaleString('en-US')} LBP`
      return { ok: false, reason: `A card is charged what is owed, never more — at most ${shown}.` }
    }
    // The whole charge counts, even where bill rounding makes it a few lira
    // over the exact figure: that is what the customer was asked for.
    return { ok: true, appliedLbp: value, changeUsd: 0, changeLbp: 0, changeRounding: 0 }
  }

  if (value <= left) {
    return { ok: true, appliedLbp: value, changeUsd: 0, changeLbp: 0, changeRounding: 0 }
  }

  // Cash, more than was owed. The bill takes what it was owed; the rest goes back.
  const over = value - left
  let changeUsd = 0
  let owedLbp = over
  if (req.currency === 'USD') {
    changeUsd = Math.floor(over / rate + 1e-9)
    owedLbp = over - changeUsd * rate
  }
  const changeLbp = Math.round(owedLbp / CASH_LBP_STEP) * CASH_LBP_STEP
  return {
    ok: true,
    appliedLbp: left,
    changeUsd,
    changeLbp,
    changeRounding: Math.round((changeLbp - owedLbp) * 100) / 100,
  }
}

/**
 * The amount to enter for one person's share, in the money they are paying with.
 *
 * Capped at what is still owed: shares are worked out from the whole bill,
 * and after some have been paid a later one can be larger than what is left —
 * charging it to a card would be the over-charge applyPayment() refuses.
 * Lira cash rounds UP to a note, the same as the Exact button; the difference
 * comes back as change.
 */
export function fillAmount(
  shareUsd: number,
  b: Balance,
  pay: Pick<PaymentRequest, 'tender' | 'currency'>,
  rate: number,
): number {
  if (b.settled || !(shareUsd > 0) || !(rate > 0)) return 0
  if (pay.currency === 'USD') return Math.min(Math.round(shareUsd * 100) / 100, b.remainingUsd)
  const lbp = Math.min(roundLbpTotal(shareUsd * rate), b.remainingLbp)
  return pay.tender === 'cash' ? Math.ceil(lbp / CASH_LBP_STEP) * CASH_LBP_STEP : lbp
}

/** Whether this payment is already on the check. A null key is never deduplicated. */
export function paymentAlreadyApplied(
  payments: readonly { key: string }[],
  key: string | null,
): boolean {
  return key !== null && payments.some(p => p.key === key)
}
