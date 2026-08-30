import {
  doc, getDoc, setDoc, addDoc, updateDoc, collection, query, where,
  orderBy, limit, getDocs, serverTimestamp, type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { authedFetch, unwrap } from './apiClient'

// Where the exchange rate comes from.
//
// EXCHANGE_RATE used to live here, as the fallback for a rate nobody had
// passed. Nothing falls back to it any more: computeTotals() and
// emptyReport() both require the rate, so a caller cannot silently get the
// build-time value instead of the configured one. The real fallback is inside
// useBusinessSettings(), which returns SETTINGS_DEFAULTS while the settings
// document is loading or unreadable — one place, where it can be reasoned
// about.
//
// A report stores the rate it was written with, so changing the live value
// never re-values an old one.

export const LBP_DENOMS = [100000, 50000, 20000, 10000, 5000, 1000] as const
export const USD_DENOMS  = [100, 50, 20, 10, 5, 1] as const

export type ShiftType = 'none' | 'am' | 'pm' | 'double'
export const SHIFT_LABELS: Record<ShiftType, string> = {
  none:   'Off',
  am:     'AM',
  pm:     'PM',
  double: 'Double',
}

export interface AttendanceEntry {
  name:    string
  shift:   ShiftType
  isGuest: boolean
}

export interface LineEntry {
  name:      string
  amountUsd: number
}

export interface EndOfDayReport {
  id:              string
  branch:          string
  date:            string          // 'YYYY-MM-DD'
  exchangeRate:    number
  cashLbp:         Record<string, number>  // denomination (string key) → count
  cashUsd:         Record<string, number>
  systemLbp:       number
  systemUsd:       number
  tipsUsd:         number
  expenses:        LineEntry[]
  income:          LineEntry[]
  attendance:      AttendanceEntry[]
  notes:           string
  submittedBy:     string
  submittedByEmail: string
  submittedAt:     Timestamp | null
  updatedAt:       Timestamp | null
  updatedBy:       string
}

export interface BranchStaffConfig {
  branch:    string
  staff:     string[]
  updatedAt: Timestamp | null
  updatedBy: string
}

export interface ComputedTotals {
  totalCashLbp:    number
  totalCashUsd:    number
  grandTotalLbp:   number
  grandTotalUsd:   number
  totalExpensesUsd: number
  totalExpensesLbp: number
  totalIncomeUsd:  number
  totalIncomeLbp:  number
  differenceLbp:   number
  differenceUsd:   number
}

export function computeTotals(
  cashLbp:   Record<string, number>,
  cashUsd:   Record<string, number>,
  systemLbp: number,
  systemUsd: number,
  expenses:  LineEntry[],
  income:    LineEntry[],
  // REQUIRED, and deliberately not defaulted.
  //
  // It used to fall back to EXCHANGE_RATE — the value compiled into the brand
  // config. Three of the four callers then omitted it, so every screen that
  // DISPLAYS a past report recomputed that day's cash difference at the
  // build-time rate instead of the rate the report was submitted with. The
  // one caller that got it right was the live entry form, which is the only
  // place the two values happen to agree.
  //
  // Each report stores its own exchangeRate precisely so history cannot move.
  // A default here quietly undid that, and did it silently — which is why this
  // is a required parameter now: the compiler names every site that forgets.
  rate: number,
): ComputedTotals {
  const totalCashLbp  = LBP_DENOMS.reduce((s, d) => s + (Number(cashLbp[String(d)] ) || 0) * d, 0)
  const totalCashUsd  = USD_DENOMS.reduce ((s, d) => s + (Number(cashUsd[String(d)] ) || 0) * d, 0)
  const grandTotalLbp = totalCashLbp + totalCashUsd * rate
  const grandTotalUsd = totalCashUsd + totalCashLbp / rate
  const totalExpensesUsd = expenses.reduce((s, e) => s + (Number(e.amountUsd) || 0), 0)
  const totalExpensesLbp = totalExpensesUsd * rate
  const totalIncomeUsd   = income.reduce((s, e) => s + (Number(e.amountUsd) || 0), 0)
  const totalIncomeLbp   = totalIncomeUsd * rate
  const differenceLbp    = grandTotalLbp + totalExpensesLbp - totalIncomeLbp - (Number(systemLbp) || 0)
  const differenceUsd    = grandTotalUsd + totalExpensesUsd - totalIncomeUsd - (Number(systemUsd) || 0)
  return {
    totalCashLbp, totalCashUsd, grandTotalLbp, grandTotalUsd,
    totalExpensesUsd, totalExpensesLbp, totalIncomeUsd, totalIncomeLbp,
    differenceLbp, differenceUsd,
  }
}

export function reportDocId(branch: string, date: string) {
  return `${branch}_${date}`
}

export function todayDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Before 10 am the shift still belongs to the previous day.
export function defaultEodDateStr() {
  const now = new Date()
  const d = now.getHours() < 10 ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1) : now
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function emptyReport(
  branch: string, date: string, uid: string, email: string,
  // Required for the same reason the one on computeTotals is: a default here
  // reads the rate compiled into the brand config, not the one the business
  // has configured, so a report could be STARTED at a rate nobody set.
  exchangeRate: number,
): EndOfDayReport {
  return {
    id:               reportDocId(branch, date),
    branch,
    date,
    exchangeRate,
    cashLbp:          Object.fromEntries(LBP_DENOMS.map(d => [String(d), 0])),
    cashUsd:          Object.fromEntries(USD_DENOMS.map(d => [String(d), 0])),
    systemLbp:        0,
    systemUsd:        0,
    tipsUsd:          0,
    expenses:         [],
    income:           [],
    attendance:       [],
    notes:            '',
    submittedBy:      uid,
    submittedByEmail: email,
    submittedAt:      null,
    updatedAt:        null,
    updatedBy:        uid,
  }
}

export async function getEndOfDayReport(branch: string, date: string): Promise<EndOfDayReport | null> {
  const snap = await getDoc(doc(db, 'endOfDayReports', reportDocId(branch, date)))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as EndOfDayReport
}

// Saving runs SERVER-SIDE (Phase 00 standing rule). See
// shared/src/server/endOfDay.ts.
//
// This is the closest thing the app has to a till: drawer counts, what the
// system said, and tips — which feed the monthly payroll figure. The client
// version did `setDoc({ ...report })`, writing whatever object the browser
// handed it, with no validation, no branch scoping, and the submitter's uid
// supplied by the caller.
//
// `uid` is no longer a parameter: the server takes the actor from the verified
// token. The endOfDayLogs audit entry is written in the same call, so a
// submission can no longer exist without one.
export async function saveEndOfDayReport(report: EndOfDayReport): Promise<{ id: string; created: boolean }> {
  const res = await authedFetch('/api/admin/end-of-day', 'POST', {
    branch: report.branch,
    date: report.date,
    exchangeRate: report.exchangeRate,
    cashLbp: report.cashLbp,
    cashUsd: report.cashUsd,
    systemLbp: report.systemLbp,
    systemUsd: report.systemUsd,
    tipsUsd: report.tipsUsd,
    expenses: report.expenses,
    income: report.income,
    attendance: report.attendance,
    notes: report.notes,
  })
  const data = await unwrap(res)
  return data as unknown as { id: string; created: boolean }
}

export async function listEndOfDayReports(branch: string | 'all', limitCount = 90): Promise<EndOfDayReport[]> {
  const col = collection(db, 'endOfDayReports')
  const q = branch === 'all'
    ? query(col, orderBy('date', 'desc'), limit(limitCount))
    : query(col, where('branch', '==', branch), orderBy('date', 'desc'), limit(limitCount))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as EndOfDayReport)
}

export async function updateEodTips(branch: string, date: string, tipsUsd: number): Promise<void> {
  const res = await authedFetch('/api/admin/end-of-day', 'PATCH', {
    action: 'tips', branch, date, tipsUsd,
  })
  await unwrap(res)
}

export async function getBranchStaff(branch: string): Promise<BranchStaffConfig | null> {
  const snap = await getDoc(doc(db, 'branchStaff', branch))
  if (!snap.exists()) return null
  return snap.data() as BranchStaffConfig
}

export async function saveBranchStaff(branch: string, staff: string[]): Promise<void> {
  const res = await authedFetch('/api/admin/end-of-day', 'PATCH', {
    action: 'staff', branch, staff,
  })
  await unwrap(res)
}

export interface StaffUser {
  uid:       string
  email:     string
  role:      string
  branchIds: string[]
}

export async function listAllStaff(): Promise<StaffUser[]> {
  const q = query(collection(db, 'users'), where('isStaff', '==', true))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({
    uid:       d.id,
    email:     d.data().email as string ?? '',
    role:      d.data().role as string ?? '',
    branchIds: Array.isArray(d.data().branchIds) ? d.data().branchIds as string[] : [],
  })).filter(s => s.email)
}

export function formatLbp(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' LBP'
}

export function formatUsd(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ---- End-of-Day Logs ----

export interface EndOfDayLog {
  id:          string
  action:      'submit' | 'update'
  reportDocId: string
  branch:      string
  date:        string
  staffUid:    string
  staffEmail:  string
  createdAt:   { seconds: number } | null
}

// logEndOfDayAction() is gone. The audit entry is written by the route, in
// the same call as the report itself — the client used to make two independent
// calls, so a saved report could end up with no log entry if the second
// failed, and the log recorded whichever uid the browser supplied.

/**
 * The end-of-day audit trail, scoped to the branches the reader is assigned.
 *
 * Pass `null` for an unrestricted read — that is the admin case, and it is
 * spelled explicitly so an accidentally-empty branch list can never be
 * mistaken for "show everything". A manager with no branches assigned sees
 * nothing, which is the honest answer.
 *
 * Every other manager-facing end-of-day view already filters by branch; this
 * one did not, so a manager for one branch could read the submission history
 * of all of them. Cash figures live one click away from these entries.
 *
 * Filtered client-side rather than with a `where` clause: the collection is
 * small and append-only, and an `in` query caps at 30 values, which would
 * quietly drop branches from the results of any larger deployment.
 */
export async function listEndOfDayLogs(
  branchIds: string[] | null,
  limitCount = 150,
): Promise<EndOfDayLog[]> {
  const snap = await getDocs(
    query(collection(db, 'endOfDayLogs'), orderBy('createdAt', 'desc'), limit(limitCount))
  )
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as EndOfDayLog))
  if (branchIds === null) return rows
  return rows.filter(r => branchIds.includes(r.branch))
}
