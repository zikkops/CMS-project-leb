'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useRequireRole, SECTION_ACCESS } from '../../../../../lib/adminAuth'
import { useIsMobile } from '../../../../../lib/useIsMobile'
import { listDailyInventoriesForDate, type DailyInventoryReport } from '../../../../../lib/dailyInventory'

const DEPT_COLOR: Record<string, string> = {
  Kitchen:  '#00A098',
  Bar:      '#C9962C',
  Cleaning: '#8B7CF6',
  Other:    'rgba(245,242,236,0.45)',
}

function discrepancyCount(r: DailyInventoryReport) {
  return r.items.filter(i => i.countedQty != null && i.countedQty !== i.previousQty).length
}

function shiftDate(date: string, delta: number) {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function DailyInventoryDayPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.dailyInventoryHistory)
  const isMobile = useIsMobile()
  const params = useParams<{ date: string }>()
  const date = params.date

  const [reports, setReports] = useState<DailyInventoryReport[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (checking || !date) return
    setLoading(true)
    listDailyInventoriesForDate(date)
      .then(r => {
        r.sort((a, b) => a.branch.localeCompare(b.branch) || a.department.localeCompare(b.department))
        setReports(r)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [checking, date])

  if (checking) return null

  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto' }}>

        <Link href="/admin/supplies/daily/history" style={{
          fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
          color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
          display: 'block', marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
        }}>← Calendar</Link>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.75rem' }}>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.4rem' : '1.8rem', color: 'var(--offwhite)' }}>
            {dateLabel}
          </h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <a href={`/admin/supplies/daily/history/${shiftDate(date, -1)}`} style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(245,242,236,0.5)',
              borderRadius: '4px', padding: '0.4rem 0.8rem', fontSize: '0.75rem', textDecoration: 'none', fontFamily: 'var(--font-inter)',
            }}>‹ Prev day</a>
            <a href={`/admin/supplies/daily/history/${shiftDate(date, 1)}`} style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(245,242,236,0.5)',
              borderRadius: '4px', padding: '0.4rem 0.8rem', fontSize: '0.75rem', textDecoration: 'none', fontFamily: 'var(--font-inter)',
            }}>Next day ›</a>
          </div>
        </div>

        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>Loading…</p>
        ) : reports.length === 0 ? (
          <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px', padding: '3rem', textAlign: 'center', color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>
            No inventory counts started or submitted for this day.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {reports.map(r => {
              const expanded = expandedId === r.id
              const discrepancies = discrepancyCount(r)
              return (
                <div key={r.id} style={{
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '6px', overflow: 'hidden',
                }}>
                  <div
                    onClick={() => setExpandedId(v => v === r.id ? null : r.id)}
                    style={{
                      padding: '0.9rem 1.1rem', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.95rem', color: 'var(--offwhite)' }}>{r.branch}</span>
                      <span style={{
                        fontFamily: 'var(--font-inter)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase',
                        color: DEPT_COLOR[r.department] ?? 'rgba(245,242,236,0.5)',
                      }}>{r.department}</span>
                      <span style={{
                        fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.05em', textTransform: 'uppercase',
                        color: r.status === 'submitted' ? 'var(--teal)' : '#C9962C',
                      }}>{r.status === 'submitted' ? 'Submitted' : 'Draft'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.35)' }}>{r.submittedByEmail}</span>
                      {r.status === 'submitted' && (
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: discrepancies > 0 ? '#C9962C' : 'rgba(245,242,236,0.3)' }}>
                          {discrepancies > 0 ? `${discrepancies} changed` : 'matched'}
                        </span>
                      )}
                      <span style={{ color: 'rgba(245,242,236,0.25)' }}>{expanded ? '▾' : '▸'}</span>
                    </div>
                  </div>

                  {expanded && (
                    <div style={{ padding: '0 1.1rem 1.1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ margin: '0.75rem 0' }}>
                        <a
                          href={`/admin/supplies/daily?branch=${encodeURIComponent(r.branch)}&department=${encodeURIComponent(r.department)}&date=${r.date}`}
                          style={{ fontSize: '0.72rem', color: '#6A9E5A', textDecoration: 'none', fontFamily: 'var(--font-inter)' }}
                        >Open in Daily Count →</a>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '420px' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                              {['Item', 'Unit', 'Last Count', 'New Count', 'Δ'].map(h => (
                                <th key={h} style={{
                                  padding: '0.5rem 0.85rem', textAlign: h === 'Item' ? 'left' : 'right',
                                  fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                                  color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)',
                                }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {r.items.map(i => {
                              const delta = i.countedQty == null ? null : i.countedQty - i.previousQty
                              return (
                                <tr key={i.supplyId} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                  <td style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem', color: 'var(--offwhite)', fontFamily: 'var(--font-inter)' }}>
                                    {i.name}
                                    {i.nameAr && <span dir="rtl" style={{ display: 'block', fontSize: '0.7rem', color: 'rgba(201,150,44,0.75)', marginTop: '0.1rem' }}>{i.nameAr}</span>}
                                  </td>
                                  <td style={{ padding: '0.5rem 0.85rem', fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)', textAlign: 'right' }}>{i.unit}</td>
                                  <td style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem', color: 'rgba(245,242,236,0.5)', fontFamily: 'var(--font-inter)', textAlign: 'right' }}>{i.previousQty}</td>
                                  <td style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem', fontWeight: 600, color: i.countedQty == null ? 'rgba(245,242,236,0.2)' : 'var(--offwhite)', fontFamily: 'var(--font-inter)', textAlign: 'right' }}>
                                    {i.countedQty == null ? '—' : i.countedQty}
                                  </td>
                                  <td style={{
                                    padding: '0.5rem 0.85rem', fontSize: '0.78rem', fontWeight: 700, fontFamily: 'var(--font-inter)', textAlign: 'right',
                                    color: delta == null || delta === 0 ? 'rgba(245,242,236,0.25)' : delta < 0 ? 'var(--red)' : 'var(--teal)',
                                  }}>
                                    {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}`}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
