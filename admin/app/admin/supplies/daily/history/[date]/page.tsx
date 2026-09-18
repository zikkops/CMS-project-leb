'use client'

// One day's inventory counts, by branch and department — counted against what
// the system expected, in quantity and in money.
//
// "Expected" is the stock figure the server held for that branch at the moment
// the count was saved: the last count, plus deliveries since, minus what sales
// took off the shelf when the `recipes` switch deducts ingredients. Counted
// minus expected is the variance. With deduction off it is mostly usage; with
// it on, it is what sales do not explain — waste, a wrong recipe, or loss.
//
// Counts saved before 14 Sep 2026 stored only what was counted: the route kept
// supplyId and countedQty and nothing else, so this page used to show blank
// names and a difference of NaN for them. They now say plainly that the figure
// was not recorded. The arithmetic is countVariance() in shared/src/recipes.ts.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { listDailyInventoriesForDate, type DailyInventoryReport, type InventoryLine } from '@big-cms/shared/dailyInventory'
import { supplyCategoryColor } from '@big-cms/shared/departments'
import { countVariance } from '@big-cms/shared/recipes'
import { formatUsd } from '@big-cms/shared/money'
import { startLoad } from '@big-cms/shared/startLoad'

function variance(i: InventoryLine) {
  return countVariance(i.previousQty, i.countedQty ?? Number.NaN, i.unitCostUsd)
}

function discrepancyCount(r: DailyInventoryReport) {
  return r.items.filter(i => {
    const v = variance(i).varianceQty
    return v !== null && v !== 0
  }).length
}

/** The money off expected for a whole count, and how many lines could not be valued. */
function varianceValue(r: DailyInventoryReport): { usd: number; uncosted: number } {
  let usd = 0
  let uncosted = 0
  for (const i of r.items) {
    const v = variance(i)
    if (v.varianceQty === null || v.varianceQty === 0) continue
    if (v.varianceUsd === null) uncosted++
    else usd += v.varianceUsd
  }
  return { usd: Math.round(usd * 100) / 100, uncosted }
}

/** Whether this count predates expected figures being stored. */
function lacksExpected(r: DailyInventoryReport) {
  return r.items.length > 0 && r.items.every(i => typeof i.previousQty !== 'number')
}

const signedUsd = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatUsd(Math.abs(n))}`
const qty = (n: number) => String(Number(n.toFixed(3)))
const signedQty = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${qty(Math.abs(n))}`

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
    let alive = true
    startLoad(() => {
      if (!alive) return
      setLoading(true)
      return listDailyInventoriesForDate(date)
        .then(r => {
          if (!alive) return
          r.sort((a, b) => a.branch.localeCompare(b.branch) || a.department.localeCompare(b.department))
          setReports(r)
          setLoading(false)
        })
        .catch(() => { if (alive) setLoading(false) })
    })
    return () => { alive = false }
  }, [checking, date])

  if (checking) return null

  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto' }}>

        <Link href="/admin/supplies/daily/history" style={{
          fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
          color: 'rgba(var(--offwhite-rgb),0.3)', textDecoration: 'none',
          display: 'block', marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
        }}>← Calendar</Link>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.4rem' : '1.8rem', color: 'var(--offwhite)' }}>
            {dateLabel}
          </h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <a href={`/admin/supplies/daily/history/${shiftDate(date, -1)}`} style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(var(--offwhite-rgb),0.5)',
              borderRadius: '4px', padding: '0.4rem 0.8rem', fontSize: '0.75rem', textDecoration: 'none', fontFamily: 'var(--font-inter)',
            }}>‹ Prev day</a>
            <a href={`/admin/supplies/daily/history/${shiftDate(date, 1)}`} style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(var(--offwhite-rgb),0.5)',
              borderRadius: '4px', padding: '0.4rem 0.8rem', fontSize: '0.75rem', textDecoration: 'none', fontFamily: 'var(--font-inter)',
            }}>Next day ›</a>
          </div>
        </div>

        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.74rem', color: 'rgba(var(--offwhite-rgb),0.35)', lineHeight: 1.6, maxWidth: '640px', marginBottom: '1.5rem' }}>
          Expected is what the system held when the count was saved: the last count, plus deliveries, minus what
          sales used when ingredient deduction is on. Variance is counted minus expected, valued at what a unit cost that day.
        </p>

        {loading ? (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>Loading…</p>
        ) : reports.length === 0 ? (
          <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px', padding: '3rem', textAlign: 'center', color: 'rgba(var(--offwhite-rgb),0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>
            No inventory counts started or submitted for this day.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {reports.map(r => {
              const expanded = expandedId === r.id
              const legacy = lacksExpected(r)
              const discrepancies = discrepancyCount(r)
              const value = varianceValue(r)
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
                        color: supplyCategoryColor(r.department),
                      }}>{r.department}</span>
                      <span style={{
                        fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.05em', textTransform: 'uppercase',
                        color: r.status === 'submitted' ? 'var(--teal)' : 'var(--brand-secondary)',
                      }}>{r.status === 'submitted' ? 'Submitted' : 'Draft'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.35)' }}>{r.submittedByEmail}</span>
                      {r.status === 'submitted' && (
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: legacy ? 'rgba(var(--offwhite-rgb),0.3)' : discrepancies > 0 ? 'var(--brand-secondary)' : 'rgba(var(--offwhite-rgb),0.3)' }}>
                          {legacy
                            ? 'no expected figures'
                            : discrepancies > 0
                              ? `${discrepancies} off expected${value.usd !== 0 ? ` · ${signedUsd(value.usd)}` : ''}${value.uncosted > 0 ? ` · ${value.uncosted} uncosted` : ''}`
                              : 'matched expected'}
                        </span>
                      )}
                      <span style={{ color: 'rgba(var(--offwhite-rgb),0.25)' }}>{expanded ? '▾' : '▸'}</span>
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
                      {legacy && (
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.4)', lineHeight: 1.6, marginBottom: '0.75rem' }}>
                          This count was saved before item names and expected figures were stored with it, so only
                          what was counted is shown. Counts saved from now on carry both.
                        </p>
                      )}
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '520px' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                              {['Item', 'Unit', 'Expected', 'Counted', 'Variance', 'Value'].map(h => (
                                <th key={h} style={{
                                  padding: '0.5rem 0.85rem', textAlign: h === 'Item' ? 'left' : 'right',
                                  fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                                  color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)',
                                }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {r.items.map(i => {
                              const v = variance(i)
                              const off = v.varianceQty !== null && v.varianceQty !== 0
                              return (
                                <tr key={i.supplyId} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                  <td style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem', color: i.name ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)' }}>
                                    {i.name || 'Name not recorded'}
                                    {i.nameAr && <span dir="rtl" style={{ display: 'block', fontSize: '0.7rem', color: 'rgba(var(--brand-secondary-rgb),0.75)', marginTop: '0.1rem' }}>{i.nameAr}</span>}
                                  </td>
                                  <td style={{ padding: '0.5rem 0.85rem', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.4)', fontFamily: 'var(--font-inter)', textAlign: 'right' }}>{i.unit || '—'}</td>
                                  <td style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.5)', fontFamily: 'var(--font-inter)', textAlign: 'right' }}>
                                    {typeof i.previousQty === 'number' ? qty(i.previousQty) : '—'}
                                  </td>
                                  <td style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem', fontWeight: 600, color: i.countedQty == null ? 'rgba(var(--offwhite-rgb),0.2)' : 'var(--offwhite)', fontFamily: 'var(--font-inter)', textAlign: 'right' }}>
                                    {i.countedQty == null ? '—' : qty(i.countedQty)}
                                  </td>
                                  <td style={{
                                    padding: '0.5rem 0.85rem', fontSize: '0.78rem', fontWeight: 700, fontFamily: 'var(--font-inter)', textAlign: 'right',
                                    color: !off ? 'rgba(var(--offwhite-rgb),0.25)' : (v.varianceQty as number) < 0 ? 'var(--red)' : 'var(--teal)',
                                  }}>
                                    {v.varianceQty === null ? '—' : v.varianceQty === 0 ? '0' : signedQty(v.varianceQty)}
                                  </td>
                                  <td style={{
                                    padding: '0.5rem 0.85rem', fontSize: '0.78rem', fontFamily: 'var(--font-inter)', textAlign: 'right',
                                    color: !off ? 'rgba(var(--offwhite-rgb),0.25)' : v.varianceUsd === null ? 'rgba(var(--offwhite-rgb),0.35)' : v.varianceUsd < 0 ? 'var(--red)' : 'var(--teal)',
                                  }}>
                                    {!off ? '—' : v.varianceUsd === null ? 'uncosted' : signedUsd(v.varianceUsd)}
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
