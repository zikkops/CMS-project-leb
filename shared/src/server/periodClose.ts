// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Closing a period and checking it later (UPGRADE.md T7.17). Closes are stored
// in `periodCloses/{from}_{to}`, server-only: no Firestore rule reads it, so no
// rules deploy. A close covers every branch: it is the business's books.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { readSalesExport, type ExportRequest } from './salesExport'
import { readSettings } from './settings'
import { BRAND } from '../brand'
import { todayYmd } from '../dates'
import { REPORT_DEFINITIONS_VERSION } from '../reportDefinitions'
import {
  adjustments, closeProblem, closesOverlapping, dayFigures, totalsOf,
  type Adjustment, type DayFigures, type PeriodClose,
} from '../periodClose'
import type { CheckRow } from '../salesExport'

export const PERIOD_CLOSES = 'periodCloses'

function readClose(id: string, d: Record<string, unknown>): PeriodClose {
  return {
    id,
    from: String(d.from ?? ''),
    to: String(d.to ?? ''),
    branches: Array.isArray(d.branches) ? d.branches.map(String) : [],
    closedAt: String(d.closedAtIso ?? ''),
    closedBy: String(d.closedByEmail ?? ''),
    definitionsVersion: String(d.definitionsVersion ?? ''),
    days: (Array.isArray(d.days) ? d.days : []) as DayFigures[],
    totals: (d.totals ?? {}) as PeriodClose['totals'],
  }
}

export async function listCloses(): Promise<PeriodClose[]> {
  const snap = await adminDb().collection(PERIOD_CLOSES).get()
  return snap.docs.map(d => readClose(d.id, d.data())).sort((a, b) => b.from.localeCompare(a.from))
}

async function currentDays(from: string, to: string, branches: readonly string[]): Promise<DayFigures[]> {
  const { exchangeRate } = await readSettings()
  const result = await readSalesExport({ from, to, branch: '' }, { timeZone: BRAND.locale.timezone, fallbackRate: exchangeRate, branches: [...branches] })
  return dayFigures(result.checks, branches)
}

export async function closePeriod(caller: Caller, range: Pick<ExportRequest, 'from' | 'to'>): Promise<PeriodClose> {
  const today = todayYmd(BRAND.locale.timezone)
  const problem = closeProblem(range.from, range.to, today, await listCloses())
  if (problem) throw new HttpError(409, problem)
  const branches = [...BRAND.branches]
  const days = await currentDays(range.from, range.to, branches)
  const id = `${range.from}_${range.to}`
  const ref = adminDb().doc(`${PERIOD_CLOSES}/${id}`)
  const closedAtIso = new Date().toISOString()
  // create(), so two admins closing the same period at once cannot both write it.
  await ref.create({
    from: range.from, to: range.to, branches, days, totals: totalsOf(days),
    definitionsVersion: REPORT_DEFINITIONS_VERSION,
    closedAt: FieldValue.serverTimestamp(), closedAtIso, closedBy: caller.uid, closedByEmail: caller.email ?? '',
  }).catch((err: { code?: number }) => {
    if (err?.code === 6) throw new HttpError(409, 'That period has just been closed.')
    throw err
  })
  return readClose(id, { from: range.from, to: range.to, branches, days, totals: totalsOf(days), definitionsVersion: REPORT_DEFINITIONS_VERSION, closedAtIso, closedByEmail: caller.email ?? '' })
}

/** A closed period against what the checks say now. */
export async function checkClose(id: string): Promise<{ close: PeriodClose; adjustments: Adjustment[] }> {
  const snap = await adminDb().doc(`${PERIOD_CLOSES}/${id}`).get()
  if (!snap.exists) throw new HttpError(404, 'There is no such closed period.')
  const close = readClose(snap.id, snap.data() ?? {})
  return { close, adjustments: adjustments(close.days, await currentDays(close.from, close.to, close.branches)) }
}

/**
 * For a report already holding the export's rows for a range: the closes that
 * cover any of its days, with what has changed on those days since.
 */
export async function closedNotes(rows: readonly CheckRow[], from: string, to: string, branches: readonly string[]): Promise<{ id: string; from: string; to: string; closedAt: string; adjustments: Adjustment[] }[]> {
  const overlapping = closesOverlapping(await listCloses(), from, to)
  return overlapping.map(c => {
    const inBoth = (day: string) => day >= c.from && day <= c.to && day >= from && day <= to
    const issued = c.days.filter(d => inBoth(d.day) && branches.includes(d.branch))
    const now = dayFigures(rows.filter(r => inBoth(r.day)), branches)
    return { id: c.id, from: c.from, to: c.to, closedAt: c.closedAt, adjustments: adjustments(issued, now) }
  })
}
