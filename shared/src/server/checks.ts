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

import { FieldValue, type Transaction } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRANCHES } from '../branches'
import {
  CHECK_LIMITS, stationForSection,
  type Check, type CheckLine, type LineSource,
} from '../checks'
import { validateSelection, toSelections, type ModifierGroup } from '../modifiers'
import { effectivePrice } from '../productPricing'
import { toTicketLines } from '../tickets'
import { readSettings } from './settings'

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
async function buildLines(caller: Caller, requests: LineRequest[]): Promise<CheckLine[]> {
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

  return requests.map((req, i) => {
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

    return line(caller, req, {
      name: String(data.name ?? ''),
      unitPrice: Number(data.price ?? 0),
      station: stationForSection(sectionByCategory.get(String(data.categoryId ?? ''))),
      modifiers: selections,
    })
  })
}

function line(
  caller: Caller,
  req: LineRequest,
  looked: Pick<CheckLine, 'name' | 'unitPrice' | 'station' | 'modifiers'>,
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
  }
}

// ── Reading ───────────────────────────────────────────────────────────────

async function readCheck(tx: Transaction, id: string): Promise<Check> {
  const snap = await tx.get(adminDb().doc(`${CHECKS}/${id}`))
  if (!snap.exists) throw new HttpError(404, 'That check no longer exists.')
  return { id: snap.id, ...(snap.data() as Omit<Check, 'id'>) }
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

export async function openCheck(
  caller: Caller,
  input: { branch: string; tableNumber: number; guestCount: number },
): Promise<{ id: string }> {
  const db = adminDb()

  if (!(BRANCHES as readonly string[]).includes(input.branch)) {
    throw new HttpError(400, 'Unknown branch.')
  }
  const guestCount = whole(input.guestCount, 'Guest count', 1, CHECK_LIMITS.maxGuests)
  const number = whole(input.tableNumber, 'Table number', 1, 9999)
  const table = await resolveTable(input.branch, number)

  return db.runTransaction(async tx => {
    const open = await tx.get(db.collection(CHECKS)
      .where('branch', '==', input.branch)
      .where('tableId', '==', table.tableId)
      .where('status', '==', 'open')
      .limit(1))
    if (!open.empty) {
      throw new HttpError(409, `Table ${table.tableNumber} already has an open check.`)
    }

    const ref = db.collection(CHECKS).doc()
    tx.set(ref, {
      branch: input.branch,
      tableId: table.tableId,
      // Snapshotted: renumbering the floor plan must not rewrite history.
      tableNumber: table.tableNumber,
      status: 'open',
      guestCount,
      lines: [],
      staffDiscount: null,
      openedBy: caller.uid,
      openedByEmail: caller.email ?? '',
      openedAt: FieldValue.serverTimestamp(),
      closedAt: null,
    })
    return { id: ref.id }
  })
}

/** Adds priced lines to an open check. They start as drafts. */
export async function addLines(
  caller: Caller,
  checkId: string,
  requests: LineRequest[],
): Promise<{ added: number; lines: CheckLine[] }> {
  // Priced BEFORE the transaction: it reads menu items, categories and
  // modifier groups, and a transaction may not read after its first write.
  const built = await buildLines(caller, requests)

  await adminDb().runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    if (check.status !== 'open') throw new HttpError(409, 'That check is closed.')
    if (check.lines.length + built.length > CHECK_LIMITS.linesPerCheck) {
      throw new HttpError(400, `A check can hold at most ${CHECK_LIMITS.linesPerCheck} items.`)
    }
    tx.update(adminDb().doc(`${CHECKS}/${checkId}`), {
      lines: [...check.lines, ...built],
      updatedAt: FieldValue.serverTimestamp(),
    })
  })

  return { added: built.length, lines: built }
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
): Promise<{ tickets: { id: string; station: string; lines: number }[] }> {
  const db = adminDb()

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

    const byStation = new Map<string, CheckLine[]>()
    for (const l of drafts) {
      if (!l.station) continue          // merchandise: no pass to fire it to
      const list = byStation.get(l.station) ?? []
      list.push(l)
      byStation.set(l.station, list)
    }

    const created: { id: string; station: string; lines: number }[] = []
    for (const [station, lines] of byStation) {
      const ref = db.collection(TICKETS).doc()
      tx.set(ref, {
        checkId,
        branch: check.branch,
        tableNumber: check.tableNumber,
        station,
        status: 'new',
        round: (roundsSoFar.get(station) ?? 0) + 1,
        lines: toTicketLines(lines),
        sentBy: caller.uid,
        sentByEmail: caller.email ?? '',
        sentAt: FieldValue.serverTimestamp(),
        bumpedAt: null,
        bumpedBy: null,
      })
      created.push({ id: ref.id, station, lines: lines.length })
    }

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
  reason: string,
): Promise<{ wasSent: boolean }> {
  const db = adminDb()
  const trimmed = reason.trim()
  if (!trimmed) throw new HttpError(400, 'A void needs a reason.')

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

    tx.update(db.doc(`${CHECKS}/${checkId}`), {
      lines: check.lines.map(l =>
        l.id === lineId
          ? { ...l, status: 'void', voidReason: trimmed.slice(0, CHECK_LIMITS.noteLength) }
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

    return { wasSent }
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
 * Closes a check.
 *
 * v1 only: no payment, no tender, no bill. Closing means the table is free
 * again. Phase 04 puts money in front of this.
 */
export async function closeCheck(caller: Caller, checkId: string): Promise<{ tableNumber: number }> {
  const db = adminDb()

  return db.runTransaction(async tx => {
    const check = await readCheck(tx, checkId)
    if (check.status !== 'open') throw new HttpError(409, 'That check is already closed.')

    const unsent = check.lines.filter(l => l.status === 'draft').length
    if (unsent > 0) {
      throw new HttpError(409,
        `${unsent} item${unsent === 1 ? '' : 's'} ${unsent === 1 ? 'has' : 'have'} not been sent yet. ` +
        'Send them or void them first.')
    }

    tx.update(db.doc(`${CHECKS}/${checkId}`), {
      status: 'closed',
      closedBy: caller.uid,
      closedByEmail: caller.email ?? '',
      closedAt: FieldValue.serverTimestamp(),
    })
    return { tableNumber: check.tableNumber }
  })
}
