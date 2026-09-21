// The cash-up and drawer report (UPGRADE.md T7.7). Pure, asserted by
// verify:export; the read is shared/src/server/cashUp.ts.
//
// Cash is counted per shift and filed by cash-up day (before 10:00 is the night
// before, reportDefinitions.ts), so it reconciles per shift, never per calendar
// day. Every figure stays in its own currency and is never netted at a rate,
// as the drawer itself refuses to do. The End of Day count for the same
// cash-up day sits beside the shifts, from what that report stored.
//
// A Z close is named by its branch, cash-up day and the time the shift opened
// ("Main 2026-09-21 18:04"): one shift is open at a branch at a time, so the
// label is unique, and it needs no counter, which a hub handed back and
// cleared would restart.

import { drawerDifference, type DrawerTotals, type Money2 } from './drawer'

export interface ShiftInput {
  id: string
  branch: string
  cashUpDay: string
  status: 'open' | 'closing' | 'closed'
  /** Opening time as café-local 'HH:MM'. */
  openedTime: string
  openedByEmail: string
  closedByEmail: string
  /** Stored at the Z close; the live figure for a shift still open. */
  totals: DrawerTotals | null
  counted: Money2 | null
  note: string
}

export interface EodCount { branch: string; date: string; countedUsd: number; countedLbp: number }

export interface ShiftRow {
  id: string
  z: string
  branch: string
  cashUpDay: string
  status: 'open' | 'closing' | 'closed'
  openedBy: string
  closedBy: string
  float: Money2
  cashIn: Money2
  change: Money2
  refunds: Money2
  paidOuts: Money2
  payIns: Money2
  safeDrops: Money2
  expected: Money2
  /** Null while the shift is open: nothing has been counted. */
  counted: Money2 | null
  difference: Money2 | null
  card: Money2
  cardTips: number
  note: string
}

export interface CashTotals {
  shifts: number
  openShifts: number
  cashIn: Money2
  change: Money2
  refunds: Money2
  paidOuts: Money2
  payIns: Money2
  safeDrops: Money2
  /** Closed shifts only: what they should have held, what was counted, and the difference. */
  expectedClosed: Money2
  counted: Money2
  difference: Money2
  card: Money2
  cardTips: number
}

export interface DayLine {
  branch: string
  cashUpDay: string
  shifts: number
  expected: Money2
  counted: Money2 | null
  /** What that day's End of Day report counted, when there is one. */
  eodCounted: Money2 | null
}

const zero = (): Money2 => ({ usd: 0, lbp: 0 })
const add = (a: Money2, b: Money2 | undefined): Money2 => ({ usd: Math.round((a.usd + (b?.usd ?? 0)) * 100) / 100, lbp: Math.round(a.lbp + (b?.lbp ?? 0)) })

export function zLabel(s: Pick<ShiftInput, 'branch' | 'cashUpDay' | 'openedTime'>): string {
  return `${s.branch} ${s.cashUpDay} ${s.openedTime}`
}

export function shiftRow(s: ShiftInput): ShiftRow {
  const t = s.totals
  return {
    id: s.id, z: zLabel(s), branch: s.branch, cashUpDay: s.cashUpDay, status: s.status,
    openedBy: s.openedByEmail, closedBy: s.closedByEmail,
    float: t?.float ?? zero(), cashIn: t?.cashIn ?? zero(), change: t?.change ?? zero(), refunds: t?.refunds ?? zero(),
    paidOuts: t?.paidOuts ?? zero(), payIns: t?.payIns ?? zero(), safeDrops: t?.safeDrops ?? zero(),
    expected: t?.expected ?? zero(),
    counted: s.status === 'closed' ? s.counted : null,
    difference: s.status === 'closed' && s.counted && t ? drawerDifference(t.expected, s.counted) : null,
    card: t?.card ?? zero(), cardTips: t?.cardTips ?? 0, note: s.note,
  }
}

export function cashTotals(rows: readonly ShiftRow[]): CashTotals {
  const t: CashTotals = {
    shifts: 0, openShifts: 0, cashIn: zero(), change: zero(), refunds: zero(), paidOuts: zero(), payIns: zero(), safeDrops: zero(),
    expectedClosed: zero(), counted: zero(), difference: zero(), card: zero(), cardTips: 0,
  }
  for (const r of rows) {
    t.shifts += 1
    if (r.status !== 'closed') t.openShifts += 1
    t.cashIn = add(t.cashIn, r.cashIn); t.change = add(t.change, r.change); t.refunds = add(t.refunds, r.refunds)
    t.paidOuts = add(t.paidOuts, r.paidOuts); t.payIns = add(t.payIns, r.payIns); t.safeDrops = add(t.safeDrops, r.safeDrops)
    t.card = add(t.card, r.card); t.cardTips = Math.round((t.cardTips + r.cardTips) * 100) / 100
    if (r.status === 'closed' && r.counted) {
      t.expectedClosed = add(t.expectedClosed, r.expected)
      t.counted = add(t.counted, r.counted)
      t.difference = add(t.difference, r.difference ?? zero())
    }
  }
  return t
}

export interface CashUpReport {
  shifts: ShiftRow[]
  byBranch: { branch: string; totals: CashTotals }[]
  total: CashTotals
  days: DayLine[]
}

export function cashUpReport(shifts: readonly ShiftInput[], eod: readonly EodCount[], branches: readonly string[]): CashUpReport {
  const rows = shifts.filter(s => branches.includes(s.branch)).map(shiftRow)
    .sort((a, b) => (a.cashUpDay === b.cashUpDay ? a.z.localeCompare(b.z) : a.cashUpDay.localeCompare(b.cashUpDay)))
  const byBranch = branches.map(branch => ({ branch, totals: cashTotals(rows.filter(r => r.branch === branch)) }))
  const days = new Map<string, DayLine>()
  for (const r of rows) {
    const k = `${r.branch}|${r.cashUpDay}`
    const d = days.get(k) ?? { branch: r.branch, cashUpDay: r.cashUpDay, shifts: 0, expected: zero(), counted: null, eodCounted: null }
    d.shifts += 1
    d.expected = add(d.expected, r.expected)
    if (r.counted) d.counted = add(d.counted ?? zero(), r.counted)
    days.set(k, d)
  }
  for (const e of eod) {
    if (!branches.includes(e.branch)) continue
    const k = `${e.branch}|${e.date}`
    const d = days.get(k) ?? { branch: e.branch, cashUpDay: e.date, shifts: 0, expected: zero(), counted: null, eodCounted: null }
    d.eodCounted = { usd: e.countedUsd, lbp: e.countedLbp }
    days.set(k, d)
  }
  return {
    shifts: rows,
    byBranch,
    total: cashTotals(rows),
    days: [...days.values()].sort((a, b) => (a.cashUpDay === b.cashUpDay ? a.branch.localeCompare(b.branch) : a.cashUpDay.localeCompare(b.cashUpDay))),
  }
}
