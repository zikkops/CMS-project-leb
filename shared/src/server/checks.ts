// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Open checks and the tickets they fire.
//
// ── The rule this file exists to enforce ───────────────────────────────────
// The browser sends an item id, a quantity and a set of modifier option ids.
// It does NOT send a price, a name or a station. Every one of those is looked
// up here and snapshotted onto the line.
//
// That is the same defect the event-attendance award had: a browser naming its
// own award amount, capped by a rule but not fixed by one. On a till it would
// be worse — a crafted request could add a $0.01 steak, and the check would
// look completely ordinary in the review queue because nothing downstream ever
// questions a price that is already on the line.

import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRANCHES, STOCKED_BRANCHES } from '../branches'
import {
  CHECK_LIMITS, stationForSection, voidReason, BATCH_KEY_PATTERN, batchAlreadyApplied,
  checkTotals, closeBlockedReason, discountReason, serviceRate,
  type Check, type CheckLine, type LineSource, type LineDiscount, type CheckDiscount,
} from '../checks'
import {
  applyPayment, balance, tipProblem, PAYMENT_KEY_PATTERN,
  type Payment, type PaymentRequest, type Tender, type PayCurrency,
} from '../payments'
import { serverFeatureOn } from './features'
import { openShiftId } from './drawer'
import { resolveMemberCode } from './memberCodes'
import { pointsForCheck } from '../loyaltyTiers'
import { refundOf } from '../drawer'
import { vatRateOn } from '../businessSettings'
import { todayYmd } from '../dates'
import { BRAND } from '../brand'
import { isSoldOut, soldOutDay } from '../soldOut'
import { validateSelection, toSelections, type ModifierGroup } from '../modifiers'
import { effectivePrice } from '../productPricing'
import { heldStationsFor, toTicketLines } from '../tickets'
import { readSettings } from './settings'
import { issueInvoiceNumber } from './invoiceNumber'
import { toRecipeSupply } from './recipes'
import {
  lineConsumption, sendMoves, reversalPlan,
  type Recipe, type RecipeSupply,
} from '../recipes'

const CHECKS = 'checks'
const TICKETS = 'kitchenTickets'

// ── What a caller may ask for ─────────────────────────────────────────────

export interface LineRequest {
  source: LineSource
  /** menuItems/{id} or products/{id}. */
  refId: string
  quantity: number
  /** Option ids only. What they cost is looked up. */
  modifierOptionIds: string[]
  seat: number | null
  course: number | null
  note: string
}

function whole(raw: unknown, label: string, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${label} must be a whole number between ${min} and ${max}.`)
  }
  return n
}

function optionalWhole(raw: unknown, label: string, min: number, max: number): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  return whole(raw, label, min, max)
}

export function parseLineRequests(body: Record<string, unknown>): LineRequest[] {
  const raw = Array.isArray(body.lines) ? body.lines : []
  if (raw.length === 0) throw new HttpError(400, 'No items to add.')
  if (raw.length > CHECK_LIMITS.linesPerCheck) {
    throw new HttpError(400, `Too many items at once (max ${CHECK_LIMITS.linesPerCheck}).`)
  }

  return raw.map((r, i) => {
    const l = (r ?? {}) as Record<string, unknown>
    const where = `Item ${i + 1}`

    const source = String(l.source ?? '')
    if (source !== 'menu' && source !== 'product') {
      throw new HttpError(400, `${where}: unknown item type.`)
    }
    const refId = String(l.refId ?? '').trim()
    if (!refId) throw new HttpError(400, `${where}: missing item.`)

    const ids = Array.isArray(l.modifierOptionIds) ? l.modifierOptionIds : []
    return {
      source,
      refId,
      quantity: whole(l.quantity ?? 1, `${where} quantity`, 1, CHECK_LIMITS.quantityPerLine),
      modifierOptionIds: [...new Set(ids.filter((x): x is string => typeof x === 'string'))],
      seat: optionalWhole(l.seat, `${where} seat`, 1, CHECK_LIMITS.maxSeat),
      course: optionalWhole(l.course, `${where} course`, 1, CHECK_LIMITS.maxCourse),
      note: String(l.note ?? '').trim().slice(0, CHECK_LIMITS.noteLength),
    }
  })
}

// ── Turning a request into a priced line ──────────────────────────────────

/**
 * Builds check lines from requests, pricing every one from stored data.
 *
 * Everything is fetched up front in as few round trips as the shape allows:
 * one getAll for the items, one for the categories that decide their stations,
 * one for the modifier groups. A read per line would make a ten-item round
 * thirty reads, and a waiter sends rounds all evening.
 */
/**
 * The Send's idempotency key, if the phone sent one.
 *
 * Optional, so a phone running older code still works — it simply gets no
 * protection against a doubled retry. Present but malformed is refused rather
 * than ignored: silently dropping it would switch the protection off without
 * anyone knowing.
 */
export function parseBatchKey(body: Record<string, unknown>): string | null {
  const raw = body.batchKey
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string' || !BATCH_KEY_PATTERN.test(raw)) {
    throw new HttpError(400, 'Invalid batch key.')
  }
  return raw
}

async function buildLines(caller: Caller, requests: LineRequest[]): Promise<{ lines: CheckLine[]; soldOut: Map<string, unknown> }> {
  const db = adminDb()

  const menuIds = [...new Set(requests.filter(r => r.source === 'menu').map(r => r.refId))]
  const productIds = [...new Set(requests.filter(r => r.source === 'product').map(r => r.refId))]

  const [menuSnaps, productSnaps] = await Promise.all([
    menuIds.length ? db.getAll(...menuIds.map(id => db.doc(`menuItems/${id}`))) : [],
    productIds.length ? db.getAll(...productIds.map(id => db.doc(`products/${id}`))) : [],
  ])
  const menuById = new Map(menuSnaps.map(s => [s.id, s]))
  const productById = new Map(productSnaps.map(s => [s.id, s]))

  // Stations come from the category's section, so the categories those items
  // belong to are needed too.
  const categoryIds = [...new Set(menuSnaps
    .filter(s => s.exists)
    .map(s => String(s.data()?.categoryId ?? ''))
    .filter(Boolean))]
  const categorySnaps = categoryIds.length
    ? await db.getAll(...categoryIds.map(id => db.doc(`menuCategories/${id}`)))
    : []
  const sectionByCategory = new Map(
    categorySnaps.map(s => [s.id, String(s.data()?.section ?? '')]))

  // Every modifier group any of these items carries.
  const groupIds = [...new Set(menuSnaps
    .filter(s => s.exists)
    .flatMap(s => (s.data()?.modifierGroupIds ?? []) as string[]))]
  const groupSnaps = groupIds.length
    ? await db.getAll(...groupIds.map(id => db.doc(`modifierGroups/${id}`)))
    : []
  const groups = new Map<string, ModifierGroup>(
    groupSnaps.filter(s => s.exists)
      .map(s => [s.id, { id: s.id, ...(s.data() as Omit<ModifierGroup, 'id'>) }]))

  // Recipes (Sep 2026). With the `recipes` switch on, each dish's recipe is
  // resolved here — before the transaction, like the price — and what ONE
  // serving takes is snapshotted onto the line. Send and void apply that
  // snapshot, so a recipe edited between adding and sending changes nothing
  // already on a check. Off, there are no extra reads and no new fields:
  // Send behaves exactly as it did before recipes existed.
  const recipesOn = menuIds.length > 0 && await serverFeatureOn('recipes')
  const recipeSnaps = recipesOn ? await db.getAll(...menuIds.map(id => db.doc(`recipes/${id}`))) : []
  const recipeById = new Map<string, Recipe>(recipeSnaps.filter(s => s.exists).map((s): [string, Recipe] => {
    const d = s.data() ?? {}
    return [s.id, {
      lines: Array.isArray(d.lines) ? d.lines : [],
      adjustments: d.adjustments && typeof d.adjustments === 'object' ? d.adjustments : {},
    }]
  }))
  const recipeSupplyIds = [...new Set([...recipeById.values()].flatMap(r => [
    ...r.lines.map(l => l.supplyId),
    ...Object.values(r.adjustments ?? {}).flat().flatMap(a => (a.kind === 'add' ? [a.supplyId] : [a.toSupplyId])),
  ]).filter(Boolean))]
  const recipeSupplySnaps = recipeSupplyIds.length
    ? await db.getAll(...recipeSupplyIds.map(id => db.doc(`supplies/${id}`)))
    : []
  const recipeSupplies: Record<string, RecipeSupply> = Object.fromEntries(
    recipeSupplySnaps.filter(s => s.exists).map(s => [s.id, toRecipeSupply(s.id, s.data() ?? {})]))

  const lines = requests.map((req, i) => {
    const where = `Item ${i + 1}`

    if (req.source === 'product') {
      const snap = productById.get(req.refId)
      if (!snap?.exists) throw new HttpError(400, `${where} is no longer in the catalogue.`)
      const data = snap.data() ?? {}
      // Merchandise carries no modifiers — a board game has no milk choice.
      if (req.modifierOptionIds.length > 0) {
        throw new HttpError(400, `${where}: merchandise does not take modifiers.`)
      }
      return line(caller, req, {
        name: String(data.name ?? ''),
        // effectivePrice, not price: a product on sale rings up at the sale
        // price, and a till that ignored that would charge more than the shelf.
        unitPrice: effectivePrice({
          price: Number(data.price ?? 0),
          salePrice: data.salePrice == null ? null : Number(data.salePrice),
          saleEndsAt: data.saleEndsAt == null ? null : String(data.saleEndsAt),
        }),
        // Nobody cooks a board game.
        station: null,
        modifiers: [],
      })
    }

    const snap = menuById.get(req.refId)
    if (!snap?.exists) throw new HttpError(400, `${where} is no longer on the menu.`)
    const data = snap.data() ?? {}
    if (data.available === false) {
      throw new HttpError(400, `"${data.name ?? where}" is marked unavailable.`)
    }

    // Every group the item carries is checked, including ones the caller did
    // not mention — that is how a required choice nobody made is caught.
    const itemGroups = ((data.modifierGroupIds ?? []) as string[])
      .map(id => groups.get(id))
      .filter((g): g is ModifierGroup => Boolean(g))

    const selections = []
    const claimed = new Set(req.modifierOptionIds)
    for (const group of itemGroups) {
      const chosen = group.options.filter(o => claimed.has(o.id)).map(o => o.id)
      const problem = validateSelection(group, chosen)
      if (problem) throw new HttpError(400, `${data.name ?? where} — ${problem}`)
      selections.push(...toSelections(group, chosen))
      chosen.forEach(id => claimed.delete(id))
    }
    // Anything left over belongs to no group on this item.
    if (claimed.size > 0) {
      throw new HttpError(400, `${data.name ?? where}: a chosen option is not offered on that item.`)
    }

    // Set only when there is something to record: Firestore refuses
    // undefined, and a line without these fields consumes nothing.
    const recipe = recipeById.get(req.refId)
    const consumption = recipe
      ? lineConsumption(recipe, selections.map(s => s.optionId), 1, recipeSupplies)
      : null

    return line(caller, req, {
      name: String(data.name ?? ''),
      unitPrice: Number(data.price ?? 0),
      station: stationForSection(sectionByCategory.get(String(data.categoryId ?? ''))),
      modifiers: selections,
      ...(consumption && consumption.consumes.length > 0 ? { consumesPerServing: consumption.consumes } : {}),
      ...(consumption && consumption.unknown.length > 0 ? { consumesUnknown: consumption.unknown } : {}),
    })
  })
  // What each menu item says about being sold out, for addLines() to judge
  // against the check's branch (UPGRADE.md T3.5).
  const soldOut = new Map(menuSnaps.filter(s => s.exists).map(s => [s.id, s.data()?.soldOut as unknown]))
  return { lines, soldOut }
}

function line(
  caller: Caller,
  req: LineRequest,
  looked: Pick<CheckLine, 'name' | 'unitPrice' | 'station' | 'modifiers'>
    & Partial<Pick<CheckLine, 'consumesPerServing' | 'consumesUnknown'>>,
): CheckLine {
  return {
    id: randomUUID(),
    source: req.source,
    refId: req.refId,
    ...looked,
    quantity: req.quantity,
    seat: req.seat,
    course: req.course,
    status: 'draft',
    note: req.note,
    addedBy: caller.uid,
    addedByEmail: caller.email ?? '',
    sentAt: null,
    voidReason: null,
    voidReasonKey: null,
    voidWasWaste: null,
  }
}

// ── Reading ───────────────────────────────────────────────────────────────

async function readCheck(tx: Transaction, id: string): Promise<Check> {
  const snap = await tx.get(adminDb().doc(`${CHECKS}/${id}`))
  if (!snap.exists) throw new HttpError(404, 'That check no longer exists.')
  return { id: snap.id, ...(snap.data() as Omit<Check, 'id'>) }
}

// ── What a caller may pay with ─────────────────────────────────────────────

/**
 * The payment in the request. Only its shape is checked here — whether it is
 * a valid amount of money is applyPayment()'s question, answered in one place.
 */
export function parsePaymentRequest(body: Record<string, unknown>): PaymentRequest {
  return {
    tender: String(body.tender ?? '') as Tender,
    currency: String(body.currency ?? '') as PayCurrency,
    amount: Number(body.amount),
    ...(body.tipUsd !== undefined && body.tipUsd !== null && body.tipUsd !== '' ? { tipUsd: Number(body.tipUsd) } : {}),
  }
}

/**
 * The payment's key, if the till sent one.
 *
 * Same contract as parseBatchKey(): optional so an older till still works,
 * refused when present and malformed — dropping a bad key would switch off
 * the protection against taking the same money twice without anyone knowing.
 */
export function parsePaymentKey(body: Record<string, unknown>): string | null {
  const raw = body.paymentKey
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string' || !PAYMENT_KEY_PATTERN.test(raw)) {
    throw new HttpError(400, 'Invalid payment key.')
  }
  return raw
}

/** Why this check cannot close for want of payment, or null when it is paid. */
function owedOn(check: Check): string | null {
  const due = checkTotals(check).net
  const payments = check.payments ?? []
  // No rate yet means no payment yet. A check owing nothing — a comped table,
  // a staff meal at 100% — closes without one.
  if (!check.billRate) return due > 0 ? `$${due.toFixed(2)} is still owed. Take payment first.` : null
  const b = balance(due, payments, check.billRate)
  if (b.settled) return null
  return `$${b.remainingUsd.toFixed(2)} (${b.remainingLbp.toLocaleString('en-US')} LBP) is still owed. ` +
    'Take payment first.'
}

// ── Operations ────────────────────────────────────────────────────────────

/**
 * Opens a check on a table, refusing if one is already open there.
 *
 * In a transaction because two waiters reaching the same table at the same
 * moment is a real thing on a busy floor, and the loser must be told rather
 * than silently given a second check on the same table — which is how a table
 * ends up paying twice for one order.
 */
/**
 * Resolves a table number to the id a check is keyed on.
 *
 * A number on the floor plan resolves to that marker's id, so a check and the
 * customer-facing map are talking about the same table.
 *
 * A number that is NOT on the plan is still allowed, keyed as `n:7`. The POS
 * has to work in a café that has not drawn its floor plan yet — requiring one
 * first would mean a product that cannot take an order until somebody has done
 * an unrelated setup task, and "table 7" is perfectly meaningful without a
 * diagram. The id is synthesised rather than random so that opening 7 twice
 * collides the way a real table does, and the duplicate check still bites.
 */
async function resolveTable(
  branch: string,
  tableNumber: number,
): Promise<{ tableId: string; tableNumber: number }> {
  const layout = await adminDb().doc(`branchTableLayouts/${branch}`).get()
  const tables = (layout.data()?.tables ?? []) as { id: string; number: number }[]
  const onPlan = tables.find(t => t.number === tableNumber)
  return { tableId: onPlan ? onPlan.id : `n:${tableNumber}`, tableNumber }
}

/**
 * A phone-made id for a check being opened, if one was sent (Phase 04, 7b).
 *
 * The counter device opens tables while offline, and everything it queues
 * after that — items, payments — has to name the check before the server has
 * ever seen it. Letting the phone choose the id means those queued actions
 * need no remapping, and a replayed open is recognised rather than refused.
 * Same shape and same refusal rule as a batch or payment key.
 */
export function parseOpenId(body: Record<string, unknown>): string | null {
  const raw = body.openId
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string' || !BATCH_KEY_PATTERN.test(raw)) throw new HttpError(400, 'Invalid check id.')
  return raw
}

export async function openCheck(
  caller: Caller,
  input: { branch: string; tableNumber: number; guestCount: number; openId?: string | null },
): Promise<{ id: string; replayed: boolean }> {
  const db = adminDb()

  if (!(BRANCHES as readonly string[]).includes(input.branch)) {
    throw new HttpError(400, 'Unknown branch.')
  }
  const guestCount = whole(input.guestCount, 'Guest count', 1, CHECK_LIMITS.maxGuests)
  const number = whole(input.tableNumber, 'Table number', 1, 9999)
  const table = await resolveTable(input.branch, number)
  // The service charge this check will carry (UPGRADE.md T3.8), read before
  // the transaction and copied onto the check: a rate changed later re-prices
  // nothing already open. None unless the switch is on and a rate is set.
  const serviceNow = (await serverFeatureOn('serviceCharge')) ? serviceRate({ rate: (await readSettings()).serviceChargeRate }) : 0

  return db.runTransaction(async tx => {
    // A replay of an open that already happened returns the same check. Read
    // first, before the open-table query, and before any write.
    if (input.openId) {
      const existing = await tx.get(db.doc(`${CHECKS}/${input.openId}`))
      if (existing.exists) {
        const d = existing.data() ?? {}
        if (d.branch !== input.branch || d.tableId !== table.tableId) {
          throw new HttpError(409, 'That check id is already in use for another table.')
        }
        return { id: existing.id, replayed: true }
      }
    }

    const open = await tx.get(db.collection(CHECKS)
      .where('branch', '==', input.branch)
      .where('tableId', '==', table.tableId)
      .where('status', '==', 'open')
      .limit(1))
    if (!open.empty) {
      throw new HttpError(409, `Table ${table.tableNumber} already has an open check.`)
    }

    const ref = input.openId ? db.doc(`${CHECKS}/${input.openId}`) : db.collection(CHECKS).doc()
    tx.set(ref, {
      branch: input.branch,
      tableId: table.tableId,
      // Snapshotted: renumbering the floor plan must not rewrite history.
      tableNumber: table.tableNumber,
      status: 'open',
      guestCount,
      lines: [],
      staffDiscount: null,
      ...(serviceNow > 0 ? { serviceCharge: { rate: serviceNow } } : {}),
      receiptNumber: null,
      openedBy: caller.uid,
      openedByEmail: caller.email ?? '',
      openedAt: FieldValue.serverTimestamp(),
      closedAt: null,
    })
    return { id: ref.id, replayed: false }
  })
}

/**
 * When items were taken during an outage, if the counter device says they
 * were (Phase 04, 7c) — or null for an ordinary add.
 *
 * Only a real instant from the last two days and not from the future: the
 * time is recorded as when the items were sent, and a check should not be
 * able to claim it was served next week.
 */
export function parseMadeOffline(body: Record<string, unknown>): string | null {
  const raw = body.madeOfflineAt
  if (raw === undefined || raw === null || raw === '') return null
  const t = typeof raw === 'string' ? Date.parse(raw) : Number.NaN
  const now = Date.now()
  if (!Number.isFinite(t) || t > now + 5 * 60_000 || t < now - 48 * 3_600_000) {
    throw new HttpError(400, 'Items taken offline need the time they were taken, within the last two days.')
  }
  return new Date(t).toISOString()
}

/**
 * Adds priced lines to an open check. They start as drafts — unless they were
 * taken during an outage.
 *
 * `madeOfflineAt` is the owner's decision of 12 Sep 2026: the kitchen made
 * those orders from spoken or paper tickets while the connection was down, so
 * on reconnect they are recorded as already made — marked sent at the time
 * they were taken, with NO kitchen ticket, which would have them cooked twice.
 * Merchandise still leaves the shelf, exactly as sendCheck() does it.
 */
export async function addLines(
  caller: Caller,
  checkId: string,
  requests: LineRequest[],
  batchKey: string | null = null,
  madeOfflineAt: string | null = null,
): Promise<{ added: number; lines: CheckLine[]; duplicate: boolean }> {
  // Priced BEFORE the transaction: it reads menu items, categories and
  // modifier groups, and a transaction may not read after its first write.
  const { lines: built, soldOut } = await buildLines(caller, requests)

  let duplicate = false
  await adminDb().runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    if (check.status !== 'open') throw new HttpError(409, 'That check is closed.')
    // Inside the transaction, so two retries racing each other cannot both
    // see "not applied yet". Checked before the size limit: a retry of a
    // batch that filled the check must succeed as a no-op, not fail as full.
    if (batchAlreadyApplied(check.lines, batchKey)) {
      duplicate = true
      return
    }
    if (check.lines.length + built.length > CHECK_LIMITS.linesPerCheck) {
      throw new HttpError(400, `A check can hold at most ${CHECK_LIMITS.linesPerCheck} items.`)
    }
    // Sold out at this branch today (UPGRADE.md T3.5). Not for orders taken
    // during an outage: the kitchen already made those.
    if (!madeOfflineAt) {
      const today = soldOutDay(BRAND.locale.timezone)
      const out = built.find(l => l.source === 'menu' && isSoldOut(soldOut.get(l.refId), check.branch, today))
      if (out) throw new HttpError(409, `"${out.name}" is sold out at ${check.branch} today.`)
    }
    const stamped = built.map(l => ({
      ...l,
      ...(batchKey ? { batchKey } : {}),
      ...(madeOfflineAt ? { status: 'sent' as const, sentAt: madeOfflineAt, madeOffline: true } : {}),
    }))
    // Ingredients for orders made during the outage, read before any write
    // as a transaction requires. See sendCheck() for why a missing supply is
    // skipped rather than allowed to fail the batch.
    const offlineMoves = madeOfflineAt && (STOCKED_BRANCHES as readonly string[]).includes(check.branch) ? sendMoves(stamped) : []
    const offlineSupplies = offlineMoves.length
      ? await tx.getAll(...offlineMoves.map(m => adminDb().doc(`supplies/${m.supplyId}`)))
      : []

    if (madeOfflineAt) {
      // Off the shelf now, as a Send would have taken it — see sendCheck().
      for (const l of stamped) {
        if (l.source !== 'product') continue
        tx.update(adminDb().doc(`products/${l.refId}`), {
          [`stock.${check.branch}`]: FieldValue.increment(-l.quantity),
        })
      }
      offlineMoves.forEach((m, i) => {
        if (!offlineSupplies[i]?.exists) return
        tx.update(offlineSupplies[i].ref, { [`quantity.${check.branch}`]: FieldValue.increment(-m.qty) })
      })
    }
    tx.update(adminDb().doc(`${CHECKS}/${checkId}`), {
      lines: [...check.lines, ...stamped],
      updatedAt: FieldValue.serverTimestamp(),
    })
  })

  return duplicate
    ? { added: 0, lines: [], duplicate: true }
    : { added: built.length, lines: built, duplicate: false }
}

/**
 * Fires the draft lines: one ticket per station, and the lines become sent.
 *
 * Both in one transaction. A ticket without its line marked sent would be
 * fired again on the next send — the same food twice — and a line marked sent
 * without a ticket is an order the kitchen never saw.
 */
export async function sendCheck(
  caller: Caller,
  checkId: string,
  hold: readonly unknown[] = [],
): Promise<{ tickets: { id: string; station: string; lines: number; held: boolean }[] }> {
  const db = adminDb()
  // Holding needs its switch (UPGRADE.md T3.11); asked for without it, refused.
  if (hold.length > 0 && !(await serverFeatureOn('holdAndFire'))) throw new HttpError(403, 'Holding food to fire later is switched off.')

  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    if (check.status !== 'open') throw new HttpError(409, 'That check is closed.')

    const drafts = check.lines.filter(l => l.status === 'draft')
    if (drafts.length === 0) throw new HttpError(400, 'Nothing new to send.')

    // Which round this is, per station — read before any write.
    const priorSnap = await tx.get(db.collection(TICKETS).where('checkId', '==', checkId))
    const roundsSoFar = new Map<string, number>()
    priorSnap.docs.forEach(d => {
      const t = d.data()
      const station = String(t.station ?? '')
      roundsSoFar.set(station, Math.max(roundsSoFar.get(station) ?? 0, Number(t.round ?? 0)))
    })

    // ── Ingredients (recipes, Sep 2026): read before the first write ───
    // One move per supply for the whole Send, from each line's per-serving
    // snapshot times its quantity. A supply deleted since the line was added
    // is skipped, never allowed to fail the Send: a waiter's order must not
    // stop because an ingredient's record is gone — and deleting a supply a
    // recipe uses is refused anyway. A branch holding no consumable stock
    // moves none.
    const ingredientMoves = (STOCKED_BRANCHES as readonly string[]).includes(check.branch) ? sendMoves(drafts) : []
    const ingredientSnaps = ingredientMoves.length
      ? await tx.getAll(...ingredientMoves.map(m => db.doc(`supplies/${m.supplyId}`)))
      : []

    const byStation = new Map<string, CheckLine[]>()
    for (const l of drafts) {
      if (!l.station) continue          // merchandise: no pass to fire it to
      const list = byStation.get(l.station) ?? []
      list.push(l)
      byStation.set(l.station, list)
    }

    const created: { id: string; station: string; lines: number; held: boolean }[] = []
    const holding = heldStationsFor(hold, [...byStation.keys()])
    for (const [station, lines] of byStation) {
      const ref = db.collection(TICKETS).doc()
      const held = holding.includes(station)
      tx.set(ref, {
        checkId,
        branch: check.branch,
        tableNumber: check.tableNumber,
        station,
        // Held until the front fires it: on the kitchen screen, greyed, and
        // not printed (the printers print a 'new' ticket).
        status: held ? 'held' : 'new',
        round: (roundsSoFar.get(station) ?? 0) + 1,
        lines: toTicketLines(lines),
        sentBy: caller.uid,
        sentByEmail: caller.email ?? '',
        sentAt: FieldValue.serverTimestamp(),
        bumpedAt: null,
        bumpedBy: null,
      })
      created.push({ id: ref.id, station, lines: lines.length, held })
    }
    if (holding.length > 0) {
      tx.update(db.doc(`${CHECKS}/${checkId}`), { heldStations: [...new Set([...(check.heldStations ?? []), ...holding])] })
    }

    // ── Merchandise leaves the shelf ────────────────────────────────────
    // The phase note's acceptance criterion: a merchandise line deducts from
    // products, not menuItems. Here is where it happens.
    //
    // On SEND, not on close: the customer has the board game in their hands
    // from that moment, and a shelf count taken before they pay would be
    // wrong. Phase 04 adds payment on top of this and does not move it.
    //
    // FieldValue.increment rather than read-modify-write, so this needs no
    // extra read inside the transaction and two tills selling the last copy
    // at once cannot both read "1" and both write "0".
    //
    // Stock is allowed to go negative. A till must not refuse a sale because
    // a count is stale — the customer is standing there holding the thing —
    // and a negative figure is a visible discrepancy somebody can reconcile,
    // which a silently blocked sale is not. Same stance the delivery maths
    // already takes about over-counts.
    for (const l of drafts) {
      if (l.source !== 'product') continue
      tx.update(db.doc(`products/${l.refId}`), {
        [`stock.${check.branch}`]: FieldValue.increment(-l.quantity),
      })
    }
    // Negative ingredient stock is allowed, as merchandise is (owner's
    // decision): the order has been taken, and a stale count must not stop
    // the kitchen being told about it.
    ingredientMoves.forEach((m, i) => {
      if (!ingredientSnaps[i]?.exists) return
      tx.update(ingredientSnaps[i].ref, { [`quantity.${check.branch}`]: FieldValue.increment(-m.qty) })
    })

    // Every draft becomes sent, merchandise included: it has left the shelf
    // even though no pass ever saw it, and leaving it draft would block the
    // check from closing forever.
    const sentAt = new Date().toISOString()
    tx.update(db.doc(`${CHECKS}/${checkId}`), {
      lines: check.lines.map(l =>
        l.status === 'draft' ? { ...l, status: 'sent', sentAt } : l),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return { tickets: created }
  })
}

/**
 * Strikes a line off, and tells the kitchen if it was already fired.
 *
 * A void is a decision somebody owns, so the reason is required rather than
 * optional. If a ticket already carries the line it is marked there too — the
 * pass is told, not silently edited, because somebody may already be cooking.
 */
export async function voidLine(
  caller: Caller,
  checkId: string,
  lineId: string,
  reasonKey: string,
  note: string,
): Promise<{ wasSent: boolean; restored: number; label: string; ingredients: 'nothing-taken' | 'return' | 'waste' | 'kept' | null }> {
  const db = adminDb()

  const reason = voidReason(reasonKey)
  if (!reason) throw new HttpError(400, 'Choose a reason for the void.')

  const trimmedNote = note.trim().slice(0, CHECK_LIMITS.noteLength)
  // "Other" without a word about it is the same as no reason at all, which is
  // what having a reason list was meant to stop.
  if (reason.key === 'other' && !trimmedNote) {
    throw new HttpError(400, 'Say what happened when the reason is Other.')
  }
  const label = trimmedNote ? `${reason.label} — ${trimmedNote}` : reason.label

  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    if (check.status !== 'open') throw new HttpError(409, 'That check is closed.')

    const target = check.lines.find(l => l.id === lineId)
    if (!target) throw new HttpError(404, 'That item is not on this check.')
    if (target.status === 'void') throw new HttpError(409, 'That item is already voided.')

    const wasSent = target.status === 'sent'
    const tickets = wasSent
      ? await tx.get(db.collection(TICKETS).where('checkId', '==', checkId))
      : null

    // What the void does to ingredients, decided by the pure plan: never
    // sent took nothing, not made goes back, made and lost is waste, valued
    // from the line's own snapshot. Supplies are read now, before any write.
    const plan = reversalPlan([target], wasSent, reason)
    const returnMoves = (STOCKED_BRANCHES as readonly string[]).includes(check.branch) ? plan.returns : []
    const returnSnaps = returnMoves.length
      ? await tx.getAll(...returnMoves.map(m => db.doc(`supplies/${m.supplyId}`)))
      : []

    // Back on the shelf only when the item still exists. "Changed their mind"
    // hands a board game back; "damaged" does not, and crediting stock for it
    // would invent a copy that is not there.
    //
    // Still gated on wasSent as well: an unsent line never came off the shelf,
    // so returning it would create stock out of nothing.
    let restored = 0
    if (wasSent && target.source === 'product' && reason.returnsToStock) {
      tx.update(db.doc(`products/${target.refId}`), {
        [`stock.${check.branch}`]: FieldValue.increment(target.quantity),
      })
      restored = target.quantity
    }
    returnMoves.forEach((m, i) => {
      if (!returnSnaps[i]?.exists) return
      tx.update(returnSnaps[i].ref, { [`quantity.${check.branch}`]: FieldValue.increment(m.qty) })
    })

    tx.update(db.doc(`${CHECKS}/${checkId}`), {
      lines: check.lines.map(l =>
        l.id === lineId
          ? {
              ...l,
              status: 'void',
              voidReason: label,
              voidReasonKey: reason.key,
              // Copied, not looked up later: changing the reason list must not
              // re-classify a void that already happened.
              voidWasWaste: reason.isWaste,
              // Who and when, for the void report (UPGRADE.md T3.2). A string,
              // not a server timestamp: Firestore takes no sentinel in an array.
              voidedBy: caller.uid,
              voidedByEmail: caller.email ?? '',
              voidedAt: new Date().toISOString(),
              ...(plan.outcome === 'waste' ? { voidWasteUsd: plan.wasteUsd } : {}),
            }
          : l),
      updatedAt: FieldValue.serverTimestamp(),
    })

    if (tickets) {
      for (const doc of tickets.docs) {
        const lines = (doc.data().lines ?? []) as { lineId: string; voided: boolean }[]
        if (!lines.some(tl => tl.lineId === lineId)) continue
        const next = lines.map(tl => tl.lineId === lineId ? { ...tl, voided: true } : tl)
        tx.update(doc.ref, {
          lines: next,
          // A ticket whose every line is struck off has nothing left to cook.
          ...(next.every(tl => tl.voided) ? { status: 'cancelled' } : {}),
        })
      }
    }

    return { wasSent, restored, label, ingredients: plan.outcome }
  })
}

/**
 * Marks a check as a staff meal, or takes the mark off.
 *
 * The RATES are copied onto the check at the moment it is marked, not read at
 * bill time. Same rule as the end-of-day exchange rate and the delivery VAT: a
 * staff meal eaten tonight must not re-price itself because somebody changed
 * the policy next month.
 *
 * Who applied it is recorded, because a discount is the one thing on a check
 * that somebody should be answerable for — and this is deliberately the only
 * discount the till can apply. Arbitrary money off a line is Phase 04, with
 * approval limits attached; a fixed rate a superadmin configured is a policy,
 * not discretion.
 */
export async function setStaffMeal(
  caller: Caller,
  checkId: string,
  on: boolean,
): Promise<{ on: boolean; food: number; drink: number }> {
  const db = adminDb()

  // Read the settings before the transaction: a transaction may not read after
  // its first write, and this is an unrelated document.
  const settings = on ? await readSettings() : null

  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    if (check.status !== 'open') throw new HttpError(409, 'That check is closed.')

    const staffDiscount = on && settings
      ? {
          food: settings.staffDiscountFood,
          drink: settings.staffDiscountDrink,
          appliedBy: caller.uid,
          appliedByEmail: caller.email ?? '',
        }
      : null

    if (on && staffDiscount && staffDiscount.food === 0 && staffDiscount.drink === 0) {
      throw new HttpError(400,
        'No staff discount is configured. A superadmin sets the rates under Settings → Business.')
    }

    tx.update(db.doc(`${CHECKS}/${checkId}`), {
      staffDiscount,
      updatedAt: FieldValue.serverTimestamp(),
    })

    return {
      on,
      food: staffDiscount?.food ?? 0,
      drink: staffDiscount?.drink ?? 0,
    }
  })
}

/** Moves a check to another table — a party changing seats mid-service. */
export async function moveCheck(
  caller: Caller,
  checkId: string,
  tableNumber: number,
): Promise<{ from: number; to: number }> {
  const db = adminDb()
  const number = whole(tableNumber, 'Table number', 1, 9999)

  // Resolved before the transaction: it reads the floor plan, and a
  // transaction may not read after its first write.
  const first = await readCheck2(checkId)
  const table = await resolveTable(first.branch, number)

  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    if (check.status !== 'open') throw new HttpError(409, 'That check is closed.')
    if (check.tableId === table.tableId) {
      throw new HttpError(400, 'That check is already on that table.')
    }

    const occupied = await tx.get(db.collection(CHECKS)
      .where('branch', '==', check.branch)
      .where('tableId', '==', table.tableId)
      .where('status', '==', 'open')
      .limit(1))
    if (!occupied.empty) {
      throw new HttpError(409, `Table ${table.tableNumber} already has an open check.`)
    }

    tx.update(db.doc(`${CHECKS}/${checkId}`), {
      tableId: table.tableId,
      tableNumber: table.tableNumber,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { from: check.tableNumber, to: table.tableNumber }
  })
}

/** A plain read, for the branch, before a transaction opens. */
async function readCheck2(id: string): Promise<Check> {
  const snap = await adminDb().doc(`${CHECKS}/${id}`).get()
  if (!snap.exists) throw new HttpError(404, 'That check no longer exists.')
  return { id: snap.id, ...(snap.data() as Omit<Check, 'id'>) }
}

/**
 * Attaches the loyalty customer whose member code was scanned — or, with a
 * null code, takes them off. Slice 5.
 *
 * Only while the check is open: the points are credited when it closes, and
 * changing who collects after that would be moving a customer's balance
 * without the check that justified it.
 */
export async function setLoyaltyCustomer(
  caller: Caller,
  checkId: string,
  code: string | null,
): Promise<{ tableNumber: number; name: string | null; tier: string | null }> {
  if (!(await serverFeatureOn('loyalty'))) {
    throw new HttpError(409, 'The loyalty programme is switched off.')
  }
  // Resolved before the transaction: it reads two other documents, and it
  // refuses staff and wholesale accounts on its own.
  const member = code ? await resolveMemberCode(code) : null

  const db = adminDb()
  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    if (check.status !== 'open') throw new HttpError(409, 'A customer can only be added to an open check.')
    tx.update(db.doc(`${CHECKS}/${checkId}`), {
      loyalty: member ? { uid: member.uid, name: member.name } : null,
    })
    return { tableNumber: check.tableNumber, name: member?.name ?? null, tier: member?.tier ?? null }
  })
}

// ── Discounts (slice 6) ────────────────────────────────────────────────────
// Owner's decisions, 12 Sep 2026: managers and admins only, applied from the
// manager's own phone — their signed-in session IS the approval, so there is
// no PIN and no second step. Every discount names a reason and who gave it.

export interface DiscountInput {
  kind: string
  /** A fraction 0–1 for a percentage; dollars for an amount; ignored for a comp. */
  value: number
  reasonKey: string
  note: string
}

/** The discount in the request, or null to take one off. Shape only — the functions below judge it. */
export function parseDiscountInput(body: Record<string, unknown>): DiscountInput | null {
  const raw = body.discount
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'object') throw new HttpError(400, 'Invalid discount.')
  const r = raw as Record<string, unknown>
  return {
    kind: String(r.kind ?? ''),
    value: Number(r.value),
    reasonKey: String(r.reasonKey ?? ''),
    note: String(r.note ?? '').trim().slice(0, CHECK_LIMITS.noteLength),
  }
}

function assertCanDiscount(caller: Caller): void {
  if (caller.role !== 'admin' && caller.role !== 'manager') {
    throw new HttpError(403, 'Only a manager or an admin can give a discount — ask one to do it from their phone.')
  }
}

function assertReason(key: string): void {
  if (!discountReason(key)) throw new HttpError(400, 'Choose a reason for the discount.')
}

/**
 * Only an open check, and only before any payment: a discount after money has
 * been taken would leave the check paid more than it now owes, with nothing
 * in the till's model to hand the difference back.
 */
function assertDiscountable(check: Check): void {
  if (check.status !== 'open') throw new HttpError(409, 'A discount can only go on an open check.')
  if ((check.payments ?? []).length > 0) {
    throw new HttpError(409, 'Give discounts before taking payment — this check already has one.')
  }
}

/** Comps one item, or takes a percentage off it; null takes the discount off. */
export async function setLineDiscount(
  caller: Caller,
  checkId: string,
  lineId: string,
  input: DiscountInput | null,
): Promise<{ tableNumber: number; label: string }> {
  assertCanDiscount(caller)
  let discount: LineDiscount | null = null
  if (input) {
    assertReason(input.reasonKey)
    const who = { reasonKey: input.reasonKey, note: input.note, by: caller.uid, byEmail: caller.email ?? '' }
    if (input.kind === 'comp') {
      discount = { kind: 'comp', percent: 1, ...who }
    } else if (input.kind === 'percent') {
      if (!(input.value > 0 && input.value <= 1)) {
        throw new HttpError(400, 'A percentage off must be more than 0% and at most 100%.')
      }
      discount = { kind: 'percent', percent: Math.round(input.value * 10_000) / 10_000, ...who }
    } else {
      throw new HttpError(400, 'An item can be comped or given a percentage off.')
    }
  }

  const db = adminDb()
  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    assertDiscountable(check)
    const line = check.lines.find(l => l.id === lineId)
    if (!line) throw new HttpError(404, 'That item is no longer on the check.')
    if (line.status === 'void') throw new HttpError(409, 'That item was voided — there is nothing to discount.')
    tx.update(db.doc(`${CHECKS}/${checkId}`), {
      lines: check.lines.map(l => (l.id === lineId ? { ...l, discount } : l)),
      updatedAt: FieldValue.serverTimestamp(),
    })
    const what = !discount ? 'Discount removed from' : discount.kind === 'comp' ? 'Comped' : `${Math.round(discount.percent * 100)}% off`
    return { tableNumber: check.tableNumber, label: `${what} ${line.name}` }
  })
}

/** A percentage or a fixed amount off the whole check; null takes it off. */
export async function setCheckDiscount(
  caller: Caller,
  checkId: string,
  input: DiscountInput | null,
): Promise<{ tableNumber: number; label: string }> {
  assertCanDiscount(caller)
  let discount: CheckDiscount | null = null
  if (input) {
    assertReason(input.reasonKey)
    const who = { reasonKey: input.reasonKey, note: input.note, by: caller.uid, byEmail: caller.email ?? '' }
    if (input.kind === 'percent') {
      if (!(input.value > 0 && input.value <= 1)) {
        throw new HttpError(400, 'A percentage off must be more than 0% and at most 100%.')
      }
      discount = { kind: 'percent', value: Math.round(input.value * 10_000) / 10_000, ...who }
    } else if (input.kind === 'amount') {
      const v = input.value
      if (!(v > 0) || v > 100_000 || Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) {
        throw new HttpError(400, 'An amount off must be a real amount of dollars, to the cent.')
      }
      discount = { kind: 'amount', value: v, ...who }
    } else {
      throw new HttpError(400, 'A check can have a percentage or an amount taken off.')
    }
  }

  const db = adminDb()
  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    assertDiscountable(check)
    tx.update(db.doc(`${CHECKS}/${checkId}`), { discount, updatedAt: FieldValue.serverTimestamp() })
    const what = !discount ? 'Discount removed from the check'
      : discount.kind === 'percent' ? `${Math.round(discount.value * 100)}% off the check`
      : `$${discount.value.toFixed(2)} off the check`
    return { tableNumber: check.tableNumber, label: what }
  })
}

/**
 * Fires what a Send held back (UPGRADE.md T3.11): every held ticket of the
 * check goes to the pass as new, stamped as sent NOW, so the kitchen's timer
 * and the printers start from when the food was wanted, not from when it was
 * ordered. Anyone on the till, like Send.
 */
export async function fireHeld(caller: Caller, checkId: string): Promise<{ fired: number; stations: string[]; tableNumber: number }> {
  const db = adminDb()
  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    const held = (await tx.get(db.collection(TICKETS).where('checkId', '==', checkId))).docs
      .filter(d => d.data().status === 'held')
    if (held.length === 0) throw new HttpError(409, 'Nothing on this check is held.')
    for (const d of held) {
      tx.update(d.ref, { status: 'new', sentAt: FieldValue.serverTimestamp(), firedBy: caller.uid, firedByEmail: caller.email ?? '' })
    }
    tx.update(db.doc(`${CHECKS}/${checkId}`), { heldStations: [], updatedAt: FieldValue.serverTimestamp() })
    return { fired: held.length, stations: [...new Set(held.map(d => String(d.data().station)))], tableNumber: check.tableNumber }
  })
}

/**
 * Takes the service charge off a check (UPGRADE.md T3.8). A manager's call,
 * like a discount, and refused once any payment is on the check, for the
 * reason discounts are: the money already taken was worked out with it. Kept
 * as a rate of 0 with who took it off, never deleted, so the check says why
 * it has none.
 */
export async function removeServiceCharge(caller: Caller, checkId: string): Promise<{ tableNumber: number; label: string }> {
  assertCanDiscount(caller)
  const db = adminDb()
  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    assertDiscountable(check)
    if (serviceRate(check.serviceCharge) === 0) throw new HttpError(409, 'That check has no service charge.')
    tx.update(db.doc(`${CHECKS}/${checkId}`), {
      serviceCharge: { rate: 0, removedBy: caller.uid, removedByEmail: caller.email ?? '' },
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { tableNumber: check.tableNumber, label: 'Service charge taken off the check' }
  })
}

export interface PaymentResult {
  /** A resend of a payment already on the check; nothing new was taken. */
  duplicate: boolean
  tableNumber: number
  payment: Omit<Payment, 'at'>
  settled: boolean
  remainingUsd: number
  remainingLbp: number
}

/**
 * Records one payment on an open check.
 *
 * The till says what was handed over; everything else — how much of it the
 * bill takes, how much goes back, at what rate — is worked out here by
 * applyPayment(), so a crafted request cannot name its own change any more
 * than it can name its own price.
 *
 * Does not close the check. Closing issues the receipt number, and that stays
 * in exactly one place; the till closes as soon as this says `settled`.
 */
export async function addPayment(
  caller: Caller,
  checkId: string,
  req: PaymentRequest,
  key: string | null,
): Promise<PaymentResult> {
  const db = adminDb()
  // Outside the transaction: only the first payment uses it, and it is not
  // part of what this write has to be consistent with.
  const { exchangeRate } = await readSettings()
  const cardTipsOn = (req.tipUsd ?? 0) > 0 ? await serverFeatureOn('cardTips') : false

  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    // Read with the check, before any write, as a transaction requires.
    const shiftId = await openShiftId(tx, check.branch)
    const payments = check.payments ?? []
    const rate = check.billRate ?? exchangeRate
    const due = checkTotals(check).net

    const result = (p: Payment, list: Payment[], duplicate: boolean): PaymentResult => {
      const b = balance(due, list, rate)
      const { at: _at, ...rest } = p
      return {
        duplicate, tableNumber: check.tableNumber, payment: rest,
        settled: b.settled, remainingUsd: b.remainingUsd, remainingLbp: b.remainingLbp,
      }
    }

    // Before the open-check test: a payment resent after its reply was lost
    // must find itself even when the check has since closed on the strength
    // of it, rather than being told the check is closed and retried again.
    const existing = key ? payments.find(p => p.key === key) : undefined
    if (existing) return result(existing, payments, true)

    const blocked = closeBlockedReason(check)
    if (blocked) throw new HttpError(409, blocked)

    // Money goes into a drawer, and one drawer per branch is the owner's
    // model — so no open shift, no payment. Otherwise the cash would belong
    // to no shift, and no close would ever account for it.
    if (!shiftId) {
      throw new HttpError(409, `Open the drawer at ${check.branch} before taking payment — Drawer, on the POS home screen.`)
    }

    const outcome = applyPayment(due, payments, rate, req)
    if (!outcome.ok) throw new HttpError(400, outcome.reason)
    // A tip on the card (UPGRADE.md T3.9): its own field, never part of the
    // amount, so the bill, the change and the drawer are exactly as without it.
    const tip = req.tipUsd ?? 0
    if (tip > 0 && !cardTipsOn) throw new HttpError(403, 'Tips on card are switched off.')
    const tipIssue = tipProblem(req)
    if (tipIssue) throw new HttpError(400, tipIssue)

    const payment: Payment = {
      key: key ?? randomUUID(),
      tender: req.tender,
      currency: req.currency,
      amount: req.amount,
      appliedLbp: outcome.appliedLbp,
      changeUsd: outcome.changeUsd,
      changeLbp: outcome.changeLbp,
      changeRounding: outcome.changeRounding,
      ...(tip > 0 ? { tipUsd: tip } : {}),
      // Not serverTimestamp(): Firestore refuses one inside an array.
      at: Timestamp.now(),
      by: caller.uid,
      byEmail: caller.email ?? '',
      shiftId,
    }
    const next = [...payments, payment]
    tx.update(db.doc(`${CHECKS}/${checkId}`), {
      payments: next,
      billRate: rate,
      // What a Z close queries by: array-contains on one field needs no
      // composite index. A check paid across a shift change lists both.
      shiftIds: FieldValue.arrayUnion(shiftId),
    })
    return result(payment, next, false)
  })
}

/**
 * Closes a check.
 *
 * With the `payments` feature off — the pilot, the old till still taking the
 * money — closing means the table is free again, exactly as in v1. With it
 * on, a check closes once its payments cover what it owes, and not before.
 */
export async function closeCheck(
  caller: Caller,
  checkId: string,
): Promise<{ tableNumber: number; receiptNumber: string }> {
  const db = adminDb()
  const [takesPayment, settings, loyaltyOn] = await Promise.all([
    serverFeatureOn('payments'), readSettings(), serverFeatureOn('loyalty'),
  ])
  // The rate in force TODAY in the café's zone, recorded on the check so the
  // receipt reprints at it after the rate changes. Not the host's today: on a
  // UTC server the first hours of the change day would still be yesterday.
  const vatRate = vatRateOn(settings, todayYmd(BRAND.locale.timezone))

  // Refused here, before a number is issued, as well as inside the
  // transaction. Refusing only inside would burn a receipt number every time
  // somebody pressed Close on a check that had not been paid.
  if (takesPayment) {
    const owed = owedOn(await readCheck2(checkId))
    if (owed) throw new HttpError(409, owed)
  }

  // Issued BEFORE the transaction, because issueInvoiceNumber runs one of its
  // own and transactions do not nest. A number burnt on a close that then
  // fails leaves a gap in the sequence, which is normal in accounting and far
  // better than two checks sharing one.
  const { invoiceNumber } = await issueInvoiceNumber()

  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    if (check.status !== 'open') throw new HttpError(409, 'That check is already closed.')

    const unsent = check.lines.filter(l => l.status === 'draft').length
    if (unsent > 0) {
      throw new HttpError(409,
        `${unsent} item${unsent === 1 ? '' : 's'} ${unsent === 1 ? 'has' : 'have'} not been sent yet. ` +
        'Send them or void them first.')
    }

    if (takesPayment) {
      const owed = owedOn(check)
      if (owed) throw new HttpError(409, owed)
    }

    // ── Loyalty at payment (slice 5) ─────────────────────────────────────
    // Points land now, in the same transaction that closes the check — the
    // till knows what was paid, so there is nothing for a manager to approve
    // (owner's decision, 12 Sep 2026). Written as an approved "check"
    // transaction, so the customer's history shows it like any other.
    // The account is read here, before any write, as a transaction requires.
    // Points for what was eaten, not for the service charge (UPGRADE.md T3.8).
    const closing = checkTotals(check)
    const net = closing.net
    const points = loyaltyOn && check.loyalty ? pointsForCheck(net - closing.service, !!check.staffDiscount) : 0
    const memberRef = points > 0 && check.loyalty ? db.doc(`users/${check.loyalty.uid}`) : null
    // A deleted account does not stop the table closing; it just collects nothing.
    const memberExists = memberRef ? (await tx.get(memberRef)).exists : false
    let loyaltyTxId: string | null = null
    if (memberRef && memberExists && check.loyalty) {
      const txRef = db.collection('transactions').doc()
      loyaltyTxId = txRef.id
      tx.update(memberRef, {
        points: FieldValue.increment(points),
        pointsEarned: FieldValue.increment(points),
      })
      tx.set(txRef, {
        type: 'check',
        source: 'pos',
        userId: [check.loyalty.uid],
        pointsAmount: points,
        status: 'approved',
        branchId: check.branch,
        checkNumber: invoiceNumber,
        checkId,
        totalAmount: net,
        submittedBy: caller.uid,
        approvedBy: caller.uid,
        createdAt: FieldValue.serverTimestamp(),
        approvedAt: FieldValue.serverTimestamp(),
      })
      tx.set(db.collection('transactionLog').doc(), {
        transactionId: txRef.id,
        action: 'approved',
        performedBy: caller.uid,
        branchId: check.branch,
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    tx.update(db.doc(`${CHECKS}/${checkId}`), {
      status: 'closed',
      receiptNumber: invoiceNumber,
      vatRate,
      closedBy: caller.uid,
      closedByEmail: caller.email ?? '',
      closedAt: FieldValue.serverTimestamp(),
      ...(loyaltyTxId ? { loyaltyPoints: points, loyaltyTxId } : {}),
    })
    return { tableNumber: check.tableNumber, receiptNumber: invoiceNumber }
  })
}

/**
 * Reverses a closed check.
 *
 * Modelled on refundPurchaseOrder, which already does this for retail sales —
 * same status, same fields, same reasoning — so the two do not drift into two
 * different ideas of what a refund is.
 *
 * The check is marked, never deleted or reopened. What was ordered has to
 * survive the reversal, because "what did we give money back for" is the
 * question a refund exists to answer.
 *
 * Worth being plain about what this does while there is no payment step: it
 * records that a closed check was reversed and puts merchandise back on the
 * shelf. It does not move money, because no money moved through here — the
 * old till still takes payment. Phase 04 puts tender underneath this and the
 * shape does not change.
 */
export async function refundCheck(
  caller: Caller,
  checkId: string,
  reasonKey: string,
  note: string,
): Promise<{
  tableNumber: number
  receiptNumber: string
  restored: number
  label: string
  ingredients: 'nothing-taken' | 'return' | 'waste' | 'kept' | null
}> {
  const db = adminDb()
  // A refund follows its cause, exactly as a void does (owner's decision,
  // 14 Sep 2026): changed their mind before anything was made gives the
  // goods back; already made is waste. It used to take free text and put
  // every piece of merchandise back whatever had happened to it — a
  // broken mug restocked as if it were still on the shelf.
  const reason = voidReason(reasonKey)
  if (!reason) throw new HttpError(400, 'Choose a reason for the refund.')
  const trimmedNote = note.trim().slice(0, CHECK_LIMITS.noteLength)
  if (reason.key === 'other' && !trimmedNote) {
    throw new HttpError(400, 'Say what happened when the reason is Other.')
  }
  const label = trimmedNote ? `${reason.label} — ${trimmedNote}` : reason.label

  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)

    // Cash handed back comes out of a drawer, so a refund that returns cash
    // needs one open, and records it — the Z close of that shift then counts
    // the refund. A card refund, or a v1 check with no payments, needs none.
    // Read here, before any write, as a transaction requires.
    const cashBack = refundOf(check.payments ?? []).cash
    const givesCash = cashBack.usd !== 0 || cashBack.lbp !== 0
    const refundShift = givesCash ? await openShiftId(tx, check.branch) : null

    // The points this check earned go back too (slice 5) — exactly the number
    // credited, from the check, never recomputed from today's rules. Read
    // before any write. The balance may go below zero if they were already
    // spent; that is the true figure, and hiding it would give the reward away.
    const takeBack = check.loyalty && (check.loyaltyPoints ?? 0) > 0 ? check.loyaltyPoints ?? 0 : 0
    const memberRef = takeBack > 0 && check.loyalty ? db.doc(`users/${check.loyalty.uid}`) : null
    const memberExists = memberRef ? (await tx.get(memberRef)).exists : false

    // Ingredients: every line still on a closed check was sent, so the
    // reason alone decides. Read before any write.
    const plan = reversalPlan(check.lines, true, reason)
    const returnMoves = (STOCKED_BRANCHES as readonly string[]).includes(check.branch) ? plan.returns : []
    const returnSnaps = returnMoves.length
      ? await tx.getAll(...returnMoves.map(m => db.doc(`supplies/${m.supplyId}`)))
      : []

    if (check.status === 'refunded') {
      // Checked INSIDE the transaction: two taps on Refund would otherwise
      // both pass and put the merchandise back twice.
      throw new HttpError(409, 'That check has already been refunded.')
    }
    if (check.status !== 'closed') {
      throw new HttpError(409, 'Only a closed check can be refunded. Close it first.')
    }
    if (givesCash && !refundShift) {
      throw new HttpError(409, `Open the drawer at ${check.branch} first — a cash refund comes out of it.`)
    }

    // Merchandise goes back on the shelf only when the reason says it still
    // exists, and ingredients for food come back on the same terms. Anything
    // already made, spilled or broken stays gone; its ingredients are waste.
    let restored = 0
    for (const l of check.lines) {
      if (l.source !== 'product' || l.status === 'void' || !reason.returnsToStock) continue
      tx.update(db.doc(`products/${l.refId}`), {
        [`stock.${check.branch}`]: FieldValue.increment(l.quantity),
      })
      restored += l.quantity
    }
    returnMoves.forEach((m, i) => {
      if (!returnSnaps[i]?.exists) return
      tx.update(returnSnaps[i].ref, { [`quantity.${check.branch}`]: FieldValue.increment(m.qty) })
    })

    tx.update(db.doc(`${CHECKS}/${checkId}`), {
      status: 'refunded',
      refundedAt: FieldValue.serverTimestamp(),
      refundedBy: caller.email ?? caller.uid,
      refundReason: label,
      refundReasonKey: reason.key,
      refundWasWaste: reason.isWaste,
      ...(plan.outcome === 'waste' ? { refundWasteUsd: plan.wasteUsd } : {}),
      ...(refundShift ? { refundShiftId: refundShift } : {}),
    })

    if (memberRef && memberExists) {
      tx.update(memberRef, {
        points: FieldValue.increment(-takeBack),
        pointsEarned: FieldValue.increment(-takeBack),
      })
      if (check.loyaltyTxId) {
        tx.update(db.doc(`transactions/${check.loyaltyTxId}`), {
          status: 'reversed',
          reversedBy: caller.uid,
          reversedAt: FieldValue.serverTimestamp(),
        })
        tx.set(db.collection('transactionLog').doc(), {
          transactionId: check.loyaltyTxId,
          action: 'reversed',
          performedBy: caller.uid,
          branchId: check.branch,
          createdAt: FieldValue.serverTimestamp(),
        })
      }
    }

    return {
      tableNumber: check.tableNumber,
      receiptNumber: check.receiptNumber ?? checkId,
      restored,
      label,
      ingredients: plan.outcome,
    }
  })
}
