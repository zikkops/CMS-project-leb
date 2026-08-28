// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The write path for goods receiving. This is where stock moves and money is
// computed, which is precisely why it isn't in the browser.
//
// The existing admin panel writes almost everything client-side, and that was
// survivable while the blast radius of a tampered client was loyalty XP. It is
// not survivable here: a delivery sets purchase cost, which feeds weighted
// average cost, which feeds food cost % and every costing decision after it.
// A browser must not be trusted to compute those numbers or to move stock.
//
// This is the first NEW module built to the Phase 00 rule — no client SDK
// writes — rather than retrofitted to it.

import { FieldValue, type Transaction } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import {
  computeTotals, round2, weightedAverageCost,
  DEFAULT_VAT_RATE, DELIVERY_BRANCHES,
  DELIVERY_DEPARTMENTS,
  type Currency, type Delivery, type DeliveryDepartment, type DeliveryLine,
  type DeliveryStatus, type RejectReason,
} from '../deliveryMath'

const VALID_STATUS: DeliveryStatus[] = ['draft', 'received', 'disputed']
const VALID_REASONS: RejectReason[] = ['damaged', 'expired', 'wrong-item', 'not-delivered']

// A generous sanity ceiling, not a business rule — the same posture as
// transactions' xpAmount caps in firestore.rules. It exists to turn a fat
// finger or a corrupted payload into a clear error instead of a supply record
// claiming forty thousand litres of milk.
const MAX_QTY = 100000
const MAX_UNIT_COST = 1000000

function num(value: unknown, field: string, { min = 0, max }: { min?: number; max: number }): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number.`)
  if (n < min) throw new HttpError(400, `${field} cannot be negative.`)
  if (n > max) throw new HttpError(400, `${field} is implausibly large (${n}). Check the entry.`)
  return n
}

function str(value: unknown, field: string, { maxLen = 200, required = false } = {}): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (required && !s) throw new HttpError(400, `${field} is required.`)
  if (s.length > maxLen) throw new HttpError(400, `${field} is too long.`)
  return s
}

export interface ParsedDelivery {
  branch: string
  department: DeliveryDepartment
  providerId: string | null
  providerName: string
  orderReportId: string | null
  invoiceNumber: string
  invoiceImageUrl: string | null
  currency: Currency
  rateUsed: number
  status: DeliveryStatus
  vatRate: number
  notes: string
  lines: DeliveryLine[]
}

export function parseDelivery(body: Record<string, unknown>): ParsedDelivery {
  const branch = str(body.branch, 'Branch', { required: true })
  if (!(DELIVERY_BRANCHES as readonly string[]).includes(branch)) {
    throw new HttpError(400, `Unknown branch: ${branch}`)
  }

  const department = str(body.department, 'Department', { required: true })
  if (!(DELIVERY_DEPARTMENTS as readonly string[]).includes(department)) {
    throw new HttpError(400, `Unknown department: ${department}`)
  }

  const status = (typeof body.status === 'string' ? body.status : 'draft') as DeliveryStatus
  if (!VALID_STATUS.includes(status)) throw new HttpError(400, 'Unknown delivery status.')

  const currency = (typeof body.currency === 'string' ? body.currency : 'USD') as Currency
  if (currency !== 'USD' && currency !== 'LBP') throw new HttpError(400, 'Currency must be USD or LBP.')

  // An LBP delivery with no rate is unusable: costOfGoodsUsd() would have to
  // either divide by zero or silently drop it from the food-cost total. Refuse
  // it at the door rather than storing a document that can't be reported on.
  const rateUsed = num(body.rateUsed ?? 0, 'Exchange rate', { max: 100000000 })
  if (currency === 'LBP' && rateUsed <= 0) {
    throw new HttpError(400, 'An LBP delivery needs the exchange rate that was used.')
  }

  const vatRate = body.vatRate === undefined
    ? DEFAULT_VAT_RATE
    : num(body.vatRate, 'VAT rate', { max: 1 })

  const rawLines = Array.isArray(body.lines) ? body.lines : []
  if (rawLines.length === 0) throw new HttpError(400, 'A delivery needs at least one line.')
  if (rawLines.length > 500) throw new HttpError(400, 'Too many lines in one delivery.')

  const seen = new Set<string>()
  const lines: DeliveryLine[] = rawLines.map((raw, i) => {
    const l = (raw ?? {}) as Record<string, unknown>
    const supplyId = str(l.supplyId, `Line ${i + 1} supply`, { required: true, maxLen: 128 })

    // Two lines for the same supply would each try to move stock, and the
    // weighted-average calculation would compound them in an order that
    // depends on array position. Merge them in the UI, not here.
    if (seen.has(supplyId)) {
      throw new HttpError(400, `Line ${i + 1}: "${str(l.name, 'name')}" appears twice. Combine the lines.`)
    }
    seen.add(supplyId)

    const qtyOrdered  = num(l.qtyOrdered ?? 0, `Line ${i + 1} ordered qty`, { max: MAX_QTY })
    const qtyReceived = num(l.qtyReceived ?? 0, `Line ${i + 1} received qty`, { max: MAX_QTY })
    const qtyRejected = num(l.qtyRejected ?? 0, `Line ${i + 1} rejected qty`, { max: MAX_QTY })
    const unitCost    = num(l.unitCost ?? 0, `Line ${i + 1} unit cost`, { max: MAX_UNIT_COST })

    const rejectReason = typeof l.rejectReason === 'string' && VALID_REASONS.includes(l.rejectReason as RejectReason)
      ? (l.rejectReason as RejectReason)
      : null

    // A rejection without a reason is a number nobody can act on later, and
    // "why did we reject 3 crates" is the entire value of recording it.
    if (qtyRejected > 0 && !rejectReason) {
      throw new HttpError(400, `Line ${i + 1}: say why the items were rejected.`)
    }

    return {
      supplyId,
      templateId: typeof l.templateId === 'string' && l.templateId ? l.templateId : null,
      name: str(l.name, `Line ${i + 1} name`, { required: true }),
      nameAr: typeof l.nameAr === 'string' && l.nameAr ? l.nameAr : null,
      unit: str(l.unit, `Line ${i + 1} unit`) || 'pcs',
      qtyOrdered,
      qtyReceived,
      qtyRejected,
      rejectReason,
      // Recomputed here, never trusted from the request. The client sends it
      // so the form can show a total as you type; the server decides what it
      // actually is.
      lineTotal: round2(qtyReceived * unitCost),
      unitCost,
      expiryDate: typeof l.expiryDate === 'string' && l.expiryDate ? l.expiryDate : null,
    }
  })

  return {
    branch,
    department: department as DeliveryDepartment,
    providerId: typeof body.providerId === 'string' && body.providerId ? body.providerId : null,
    providerName: str(body.providerName, 'Provider'),
    orderReportId: typeof body.orderReportId === 'string' && body.orderReportId ? body.orderReportId : null,
    invoiceNumber: str(body.invoiceNumber, 'Invoice number', { maxLen: 60 }),
    invoiceImageUrl: typeof body.invoiceImageUrl === 'string' && body.invoiceImageUrl ? body.invoiceImageUrl : null,
    currency,
    rateUsed,
    status,
    vatRate,
    notes: str(body.notes, 'Notes', { maxLen: 2000 }),
    lines,
  }
}

export interface PostResult {
  id: string
  stockMoved: boolean
  linesApplied: number
  missingSupplies: string[]
}

// ── Posting a delivery ─────────────────────────────────────────────────────
// A draft records intent and moves nothing. Only 'received' or 'disputed'
// moves stock — a delivery half-entered on a phone at a back door must not
// leave stock wrong if the person walks away mid-entry.
//
// Runs in one transaction because three things must be true together: stock
// increments, average cost updates, and the delivery says it was applied. Any
// two of those without the third leaves books that don't reconcile.
export async function postDelivery(
  parsed: ParsedDelivery,
  actor: { uid: string; email: string | null },
  existingId?: string,
): Promise<PostResult> {
  const db = adminDb()
  const ref = existingId ? db.doc(`deliveries/${existingId}`) : db.collection('deliveries').doc()
  const totals = computeTotals(parsed.lines, parsed.vatRate)
  const shouldApply = parsed.status !== 'draft'

  const missingSupplies: string[] = []
  let linesApplied = 0

  await db.runTransaction(async (tx: Transaction) => {
    const prevSnap = existingId ? await tx.get(ref) : null
    const prev = prevSnap?.exists ? (prevSnap.data() as Delivery) : null

    // Re-posting an already-applied delivery would double the stock. This is
    // the realistic failure: someone opens a received delivery, fixes a typo
    // in the invoice number, saves, and every quantity lands twice.
    //
    // Editing a received delivery is deliberately refused rather than
    // reversed-and-reapplied. A reversal is the right long-term answer, but it
    // needs a credit-note concept to stay auditable, and silently rewriting
    // posted stock is worse than making someone raise a correction.
    if (prev && prev.status !== 'draft' && shouldApply) {
      throw new HttpError(
        409,
        'This delivery has already been received and its stock applied. ' +
        'Raise a correcting delivery rather than editing this one.'
      )
    }

    // All reads must precede all writes inside a Firestore transaction, so the
    // supply documents are gathered up front rather than as each line is
    // written.
    const supplyRefs = parsed.lines.map(l => db.doc(`supplies/${l.supplyId}`))
    const supplySnaps = supplyRefs.length > 0 ? await tx.getAll(...supplyRefs) : []

    tx.set(ref, {
      branch: parsed.branch,
      department: parsed.department,
      providerId: parsed.providerId,
      providerName: parsed.providerName,
      orderReportId: parsed.orderReportId,
      invoiceNumber: parsed.invoiceNumber,
      invoiceImageUrl: parsed.invoiceImageUrl,
      currency: parsed.currency,
      rateUsed: parsed.rateUsed,
      vatRate: parsed.vatRate,
      status: parsed.status,
      lines: parsed.lines,
      notes: parsed.notes,
      totals,
      receivedBy: { uid: actor.uid, email: actor.email },
      deliveredAt: prev?.deliveredAt ?? FieldValue.serverTimestamp(),
      createdAt: prev?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      // Records that stock was moved by THIS document, so a later reader can
      // tell a posted delivery from a draft without re-deriving it from status.
      stockAppliedAt: shouldApply ? FieldValue.serverTimestamp() : null,
    })

    if (!shouldApply) return

    for (let i = 0; i < parsed.lines.length; i++) {
      const line = parsed.lines[i]
      const snap = supplySnaps[i]

      // A line pointing at a deleted supply can't move stock. Recording it and
      // carrying on beats failing the whole delivery — the invoice is real and
      // the other twenty lines are correct — but the caller reports it so the
      // gap gets fixed rather than silently swallowed.
      if (!snap.exists) {
        missingSupplies.push(line.name)
        continue
      }

      // Only what was actually accepted moves stock. Rejected items were
      // handed back at the door; counting them would inflate stock and then
      // show up as unexplained shrinkage at the next count.
      const accepted = line.qtyReceived - line.qtyRejected
      if (accepted <= 0) continue

      const data = snap.data() ?? {}
      const rawQty = data.quantity
      const currentQty = typeof rawQty === 'number'
        ? rawQty                                    // legacy single-number stock
        : Number((rawQty as Record<string, unknown>)?.[parsed.branch] ?? 0)
      const currentAvg = Number(data.avgUnitCost ?? 0)

      // Costs are stored per delivery IN ITS OWN CURRENCY, but the supply's
      // average cost has to be one currency or the average is meaningless.
      // USD is the base — it's the stable one here.
      const unitCostUsd = parsed.currency === 'USD'
        ? line.unitCost
        : round2(line.unitCost / parsed.rateUsed)

      tx.update(snap.ref, {
        // Dot-path increment, matching submitDailyInventory's approach: it
        // touches only this branch's key inside the quantity map, so a
        // simultaneous delivery or count at another branch can't be clobbered
        // by a stale whole-map write.
        [`quantity.${parsed.branch}`]: FieldValue.increment(accepted),
        avgUnitCost: weightedAverageCost(currentQty, currentAvg, accepted, unitCostUsd),
        lastUnitCost: unitCostUsd,
        lastReceivedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      linesApplied++
    }
  })

  return { id: ref.id, stockMoved: shouldApply, linesApplied, missingSupplies }
}
