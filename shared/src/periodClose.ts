// Period close (UPGRADE.md T7.17). Pure, asserted by verify:export; the
// server is shared/src/server/periodClose.ts and the page /admin/reports/periods.
//
// When an admin closes a period, the figures handed to the accountant are
// stored as issued: every café day and branch, from the sales summary's own
// arithmetic, with the definitions version they were worked out under. The
// period is not locked. Something that later changes a closed day (a held hub
// sale applied, a check that reached the cloud late) is allowed, and is shown
// against the issued figures as a post-close adjustment: the reports never
// silently disagree with what was sent.
//
// A refund given after the close does not change a closed day: it is filed on
// the day it was given (T7.4), in the next period, which is the point.

import { salesSummary, type SalesFigures } from './salesSummary'
import type { CheckRow } from './salesExport'

/** What is kept of each day, as issued. */
export const CLOSED_FIELDS = ['checks', 'billed', 'netSales', 'vatOutput', 'serviceCharge', 'refundsBilled', 'refundsVat', 'cardTips'] as const
export type ClosedField = typeof CLOSED_FIELDS[number]

export const CLOSED_FIELD_LABELS: Record<ClosedField, string> = {
  checks: 'Checks', billed: 'Billed', netSales: 'Net sales', vatOutput: 'VAT output', serviceCharge: 'Service charge',
  refundsBilled: 'Refunds given', refundsVat: 'VAT reversed', cardTips: 'Card tips',
}

export type DayFigures = { branch: string; day: string } & Record<ClosedField, number>

export interface PeriodClose {
  id: string
  from: string
  to: string
  branches: string[]
  closedAt: string
  closedBy: string
  definitionsVersion: string
  days: DayFigures[]
  totals: Record<ClosedField, number>
}

export interface Adjustment { branch: string; day: string; field: ClosedField; issued: number; now: number; difference: number }

const r2 = (n: number) => Math.round(n * 100) / 100
const pickFields = (f: SalesFigures): Record<ClosedField, number> =>
  Object.fromEntries(CLOSED_FIELDS.map(k => [k, f[k]])) as Record<ClosedField, number>

/** Each café day and branch, from the sales summary's own function over the export's rows. */
export function dayFigures(rows: readonly CheckRow[], branches: readonly string[]): DayFigures[] {
  const keys = new Set(rows.filter(r => branches.includes(r.branch)).map(r => `${r.branch}|${r.day}`))
  return [...keys].sort().map(k => {
    const [branch, day] = k.split('|')
    return { branch, day, ...pickFields(salesSummary(rows.filter(r => r.day === day), [branch]).total) }
  })
}

export function totalsOf(days: readonly DayFigures[]): Record<ClosedField, number> {
  return Object.fromEntries(CLOSED_FIELDS.map(k => [k, r2(days.reduce((n, d) => n + d[k], 0))])) as Record<ClosedField, number>
}

/**
 * Every figure that differs from what was issued, day by day: a day that has
 * appeared since counts from zero, and a day that has gone counts to zero.
 */
export function adjustments(issued: readonly DayFigures[], now: readonly DayFigures[]): Adjustment[] {
  const key = (d: DayFigures) => `${d.branch}|${d.day}`
  const before = new Map(issued.map(d => [key(d), d]))
  const after = new Map(now.map(d => [key(d), d]))
  const out: Adjustment[] = []
  for (const k of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const [branch, day] = k.split('|')
    for (const field of CLOSED_FIELDS) {
      const was = before.get(k)?.[field] ?? 0
      const is = after.get(k)?.[field] ?? 0
      const difference = field === 'checks' ? is - was : r2(is - was)
      if (difference !== 0) out.push({ branch, day, field, issued: was, now: is, difference })
    }
  }
  return out
}

/** Why a period cannot be closed, or null. Periods never overlap, and today is not over yet. */
export function closeProblem(from: string, to: string, today: string, existing: readonly Pick<PeriodClose, 'from' | 'to'>[]): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return 'Choose the first and last day of the period.'
  if (to >= today) return 'A period can be closed once its last day is over: choose a last day before today.'
  const clash = existing.find(p => p.from <= to && p.to >= from)
  if (clash) return `Those days overlap a period already closed, ${clash.from} to ${clash.to}.`
  return null
}

/** The closes that cover any of these days, for a report to say so. */
export function closesOverlapping<T extends Pick<PeriodClose, 'from' | 'to'>>(closes: readonly T[], from: string, to: string): T[] {
  return closes.filter(p => p.from <= to && p.to >= from)
}
