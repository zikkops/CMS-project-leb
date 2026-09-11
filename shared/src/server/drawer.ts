// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The branch cash drawer's shifts — Phase 04, slice 4.
//
// One drawer per branch, opened with a float and closed with a count, by
// anyone on the till (owner's decisions, 11 Sep 2026). The arithmetic is
// shared/src/drawer.ts; this file decides which payments belong to which
// shift and makes the open/close transitions safe.
//
// ── One open shift per branch ──────────────────────────────────────────────
// A pointer document per branch, `branchDrawers/{branch}`, names the open
// shift. It has no Firestore rule, so no browser can read or write it; the
// till learns the open shift from drawerShifts itself. Opening checks the
// pointer inside the transaction that sets it, so two phones pressing Open at
// once get one shift and one refusal, not two drawers.
//
// ── Which money is whose ───────────────────────────────────────────────────
// A payment records the shift that was open when it was taken, and its check
// lists that shift in `shiftIds`; a refund records `refundShiftId`. Both are
// single-field queries, so no composite index has to exist before a close
// can add anything up.

import { FieldValue, type Transaction } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRANCHES } from '../branches'
import {
  LBP_DENOMS, USD_DENOMS, countedCash, daySystem, drawerDifference, drawerTotals, floatProblem, refundOf,
  type DaySystem, type DenomCount, type DrawerTotals, type Money2, type Refund, type DrawerPayment,
} from '../drawer'
import type { Check } from '../checks'
import { BRAND } from '../brand'
import { cashUpDay } from '../dates'

export const SHIFTS = 'drawerShifts'
const POINTER = 'branchDrawers'

export type ShiftStatus = 'open' | 'closing' | 'closed'

interface StoredShift {
  branch: string
  status: ShiftStatus
  float: Money2
  openedBy: string
  openedByEmail: string
}

function assertBranch(branch: string): void {
  if (!(BRANCHES as readonly string[]).includes(branch)) {
    throw new HttpError(400, `Unknown branch: ${branch || '(none)'}`)
  }
}

/** The shift open at a branch, read inside a transaction, or null. */
export async function openShiftId(tx: Transaction, branch: string): Promise<string | null> {
  const snap = await tx.get(adminDb().doc(`${POINTER}/${branch}`))
  const id = snap.data()?.openShiftId
  return typeof id === 'string' && id ? id : null
}

/** A float as the request states it. Its validity is floatProblem()'s question. */
export function parseFloat2(body: Record<string, unknown>): Money2 {
  return { usd: Number(body.floatUsd ?? 0), lbp: Number(body.floatLbp ?? 0) }
}

/**
 * A note-by-note count. Only real notes, only whole non-negative numbers of
 * them — a count is refused rather than cleaned, because a cleaned count is
 * a different count from the one somebody made.
 */
export function parseCount(v: unknown, denoms: readonly number[], label: string): DenomCount {
  if (v == null) return {}
  if (typeof v !== 'object') throw new HttpError(400, `${label} must be a count of notes.`)
  const allowed = new Set(denoms.map(String))
  const out: DenomCount = {}
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!allowed.has(k)) throw new HttpError(400, `${label}: there is no ${k} note.`)
    const n = Number(raw ?? 0)
    if (!Number.isInteger(n) || n < 0 || n > 100_000) {
      throw new HttpError(400, `${label}: the number of ${k} notes must be a whole number.`)
    }
    out[k] = n
  }
  return out
}

export const parseLbpCount = (v: unknown) => parseCount(v, LBP_DENOMS, 'LBP count')
export const parseUsdCount = (v: unknown) => parseCount(v, USD_DENOMS, 'USD count')

export async function openShift(caller: Caller, branch: string, float: Money2): Promise<{ id: string }> {
  assertBranch(branch)
  const problem = floatProblem(float)
  if (problem) throw new HttpError(400, problem)

  const db = adminDb()
  return db.runTransaction(async tx => {
    const current = await openShiftId(tx, branch)
    if (current) {
      throw new HttpError(409, `The drawer at ${branch} is already open. Close that shift before opening another.`)
    }
    const ref = db.collection(SHIFTS).doc()
    tx.set(ref, {
      branch,
      status: 'open' satisfies ShiftStatus,
      float,
      // The End of Day this shift is counted in — the café's cash-up day, with
      // the same before-10am rule the End of Day form uses, so a shift opened
      // at 01:00 belongs to the night before, as its report does.
      cashUpDay: cashUpDay(BRAND.locale.timezone),
      openedAt: FieldValue.serverTimestamp(),
      openedBy: caller.uid,
      openedByEmail: caller.email ?? '',
    })
    tx.set(db.doc(`${POINTER}/${branch}`), { openShiftId: ref.id, since: FieldValue.serverTimestamp() })
    return { id: ref.id }
  })
}

async function readShift(shiftId: string): Promise<StoredShift & { id: string }> {
  const snap = await adminDb().doc(`${SHIFTS}/${shiftId}`).get()
  if (!snap.exists) throw new HttpError(404, 'That shift does not exist.')
  return { id: snap.id, ...(snap.data() as StoredShift) }
}

/**
 * Everything that has gone through a shift's drawer.
 *
 * The X reading and the Z close both come from here, so the figure a manager
 * sees at four o'clock and the one the close is judged against cannot be two
 * different sums.
 */
export async function shiftTotals(shiftId: string, float: Money2): Promise<DrawerTotals> {
  const db = adminDb()
  const [paid, refunded] = await Promise.all([
    db.collection('checks').where('shiftIds', 'array-contains', shiftId).get(),
    db.collection('checks').where('refundShiftId', '==', shiftId).get(),
  ])
  const payments: DrawerPayment[] = []
  for (const d of paid.docs) {
    for (const p of (d.data() as Check).payments ?? []) {
      // A check paid across a shift change lists both shifts; each payment
      // belongs to the one it was taken in.
      if (p.shiftId === shiftId) payments.push(p)
    }
  }
  const refunds: Refund[] = refunded.docs.map(d => refundOf((d.data() as Check).payments ?? []))
  return drawerTotals(float, payments, refunds)
}

/**
 * End of Day's "system" figure for one branch and day, from its drawer shifts.
 *
 * A closed shift contributes what its Z recorded; an open one its live
 * figure, flagged, so the form can say the number will still move. Two
 * equality filters, which Firestore serves without a composite index.
 */
export async function daySystemFor(branch: string, day: string, rate: number): Promise<DaySystem> {
  assertBranch(branch)
  const snap = await adminDb().collection(SHIFTS)
    .where('branch', '==', branch).where('cashUpDay', '==', day).get()
  const rows = await Promise.all(snap.docs.map(async d => {
    const s = d.data() as StoredShift & { totals?: DrawerTotals }
    if (s.status === 'closed' && s.totals) return { expected: s.totals.expected, open: false }
    return { expected: (await shiftTotals(d.id, s.float)).expected, open: true }
  }))
  return daySystem(rows, rate)
}

/** An X reading: where the drawer stands now. Changes nothing. */
export async function xReading(shiftId: string): Promise<{ branch: string; status: ShiftStatus; totals: DrawerTotals }> {
  const shift = await readShift(shiftId)
  return { branch: shift.branch, status: shift.status, totals: await shiftTotals(shiftId, shift.float) }
}

export interface ZResult {
  branch: string
  totals: DrawerTotals
  counted: Money2
  difference: Money2
}

/**
 * The Z close: stop taking money into the shift, add it up, record the count.
 *
 * Two steps, deliberately. First the shift is marked `closing` and the
 * branch's pointer cleared, in one transaction — from then on addPayment()
 * finds no open drawer and refuses, so nothing can land in the shift while it
 * is being added up. Then the totals are computed and written. If the second
 * step fails the shift stays `closing`, and closing it again finishes the job.
 */
export async function closeShift(
  caller: Caller,
  shiftId: string,
  countLbp: DenomCount,
  countUsd: DenomCount,
  note: string,
): Promise<ZResult> {
  const db = adminDb()
  const ref = db.doc(`${SHIFTS}/${shiftId}`)

  const shift = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That shift does not exist.')
    const s = snap.data() as StoredShift
    if (s.status === 'closed') throw new HttpError(409, 'That shift is already closed.')
    // Reads before writes, as a transaction requires.
    const pointer = db.doc(`${POINTER}/${s.branch}`)
    const p = await tx.get(pointer)
    if (s.status === 'open') tx.update(ref, { status: 'closing' satisfies ShiftStatus })
    if (p.data()?.openShiftId === shiftId) tx.set(pointer, { openShiftId: null, since: null })
    return s
  })

  const totals = await shiftTotals(shiftId, shift.float)
  const counted = countedCash(countLbp, countUsd)
  const difference = drawerDifference(totals.expected, counted)

  await ref.update({
    status: 'closed' satisfies ShiftStatus,
    countLbp, countUsd, counted, totals, difference,
    note: note.trim().slice(0, 500),
    closedAt: FieldValue.serverTimestamp(),
    closedBy: caller.uid,
    closedByEmail: caller.email ?? '',
  })

  return { branch: shift.branch, totals, counted, difference }
}
