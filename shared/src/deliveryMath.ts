// Pure calculations and types for goods receiving. NO Firestore, NO Firebase,
// no imports that reach either — deliberately.
//
// shared/src/server/deliveries.ts needs these functions, and it runs in a
// serverless function on the Admin SDK. If they lived alongside the client
// read helpers, importing one value would execute `import { db } from
// './firebase'` and stand up a browser Firestore instance inside every
// invocation that never uses it.
//
// It's also what lets scripts/verify-delivery-math.mjs import this module
// directly instead of transpiling and stripping it.
//
// shared/src/deliveries.ts re-exports everything here, so import from either.

// `import type` only — fully erased at compile time, so this module still
// pulls no Firebase code into a serverless bundle. Do not turn either of these
// into a value import.
import type { Timestamp } from 'firebase/firestore'
import { STOCKED_BRANCHES } from './branches'
import type { OrderUnit } from './weeklyOrders'


// Departments disagree across this codebase and it matters here.
// weeklyOrders.Department is Kitchen | Bar | Cleaning; dailyInventory's adds
// 'Other', and so does the supplies page's Category. A delivery has to line up
// with what stock is actually filed under — supplies — not with what can be
// ordered, or an "Other" item could be received into a department the count
// never looks at. So this declares its own, matching supplies.
export const DELIVERY_DEPARTMENTS = ['Kitchen', 'Bar', 'Cleaning', 'Other'] as const
export type DeliveryDepartment = typeof DELIVERY_DEPARTMENTS[number]

// Receiving and counting have to agree on which branches hold stock, or a
// delivery could post to a branch no count will ever reconcile. They agree by
// reading the same configured list rather than by two files each remembering
// to exclude the same name.
export const DELIVERY_BRANCHES = STOCKED_BRANCHES

// ── Currency ───────────────────────────────────────────────────────────────
// Lebanon is a two-currency country and suppliers invoice in both. Every
// delivery stores the currency its numbers are IN, plus the rate used to
// convert — never just a converted figure.
//
// rateUsed is stored ON the delivery rather than read from a global setting at
// display time, because a global rate moves. A delivery reprinted next year
// must show the same totals it showed on the day, and that's only possible if
// the rate that was applied is part of the record.
export type Currency = 'USD' | 'LBP'

export const CURRENCY_LABELS: Record<Currency, string> = {
  USD: 'USD ($)',
  LBP: 'LBP (ل.ل)',
}

export type DeliveryStatus = 'draft' | 'received' | 'disputed'
export type RejectReason = 'damaged' | 'expired' | 'wrong-item' | 'not-delivered'

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  damaged:       'Damaged',
  expired:       'Expired',
  'wrong-item':  'Wrong item',
  'not-delivered': 'Not delivered',
}

export interface DeliveryLine {
  // The durable link. supplyId is what moves stock; templateId is what ties
  // the line back to the weekly order it was ordered on. Both are stored
  // because they answer different questions, and because a delivery can be
  // unplanned (no order behind it), in which case templateId is null.
  supplyId: string
  templateId: string | null

  // Denormalized at write time so a delivery renders correctly years later
  // even if the supply is renamed or deleted — the same reasoning behind the
  // denormalized provider name on a weekly order line.
  name: string
  nameAr?: string | null
  unit: OrderUnit | string

  qtyOrdered: number      // from the weekly order; 0 on an unplanned delivery
  qtyReceived: number     // what actually came
  qtyRejected: number
  rejectReason: RejectReason | null

  unitCost: number        // in the delivery's currency, per `unit`
  lineTotal: number       // qtyReceived × unitCost, recomputed server-side

  // Whether VAT applies to THIS line. Defaulted from the supply's own
  // `vatable` flag when the line is seeded, and overridable per delivery
  // because the same item can arrive taxed from one supplier and untaxed from
  // another. Optional so deliveries recorded before this existed still read —
  // `undefined` is treated as taxable, which is what a single whole-invoice
  // VAT rate meant for every line at the time they were written.
  vatable?: boolean

  expiryDate?: string | null   // 'YYYY-MM-DD', optional, per batch
}

export interface Delivery {
  id: string
  branch: string
  department: DeliveryDepartment

  providerId: string | null
  providerName: string        // denormalized, same reasoning as line.name

  orderReportId: string | null   // null = unplanned delivery

  deliveredAt: Timestamp | null
  receivedBy: { uid: string; email: string }

  invoiceNumber: string
  invoiceImageUrl: string | null

  currency: Currency
  rateUsed: number            // LBP per 1 USD at the time of receipt

  status: DeliveryStatus
  lines: DeliveryLine[]
  notes: string

  totals: { subtotal: number; vat: number; grand: number }

  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

// ── VAT ────────────────────────────────────────────────────────────────────
// Lebanon's VAT is 11%. A rise to 12% was approved in early 2026 but was not
// in force as of mid-2026.
//
// This is a DEFAULT, not a constant to scatter through the codebase. It lives
// on the delivery document so an old invoice reprints at the rate that
// applied, and it belongs in tenant settings the moment there's a second café.
// Do not inline 0.11 anywhere else.
export const DEFAULT_VAT_RATE = 0.11

// ── Derived values — never stored as truth ─────────────────────────────────
// Variance is computed from qtyOrdered and qtyReceived every time it's shown.
// Storing it would create a second source of truth that silently drifts the
// first time someone edits a line.

export function shortfall(line: DeliveryLine): number {
  return Math.max(0, line.qtyOrdered - line.qtyReceived)
}

export function isShort(line: DeliveryLine): boolean {
  return line.qtyOrdered > 0 && line.qtyReceived < line.qtyOrdered
}

export function lineTotal(line: Pick<DeliveryLine, 'qtyReceived' | 'unitCost'>): number {
  return round2(line.qtyReceived * line.unitCost)
}

// Money in JavaScript is floating point, so every computed figure is rounded
// to cents at the point it's produced. Without this, a dozen lines of
// 4.20 × 17 accumulate a total that disagrees with the supplier's paper bill
// by a cent — which is exactly the kind of thing that destroys trust in a
// system whose whole job is matching an invoice.
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Invoice totals, with VAT charged per line rather than on the whole subtotal.
 *
 * A real supplier invoice mixes taxed and untaxed items — most raw food is
 * zero-rated while cleaning chemicals and paper goods are not — so a single
 * rate across the subtotal cannot match the paper bill. It was close enough
 * to look right and wrong by a few percent, which is the worst kind of wrong
 * for a figure that feeds food cost.
 *
 * `taxableSubtotal` is returned alongside so the form can show WHY the VAT
 * figure is what it is; reconciling against a supplier is much easier when the
 * taxed portion is visible rather than inferred.
 *
 * A line with `vatable` undefined counts as taxable — that is what the old
 * whole-invoice rate did to every line, so existing deliveries reprint at the
 * totals they were saved with.
 */
export function computeTotals(
  lines: DeliveryLine[],
  vatRate: number = DEFAULT_VAT_RATE,
): { subtotal: number; taxableSubtotal: number; vat: number; grand: number } {
  const subtotal = round2(lines.reduce((sum, l) => sum + lineTotal(l), 0))
  const taxableSubtotal = round2(
    lines.reduce((sum, l) => (l.vatable === false ? sum : sum + lineTotal(l)), 0)
  )
  const vat = round2(taxableSubtotal * vatRate)
  return { subtotal, taxableSubtotal, vat, grand: round2(subtotal + vat) }
}

/**
 * A blank line for an item that was NOT on the weekly order.
 *
 * Deliveries arrive with things nobody ordered — a substitution, a free case,
 * something the rep threw in. The data model always allowed it (templateId
 * null, qtyOrdered 0, and isShort() deliberately returns false for it), and
 * the receiving form's own empty state has always invited it. There was simply
 * no way to add one.
 */
export function unplannedLine(supply: {
  id: string
  name: string
  nameAr?: string | null
  unit: string
  avgUnitCost?: number
  vatable?: boolean
}): DeliveryLine {
  return {
    supplyId: supply.id,
    templateId: null,
    name: supply.name,
    nameAr: supply.nameAr ?? null,
    unit: supply.unit,
    qtyOrdered: 0,
    qtyReceived: 0,
    qtyRejected: 0,
    rejectReason: null,
    unitCost: supply.avgUnitCost ?? 0,
    lineTotal: 0,
    vatable: supply.vatable !== false,
  }
}

// ── Weighted average cost ──────────────────────────────────────────────────
// Maintained on the supply as stock is received. This is the basis for food
// cost %, for recipe costing later, and for spotting supplier price drift.
//
// Weighted average rather than last-price-paid because last-price is
// misleading the moment you hold stock bought at two prices: 40 litres at
// $4.00 plus 10 litres at $6.00 is not $6.00 oil, it's $4.40 oil.
//
// The guard matters. With no stock on hand and none arriving, there's nothing
// to average — return the new price rather than dividing by zero. And a
// delivery of 0 received (everything rejected) must not move the cost at all.
export function weightedAverageCost(
  currentQty: number,
  currentAvgCost: number,
  receivedQty: number,
  receivedUnitCost: number,
): number {
  if (receivedQty <= 0) return currentAvgCost
  const totalQty = currentQty + receivedQty
  if (totalQty <= 0) return round2(receivedUnitCost)
  const totalValue = (currentQty * currentAvgCost) + (receivedQty * receivedUnitCost)
  return round2(totalValue / totalQty)
}

// Price drift against what this supply last cost. Returned as a ratio so the
// caller decides what counts as alarming — "this provider raised olive oil 22%
// in six weeks" is a renegotiation, and it starts here.
export function priceChange(previousUnitCost: number, newUnitCost: number): number | null {
  if (!previousUnitCost) return null
  return (newUnitCost - previousUnitCost) / previousUnitCost
}

// ── Seeding a delivery from a weekly order ─────────────────────────────────
// THE FORM DESIGN DECISION, expressed in code.
//
// Most lines arrive exactly as ordered. A form that makes someone type every
// quantity again is a form staff abandon after a week. So opening a delivery
// against a submitted weekly order pre-fills every qtyReceived with
// qtyOrdered, and the receiver touches only the lines that were short,
// damaged, or priced differently — behind one "Confirm all as ordered" button.
//
// unitCost starts at the supply's current average cost, so an unchanged price
// needs no typing either. It is NOT pre-filled from the order, because a
// weekly order carries no price at all — that's the gap this whole phase exists
// to close.
export interface SeedSource {
  templateId: string
  supplyId: string | null
  name: string
  nameAr?: string | null
  unit: OrderUnit | string
  quantity: number
  currentAvgCost: number
  vatable?: boolean
}

export function seedLinesFromOrder(items: SeedSource[]): DeliveryLine[] {
  return items
    // A template item with no supplyId cannot move stock — receiving it would
    // silently do nothing. Dropping it here is deliberate: the caller surfaces
    // the count so the gap gets fixed in the template rather than hidden.
    .filter(i => i.supplyId)
    .map(i => ({
      supplyId: i.supplyId as string,
      templateId: i.templateId,
      name: i.name,
      nameAr: i.nameAr ?? null,
      unit: i.unit,
      qtyOrdered: i.quantity,
      qtyReceived: i.quantity,
      qtyRejected: 0,
      rejectReason: null,
      unitCost: i.currentAvgCost,
      lineTotal: round2(i.quantity * i.currentAvgCost),
      vatable: i.vatable !== false,
      expiryDate: null,
    }))
}

// ── Food cost ──────────────────────────────────────────────────────────────
// COGS for a branch over a period, from what was actually received and paid
// for. Pair it with the net sales the end-of-day report already captures and
// you have food cost % — per branch, per week — which nothing computes today
// and which is the first report a café owner asks for.
//
// Converts everything to USD using each delivery's OWN stored rate, never a
// current one, so a historical period doesn't silently re-value when the rate
// moves.
export function costOfGoodsUsd(deliveries: Delivery[]): number {
  return round2(
    deliveries
      .filter(d => d.status !== 'draft')
      .reduce((sum, d) => {
        const grand = d.totals?.grand ?? 0
        if (d.currency === 'USD') return sum + grand
        // A missing or zero rate on an LBP delivery would divide to Infinity
        // and poison the whole total. Skip it — and note that the route
        // refuses to post such a delivery in the first place.
        if (!d.rateUsed) return sum
        return sum + (grand / d.rateUsed)
      }, 0)
  )
}

export function foodCostPercent(cogsUsd: number, netSalesUsd: number): number | null {
  if (!netSalesUsd) return null
  return cogsUsd / netSalesUsd
}

export function deliveryDocLabel(d: Pick<Delivery, 'branch' | 'department' | 'providerName' | 'invoiceNumber'>): string {
  // Built by joining only the parts that exist. Interpolating them all
  // unconditionally left "Main — Kitchen —  — WALK-0001" in the audit log
  // whenever a delivery arrived without a named supplier, which is every
  // unplanned one.
  return [d.branch, d.department, d.providerName, d.invoiceNumber]
    .filter(part => part && String(part).trim())
    .join(' — ')
}

// How much of each ordered line has actually arrived, across every delivery
// booked against that order. Keyed by templateId because that's what a weekly
// order line carries.
export function fulfilmentByTemplateId(deliveries: Delivery[]): Record<string, number> {
  const received: Record<string, number> = {}
  for (const d of deliveries) {
    // A draft hasn't arrived yet — counting it would show an order as
    // fulfilled by a delivery nobody has checked in.
    if (d.status === 'draft') continue
    for (const line of d.lines) {
      if (!line.templateId) continue
      received[line.templateId] = (received[line.templateId] ?? 0) + line.qtyReceived
    }
  }
  return received
}
