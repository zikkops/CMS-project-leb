'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import { useIsMobile } from '../../../lib/useIsMobile'
import {
  INVENTORY_BRANCHES, DEPARTMENTS, todayDateStr, listSuppliesForCount, emptyInventoryReport,
  getDailyInventory, saveDailyInventoryDraft, submitDailyInventory, listDailyInventories,
  type SupplyForCount, type InventoryLine, type DailyInventoryReport,
} from '../../../lib/dailyInventory'

const DEPT_COLOR: Record<string, string> = {
  Kitchen:  '#00A098',
  Bar:      '#C9962C',
  Cleaning: '#8B7CF6',
  Other:    'rgba(245,242,236,0.45)',
}

const BRANCH_COLOR: Record<string, string> = {
  Beirut:    '#00A098',
  Zouk:      '#C9962C',
  Broummana: '#8B7CF6',
}

const inp: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#F5F2EC', borderRadius: '4px', padding: '0.5rem 0.7rem',
  fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'var(--font-inter)',
}

function DailyInventoryInner() {
  const params = useSearchParams()
  const { checking, role, branchIds, orderDepts, user } = useRequireRole(SECTION_ACCESS.dailyInventory)
  const isMobile = useIsMobile()

  const branchOptions = useMemo(
    () => role === 'admin' ? [...INVENTORY_BRANCHES] : branchIds.filter(b => (INVENTORY_BRANCHES as readonly string[]).includes(b)),
    [role, branchIds],
  )

  // Reuses the same orderDepts concept the Weekly Orders submit form already
  // scopes by role (kitchen_crew -> Kitchen, barista -> Bar, admin/manager ->
  // all three) — admin/manager additionally get 'Other' since they're the
  // only roles meant to review odds-and-ends items outside the three depts.
  const departmentOptions = useMemo(() => {
    const base = orderDepts.filter(d => (DEPARTMENTS as readonly string[]).includes(d))
    const withOther = (role === 'admin' || role === 'manager') && !base.includes('Other') ? [...base, 'Other'] : base
    return withOther.length > 0 ? withOther : [...DEPARTMENTS]
  }, [orderDepts, role])

  const [branch,     setBranch]     = useState('')
  const [department, setDepartment] = useState('')
  const [date,        setDate]      = useState(todayDateStr())

  const [supplies, setSupplies] = useState<SupplyForCount[]>([])
  const [loadingSupplies, setLoadingSupplies] = useState(true)

  const [report,  setReport]  = useState<DailyInventoryReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [counts,  setCounts]  = useState<Record<string, string>>({})
  const [search,  setSearch]  = useState('')

  const [saving,   setSaving]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saved,    setSaved]    = useState<'draft' | 'submitted' | null>(null)
  const [err,      setErr]      = useState('')

  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<DailyInventoryReport[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const canReview = role === 'admin' || role === 'manager'

  useEffect(() => {
    if (branchOptions.length === 1) setBranch(branchOptions[0])
  }, [branchOptions])

  useEffect(() => {
    if (departmentOptions.length === 1) setDepartment(departmentOptions[0])
  }, [departmentOptions])

  // Prefill from URL params (e.g. an "Open in Daily Count →" link from the
  // history sheet) — only allow a branch the user actually has access to.
  useEffect(() => {
    if (checking) return
    const pb = params.get('branch')
    const pdept = params.get('department')
    const pd = params.get('date')
    if (pb && branchOptions.includes(pb)) setBranch(pb)
    if (pdept && departmentOptions.includes(pdept)) setDepartment(pdept)
    if (pd) setDate(pd)
  }, [params, checking, branchOptions, departmentOptions])

  useEffect(() => {
    listSuppliesForCount().then(s => { setSupplies(s); setLoadingSupplies(false) })
  }, [])

  const items = useMemo(
    () => supplies.filter(s => s.category === department),
    [supplies, department],
  )

  useEffect(() => {
    if (!branch || !department || !date || loadingSupplies) return
    let cancelled = false
    setLoading(true)
    setSaved(null)
    setErr('')
    getDailyInventory(branch, date, department).then(existing => {
      if (cancelled) return
      const base = existing ?? emptyInventoryReport(branch, date, department, supplies, user?.uid ?? '', user?.email ?? '')
      setReport(base)
      setCounts(Object.fromEntries(base.items.map(i => [i.supplyId, i.countedQty == null ? '' : String(i.countedQty)])))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [branch, department, date, loadingSupplies, supplies, user])

  useEffect(() => {
    if (!canReview || !branch || !showHistory) return
    setHistoryLoading(true)
    listDailyInventories(branch, 30).then(h => { setHistory(h); setHistoryLoading(false) })
  }, [canReview, branch, showHistory])

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? items.filter(s => s.name.toLowerCase().includes(q)) : items
  }, [items, search])

  const countedCount = items.filter(s => (counts[s.id] ?? '') !== '').length
  const allCounted = items.length > 0 && countedCount === items.length

  function buildItems(): InventoryLine[] {
    return items.map(s => {
      const v = counts[s.id]
      const n = v === '' || v === undefined ? null : Number(v)
      return {
        supplyId: s.id, name: s.name, nameAr: s.nameAr, category: s.category, unit: s.unit,
        previousQty: s.quantity[branch] ?? 0,
        countedQty: n == null || isNaN(n) ? null : n,
      }
    })
  }

  async function handleSaveDraft() {
    if (!report || !user) return
    setSaving(true); setErr('')
    try {
      const next = { ...report, items: buildItems() }
      await saveDailyInventoryDraft(next)
      setReport(next)
      setSaved('draft')
    } catch {
      setErr('Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit() {
    if (!report || !user || !allCounted) return
    setSubmitting(true); setErr('')
    try {
      const next = { ...report, items: buildItems() }
      await submitDailyInventory(next)
      setReport(next)
      setSaved('submitted')
      setSupplies(prev => prev.map(s => {
        const line = next.items.find(i => i.supplyId === s.id)
        if (!line || line.countedQty == null) return s
        return { ...s, quantity: { ...s.quantity, [branch]: line.countedQty } }
      }))
    } catch {
      setErr('Submit failed — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) return null

  if (branchOptions.length === 0) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <p style={{ color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)', fontSize: '0.88rem', textAlign: 'center' }}>
          No branch assigned for inventory counts.
        </p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem 1rem 6rem' : '2rem 1.5rem 6rem' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '1.75rem' }}>
          <a href="/admin/supplies" style={{
            fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
            marginBottom: '0.5rem', display: 'block', fontFamily: 'var(--font-inter)',
          }}>← Inventory Management</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
            Daily Inventory Count
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.3)' }}>
            Kitchen, Bar, and Cleaning are counted separately — pick a department below, count what&apos;s actually on the shelf, and submit.
          </p>
        </div>

        {/* Branch + Date */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)', marginBottom: '0.4rem', fontFamily: 'var(--font-inter)' }}>Branch</label>
            {branchOptions.length === 1 ? (
              <div style={{ ...inp, display: 'inline-block', color: BRANCH_COLOR[branch] ?? '#F5F2EC', fontWeight: 600 }}>{branch}</div>
            ) : (
              <select value={branch} onChange={e => setBranch(e.target.value)} style={{ ...inp, width: '100%', background: '#1a1a1a', cursor: 'pointer' }}>
                <option value="">— Select Branch —</option>
                {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)', marginBottom: '0.4rem', fontFamily: 'var(--font-inter)' }}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, width: '100%' }} />
          </div>
        </div>

        {/* Department tabs */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)', marginBottom: '0.5rem', fontFamily: 'var(--font-inter)' }}>Department</label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {departmentOptions.map(d => (
              <button key={d} onClick={() => setDepartment(d)} style={{
                background: department === d ? `${DEPT_COLOR[d]}18` : 'transparent',
                border: `1px solid ${department === d ? DEPT_COLOR[d] : 'rgba(255,255,255,0.09)'}`,
                color: department === d ? DEPT_COLOR[d] : 'rgba(245,242,236,0.35)',
                borderRadius: '6px', padding: '0.5rem 1.25rem',
                fontSize: '0.78rem', fontWeight: department === d ? 600 : 400,
                letterSpacing: '0.06em', cursor: 'pointer', fontFamily: 'var(--font-inter)',
              }}>{d}</button>
            ))}
          </div>
        </div>

        {!branch || !department ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>
            Select a branch and department to begin.
          </p>
        ) : loading || loadingSupplies ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>Loading…</p>
        ) : (
          <>
            {/* Status banner */}
            {report?.status === 'submitted' && saved !== 'draft' && (
              <div style={{
                background: 'rgba(0,160,152,0.08)', border: '1px solid rgba(0,160,152,0.25)',
                borderRadius: '4px', padding: '0.85rem 1.1rem', marginBottom: '1.25rem',
                fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--teal)',
              }}>
                ✓ Already submitted for {branch} · {department} on {date} — you can still adjust counts and resubmit below.
              </div>
            )}
            {report?.status === 'draft' && report.items.some(i => i.countedQty != null) && (
              <div style={{
                background: 'rgba(201,150,44,0.08)', border: '1px solid rgba(201,150,44,0.22)',
                borderRadius: '4px', padding: '0.85rem 1.1rem', marginBottom: '1.25rem',
                fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: '#C9962C',
              }}>
                In-progress count found — resuming where it was left off.
              </div>
            )}

            {/* Search */}
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${department} items…`}
              style={{ ...inp, width: '100%', marginBottom: '1.25rem', padding: '0.6rem 0.9rem' }}
            />

            {/* Progress */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{
                  width: items.length > 0 ? `${(countedCount / items.length) * 100}%` : '0%',
                  height: '100%', background: allCounted ? 'var(--teal)' : DEPT_COLOR[department], transition: 'width 0.2s',
                }} />
              </div>
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)', whiteSpace: 'nowrap' }}>
                {countedCount} / {items.length} counted
              </span>
            </div>

            {/* Items */}
            {visibleItems.length === 0 ? (
              <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px', padding: '3rem', textAlign: 'center', color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>
                {search ? 'No items match your search.' : `No ${department} items yet — add them from the Inventory Management page first.`}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.6rem', marginBottom: '2rem' }}>
                {visibleItems.map(s => {
                  const prev = s.quantity[branch] ?? 0
                  const val  = counts[s.id] ?? ''
                  const counted = val !== ''
                  const delta = counted ? Number(val) - prev : 0
                  return (
                    <div key={s.id} style={{
                      background: counted ? 'rgba(0,160,152,0.04)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${counted ? 'rgba(0,160,152,0.2)' : 'rgba(255,255,255,0.07)'}`,
                      borderRadius: '6px', padding: '0.8rem 0.9rem',
                      display: 'flex', flexDirection: 'column', gap: '0.5rem',
                    }}>
                      <div>
                        <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.82rem', color: 'var(--offwhite)', lineHeight: 1.3 }}>{s.name}</p>
                        {s.nameAr && (
                          <p dir="rtl" style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(201,150,44,0.8)', marginTop: '0.1rem' }}>{s.nameAr}</p>
                        )}
                      </div>
                      {isMobile ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                          <div>
                            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', marginBottom: '0.15rem' }}>Last count</p>
                            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.9rem', color: 'rgba(245,242,236,0.5)', fontWeight: 600 }}>
                              {prev} <span style={{ fontSize: '0.68rem', fontWeight: 400 }}>{s.unit}</span>
                            </p>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <input
                                type="number" min="0" inputMode="decimal"
                                value={val}
                                onChange={e => setCounts(prev2 => ({ ...prev2, [s.id]: e.target.value }))}
                                placeholder="Count"
                                style={{ ...inp, width: '90px', textAlign: 'center', fontWeight: 600, color: counted ? 'var(--teal)' : '#F5F2EC' }}
                              />
                              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.35)' }}>{s.unit}</span>
                            </div>
                            {counted && delta !== 0 && (
                              <span style={{
                                fontFamily: 'var(--font-inter)', fontSize: '0.68rem', fontWeight: 700,
                                color: delta < 0 ? 'var(--red)' : 'var(--teal)',
                              }}>
                                {delta > 0 ? '+' : ''}{delta}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.3)' }}>
                            Last count: {prev} {s.unit}
                          </p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input
                              type="number" min="0" inputMode="decimal"
                              value={val}
                              onChange={e => setCounts(prev2 => ({ ...prev2, [s.id]: e.target.value }))}
                              placeholder="Count"
                              style={{ ...inp, width: '90px', textAlign: 'center', fontWeight: 600, color: counted ? 'var(--teal)' : '#F5F2EC' }}
                            />
                            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.35)' }}>{s.unit}</span>
                            {counted && delta !== 0 && (
                              <span style={{
                                marginLeft: 'auto', fontFamily: 'var(--font-inter)', fontSize: '0.68rem', fontWeight: 700,
                                color: delta < 0 ? 'var(--red)' : 'var(--teal)',
                              }}>
                                {delta > 0 ? '+' : ''}{delta}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {err && <p style={{ color: 'var(--red)', fontSize: '0.82rem', marginBottom: '1rem', fontFamily: 'var(--font-inter)' }}>{err}</p>}
            {saved === 'draft' && <p style={{ color: '#C9962C', fontSize: '0.82rem', marginBottom: '1rem', fontFamily: 'var(--font-inter)' }}>✓ Progress saved.</p>}
            {saved === 'submitted' && <p style={{ color: 'var(--teal)', fontSize: '0.82rem', marginBottom: '1rem', fontFamily: 'var(--font-inter)' }}>✓ {department} inventory submitted — stock levels updated for {branch}.</p>}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '2.5rem' }}>
              <button
                onClick={handleSaveDraft}
                disabled={saving || submitting || items.length === 0}
                style={{
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                  color: 'rgba(245,242,236,0.6)', padding: '0.75rem 1.5rem', borderRadius: '2px',
                  fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase',
                  cursor: saving || submitting ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-inter)',
                  opacity: saving ? 0.6 : 1,
                }}
              >{saving ? 'Saving…' : 'Save Progress'}</button>

              <button
                onClick={handleSubmit}
                disabled={!allCounted || saving || submitting}
                title={!allCounted ? 'Every item needs a count before submitting' : undefined}
                style={{
                  background: allCounted ? DEPT_COLOR[department] : 'rgba(255,255,255,0.08)',
                  color: allCounted ? '#000' : 'rgba(245,242,236,0.3)', border: 'none', padding: '0.75rem 2rem', borderRadius: '2px',
                  fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700,
                  cursor: allCounted && !saving && !submitting ? 'pointer' : 'not-allowed',
                  fontFamily: 'var(--font-inter)', opacity: submitting ? 0.6 : 1,
                }}
              >{submitting ? 'Submitting…' : `Submit ${department} Inventory`}</button>

              {!allCounted && items.length > 0 && (
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.3)' }}>
                  {items.length - countedCount} item{items.length - countedCount !== 1 ? 's' : ''} left to count
                </span>
              )}
            </div>

            {/* Recent submissions — admin/manager only */}
            {canReview && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setShowHistory(v => !v)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                      fontFamily: 'var(--font-inter)', fontSize: '0.72rem', letterSpacing: '0.1em',
                      textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)',
                    }}
                  >{showHistory ? '▾' : '▸'} Recent Submissions — {branch}</button>
                  <a href="/admin/supplies/daily/history" style={{
                    fontFamily: 'var(--font-inter)', fontSize: '0.72rem', letterSpacing: '0.05em',
                    color: '#6A9E5A', textDecoration: 'none',
                  }}>View full history sheet →</a>
                </div>

                {showHistory && (
                  <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {historyLoading ? (
                      <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.8rem' }}>Loading…</p>
                    ) : history.filter(h => h.department === department).length === 0 ? (
                      <p style={{ color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.8rem' }}>No {department} submissions yet for this branch.</p>
                    ) : history.filter(h => h.department === department).map(h => {
                      const discrepancies = h.items.filter(i => i.countedQty != null && i.countedQty !== i.previousQty).length
                      return (
                        <div key={h.id} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
                          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                          borderRadius: '4px', padding: '0.7rem 1rem',
                        }}>
                          <div>
                            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--offwhite)', fontWeight: 500 }}>{h.date}</span>
                            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.3)', marginLeft: '0.6rem' }}>
                              {h.status === 'submitted' ? `by ${h.submittedByEmail}` : 'draft — not submitted'}
                            </span>
                          </div>
                          {h.status === 'submitted' && (
                            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: discrepancies > 0 ? '#C9962C' : 'rgba(245,242,236,0.3)' }}>
                              {discrepancies > 0 ? `${discrepancies} item${discrepancies !== 1 ? 's' : ''} changed` : 'matched expected'}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function DailyInventoryPage() {
  return (
    <Suspense fallback={null}>
      <DailyInventoryInner />
    </Suspense>
  )
}
