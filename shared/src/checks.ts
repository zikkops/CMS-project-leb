// Open checks: what a table has ordered.
//
// Phase 03, POS v1. A check gets an order from a waiter's hand to a kitchen
// and back. It deliberately does NOT do money arithmetic — no bill, no tender,
// no change. Phase 04 records payments ON a check, but the arithmetic for them
// lives in payments.ts, so this file stays about what was ordered.
//
// No React and no Firebase import: the server validates against these rules
// and the waiter's screen renders from them, so both halves must be able to
// import it.

import {
  lineUnitPrice, describeSelections, type ModifierSelection,
} from './modifiers'
import type { Payment } from './payments'

// ── Where a line draws its stock from ──────────────────────────────────────
// THE field that has to exist from the first version.
//
// A cappuccino and a board game on one bill deduct from two different stock
// models: menuItems for food and drink, products with per-branch stock for
// retail. Omega sells Restaurant POS and Retail POS as two separate products
// and neither does this, which makes it the differentiator — and it is only
// cheap now. Adding it later means migrating every check line ever written,
// guessing which model each one drew from.
export type LineSource = 'menu' | 'product'

export type LineStatus =
  | 'draft'   // on the check, not yet sent to a station
  | 'sent'    // a ticket exists for it
  | 'void'    // struck off; kept rather than deleted, see below

export type CheckStatus =
  | 'open'
  | 'closed'
  /**
   * Closed and then reversed.
   *
   * A separate status rather than deleting or reopening the check: the record
   * of what was ordered has to survive the reversal, because "what did we give
   * money back for" is the question a refund exists to answer.
   *
   * Worth being plain about what this does and does not mean while there is no
   * payment step. It records that a closed check was reversed and puts any
   * merchandise back on the shelf. It does not move money, because no money
   * moved through here in the first place — the till still takes payment.
   * Phase 04 puts tender underneath this and the shape does not change.
   */
  | 'refunded'
  | 'cancelled'

/**
 * Where a line goes when it is sent.
 *
 * Derived from the menu category's section, which the plan predicted would map
 * almost directly onto kitchen routing — Food to the kitchen, Beverage to the
 * bar, Sweets to its own pass.
 *
 * A merchandise line has no station. Nobody cooks a board game; it is taken
 * off a shelf. Giving it a fake station would put it in a kitchen queue where
 * it would sit unbumped forever.
 */
export type Station = 'Kitchen' | 'Bar' | 'Sweets'

export const STATIONS: Station[] = ['Kitchen', 'Bar', 'Sweets']

const STATION_FOR_SECTION: Record<string, Station> = {
  Food: 'Kitchen',
  Beverage: 'Bar',
  Sweets: 'Sweets',
}

/** null for merchandise, and for a section nobody has mapped yet. */
export function stationForSection(section: string | null | undefined): Station | null {
  return STATION_FOR_SECTION[String(section ?? '')] ?? null
}

// ── Why something was struck off ───────────────────────────────────────────
//
// A void used to take free text, and free text cannot be acted on. "Changed
// his mind" and "dropped it" are different events: the first leaves a sellable
// item, the second destroys one, and a till that treats them the same either
// loses stock it still has or keeps stock it does not.
//
// So the reason is a CHOICE, and the choice carries what follows from it.
// Free text stays, as a note beside the reason rather than instead of it.

export interface VoidReasonDef {
  key: string
  label: string
  /**
   * Whether the thing still exists and can be sold again.
   *
   * A retail product handed back goes on the shelf, and a dish that was never
   * made gives its ingredients back to stock (ingredientOutcome() in
   * recipes.ts, with the `recipes` switch on).
   */
  returnsToStock: boolean
  /**
   * Whether this counts as waste: made or consumed, and lost.
   *
   * With recipes on, a waste reason stamps what the ingredients cost on the
   * void or refund, and the Food Cost Report adds those up by reason
   * (wasteSummary() in recipes.ts). Copied onto the line when it happens, so a
   * later change to this list cannot re-classify a void already made.
   */
  isWaste: boolean
}

export const VOID_REASONS: VoidReasonDef[] = [
  // Nothing was consumed. The item is still there.
  { key: 'changed-mind', label: 'Customer changed their mind', returnsToStock: true, isWaste: false },
  { key: 'rung-wrong', label: 'Rung up by mistake', returnsToStock: true, isWaste: false },
  { key: 'not-available', label: 'Not available after all', returnsToStock: true, isWaste: false },

  // It was made, or it is gone. Either way it is not going back.
  { key: 'made-wrong', label: 'Made wrong', returnsToStock: false, isWaste: true },
  { key: 'sent-back', label: 'Customer sent it back', returnsToStock: false, isWaste: true },
  { key: 'damaged', label: 'Damaged or spilled', returnsToStock: false, isWaste: true },

  // Deliberately last and deliberately not defaulting to "returns": guessing
  // wrong in that direction invents stock that is not on the shelf.
  { key: 'other', label: 'Other', returnsToStock: false, isWaste: true },
]

export function voidReason(key: string): VoidReasonDef | undefined {
  return VOID_REASONS.find(r => r.key === key)
}

// ── Discounts (Phase 04, slice 6) ──────────────────────────────────────────
// Owner's decisions, 12 Sep 2026: four kinds — % off the whole check, a fixed
// amount off it, an item comped, % off one item. Managers and admins only; a
// barista gives nothing. The manager applies it from their own phone, so
// their login IS the approval. Every one carries a reason from this list.

export interface DiscountReasonDef { key: string; label: string }

export const DISCOUNT_REASONS: DiscountReasonDef[] = [
  { key: 'complaint', label: 'Complaint — something went wrong' },
  { key: 'regular', label: 'Regular or friend of the house' },
  { key: 'promotion', label: 'Promotion' },
  { key: 'wait', label: 'Long wait' },
  { key: 'other', label: 'Other' },
]

export function discountReason(key: string): DiscountReasonDef | undefined {
  return DISCOUNT_REASONS.find(r => r.key === key)
}

/** On one line: made free, or a percentage off that item. */
export interface LineDiscount {
  kind: 'comp' | 'percent'
  /** Fraction off, 0–1. A comp is 1. */
  percent: number
  reasonKey: string
  note: string
  by: string
  byEmail: string
}

/** On the whole check: a percentage, or a fixed amount in the main currency. */
export interface CheckDiscount {
  kind: 'percent' | 'amount'
  /** A fraction 0–1 for 'percent'; dollars for 'amount'. */
  value: number
  reasonKey: string
  note: string
  by: string
  byEmail: string
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

export interface CheckLine {
  /** Stable for the life of the check — edits, voids and tickets all cite it. */
  id: string
  source: LineSource
  /** menuItems/{id} or products/{id}. Kept for reporting, never for pricing. */
  refId: string

  // ── Snapshots ────────────────────────────────────────────────────────────
  // Name, price and modifiers are copied onto the line when it is added, and
  // never re-read. Same rule as the end-of-day exchange rate and the delivery
  // VAT: a check written at eight o'clock must not change because somebody
  // edited the menu at nine. Pricing from refId would do exactly that.
  name: string
  /** Before modifiers. lineUnitPrice() adds them. */
  unitPrice: number
  modifiers: ModifierSelection[]

  quantity: number
  /** Which seat ordered it, or null for the table as a whole. */
  seat: number | null
  /** Course number for pacing; null means "whenever". */
  course: number | null
  /** Snapshotted at add time, for the same reason the price is. */
  station: Station | null
  status: LineStatus
  /** "no ice", "allergy — nuts". Reaches the ticket. */
  note: string

  addedBy: string
  addedByEmail: string
  /**
   * The Send that added this line, as an idempotency key. A retry of the same
   * Send carries the same key, and the server skips a batch it has already
   * applied — see batchAlreadyApplied(). Absent on lines added before this
   * existed.
   */
  batchKey?: string
  /** Set when a ticket was created for it; null while still a draft. */
  sentAt: string | null
  /**
   * Why it was struck off, as a chosen reason plus anything typed.
   *
   * voidReason keeps the human sentence so old lines written before the
   * reasons existed still read correctly; voidReasonKey is the one a report
   * can group by.
   */
  voidReason: string | null
  voidReasonKey: string | null
  /**
   * Who struck it off, and when (ISO), for the void report (UPGRADE.md T3.2).
   * Absent on voids from before 18 Sep 2026: the report says "not recorded"
   * rather than guessing from the activity log.
   */
  voidedBy?: string
  voidedByEmail?: string
  voidedAt?: string
  /** Copied from the reason, so a later change to the list cannot re-classify
   *  a void that already happened. */
  voidWasWaste: boolean | null
  /** A manager's comp or percentage off this one item (slice 6). Absent: none. */
  discount?: LineDiscount | null
  /**
   * Taken on the counter device during an outage and recorded on reconnect
   * as already made (7c) — the kitchen worked from a spoken or paper order,
   * so no ticket was fired for it. sentAt is when it was taken.
   */
  madeOffline?: boolean
  /**
   * What ONE serving takes off the ingredient shelf, snapshotted when the line
   * was added (recipes, Sep 2026) — only for a dish with a recipe, and only
   * while the `recipes` switch is on. Quantity multiplies it wherever stock
   * moves. Absent means the line consumes nothing. Same shape as Consumption
   * in recipes.ts, spelled out rather than imported so the verifier that
   * transpiles this module does not need that one.
   */
  consumesPerServing?: { supplyId: string; qty: number; unitCostUsd: number | null }[]
  /** Ingredients the recipe uses that could not be measured: no conversion set. */
  consumesUnknown?: string[]
  /** What a wasted void cost, from the snapshot; null when it could not be costed. */
  voidWasteUsd?: number | null
}

/**
 * The staff-meal rates, copied onto a check when it is marked as one.
 *
 * Snapshotted for the reason every rate in this codebase is: a check written
 * tonight must not re-price itself because somebody changed the policy next
 * month. null means this is an ordinary check.
 */
export interface StaffDiscount {
  /** Fraction taken OFF food. 0.7 is seventy percent off. */
  food: number
  drink: number
  appliedBy: string
  appliedByEmail: string
}

export interface Check {
  id: string
  branch: string
  /** TableMarker.id from branchTableLayouts — not the printed number, which
   *  can be changed on the floor plan without meaning a different table. */
  tableId: string
  /** Snapshotted so a closed check still reads "Table 12" after a renumber. */
  tableNumber: number
  status: CheckStatus
  guestCount: number
  lines: CheckLine[]
  openedBy: string
  openedByEmail: string
  /**
   * Was typed `string | null`. It has never been a string: the server writes
   * serverTimestamp(), so a client receives a Timestamp. Trusting the old type,
   * receipt.ts ran `new Date(check.closedAt)`, got Invalid Date, and printed
   * "NaN-NaN-NaN NaN:NaN" on every real receipt. Unknown, and read through
   * timestampMs() in timestamps.ts, so nothing can trust a shape again.
   */
  closedAt: unknown
  /**
   * Issued when the check closes, from the same sequence counter sales and
   * wholesale orders use — one series for the business, which is what an
   * accountant expects. Null while the check is still open.
   */
  receiptNumber: string | null
  /** null on an ordinary check. Set by the staff-meal toggle. */
  staffDiscount: StaffDiscount | null
  /**
   * Phase 04. Absent on every check closed before the till took money, which
   * is why it is optional rather than an empty array somebody forgot to write.
   */
  payments?: Payment[]
  /** The rate every payment on this check is valued at — fixed by the first. */
  billRate?: number | null
  /**
   * The VAT rate in force the day the check closed (vatRateOn()). Prices
   * include it. Absent on checks closed before it was recorded, whose
   * receipts then print no VAT line rather than guess one.
   */
  vatRate?: number | null
  /**
   * Who collects this check's points (slice 5), attached by scanning their
   * member code. The name is a snapshot for the waiter's screen. Absent or
   * null: nobody collects.
   */
  loyalty?: { uid: string; name: string } | null
  /** Points credited when the check closed — kept so a refund takes back exactly these. */
  loyaltyPoints?: number
  /** The approved transaction those points were written as, so a refund can mark it reversed. */
  loyaltyTxId?: string
  /** Why it was refunded: the VOID_REASONS label and key, stamped by refundCheck(). */
  refundReason?: string
  refundReasonKey?: string
  /** Copied from the reason when the refund happened, so a later change to the list cannot re-classify it. */
  refundWasWaste?: boolean
  /** What the wasted ingredients cost; null when an ingredient had no cost; absent when nothing was wasted. */
  refundWasteUsd?: number | null
  /**
   * A manager's discount on the whole check (slice 6), taken off after any
   * item discounts. Kept separate from staffDiscount, which is a fixed policy
   * rate rather than somebody's discretion, and keeps its own meaning.
   */
  discount?: CheckDiscount | null
  /**
   * The service charge (UPGRADE.md T3.8), copied onto the check when it opens
   * from Business Settings, like every rate here: a check opened tonight is not
   * re-priced by a change tomorrow. `rate` is a fraction (0.1 is 10%); a
   * manager taking it off sets it to 0 and is recorded. Absent: no service.
   */
  serviceCharge?: ServiceCharge | null
}

export interface ServiceCharge {
  rate: number
  removedBy?: string
  removedByEmail?: string
}

/** The service rate a check carries: a sensible fraction, or 0. Never more than 30%. */
export function serviceRate(s: ServiceCharge | null | undefined): number {
  const r = Number(s?.rate ?? 0)
  return Number.isFinite(r) && r > 0 && r <= 0.3 ? r : 0
}

// ── Bounds ────────────────────────────────────────────────────────────────

export const CHECK_LIMITS = {
  /** A table ordering more than this has a data-entry problem, not an appetite. */
  linesPerCheck: 200,
  quantityPerLine: 99,
  /** Enough for a long table; above this somebody is typing, not seating. */
  maxSeat: 40,
  maxCourse: 9,
  maxGuests: 40,
  noteLength: 200,
} as const

// ── Staff meals ────────────────────────────────────────────────────────────

/**
 * Which rate a line takes, from the station it was routed to.
 *
 * The station already encodes what was bought — Bar means a drink, Kitchen and
 * Sweets mean food — so nothing new has to be stored on the line to know which
 * rate applies. Merchandise has no station and takes no staff discount: a
 * board game is bought stock with a real cost, not a plate of food, and
 * discounting it is a different policy nobody has asked for.
 */
export function staffRateFor(line: CheckLine, discount: StaffDiscount | null): number {
  if (!discount) return 0
  if (line.source === 'product') return 0
  if (line.station === 'Bar') return discount.drink
  if (line.station === 'Kitchen' || line.station === 'Sweets') return discount.food
  // A section nobody mapped to a station. No rate rather than a guess.
  return 0
}

/** What comes off one line, in the main currency. */
export function lineDiscount(line: CheckLine, discount: StaffDiscount | null): number {
  const rate = staffRateFor(line, discount)
  if (rate <= 0) return 0
  return Math.round(grossLineTotal(line) * rate * 100) / 100
}

// ── Money on a line (not a bill — see the header) ──────────────────────────

/** One line before any discount. Voided lines count as zero. */
export function grossLineTotal(line: CheckLine): number {
  if (line.status === 'void') return 0
  const unit = lineUnitPrice(line.unitPrice, line.modifiers)
  return Math.round(unit * line.quantity * 100) / 100
}

/**
 * One line's total.
 *
 * Takes the discount rather than reading it from anywhere, so a caller that
 * has not thought about staff meals gets the undiscounted figure instead of
 * silently the wrong one.
 */
export function lineTotal(line: CheckLine, discount: StaffDiscount | null = null): number {
  const afterStaff = Math.round((grossLineTotal(line) - lineDiscount(line, discount)) * 100) / 100
  // A manager's item discount comes off what is left after the staff rate, so
  // the two never add up to more than the line (slice 6). A comp is free.
  const d = line.discount
  if (!d || line.status === 'void') return afterStaff
  if (d.kind === 'comp') return 0
  return Math.round(afterStaff * (1 - clamp01(d.percent)) * 100) / 100
}

/**
 * What a whole-check discount takes off a subtotal: a percentage of it, or a
 * fixed amount — never more than the subtotal, so a check cannot go below
 * zero and nobody is handed money back for eating.
 */
export function checkDiscountAmount(subtotal: number, d: CheckDiscount | null | undefined): number {
  if (!d || !(subtotal > 0)) return 0
  const raw = d.kind === 'percent' ? subtotal * clamp01(d.value) : Math.max(0, Number(d.value) || 0)
  return Math.round(Math.min(raw, subtotal) * 100) / 100
}

/**
 * What the table has ordered so far.
 *
 * Explicitly NOT a bill: no VAT, no service, no discount, no rounding rule.
 * Those are Phase 04 and each is a decision this must not pre-empt by
 * pretending to be the total somebody pays.
 */
export function orderedTotal(lines: CheckLine[], discount: StaffDiscount | null = null): number {
  return Math.round(lines.reduce((sum, l) => sum + lineTotal(l, discount), 0) * 100) / 100
}

export interface CheckTotals {
  /** Before any discount. */
  gross: number
  /** What the STAFF MEAL took off. Zero on an ordinary check. Name kept from v1. */
  discount: number
  /** What managers' comps and item percentages took off (slice 6). */
  itemDiscounts: number
  /** After the staff meal and item discounts: the sum of lineTotal(). */
  subtotal: number
  /** What a manager's whole-check discount took off the subtotal (slice 6). */
  checkDiscount: number
  /** The service charge, on what is left after every discount (T3.8). Zero on a check without one. */
  service: number
  /** What is owed, service included. VAT is inside it — prices include VAT, and so does the service charge. */
  net: number
}

/**
 * The three figures a check screen shows.
 *
 * Discount is returned separately rather than folded into the total, because a
 * staff meal that quietly shows a smaller number is a staff meal nobody can
 * audit. It should be visible as a line somebody signed off.
 */
// ── Sending the same order twice ───────────────────────────────────────────
//
// A Send whose reply is lost has an unknown outcome: the lines may or may not
// be on the check. Resending blind duplicated them, and the kitchen made the
// order twice. Each batch of drafts therefore carries a key, the server skips a
// key it has already applied, and the phone learns from the live check whether
// the batch landed.

/** What a batch key may look like — a randomUUID() fits. */
export const BATCH_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/

/** Whether this batch is already on the check. A null key is never deduplicated. */
export function batchAlreadyApplied(
  lines: readonly { batchKey?: string }[],
  batchKey: string | null,
): boolean {
  return batchKey !== null && lines.some(l => l.batchKey === batchKey)
}

/**
 * Where an unsettled batch has got to, read from the live check.
 *
 *   absent  none of it is there — it never arrived, or has not been seen yet
 *   landed  it is on the check, and at least one line is still unsent
 *   sent    it is on the check and nothing in it is waiting to be fired
 */
export function reconcilePendingBatch(
  lines: readonly { batchKey?: string; status: string }[],
  batchKey: string,
): 'absent' | 'landed' | 'sent' {
  const mine = lines.filter(l => l.batchKey === batchKey)
  if (mine.length === 0) return 'absent'
  return mine.some(l => l.status === 'draft') ? 'landed' : 'sent'
}

export function checkTotals(
  check: Pick<Check, 'lines' | 'staffDiscount'> & Partial<Pick<Check, 'discount' | 'serviceCharge'>>,
): CheckTotals {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const gross = r2(check.lines.reduce((s, l) => s + grossLineTotal(l), 0))
  const discount = r2(check.lines.reduce((s, l) => s + lineDiscount(l, check.staffDiscount), 0))
  const subtotal = r2(check.lines.reduce((s, l) => s + lineTotal(l, check.staffDiscount), 0))
  const itemDiscounts = r2(gross - discount - subtotal)
  const checkDiscount = checkDiscountAmount(subtotal, check.discount)
  const afterDiscounts = r2(subtotal - checkDiscount)
  // Last, on what is actually charged for the food: service is never charged
  // on a discount (UPGRADE.md T3.8). Inside net, so payments, the drawer, VAT
  // and the export follow without knowing it exists, as they did for discounts.
  const service = r2(afterDiscounts * serviceRate(check.serviceCharge))
  return { gross, discount, itemDiscounts, subtotal, checkDiscount, service, net: r2(afterDiscounts + service) }
}

// ── Reading a check ────────────────────────────────────────────────────────

/** Lines not yet sent, which is what the Send button acts on. */
export function draftLines(lines: CheckLine[]): CheckLine[] {
  return lines.filter(l => l.status === 'draft')
}

/**
 * Draft lines grouped by the station that will cook them.
 *
 * One ticket per station per send. Merchandise (station null) is excluded —
 * it is not cooked, so it never becomes a kitchen ticket, and a caller that
 * wants to know about it should look at the check.
 */
export function draftsByStation(lines: CheckLine[]): Map<Station, CheckLine[]> {
  const out = new Map<Station, CheckLine[]>()
  for (const line of draftLines(lines)) {
    if (!line.station) continue
    const list = out.get(line.station) ?? []
    list.push(line)
    out.set(line.station, list)
  }
  return out
}

/** Lines for one seat, for splitting a table's order by who ordered what. */
export function linesForSeat(lines: CheckLine[], seat: number | null): CheckLine[] {
  return lines.filter(l => l.seat === seat && l.status !== 'void')
}

/** Seats that have actually ordered something, in order. */
export function seatsUsed(lines: CheckLine[]): number[] {
  const seats = new Set<number>()
  for (const l of lines) if (l.status !== 'void' && l.seat !== null) seats.add(l.seat)
  return [...seats].sort((a, b) => a - b)
}

/** "2 x Flat White (Large, Oat milk) — seat 3 — no sugar" */
export function describeLine(line: CheckLine): string {
  const parts = [`${line.quantity} x ${line.name}`]
  if (line.modifiers.length > 0) parts.push(`(${describeSelections(line.modifiers)})`)
  if (line.seat !== null) parts.push(`— seat ${line.seat}`)
  if (line.note) parts.push(`— ${line.note}`)
  return parts.join(' ')
}

// ── Rules the screen and the server both enforce ───────────────────────────

/**
 * Whether a line may still be changed.
 *
 * Once a ticket exists the kitchen may already be cooking it, so editing the
 * line would change what the customer is charged for something already being
 * made. Sent lines are voided, not edited — and a void is a decision somebody
 * has to own, which is why voidReason is required rather than optional.
 */
export function canEditLine(line: CheckLine): boolean {
  return line.status === 'draft'
}

/** Why this check cannot be closed yet, or null. */
export function closeBlockedReason(check: Check): string | null {
  if (check.status !== 'open') return 'That check is already closed.'
  const drafts = draftLines(check.lines).length
  if (drafts > 0) {
    return `${drafts} item${drafts === 1 ? '' : 's'} ${drafts === 1 ? 'has' : 'have'} not been sent to the kitchen yet. ` +
      'Send them or void them first.'
  }
  return null
}
