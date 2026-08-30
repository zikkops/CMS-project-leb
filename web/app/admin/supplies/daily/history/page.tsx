'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { branchAbbrev } from '@big-cms/shared/branches'
import {
  INVENTORY_BRANCHES, DEPARTMENTS, listDailyInventories,
  type DailyInventoryReport,
} from '@big-cms/shared/dailyInventory'

const DEPT_COLOR: Record<string, string> = {
  Kitchen:  '#00A098',
  Bar:      '#C9962C',
  Cleaning: '#8B7CF6',
  Other:    'rgba(245,242,236,0.45)',
}

// branchAbbrev() derives these from the configured names and de-duplicates
// collisions, rather than a fixed table that only knew the original three.

const sel: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)',
  color: '#F5F2EC', borderRadius: '4px', padding: '0.5rem 0.7rem',
  fontSize: '0.82rem', outline: 'none', cursor: 'pointer', fontFamily: 'var(--font-inter)',
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function pad2(n: number) { return String(n).padStart(2, '0') }

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// Monday-first 7-wide grid, padded with nulls before day 1 and after the
// month's last day so every row has exactly 7 cells.
function buildMonthGrid(year: number, month: number): (string | null)[] {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7 // Sun=0..Sat=6 -> Mon=0..Sun=6
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${pad2(month + 1)}-${pad2(d)}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

const MONTH_LABEL = (year: number, month: number) =>
  new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })

export default function DailyInventoryHistoryPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.dailyInventoryHistory)
  const isMobile = useIsMobile()

  const now = new Date()
  const [viewYear,  setViewYear]  = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())

  const [branchFilter, setBranchFilter]         = useState<string>('all')
  const [departmentFilter, setDepartmentFilter] = useState<string>('all')

  const [reports, setReports] = useState<DailyInventoryReport[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)

  useEffect(() => {
    if (checking) return
    setLoading(true)
    // Fetched broadly (not scoped to the visible month) so switching months
    // is instant — a plain branch+orderBy(date) query needs no composite
    // index, unlike a branch+date-range query would.
    listDailyInventories(branchFilter === 'all' ? 'all' : branchFilter, 1000)
      .then(r => { setReports(r); setLoading(false) })
      .catch(() => setLoading(false))
  }, [checking, branchFilter])

  const byDate = useMemo(() => {
    const m = new Map<string, DailyInventoryReport[]>()
    for (const r of reports) {
      if (departmentFilter !== 'all' && r.department !== departmentFilter) continue
      if (!m.has(r.date)) m.set(r.date, [])
      m.get(r.date)!.push(r)
    }
    return m
  }, [reports, departmentFilter])

  const monthCells = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])

  function goPrevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) } else { setViewMonth(m => m - 1) }
  }
  function goNextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) } else { setViewMonth(m => m + 1) }
  }
  function goToday() { setViewYear(now.getFullYear()); setViewMonth(now.getMonth()) }

  if (checking) return null

  const today = todayStr()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>

        <a href="/admin/supplies/daily" style={{
          fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
          color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
          display: 'block', marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
        }}>← Daily Inventory Count</a>
        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
          Daily Inventory History
        </h1>
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.3)', marginBottom: '1.5rem' }}>
          Every branch&apos;s Kitchen, Bar, and Cleaning counts, by day. Hover a day for a quick look, click for the full detail.
        </p>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} style={sel}>
            <option value="all">All Branches</option>
            {INVENTORY_BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)} style={sel}>
            <option value="all">All Departments</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          {DEPARTMENTS.filter(d => d !== 'Other').map(d => (
            <div key={d} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: DEPT_COLOR[d], flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.4)' }}>{d}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '2px', border: '1px solid rgba(245,242,236,0.4)', flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.4)' }}>Draft (not submitted)</span>
          </div>
        </div>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <button onClick={goPrevMonth} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(245,242,236,0.5)', borderRadius: '4px', width: '32px', height: '32px', cursor: 'pointer', fontSize: '0.9rem' }}>‹</button>
          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem', color: 'var(--offwhite)', minWidth: '160px', textAlign: 'center' }}>
            {MONTH_LABEL(viewYear, viewMonth)}
          </p>
          <button onClick={goNextMonth} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(245,242,236,0.5)', borderRadius: '4px', width: '32px', height: '32px', cursor: 'pointer', fontSize: '0.9rem' }}>›</button>
          <button onClick={goToday} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(245,242,236,0.4)', borderRadius: '4px', padding: '0.4rem 0.9rem', cursor: 'pointer', fontSize: '0.72rem', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)' }}>Today</button>
        </div>

        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>Loading…</p>
        ) : (
          <>
            {/* Weekday header */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: isMobile ? '0.25rem' : '0.5rem', marginBottom: '0.4rem' }}>
              {WEEKDAYS.map(w => (
                <p key={w} style={{ fontFamily: 'var(--font-inter)', fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.25)', textAlign: 'center' }}>
                  {isMobile ? w.slice(0, 1) : w}
                </p>
              ))}
            </div>

            {/* Calendar grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: isMobile ? '0.25rem' : '0.5rem' }}>
              {monthCells.map((date, i) => {
                if (!date) return <div key={i} />
                const dayReports = byDate.get(date) ?? []
                const isToday = date === today
                const dayNum = parseInt(date.split('-')[2], 10)

                return (
                  <a
                    key={date}
                    href={`/admin/supplies/daily/history/${date}`}
                    onMouseEnter={() => setHoveredDate(date)}
                    onMouseLeave={() => setHoveredDate(null)}
                    style={{
                      position: 'relative',
                      display: 'block', textDecoration: 'none',
                      minHeight: isMobile ? '52px' : '78px',
                      background: dayReports.length > 0 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.01)',
                      border: `1px solid ${isToday ? 'var(--teal)' : 'rgba(255,255,255,0.06)'}`,
                      borderRadius: '6px', padding: isMobile ? '0.3rem' : '0.5rem',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: isToday ? 'var(--teal)' : 'rgba(245,242,236,0.35)', fontWeight: isToday ? 700 : 400 }}>
                      {dayNum}
                    </span>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', marginTop: '0.25rem' }}>
                      {dayReports.map(r => (
                        <span
                          key={r.id}
                          title={`${r.branch} · ${r.department} — ${r.status === 'submitted' ? 'Submitted' : 'Draft'}`}
                          style={{
                            fontSize: isMobile ? '0.45rem' : '0.55rem', fontWeight: 700,
                            fontFamily: 'var(--font-inter)', letterSpacing: '0.02em',
                            padding: isMobile ? '0.05rem 0.15rem' : '0.1rem 0.3rem',
                            borderRadius: '2px', lineHeight: 1.4,
                            color: r.status === 'submitted' ? '#000' : DEPT_COLOR[r.department],
                            background: r.status === 'submitted' ? DEPT_COLOR[r.department] : 'transparent',
                            border: r.status === 'submitted' ? 'none' : `1px solid ${DEPT_COLOR[r.department]}`,
                          }}
                        >{branchAbbrev(r.branch)}</span>
                      ))}
                    </div>

                    {/* Hover preview */}
                    {hoveredDate === date && dayReports.length > 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, zIndex: 30,
                        marginTop: '0.3rem', minWidth: '220px',
                        background: '#141414', border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '6px', padding: '0.65rem 0.8rem',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.4)', pointerEvents: 'none',
                      }}>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)', marginBottom: '0.4rem' }}>
                          {date}
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          {dayReports.map(r => (
                            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'var(--offwhite)' }}>
                                {r.branch} · <span style={{ color: DEPT_COLOR[r.department] }}>{r.department}</span>
                              </span>
                              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: r.status === 'submitted' ? 'var(--teal)' : '#C9962C' }}>
                                {r.status === 'submitted' ? 'Submitted' : 'Draft'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </a>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
