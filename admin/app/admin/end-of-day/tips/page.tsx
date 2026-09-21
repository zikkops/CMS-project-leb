'use client'

import { useEffect, useState } from 'react'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRANCHES } from '@big-cms/shared/branches'
import { listEndOfDayReports, formatUsd, type EndOfDayReport } from '@big-cms/shared/endOfDay'
import { todayYmd } from '@big-cms/shared/dates'
import { BRAND } from '@big-cms/shared/brand'
import { useBusinessSettings } from '@big-cms/shared/useBusinessSettings'
import { distributeTips } from '@big-cms/shared/tips'

// The deduction is a SETTING. It used to be `const DEDUCTION = 0.11` right
// here, which meant the rate on the Business Settings form did nothing at all:
// a manager could change it, see it saved, and every payout would still come
// out at 11%. See the note at the top of shared/src/tips.ts.

const inp: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: 'var(--offwhite)',
  padding: '0.6rem 0.8rem',
  borderRadius: '2px',
  fontSize: '0.88rem',
  outline: 'none',
  fontFamily: 'var(--font-inter)',
}

const selStyle: React.CSSProperties = { ...inp, backgroundColor: '#1a1a1a', cursor: 'pointer' }

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.35)',
  marginBottom: '0.4rem', fontFamily: 'var(--font-inter)',
}

// ─── computation ─────────────────────────────────────────────────────────────

interface StaffTip { name: string; shiftPoints: number; earned: number }

interface PeriodResult {
  label: string
  dateRange: string
  reportCount: number
  totalTipsUsd: number
  netTipsUsd: number
  totalShiftPoints: number
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
): PeriodResult {
  // The arithmetic is shared/src/tips.ts, asserted by npm run verify:tips —
  // including that the shares add up to the pot to the cent, which this page's
  // version did not: it multiplied an unrounded per-point figure per person
  // and let the remainder evaporate.
  const d = distributeTips(
    // The jar, and what was tipped on cards at the till (UPGRADE.md T3.9).
    reports.reduce((s, r) => s + (Number(r.tipsUsd) || 0) + (Number(r.cardTipsUsd) || 0), 0),
    deductionRate,
    reports.flatMap(r => r.attendance.map(a => ({ name: a.name, shift: a.shift }))),
  )

  return {
    label,
    dateRange,
    reportCount: reports.length,
    totalTipsUsd: d.totalTipsUsd,
    netTipsUsd: d.netTipsUsd,
    totalShiftPoints: d.totalShiftPoints,
    tipsPerPoint: d.perPoint,
    deductionRate: d.deductionRate,
    staff: d.staff,
  }
}

// ─── page ─────────────────────────────────────────────────────────────────────

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

  // The café's month, not the viewer's. getFullYear()/getMonth() read whoever
  // is looking — a manager abroad, or anybody at all just after midnight on the
  // first — and this page divides a month into two pay periods, so landing on
  // the wrong one is not cosmetic. Same rule as everywhere else in the repo.
  const defaultMonth = todayYmd(BRAND.locale.timezone).slice(0, 7)

  const [chosenBranch, setChosenBranch] = useState('')
  const [month,   setMonth]   = useState(defaultMonth)
  const [reports, setReports] = useState<EndOfDayReport[]>([])
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')

  // Derived, not seeded by an effect. Setting state during an effect to supply
  // a default renders once with nothing selected and again with the default —
  // and React flags it, because that is a cascading render for a value that
  // was always computable.
  const branch = chosenBranch || (role !== 'admin' && branchIds.length === 1 ? branchIds[0] : '')

  useEffect(() => {
    if (!branch) return
    // `alive` is not ceremony. Switching branch twice quickly can land the
    // first answer after the second, and the screen would then show one
    // branch's reports under another branch's name — with tips computed from
    // them. The guard drops any answer that arrives after its question stopped
    // being the question.
    let alive = true
    void (async () => {
      setLoading(true)
      setErr('')
      try {
        // Up to 400 reports for the branch; the month is filtered below.
        const data = await listEndOfDayReports(branch, 400)
        if (alive) setReports(data)
      } catch {
        if (alive) setErr('Failed to load reports.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [branch])

  if (checking) return null

  // Filter to the selected month and split into two periods
  const monthStr  = month  // 'YYYY-MM'
  const monthReports = reports.filter(r => r.date.startsWith(monthStr))

  const period1Reports = monthReports.filter(r => parseInt(r.date.split('-')[2]) <= 15)
  const period2Reports = monthReports.filter(r => parseInt(r.date.split('-')[2]) >= 16)

  const [yearStr, monthNumStr] = month.split('-')
  const monthLabel = new Date(parseInt(yearStr), parseInt(monthNumStr) - 1, 1)
    .toLocaleString('en-US', { month: 'long', year: 'numeric' })

  const lastDay = new Date(parseInt(yearStr), parseInt(monthNumStr), 0).getDate()

  const p1 = buildPeriod('Period 1', `1–15 ${monthLabel}`, period1Reports, deductionRate)
  const p2 = buildPeriod('Period 2', `16–${lastDay} ${monthLabel}`, period2Reports, deductionRate)

  const hasTipsData = monthReports.some(r => (r.tipsUsd || 0) > 0)

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
            Monthly tip distribution by shift — {deductionPct} deducted, remainder split by shift points
          </p>
        </div>

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1.5rem', marginBottom: '2.5rem', maxWidth: '480px' }}>
          <div>
            <label style={labelStyle}>Branch</label>
            {branchOptions.length === 1 ? (
              <div style={{ ...inp, display: 'inline-block' }}>{branch || branchOptions[0]}</div>
            ) : (
              <select value={branch} onChange={e => setChosenBranch(e.target.value)} style={selStyle}>
                <option value="">— Select —</option>
                {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </div>
          <div>
            <label style={labelStyle}>Month</label>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              style={inp}
            />
          </div>
        </div>

        {loading && (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        )}
        {err && (
          <p style={{ color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>{err}</p>
        )}

        {!loading && branch && monthReports.length === 0 && (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
            color: 'rgba(var(--offwhite-rgb),0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          }}>
            No EOD reports for {monthLabel} — {branch}.
          </div>
        )}

        {!loading && branch && !hasTipsData && monthReports.length > 0 && (
          <div style={{
            background: 'rgba(var(--brand-secondary-rgb),0.08)', border: '1px solid rgba(var(--brand-secondary-rgb),0.2)',
            borderRadius: '4px', padding: '1rem 1.25rem', marginBottom: '2rem',
            fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--brand-secondary)',
          }}>
            No tips data found for {monthLabel}. Make sure tips are entered on the EOD form for each day.
          </div>
        )}

        {!loading && branch && monthReports.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
            <PeriodCard period={p1} />
            <PeriodCard period={p2} />
          </div>
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
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: '6px',
      overflow: 'hidden',
    }}>
      {/* Card header */}
      <div style={{
        padding: '1rem 1.25rem',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
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
        borderBottom: '1px solid rgba(255,255,255,0.06)',
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
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}>
            <span>Staff member</span>
            {!isMobile && <span style={{ textAlign: 'center' }}>AM/PM shifts</span>}
            {!isMobile && <span style={{ textAlign: 'center' }}>Points</span>}
            <span style={{ textAlign: 'right' }}>Tips earned</span>
          </div>

          {period.staff.map((s, idx) => {
            // Approximate AM/PM count from points: double shifts contribute 2 pts each,
            // but we only store aggregate points here — show points breakdown simply.
            return (
              <div key={s.name} style={{
                display: 'grid', gridTemplateColumns: staffGridCols,
                padding: '0.75rem 1.25rem', alignItems: 'center',
                borderTop: idx > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
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
                    {s.shiftPoints}
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
            borderTop: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.02)',
          }}>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.35)' }}>
              Total
            </span>
            {!isMobile && (
              <>
                <span />
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', fontWeight: 600, color: 'var(--brand-secondary)', textAlign: 'center' }}>
                  {period.totalShiftPoints}
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
        borderTop: '1px solid rgba(255,255,255,0.04)',
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
