// The range view of Daily Inventory History (UPGRADE.md T7.1b): the counts
// for some branches between two calendar days, one row per count, and every
// counted line for the download. A count's `date` is its calendar day, so the
// report counts calendar days. Variance is countVariance()'s: counted minus
// what the branch held when the count was saved, valued at the stored unit
// cost. Counts saved before 14 Sep 2026 lack those fields, and a line without
// them reads as "not recorded", never as 0.

import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { countVariance } from '@big-cms/shared/recipes'
import type { DailyInventoryReport } from '@big-cms/shared/dailyInventory'
import type { FileColumn } from '@big-cms/shared/reportFile'
import type { ReportSheet } from '../../../../components/ui/ReportDownloads'

/**
 * One query per branch: branch ==, date between, newest first. The existing
 * (branch ASC, date DESC) index serves it.
 */
export async function readCountsInRange(branches: readonly string[], from: string, to: string): Promise<DailyInventoryReport[]> {
  const col = collection(db, 'dailyInventoryCounts')
  const snaps = await Promise.all(branches.map(b => getDocs(query(col,
    where('branch', '==', b), where('date', '>=', from), where('date', '<=', to), orderBy('date', 'desc')))))
  return snaps.flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() }) as DailyInventoryReport))
}

export interface CountLineRow {
  date: string
  branch: string
  department: string
  supply: string
  unit: string
  expected: number | null
  counted: number
  difference: number | null
  unitCost: number | null
  differenceUsd: number | null
}

export interface CountRow {
  id: string
  date: string
  branch: string
  department: string
  status: 'draft' | 'submitted'
  /** Lines with a counted quantity. */
  lines: number
  /** Sum of the lines whose value is known. */
  varianceUsd: number
  /** Counted lines whose value in USD was not recorded (no expected figure or no unit cost). */
  unknown: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function countLines(r: DailyInventoryReport): CountLineRow[] {
  const out: CountLineRow[] = []
  for (const l of r.items ?? []) {
    if (typeof l.countedQty !== 'number' || !Number.isFinite(l.countedQty)) continue
    const { varianceQty, varianceUsd } = countVariance(l.previousQty, l.countedQty, l.unitCostUsd)
    out.push({
      date: r.date, branch: r.branch, department: r.department,
      supply: l.name ?? l.supplyId, unit: l.unit ?? '',
      expected: typeof l.previousQty === 'number' && Number.isFinite(l.previousQty) ? l.previousQty : null,
      counted: l.countedQty,
      difference: varianceQty,
      unitCost: typeof l.unitCostUsd === 'number' && Number.isFinite(l.unitCostUsd) && l.unitCostUsd > 0 ? l.unitCostUsd : null,
      differenceUsd: varianceUsd,
    })
  }
  return out
}

export function countRow(r: DailyInventoryReport): CountRow {
  const lines = countLines(r)
  return {
    id: r.id, date: r.date, branch: r.branch, department: r.department, status: r.status,
    lines: lines.length,
    varianceUsd: r2(lines.reduce((s, l) => s + (l.differenceUsd ?? 0), 0)),
    unknown: lines.filter(l => l.differenceUsd === null).length,
  }
}

/** Newest first, then branch and department, so a day's counts sit together. */
export function sortCounts<T extends { date: string; branch: string; department: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.branch.localeCompare(b.branch) || a.department.localeCompare(b.department))
}

export type BranchKey = 'counts' | 'lines' | 'varianceUsd' | 'unknown'

export function branchTotals(branches: readonly string[], rows: readonly CountRow[]): { branch: string; totals: Record<BranchKey, number> }[] {
  return branches.map(branch => {
    const mine = rows.filter(r => r.branch === branch)
    return {
      branch,
      totals: {
        counts: mine.length,
        lines: mine.reduce((s, r) => s + r.lines, 0),
        varianceUsd: r2(mine.reduce((s, r) => s + r.varianceUsd, 0)),
        unknown: mine.reduce((s, r) => s + r.unknown, 0),
      },
    }
  })
}

const sheet = <T,>(name: string, columns: FileColumn<T>[], rows: readonly T[]) => ({ name, columns, rows }) as unknown as ReportSheet<never>

export function countSheets(rows: readonly CountRow[], lines: readonly CountLineRow[]): ReportSheet<never>[] {
  return [
    sheet<CountRow>('Counts', [
      { label: 'Date', value: r => r.date }, { label: 'Branch', value: r => r.branch }, { label: 'Department', value: r => r.department },
      { label: 'Status', value: r => (r.status === 'submitted' ? 'Submitted' : 'Draft') },
      { label: 'Lines counted', value: r => r.lines },
      { label: 'Variance USD (known lines only)', value: r => r.varianceUsd },
      { label: 'Lines with value not recorded', value: r => r.unknown },
    ], rows),
    sheet<CountLineRow>('Lines', [
      { label: 'Date', value: l => l.date }, { label: 'Branch', value: l => l.branch }, { label: 'Department', value: l => l.department },
      { label: 'Supply', value: l => l.supply }, { label: 'Unit', value: l => l.unit },
      { label: 'Expected', value: l => l.expected }, { label: 'Counted', value: l => l.counted },
      { label: 'Difference', value: l => l.difference }, { label: 'Unit cost USD', value: l => l.unitCost },
      { label: 'Difference USD', value: l => l.differenceUsd },
    ], lines),
  ]
}
