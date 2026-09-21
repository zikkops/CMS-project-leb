// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Reads what the labour report needs for a period (UPGRADE.md T7.11): the
// clock-ins, everyone's dated pay, the End of Day reports (tips and who
// worked which shift), and the sales export's rows for net sales per branch
// and day. Admin only, where it is called: it carries rates.

import { adminDb } from './firebaseAdmin'
import { readInChunks, readSalesExport, requestedBranches, type ExportRequest } from './salesExport'
import { listStaffPay } from './staffPay'
import { readSettings } from './settings'
import { salesSummary } from '../salesSummary'
import { TIME_ENTRIES, timesheet, type Shift, type TimeEntry } from '../timeClock'
import { timestampMs } from '../timestamps'
import type { CutShort } from '../salesExport'
import type { LabourStaff, SalesDay, TipDay } from '../labourReport'

export async function readLabour(
  range: ExportRequest,
  opts: { timeZone: string; branches: readonly string[] },
): Promise<{ shifts: Shift[]; staff: LabourStaff[]; tipDays: TipDay[]; sales: SalesDay[]; branches: string[]; lbpRate: number; cutShort: CutShort | null }> {
  const branches = requestedBranches(range, [...opts.branches])
  const wanted = new Set(branches)
  const settings = await readSettings()
  const [clock, pay, eodSnap, exported] = await Promise.all([
    readInChunks(TIME_ENTRIES, 'at', range, opts.timeZone),
    listStaffPay(),
    adminDb().collection('endOfDayReports').where('date', '>=', range.from).where('date', '<=', range.to).get(),
    readSalesExport(range, { timeZone: opts.timeZone, fallbackRate: settings.exchangeRate, branches: [...opts.branches] }),
  ])

  // Paired over the padded window, so a shift across the range's edge is
  // whole; then only the shifts that started on a day in the range.
  const entries: TimeEntry[] = clock.docs.map(d => d.data).filter(e => wanted.has(String(e.branch))).map(e => ({
    uid: String(e.uid), name: String(e.name ?? ''), branch: String(e.branch), direction: e.direction === 'out' ? 'out' : 'in', at: timestampMs(e.at, 0),
  }))
  const shifts = timesheet(entries, { timeZone: opts.timeZone, now: Date.now() }).shifts
    .filter(s => s.day >= range.from && s.day <= range.to)

  const tipDays: TipDay[] = eodSnap.docs.map(d => d.data())
    .filter(r => wanted.has(String(r.branch)))
    .map(r => ({
      branch: String(r.branch),
      day: String(r.date),
      tipsUsd: (Number(r.tipsUsd) || 0) + (Number(r.cardTipsUsd) || 0),
      // The rate the day was saved with; today's setting for a day from before that was kept.
      deductionRate: typeof r.tipsDeductionRate === 'number' ? r.tipsDeductionRate : settings.tipsDeductionRate,
      attendance: (Array.isArray(r.attendance) ? r.attendance : [])
        .map((a: Record<string, unknown>) => ({ name: String(a?.name ?? ''), shift: String(a?.shift ?? '') })),
    }))

  // Net sales per branch and café day, from the sales summary's own figures.
  const groups = new Map<string, typeof exported.checks>()
  for (const row of exported.checks) {
    if (row.kind !== 'sale' || !wanted.has(row.branch)) continue
    const k = `${row.branch}|${row.day}`
    groups.set(k, [...(groups.get(k) ?? []), row])
  }
  const sales: SalesDay[] = [...groups.entries()].map(([k, rows]) => {
    const [branch, day] = k.split('|')
    return { branch, day, netSales: salesSummary(rows, [branch]).total.netSales }
  })

  const staff: LabourStaff[] = pay.map(p => ({ uid: p.uid, email: p.email, firstName: p.firstName, history: p.history }))
  const cuts = [clock.cutShort, exported.cutShort].filter((c): c is CutShort => Boolean(c))
  return {
    shifts, staff, tipDays, sales, branches, lbpRate: settings.exchangeRate,
    cutShort: cuts.length ? cuts.reduce((a, b) => (b.completeThrough < a.completeThrough ? b : a)) : null,
  }
}
