'use client'

import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRANCHES } from '@big-cms/shared/branches'
import { listEndOfDayReportsBetween, formatUsd, type EndOfDayReport } from '@big-cms/shared/endOfDay'
import { useBusinessSettings } from '@big-cms/shared/useBusinessSettings'
import { distributeTips } from '@big-cms/shared/tips'
import { matchStaffName, readPayHistory, tipWeightOn } from '@big-cms/shared/staffPay'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { startLoad } from '@big-cms/shared/startLoad'
import type { FileColumn } from '@big-cms/shared/reportFile'
import { ReportRange, BranchTotals, type RangeChoice } from '../../../components/ui/ReportRange'
import { ReportDownloads, type ReportSheet } from '../../../components/ui/ReportDownloads'
import { reportHeader } from '../../reports/files'

/** Tip weights by date, as set on Staff Pay (UPGRADE.md T7.18); no rates come with them. */
interface WeightRow { uid: string; email: string; firstName: string; weights: { from: string; tipWeight: number }[] }

/** A person's weight on a day: the attendance name matched to a staff member, else 1 (a guest). */
function weightLookup(rows: readonly WeightRow[]): (name: string, day: string) => number {
  const byUid = new Map(rows.map(r => [r.uid, readPayHistory(r.weights.map(w => ({ ...w, hourlyRate: null, currency: 'USD' })))]))
  return (name, day) => {
    const uid = matchStaffName(name, rows)
    return uid ? tipWeightOn(byUid.get(uid) ?? [], day) : 1
  }
}

// The deduction is a SETTING. It used to be `const DEDUCTION = 0.11` right
// here, which meant the rate on the Business Settings form did nothing at all:
// a manager could change it, see it saved, and every payout would still come
// out at 11%. See the note at the top of shared/src/tips.ts.

// ─── computation ─────────────────────────────────────────────────────────────

interface StaffTip { name: string; shiftPoints: number; weightedPoints: number; earned: number }

interface PeriodResult {
  label: string
  dateRange: string
  reportCount: number
  totalTipsUsd: number
  netTipsUsd: number
  totalShiftPoints: number
  /** Shift points × weights, summed: what the pot is divided by. */
  totalWeightedPoints: number
  deductedUsd: number
  tipsPerPoint: number
  /** The rate this period was actually worked out at — it travels with the
   *  figures rather than being read again where they are displayed, so a card
   *  can never label a total with a rate that did not produce it. */
  deductionRate: number
  staff: StaffTip[]
}

function buildPeriod(
  label: string,
  dateRange: string,
  reports: EndOfDayReport[],
  deductionRate: number,
  weightOn: (name: string, day: string) => number,
): PeriodResult {
  // The arithmetic is shared/src/tips.ts, asserted by npm run verify:tips —
  // including that the shares add up to the pot to the cent, which this page's
  // version did not: it multiplied an unrounded per-point figure per person
  // and let the remainder evaporate.
  const d = distributeTips(
    // The jar, and what was tipped on cards at the till (UPGRADE.md T3.9).
    reports.reduce((s, r) => s + (Number(r.tipsUsd) || 0) + (Number(r.cardTipsUsd) || 0), 0),
    deductionRate,
    // Each shift at that day's weight (T7.18), so a raise counts from its day.
    reports.flatMap(r => r.attendance.map(a => ({ name: a.name, shift: a.shift, weight: weightOn(a.name, r.date) }))),
  )

  return {
    label,
    dateRange,
    reportCount: reports.length,
    totalTipsUsd: d.totalTipsUsd,
    netTipsUsd: d.netTipsUsd,
    totalShiftPoints: d.totalShiftPoints,
    totalWeightedPoints: d.totalWeightedPoints,
    deductedUsd: d.deductedUsd,
    tipsPerPoint: d.perPoint,
    deductionRate: d.deductionRate,
    staff: d.staff,
  }
}

// ─── download ────────────────────────────────────────────────────────────────

const sheet = <T,>(name: string, columns: FileColumn<T>[], rows: readonly T[]) => ({ name, columns, rows }) as unknown as ReportSheet<never>

/** One sheet per branch's period, and a summary; the figures are the periods' own, nothing added here. */
function tipSheets(periods: readonly { branch: string; period: PeriodResult }[]): ReportSheet<never>[] {
  const people = periods.map(({ branch, period }) => sheet<StaffTip>(`Tips ${branch}`, [
    { label: 'Name', value: s => s.name },
    { label: 'Shift points', value: s => s.shiftPoints },
    { label: 'Weighted points', value: s => s.weightedPoints },
    { label: 'Earned USD', value: s => s.earned },
  ], period.staff))
  const summary = sheet<{ branch: string; period: PeriodResult }>('Summary', [
    { label: 'Branch', value: r => r.branch },
    { label: 'Days of data', value: r => r.period.reportCount },
    { label: 'Pot USD', value: r => r.period.totalTipsUsd },
    { label: 'Deduction rate %', value: r => +(r.period.deductionRate * 100).toFixed(2) },
    { label: 'Deducted USD', value: r => r.period.deductedUsd },
    { label: 'Net USD', value: r => r.period.netTipsUsd },
    { label: 'Shift points', value: r => r.period.totalShiftPoints },
    { label: 'Weighted points', value: r => r.period.totalWeightedPoints },
  ], periods)
  // The CSV is the first sheet: the split itself for one branch, the summary for several.
  return periods.length === 1 ? [...people, summary] : [summary, ...people]
}

// ─── page ─────────────────────────────────────────────────────────────────────

/** What was read for one run: the range, and each branch's reports. */
interface Loaded { from: string; to: string; byBranch: { branch: string; reports: EndOfDayReport[] }[] }

export default function TipsCalculatorPage() {
  const isMobile = useIsMobile()
  const { checking, role, branchIds } = useRequireRole(SECTION_ACCESS.endOfDay)
  // The configured deduction, not a constant. useBusinessSettings falls back
  // to the brand defaults while it loads or if the document is unreadable, so
  // this is never undefined — see shared/src/businessSettings.ts.
  const { settings } = useBusinessSettings()
  const deductionRate = settings.tipsDeductionRate
  const deductionPct = `${+(deductionRate * 100).toFixed(2)}%`

  const branchOptions = role === 'admin' ? [...BRANCHES] : branchIds

  const [loaded,  setLoaded]  = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)
  const [weights, setWeights] = useState<WeightRow[]>([])
  const [weightsErr, setWeightsErr] = useState('')
  const [err,     setErr]     = useState('')

  // Not ceremony. Running twice quickly can land the first answer after the
  // second, and the screen would then show one range's reports under another
  // range's name, with tips computed from them. Only the latest run's answer
  // is kept.
  const runId = useRef(0)

  async function run(range: RangeChoice) {
    const id = ++runId.current
    // '' is every branch the person may see; else the ones chosen.
    const branches = range.branch ? range.branch.split(',') : branchOptions
    setLoading(true)
    setErr('')
    try {
      // Tips are pooled per branch, so each branch is read (and split) on its own.
      const byBranch = await Promise.all(branches.map(async branch => ({
        branch, reports: await listEndOfDayReportsBetween(branch, range.from, range.to),
      })))
      if (id === runId.current) setLoaded({ from: range.from, to: range.to, byBranch })
    } catch {
      if (id === runId.current) setErr('Failed to load reports.')
    } finally {
      if (id === runId.current) setLoading(false)
    }
  }

  // Tip weights, once. If they cannot be read, everybody counts at 1 and the
  // page says so, rather than splitting by weights it does not have.
  useEffect(() => {
    if (checking) return
    startLoad(async () => {
      try {
        const data = await unwrap(await authedFetch('/api/admin/staff-pay?weights=1', 'GET')) as { staff: WeightRow[] }
        setWeights(data.staff)
      } catch {
        setWeightsErr('Tip weights could not be read, so everybody counts at 1 this time.')
      }
    })
  }, [checking])

  if (checking) return null
  const weightOn = weightLookup(weights)

  // Worked out while rendering, so weights arriving after the run still count.
  const rangeLabel = loaded ? (loaded.from === loaded.to ? loaded.from : `${loaded.from} to ${loaded.to}`) : ''
  const periods = (loaded?.byBranch ?? []).map(({ branch, reports }) => ({
    branch, reports, period: buildPeriod(branch, rangeLabel, reports, deductionRate, weightOn),
  }))
  const reportCount = periods.reduce((s, p) => s + p.reports.length, 0)
  const hasTipsData = periods.some(p => p.period.totalTipsUsd > 0)
  const branchNames = periods.map(p => p.branch).join(', ')

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin/end-of-day/history" style={{
            fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(var(--offwhite-rgb),0.3)', textDecoration: 'none',
            display: 'block', marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
          }}>← EOD History</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
            Tips Calculator
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.3)' }}>
            Tip distribution by shift — {deductionPct} deducted, remainder split by shift points
          </p>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.45)', marginTop: '0.5rem' }}>
            Pay periods are usually the 1st–15th and the 16th–end of the month: pick This month or Last month, then set the days.
            Each branch keeps its own pot.
          </p>
        </div>

        {/* Controls */}
        <ReportRange onRun={r => { void run(r) }} busy={loading} branches={branchOptions} />

        {loading && (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        )}
        {err && (
          <p style={{ color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>{err}</p>
        )}
        {weightsErr && (
          <p style={{ color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>{weightsErr}</p>
        )}

        {!loading && loaded && reportCount === 0 && (
          <div style={{
            border: '1px dashed rgba(var(--overlay-rgb),0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
            color: 'rgba(var(--offwhite-rgb),0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          }}>
            No EOD reports for {rangeLabel} — {branchNames || 'no branch'}.
          </div>
        )}

        {!loading && loaded && !hasTipsData && reportCount > 0 && (
          <div style={{
            background: 'rgba(var(--brand-secondary-rgb),0.08)', border: '1px solid rgba(var(--brand-secondary-rgb),0.2)',
            borderRadius: '4px', padding: '1rem 1.25rem', marginBottom: '2rem',
            fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--brand-secondary)',
          }}>
            No tips data found for {rangeLabel}. Make sure tips are entered on the EOD form for each day.
          </div>
        )}

        {!loading && loaded && reportCount > 0 && (
          <>
            <ReportDownloads
              header={reportHeader('Tips', loaded.from, loaded.to, periods.map(p => p.branch), 'cashUp')}
              sheets={tipSheets(periods)}
            />
            <BranchTotals
              rows={periods.map(({ branch, period }) => ({ branch, totals: {
                pot: period.totalTipsUsd,
                deducted: period.deductedUsd,
                net: period.netTipsUsd,
                points: period.totalWeightedPoints,
              } }))}
              columns={[
                { key: 'pot', label: 'Pot', money: true },
                { key: 'deducted', label: 'Deducted', money: true },
                { key: 'net', label: 'Net', money: true },
                { key: 'points', label: 'Weighted points' },
              ]}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
              {periods.map(p => <PeriodCard key={p.branch} period={p.period} />)}
            </div>
          </>
        )}

      </div>
    </div>
  )
}

// ─── PeriodCard ───────────────────────────────────────────────────────────────

function PeriodCard({ period }: { period: PeriodResult }) {
  const isMobile = useIsMobile()
  const hasData = period.totalTipsUsd > 0 || period.staff.length > 0
  const staffGridCols = isMobile ? '1fr auto' : '1fr 110px 80px 110px'

  return (
    <div style={{
      background: 'rgba(var(--overlay-rgb),0.02)',
      border: '1px solid rgba(var(--overlay-rgb),0.07)',
      borderRadius: '6px',
      overflow: 'hidden',
    }}>
      {/* Card header */}
      <div style={{
        padding: '1rem 1.25rem',
        borderBottom: '1px solid rgba(var(--overlay-rgb),0.06)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem',
      }}>
        <div>
          <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1rem', color: 'var(--brand-secondary)', letterSpacing: '0.1em' }}>
            {period.label}
          </span>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.4)', marginLeft: '0.75rem' }}>
            {period.dateRange}
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(var(--offwhite-rgb),0.3)' }}>
          {period.reportCount} day{period.reportCount !== 1 ? 's' : ''} of data
        </span>
      </div>

      {/* Summary row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '0.1rem',
        borderBottom: '1px solid rgba(var(--overlay-rgb),0.06)',
      }}>
        <SummaryCell label="Total tips" value={formatUsd(period.totalTipsUsd)} dim={period.totalTipsUsd === 0} />
        <SummaryCell label={`After ${+(period.deductionRate * 100).toFixed(2)}% deduction`} value={formatUsd(period.netTipsUsd)} highlight />
        <SummaryCell label="Total shift points" value={String(period.totalShiftPoints)} dim={period.totalShiftPoints === 0} />
        <SummaryCell label="Tips per shift point" value={formatUsd(period.tipsPerPoint)} highlight={period.tipsPerPoint > 0} />
      </div>

      {/* Staff breakdown */}
      {period.staff.length === 0 && (
        <div style={{
          padding: '2rem', textAlign: 'center',
          color: 'rgba(var(--offwhite-rgb),0.2)', fontFamily: 'var(--font-inter)', fontSize: '0.82rem',
        }}>
          {!hasData ? 'No tips or attendance recorded for this period.' : 'No attendance recorded for this period.'}
        </div>
      )}

      {period.staff.length > 0 && (
        <div>
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: staffGridCols,
            padding: '0.55rem 1.25rem',
            fontFamily: 'var(--font-inter)', fontSize: '0.62rem',
            letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'rgba(var(--offwhite-rgb),0.3)',
            borderBottom: '1px solid rgba(var(--overlay-rgb),0.04)',
          }}>
            <span>Staff member</span>
            {!isMobile && <span style={{ textAlign: 'center' }}>AM/PM shifts</span>}
            {!isMobile && <span style={{ textAlign: 'center' }} title="Shift points times the person's tip weight, set on Staff Pay">Weighted points</span>}
            <span style={{ textAlign: 'right' }}>Tips earned</span>
          </div>

          {period.staff.map((s, idx) => {
            // Approximate AM/PM count from points: double shifts contribute 2 pts each,
            // but we only store aggregate points here — show points breakdown simply.
            return (
              <div key={s.name} style={{
                display: 'grid', gridTemplateColumns: staffGridCols,
                padding: '0.75rem 1.25rem', alignItems: 'center',
                borderTop: idx > 0 ? '1px solid rgba(var(--overlay-rgb),0.04)' : 'none',
              }}>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'var(--offwhite)' }}>
                  {s.name}
                  {isMobile && (
                    <span style={{ display: 'block', fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.4)', marginTop: '0.15rem' }}>
                      {s.shiftPoints} pt{s.shiftPoints !== 1 ? 's' : ''}
                    </span>
                  )}
                </span>
                {!isMobile && (
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.4)', textAlign: 'center' }}>
                    {/* Points ÷ 2 floors double shifts; remainder = singles */}
                    {s.shiftPoints} pt{s.shiftPoints !== 1 ? 's' : ''}
                  </span>
                )}
                {!isMobile && (
                  <span style={{
                    fontFamily: 'var(--font-inter)', fontSize: '0.88rem', fontWeight: 600,
                    color: 'var(--brand-secondary)', textAlign: 'center',
                  }}>
                    {/* Points × weight (T7.18): what the pot is split by. */}
                    {s.weightedPoints}
                  </span>
                )}
                <span style={{
                  fontFamily: 'var(--font-inter)', fontSize: '0.95rem', fontWeight: 700,
                  color: 'var(--teal)', textAlign: 'right',
                }}>
                  {formatUsd(s.earned)}
                </span>
              </div>
            )
          })}

          {/* Total row */}
          <div style={{
            display: 'grid', gridTemplateColumns: staffGridCols,
            padding: '0.75rem 1.25rem',
            borderTop: '1px solid rgba(var(--overlay-rgb),0.1)',
            background: 'rgba(var(--overlay-rgb),0.02)',
          }}>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.35)' }}>
              Total
            </span>
            {!isMobile && (
              <>
                <span />
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', fontWeight: 600, color: 'var(--brand-secondary)', textAlign: 'center' }}>
                  {period.totalWeightedPoints}
                </span>
              </>
            )}
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--teal)', textAlign: 'right' }}>
              {formatUsd(period.netTipsUsd)}
            </span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{
        padding: '0.65rem 1.25rem',
        borderTop: '1px solid rgba(var(--overlay-rgb),0.04)',
        background: 'rgba(0,0,0,0.2)',
        fontFamily: 'var(--font-inter)', fontSize: '0.65rem',
        color: 'rgba(var(--offwhite-rgb),0.2)', letterSpacing: '0.03em',
      }}>
        AM shift = 1 pt · PM shift = 1 pt · Double shift = 2 pts · Tips per point = net ÷ total points
      </div>
    </div>
  )
}

function SummaryCell({ label, value, highlight, dim }: { label: string; value: string; highlight?: boolean; dim?: boolean }) {
  return (
    <div style={{ padding: '0.9rem 1.25rem' }}>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.3)', marginBottom: '0.3rem' }}>
        {label}
      </p>
      <p style={{
        fontFamily: 'var(--font-inter)', fontSize: '1rem', fontWeight: 600,
        color: dim ? 'rgba(var(--offwhite-rgb),0.2)' : highlight ? 'var(--brand-secondary)' : 'var(--offwhite)',
      }}>
        {value}
      </p>
    </div>
  )
}
