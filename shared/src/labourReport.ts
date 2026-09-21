// The labour report (UPGRADE.md T7.11). Pure, asserted by verify:tips; the
// read is shared/src/server/labour.ts and the page /admin/reports/labour.
//
// Hours come from the timesheet (clock-ins on the café hubs), each shift
// costed at the person's hourly rate AS IT STOOD on the day the shift started
// (staffPay.ts, T7.18): last month is worked out with last month's rate. A
// person with no rate that day is "not priced", counted in minutes and never
// costed at $0, which would read as free labour. A shift still open, or longer
// than 16 hours, has no reliable length and is flagged, never guessed.
//
// Tips are the tips split for the same period, per branch, each day at the
// deduction it was saved with and each shift at that day's tip weight (the
// tips page's own arithmetic, tips.ts). A name on the End of Day attendance
// that matches no staff account is listed apart, never dropped.
//
// Owed for payroll = hours × rate + tips, per currency: a rate in lira is owed
// in lira, and tips are dollars. Labour as a share of net sales (the sales
// summary's net sales, excluding VAT and service) converts lira cost at the
// business rate for that one percentage, and says so.

import { hourlyRateOn, matchStaffName, tipWeightOn, type PayCurrency, type PayEntry } from './staffPay'
import { distributeTipDays } from './tips'
import type { Shift } from './timeClock'

export interface LabourStaff { uid: string; email: string; firstName: string; history: readonly PayEntry[] }
export interface TipDay { branch: string; day: string; tipsUsd: number; deductionRate: number; attendance: readonly { name: string; shift: string }[] }
export interface SalesDay { branch: string; day: string; netSales: number }

export interface LabourShift extends Shift {
  rate: number | null
  currency: PayCurrency | null
  costUsd: number
  costLbp: number
  /** Open, or too long to trust: no cost, and listed. */
  flagged: boolean
}

export interface LabourPerson {
  uid: string
  name: string
  shifts: number
  minutes: number
  openShifts: number
  /** Minutes worked on days with no rate set: not costed, never $0. */
  unpricedMinutes: number
  costUsd: number
  costLbp: number
  tipsUsd: number
  /** What payroll owes: pay in its own currency, plus tips in dollars. */
  owedUsd: number
  owedLbp: number
}

export interface LabourDay {
  branch: string
  day: string
  minutes: number
  unpricedMinutes: number
  costUsd: number
  costLbp: number
  netSales: number
  /** Labour cost ÷ net sales, lira at the business rate. Null with no sales. */
  labourPercent: number | null
}

export interface LabourTotals {
  shifts: number
  openShifts: number
  minutes: number
  unpricedMinutes: number
  costUsd: number
  costLbp: number
  tipsUsd: number
  netSales: number
  labourPercent: number | null
}

export interface LabourReport {
  people: LabourPerson[]
  days: LabourDay[]
  shifts: LabourShift[]
  /** Tips for attendance names that match no staff account. */
  unmatchedTips: { branch: string; name: string; tipsUsd: number }[]
  byBranch: { branch: string; totals: LabourTotals }[]
  total: LabourTotals
  /** The business rate the percentage converted lira cost at. */
  lbpRate: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

function percent(costUsd: number, costLbp: number, netSales: number, lbpRate: number): number | null {
  if (!(netSales > 0)) return null
  if (costLbp > 0 && !(lbpRate > 0)) return null
  const cost = costUsd + (costLbp > 0 ? costLbp / lbpRate : 0)
  return Math.round((cost / netSales) * 10_000) / 10_000
}

/** One shift at its day's rate. Open or too long: flagged and not costed. */
export function costShift(shift: Shift, history: readonly PayEntry[]): LabourShift {
  const flagged = shift.outAt === null || shift.minutes === null || shift.long
  const pay = hourlyRateOn(history, shift.day)
  const hours = flagged ? 0 : (shift.minutes as number) / 60
  return {
    ...shift,
    rate: pay?.rate ?? null,
    currency: pay?.currency ?? null,
    costUsd: pay && pay.currency === 'USD' ? r2(hours * pay.rate) : 0,
    costLbp: pay && pay.currency === 'LBP' ? Math.round(hours * pay.rate) : 0,
    flagged,
  }
}

export function labourReport(input: {
  shifts: readonly Shift[]
  staff: readonly LabourStaff[]
  tipDays: readonly TipDay[]
  sales: readonly SalesDay[]
  branches: readonly string[]
  lbpRate: number
}): LabourReport {
  const branches = new Set(input.branches)
  const staffBy = new Map(input.staff.map(s => [s.uid, s]))
  const shifts = input.shifts.filter(s => branches.has(s.branch)).map(s => costShift(s, staffBy.get(s.uid)?.history ?? []))

  const people = new Map<string, LabourPerson>()
  const person = (uid: string, fallback: string) => {
    const s = staffBy.get(uid)
    const p = people.get(uid) ?? {
      uid, name: s?.firstName || s?.email || fallback || uid, shifts: 0, minutes: 0, openShifts: 0, unpricedMinutes: 0,
      costUsd: 0, costLbp: 0, tipsUsd: 0, owedUsd: 0, owedLbp: 0,
    }
    people.set(uid, p)
    return p
  }
  for (const s of shifts) {
    const p = person(s.uid, s.name)
    p.shifts++
    if (s.flagged) { p.openShifts++; continue }
    p.minutes += s.minutes ?? 0
    if (s.rate === null) p.unpricedMinutes += s.minutes ?? 0
    p.costUsd = r2(p.costUsd + s.costUsd)
    p.costLbp += s.costLbp
  }

  // The tips split, per branch, as the tips page works it out.
  const unmatchedTips: LabourReport['unmatchedTips'] = []
  const tipsByBranch = new Map<string, number>()
  const matchList = input.staff.map(s => ({ uid: s.uid, email: s.email, firstName: s.firstName }))
  for (const branch of input.branches) {
    const days = input.tipDays.filter(d => d.branch === branch)
    if (days.length === 0) continue
    const d = distributeTipDays(
      days.map(x => ({ tipsUsd: x.tipsUsd, deductionRate: x.deductionRate })),
      days.flatMap(x => x.attendance.map(a => {
        const uid = matchStaffName(a.name, matchList)
        return { name: a.name, shift: a.shift, weight: uid ? tipWeightOn(staffBy.get(uid)?.history ?? [], x.day) : 1 }
      })),
    )
    tipsByBranch.set(branch, d.netTipsUsd)
    for (const t of d.staff) {
      const uid = matchStaffName(t.name, matchList)
      if (uid) { const p = person(uid, t.name); p.tipsUsd = r2(p.tipsUsd + t.earned) }
      else if (t.earned > 0) unmatchedTips.push({ branch, name: t.name, tipsUsd: t.earned })
    }
  }
  for (const p of people.values()) {
    p.owedUsd = r2(p.costUsd + p.tipsUsd)
    p.owedLbp = p.costLbp
  }

  const dayMap = new Map<string, LabourDay>()
  const dayRow = (branch: string, day: string) => {
    const k = `${branch}|${day}`
    const d = dayMap.get(k) ?? { branch, day, minutes: 0, unpricedMinutes: 0, costUsd: 0, costLbp: 0, netSales: 0, labourPercent: null }
    dayMap.set(k, d)
    return d
  }
  for (const s of shifts) {
    const d = dayRow(s.branch, s.day)
    if (s.flagged) continue
    d.minutes += s.minutes ?? 0
    if (s.rate === null) d.unpricedMinutes += s.minutes ?? 0
    d.costUsd = r2(d.costUsd + s.costUsd)
    d.costLbp += s.costLbp
  }
  for (const s of input.sales) {
    if (!branches.has(s.branch)) continue
    const d = dayRow(s.branch, s.day)
    d.netSales = r2(d.netSales + s.netSales)
  }
  const days = [...dayMap.values()]
    .map(d => ({ ...d, labourPercent: percent(d.costUsd, d.costLbp, d.netSales, input.lbpRate) }))
    .sort((a, b) => (a.day === b.day ? a.branch.localeCompare(b.branch) : a.day.localeCompare(b.day)))

  const totalsOf = (list: readonly LabourDay[], shiftList: readonly LabourShift[], tipsUsd: number): LabourTotals => {
    const costUsd = r2(list.reduce((n, d) => n + d.costUsd, 0))
    const costLbp = list.reduce((n, d) => n + d.costLbp, 0)
    const netSales = r2(list.reduce((n, d) => n + d.netSales, 0))
    return {
      shifts: shiftList.length,
      openShifts: shiftList.filter(s => s.flagged).length,
      minutes: list.reduce((n, d) => n + d.minutes, 0),
      unpricedMinutes: list.reduce((n, d) => n + d.unpricedMinutes, 0),
      costUsd, costLbp, tipsUsd: r2(tipsUsd), netSales,
      labourPercent: percent(costUsd, costLbp, netSales, input.lbpRate),
    }
  }
  const byBranch = input.branches.map(branch => ({
    branch,
    totals: totalsOf(days.filter(d => d.branch === branch), shifts.filter(s => s.branch === branch), tipsByBranch.get(branch) ?? 0),
  }))
  return {
    people: [...people.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name)),
    days,
    shifts,
    unmatchedTips,
    byBranch,
    total: totalsOf(days, shifts, [...tipsByBranch.values()].reduce((n, t) => n + t, 0)),
    lbpRate: input.lbpRate,
  }
}
