// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Reads the drawer shifts and End of Day counts for a period of cash-up days
// (UPGRADE.md T7.7). Both are filed by a 'YYYY-MM-DD' string (the shift's
// `cashUpDay`, the report's `date`), so each is one single-field range with no
// composite index. A shift still open is shown with its live figure
// (shiftTotals), never with a count it has not had.

import { adminDb } from './firebaseAdmin'
import { requestedBranches, type ExportRequest } from './salesExport'
import { shiftTotals } from './drawer'
import { closedAtParts } from '../salesExport'
import { countedCash, type DenomCount, type DrawerMovement, type DrawerTotals, type Money2 } from '../drawer'
import type { EodCount, ShiftInput } from '../cashUpReport'

export async function readCashUp(
  range: ExportRequest,
  opts: { timeZone: string; branches: readonly string[] },
): Promise<{ shifts: ShiftInput[]; eod: EodCount[]; branches: string[] }> {
  const db = adminDb()
  const wanted = requestedBranches(range, opts.branches)
  const [shiftSnap, eodSnap] = await Promise.all([
    db.collection('drawerShifts').where('cashUpDay', '>=', range.from).where('cashUpDay', '<=', range.to).get(),
    db.collection('endOfDayReports').where('date', '>=', range.from).where('date', '<=', range.to).get(),
  ])
  const shifts: ShiftInput[] = []
  for (const doc of shiftSnap.docs) {
    const s = doc.data()
    if (!wanted.includes(String(s.branch))) continue
    const status = s.status === 'closed' ? 'closed' : s.status === 'closing' ? 'closing' : 'open'
    let totals = (s.totals ?? null) as DrawerTotals | null
    if (status !== 'closed' || !totals) {
      totals = await shiftTotals(doc.id, s.float as Money2, (Array.isArray(s.movements) ? s.movements : []) as DrawerMovement[])
    }
    shifts.push({
      id: doc.id,
      branch: String(s.branch),
      cashUpDay: String(s.cashUpDay ?? ''),
      status,
      openedTime: closedAtParts(s.openedAt, opts.timeZone).time,
      openedByEmail: String(s.openedByEmail ?? ''),
      closedByEmail: String(s.closedByEmail ?? ''),
      totals,
      counted: (s.counted ?? null) as Money2 | null,
      note: String(s.note ?? ''),
    })
  }
  const eod: EodCount[] = eodSnap.docs.map(d => d.data())
    .filter(r => wanted.includes(String(r.branch)))
    // From the stored note-by-note count, with the drawer's own countedCash():
    // the report keeps the counts, not their totals.
    .map(r => {
      const c = countedCash((r.cashLbp ?? {}) as DenomCount, (r.cashUsd ?? {}) as DenomCount)
      return { branch: String(r.branch), date: String(r.date), countedUsd: c.usd, countedLbp: c.lbp }
    })
  return { shifts, eod, branches: wanted }
}
