import {
  doc, getDoc, setDoc, addDoc, updateDoc, collection, query, where,
  orderBy, limit, getDocs, serverTimestamp, type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'

export const EXCHANGE_RATE = 90000

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
  rate = EXCHANGE_RATE,
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

export function emptyReport(branch: string, date: string, uid: string, email: string): EndOfDayReport {
  return {
    id:               reportDocId(branch, date),
    branch,
    date,
    exchangeRate:     EXCHANGE_RATE,
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

export async function saveEndOfDayReport(report: EndOfDayReport, uid: string): Promise<void> {
  const id = reportDocId(report.branch, report.date)
  await setDoc(doc(db, 'endOfDayReports', id), {
    ...report,
    id,
    submittedAt: report.submittedAt ?? serverTimestamp(),
    updatedAt:   serverTimestamp(),
    updatedBy:   uid,
  })
}

export async function listEndOfDayReports(branch: string | 'all', limitCount = 90): Promise<EndOfDayReport[]> {
  const col = collection(db, 'endOfDayReports')
  const q = branch === 'all'
    ? query(col, orderBy('date', 'desc'), limit(limitCount))
    : query(col, where('branch', '==', branch), orderBy('date', 'desc'), limit(limitCount))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as EndOfDayReport)
}

export async function updateEodTips(branch: string, date: string, tipsUsd: number, uid: string): Promise<void> {
  await updateDoc(doc(db, 'endOfDayReports', reportDocId(branch, date)), {
    tipsUsd,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}

export async function getBranchStaff(branch: string): Promise<BranchStaffConfig | null> {
  const snap = await getDoc(doc(db, 'branchStaff', branch))
  if (!snap.exists()) return null
  return snap.data() as BranchStaffConfig
}

export async function saveBranchStaff(branch: string, staff: string[], uid: string): Promise<void> {
  await setDoc(doc(db, 'branchStaff', branch), {
    branch,
    staff,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
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

export async function logEndOfDayAction(
  entry: Omit<EndOfDayLog, 'id' | 'createdAt'>
): Promise<void> {
  await addDoc(collection(db, 'endOfDayLogs'), { ...entry, createdAt: serverTimestamp() })
}

export async function listEndOfDayLogs(limitCount = 150): Promise<EndOfDayLog[]> {
  const snap = await getDocs(
    query(collection(db, 'endOfDayLogs'), orderBy('createdAt', 'desc'), limit(limitCount))
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as EndOfDayLog))
}
