// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The end-of-day cash-up: drawer counts, tips, expenses, income, attendance.
//
// ── Why this moved off the client ─────────────────────────────────────────
// This is the closest thing the app currently has to a till. It records how
// much cash was counted, what the system said it should be, and how much went
// to tips — and the tips figure feeds the monthly payroll calculation.
//
// The client version had three problems, none of which a rule can catch:
//
//   1. `setDoc({ ...report })` wrote whatever object the browser handed it.
//      Every field, unvalidated: branch, date, both currency counts, tips.
//
//   2. The caller passed its own `uid`. A submission recorded whoever the
//      browser said submitted it, which is the one field an audit trail
//      exists to establish.
//
//   3. No branch scoping. A manager at one branch could write another
//      branch's cash-up. The UI never offered it; nothing stopped it.
//
// The document id is derived from branch + date on BOTH sides, so a report is
// naturally one-per-branch-per-day. That much was already right.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRANCHES } from '../branches'

export function reportDocId(branch: string, date: string): string {
  return `${branch}_${date}`
}

interface LineEntry { label: string; amount: number; currency?: string }
interface AttendanceEntry { name: string; hours?: number; present?: boolean }

export interface EodInput {
  branch: string
  date: string
  exchangeRate: number
  cashLbp: Record<string, number>
  cashUsd: Record<string, number>
  systemLbp: number
  systemUsd: number
  tipsUsd: number
  expenses: LineEntry[]
  income: LineEntry[]
  attendance: AttendanceEntry[]
  notes: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function money(v: unknown, label: string, max = 1_000_000_000): number {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label} must be a non-negative number.`)
  if (n > max) throw new HttpError(400, `${label} is implausibly large.`)
  return n
}

/** Denomination map: string keys, non-negative integer counts. */
function counts(v: unknown, label: string): Record<string, number> {
  if (v == null) return {}
  if (typeof v !== 'object') throw new HttpError(400, `${label} must be an object.`)
  const out: Record<string, number> = {}
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(raw ?? 0)
    if (!Number.isInteger(n) || n < 0) {
      throw new HttpError(400, `${label}: "${k}" must be a non-negative whole number of notes.`)
    }
    out[k] = n
  }
  return out
}

function lines(v: unknown, label: string): LineEntry[] {
  if (v == null) return []
  if (!Array.isArray(v)) throw new HttpError(400, `${label} must be a list.`)
  return v.map((row, i) => {
    const r = (row ?? {}) as Record<string, unknown>
    return {
      label: String(r.label ?? '').slice(0, 200),
      amount: money(r.amount, `${label} line ${i + 1}`),
      ...(typeof r.currency === 'string' ? { currency: r.currency } : {}),
    }
  })
}

export function parseEodInput(body: Record<string, unknown>): EodInput {
  const branch = typeof body.branch === 'string' ? body.branch.trim() : ''
  if (!(BRANCHES as readonly string[]).includes(branch)) {
    throw new HttpError(400, `Unknown branch: ${branch || '(none)'}`)
  }

  const date = typeof body.date === 'string' ? body.date.trim() : ''
  if (!DATE.test(date)) throw new HttpError(400, 'Date must be YYYY-MM-DD.')

  const attendanceRaw = Array.isArray(body.attendance) ? body.attendance : []

  return {
    branch,
    date,
    // Stored on the record, not looked up at read time, so a reprint next year
    // shows the totals that were actually used. Same reasoning as deliveries.
    exchangeRate: money(body.exchangeRate, 'Exchange rate'),
    cashLbp: counts(body.cashLbp, 'LBP cash count'),
    cashUsd: counts(body.cashUsd, 'USD cash count'),
    systemLbp: money(body.systemLbp, 'System LBP'),
    systemUsd: money(body.systemUsd, 'System USD'),
    tipsUsd: money(body.tipsUsd, 'Tips'),
    expenses: lines(body.expenses, 'Expenses'),
    income: lines(body.income, 'Income'),
    attendance: attendanceRaw.map(row => {
      const r = (row ?? {}) as Record<string, unknown>
      return {
        name: String(r.name ?? '').slice(0, 120),
        ...(r.hours != null ? { hours: money(r.hours, 'Hours', 24) } : {}),
        ...(typeof r.present === 'boolean' ? { present: r.present } : {}),
      }
    }),
    notes: String(body.notes ?? '').slice(0, 5000),
  }
}

/** Admins are unscoped; a manager is limited to their own branches. */
function assertBranch(caller: Caller, branch: string): void {
  if (caller.role === 'admin') return
  if (caller.branchIds.length === 0) return
  if (!caller.branchIds.includes(branch)) {
    throw new HttpError(403, 'That branch is not one of yours.')
  }
}

export interface EodResult {
  id: string
  created: boolean
}

export async function saveEndOfDay(caller: Caller, input: EodInput): Promise<EodResult> {
  assertBranch(caller, input.branch)

  const db = adminDb()
  const id = reportDocId(input.branch, input.date)
  const ref = db.doc(`endOfDayReports/${id}`)

  const existing = await ref.get()

  await ref.set({
    ...input,
    id,
    // submittedBy is set once, on creation, and never overwritten by a later
    // edit. Who cashed up is not the same fact as who last corrected a typo,
    // and the old client version overwrote the first with the second.
    submittedBy: existing.exists ? existing.data()?.submittedBy : caller.uid,
    submittedByEmail: existing.exists ? existing.data()?.submittedByEmail : (caller.email ?? ''),
    submittedAt: existing.exists ? existing.data()?.submittedAt : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  })

  // endOfDayLogs is a separate, append-only audit collection that the EOD log
  // page reads. Written here, in the same call as the report, so a submission
  // cannot exist without its log entry — the client used to make two
  // independent calls, and the second could simply fail.
  await db.collection('endOfDayLogs').add({
    action: existing.exists ? 'update' : 'submit',
    reportDocId: id,
    branch: input.branch,
    date: input.date,
    staffUid: caller.uid,
    staffEmail: caller.email ?? '',
    createdAt: FieldValue.serverTimestamp(),
  })

  return { id, created: !existing.exists }
}

export async function updateTips(
  caller: Caller,
  branch: string,
  date: string,
  tipsUsd: number,
): Promise<{ id: string; before: number; after: number }> {
  if (!(BRANCHES as readonly string[]).includes(branch)) {
    throw new HttpError(400, `Unknown branch: ${branch || '(none)'}`)
  }
  if (!DATE.test(date)) throw new HttpError(400, 'Date must be YYYY-MM-DD.')
  assertBranch(caller, branch)

  const amount = money(tipsUsd, 'Tips')
  const db = adminDb()
  const ref = db.doc(`endOfDayReports/${reportDocId(branch, date)}`)

  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'There is no end-of-day report for that branch and date.')

  const before = Number(snap.data()?.tipsUsd ?? 0)
  await ref.update({
    tipsUsd: amount,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  })

  return { id: ref.id, before, after: amount }
}

export async function saveBranchStaff(
  caller: Caller,
  branch: string,
  staff: string[],
): Promise<{ count: number }> {
  if (!(BRANCHES as readonly string[]).includes(branch)) {
    throw new HttpError(400, `Unknown branch: ${branch || '(none)'}`)
  }
  assertBranch(caller, branch)

  const clean = (Array.isArray(staff) ? staff : [])
    .filter((s): s is string => typeof s === 'string')
    .map(s => s.trim())
    .filter(Boolean)

  await adminDb().doc(`branchStaff/${branch}`).set({
    branch,
    staff: clean,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  })

  return { count: clean.length }
}
