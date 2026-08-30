'use client'

import { useEffect, useMemo, useState } from 'react'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRANCHES } from '@big-cms/shared/branches'
import { listEndOfDayReports, formatUsd, type EndOfDayReport } from '@big-cms/shared/endOfDay'

const DEDUCTION = 0.11  // 11% taken off the top before distribution

const inp: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#F5F2EC',
  padding: '0.6rem 0.8rem',
  borderRadius: '2px',
  fontSize: '0.88rem',
  outline: 'none',
  fontFamily: 'var(--font-inter)',
}

const selStyle: React.CSSProperties = { ...inp, backgroundColor: '#1a1a1a', cursor: 'pointer' }

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)',
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
  staff: StaffTip[]
}

function buildPeriod(label: string, dateRange: string, reports: EndOfDayReport[]): PeriodResult {
  const totalTipsUsd = reports.reduce((s, r) => s + (Number(r.tipsUsd) || 0), 0)
  const netTipsUsd   = totalTipsUsd * (1 - DEDUCTION)

  const map = new Map<string, number>()
  for (const r of reports) {
    for (const a of r.attendance) {
      if (a.shift === 'none') continue
      const pts = a.shift === 'double' ? 2 : 1
      map.set(a.name, (map.get(a.name) ?? 0) + pts)
    }
  }

  const totalShiftPoints = [...map.values()].reduce((s, v) => s + v, 0)
  const tipsPerPoint = totalShiftPoints > 0 ? netTipsUsd / totalShiftPoints : 0

  const staff = [...map.entries()]
    .map(([name, shiftPoints]) => ({ name, shiftPoints, earned: shiftPoints * tipsPerPoint }))
    .sort((a, b) => b.earned - a.earned)

  return { label, dateRange, reportCount: reports.length, totalTipsUsd, netTipsUsd, totalShiftPoints, tipsPerPoint, staff }
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function TipsCalculatorPage() {
  const isMobile = useIsMobile()
  const { checking, role, branchIds } = useRequireRole(SECTION_ACCESS.endOfDay)

  const branchOptions = role === 'admin' ? [...BRANCHES] : branchIds

  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [branch,  setBranch]  = useState('')
  const [month,   setMonth]   = useState(defaultMonth)
  const [reports, setReports] = useState<EndOfDayReport[]>([])
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')

  useEffect(() => {
    if (checking) return
    if (role !== 'admin' && branchIds.length === 1) setBranch(branchIds[0])
  }, [checking, role, branchIds])

  useEffect(() => {
    if (!branch) return
    setLoading(true); setErr('')
    // Load up to 400 reports for the branch, filter by month client-side
    listEndOfDayReports(branch, 400)
      .then(data => { setReports(data); setLoading(false) })
      .catch(() => { setErr('Failed to load reports.'); setLoading(false) })
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

  const p1 = buildPeriod('Period 1', `1–15 ${monthLabel}`, period1Reports)
  const p2 = buildPeriod('Period 2', `16–${lastDay} ${monthLabel}`, period2Reports)

  const hasTipsData = monthReports.some(r => (r.tipsUsd || 0) > 0)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin/end-of-day/history" style={{
            fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
            display: 'block', marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
          }}>← EOD History</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
            Tips Calculator
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)' }}>
            Monthly tip distribution by shift — 11% deducted, remainder split by shift points
          </p>
        </div>

        {/* Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1.5rem', marginBottom: '2.5rem', maxWidth: '480px' }}>
          <div>
            <label style={labelStyle}>Branch</label>
            {branchOptions.length === 1 ? (
              <div style={{ ...inp, display: 'inline-block' }}>{branch || branchOptions[0]}</div>
            ) : (
              <select value={branch} onChange={e => setBranch(e.target.value)} style={selStyle}>
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
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        )}
        {err && (
          <p style={{ color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>{err}</p>
        )}

        {!loading && branch && monthReports.length === 0 && (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
            color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          }}>
            No EOD reports for {monthLabel} — {branch}.
          </div>
        )}

        {!loading && branch && !hasTipsData && monthReports.length > 0 && (
          <div style={{
            background: 'rgba(201,150,44,0.08)', border: '1px solid rgba(201,150,44,0.2)',
            borderRadius: '4px', padding: '1rem 1.25rem', marginBottom: '2rem',
            fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: '#C9962C',
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
          <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1rem', color: '#C9962C', letterSpacing: '0.1em' }}>
            {period.label}
          </span>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.4)', marginLeft: '0.75rem' }}>
            {period.dateRange}
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.3)' }}>
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
        <SummaryCell label="After 11% deduction" value={formatUsd(period.netTipsUsd)} highlight />
        <SummaryCell label="Total shift points" value={String(period.totalShiftPoints)} dim={period.totalShiftPoints === 0} />
        <SummaryCell label="Tips per shift point" value={formatUsd(period.tipsPerPoint)} highlight={period.tipsPerPoint > 0} />
      </div>

      {/* Staff breakdown */}
      {period.staff.length === 0 && (
        <div style={{
          padding: '2rem', textAlign: 'center',
          color: 'rgba(245,242,236,0.2)', fontFamily: 'var(--font-inter)', fontSize: '0.82rem',
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
            color: 'rgba(245,242,236,0.3)',
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
                    <span style={{ display: 'block', fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)', marginTop: '0.15rem' }}>
                      {s.shiftPoints} pt{s.shiftPoints !== 1 ? 's' : ''}
                    </span>
                  )}
                </span>
                {!isMobile && (
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.4)', textAlign: 'center' }}>
                    {/* Points ÷ 2 floors double shifts; remainder = singles */}
                    {s.shiftPoints} pt{s.shiftPoints !== 1 ? 's' : ''}
                  </span>
                )}
                {!isMobile && (
                  <span style={{
                    fontFamily: 'var(--font-inter)', fontSize: '0.88rem', fontWeight: 600,
                    color: '#C9962C', textAlign: 'center',
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
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)' }}>
              Total
            </span>
            {!isMobile && (
              <>
                <span />
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', fontWeight: 600, color: '#C9962C', textAlign: 'center' }}>
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
        color: 'rgba(245,242,236,0.2)', letterSpacing: '0.03em',
      }}>
        AM shift = 1 pt · PM shift = 1 pt · Double shift = 2 pts · Tips per point = net ÷ total points
      </div>
    </div>
  )
}

function SummaryCell({ label, value, highlight, dim }: { label: string; value: string; highlight?: boolean; dim?: boolean }) {
  return (
    <div style={{ padding: '0.9rem 1.25rem' }}>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', marginBottom: '0.3rem' }}>
        {label}
      </p>
      <p style={{
        fontFamily: 'var(--font-inter)', fontSize: '1rem', fontWeight: 600,
        color: dim ? 'rgba(245,242,236,0.2)' : highlight ? '#C9962C' : 'var(--offwhite)',
      }}>
        {value}
      </p>
    </div>
  )
}
