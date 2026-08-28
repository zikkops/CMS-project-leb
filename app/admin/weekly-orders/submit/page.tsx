'use client'

import { useEffect, useMemo, useState } from 'react'

function useIsMobile(breakpoint = 640) {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return mobile
}
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { useRequireRole, ALL_ROLES } from '../../../lib/adminAuth'
import {
  listTemplateItems, listProviders, submitWeeklyReport, getCurrentWeek,
  groupByProvider, groupByCategory, packLabel,
  type OrderTemplateItem, type OrderProvider,
  DEPARTMENTS, type Department,
} from '../../../lib/weeklyOrders'
import { BRANCHES } from '../../../lib/branches'

type SupplyBranch = 'Beirut' | 'Zouk' | 'Broummana'
interface Supply { id: string; name: string; quantity: Record<SupplyBranch, number>; unit: string; threshold: number; category: string }

function supplyStatus(qty: number, threshold: number): 'ok' | 'low' | 'out' {
  if (qty <= 0) return 'out'
  if (qty < threshold) return 'low'
  return 'ok'
}

const DEPT_COLOR: Record<Department, string> = {
  Kitchen:  '#00A098',
  Bar:      '#C9962C',
  Cleaning: '#8B7CF6',
}

const inp: React.CSSProperties = {
  backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)',
  color: '#F5F2EC', padding: '0.6rem 0.8rem', borderRadius: '2px',
  fontSize: '0.85rem', outline: 'none', fontFamily: 'var(--font-inter)',
}

export default function SubmitOrderPage() {
  const isMobile = useIsMobile()
  const { checking, role, branchIds, orderDepts, user } = useRequireRole(ALL_ROLES)

  const [items,       setItems]    = useState<OrderTemplateItem[]>([])
  const [providerMap, setProvMap]  = useState<Record<string, OrderProvider>>({})
  const [loading,     setLoading]  = useState(true)
  const [branch,      setBranch]   = useState('')
  const [dept,        setDept]     = useState<Department | ''>('')
  const [notes,       setNotes]    = useState('')
  const [qtys,        setQtys]     = useState<Record<string, string>>({})
  const [saving,      setSaving]   = useState(false)
  const [err,         setErr]      = useState('')
  const [done,        setDone]     = useState(false)
  const [supplies,    setSupplies] = useState<Supply[]>([])
  const [suppliesOpen, setSuppliesOpen] = useState(true)

  const week = getCurrentWeek()

  // Cast orderDepts (string[]) to Department[] — adminAuth stores as string[]
  // to avoid importing weeklyOrders types into the auth lib
  const allowedDepts = useMemo(
    () => DEPARTMENTS.filter(d => (orderDepts as string[]).includes(d)),
    [orderDepts],
  )

  // Auto-select branch when user only has one
  useEffect(() => {
    if (checking) return
    if (role !== 'admin' && branchIds.length === 1) setBranch(branchIds[0])
  }, [checking, role, branchIds])

  // Auto-select department when user only has one allowed
  useEffect(() => {
    if (allowedDepts.length === 1) setDept(allowedDepts[0])
  }, [allowedDepts])

  useEffect(() => {
    // Template items and providers are required; load supplies separately so a
    // missing Firestore rule doesn't break the whole page.
    Promise.all([listTemplateItems(), listProviders()]).then(([data, provs]) => {
      setItems(data)
      setProvMap(Object.fromEntries(provs.map(p => [p.id, p])))
      setLoading(false)
    })
    getDocs(collection(db, 'supplies')).then(snap => {
      setSupplies(snap.docs.map(d => {
        const s = d.data() as Omit<Supply, 'id'>
        const qty = typeof s.quantity === 'number'
          ? { Beirut: s.quantity, Zouk: 0, Broummana: 0 }
          : (s.quantity ?? { Beirut: 0, Zouk: 0, Broummana: 0 })
        return { ...s, id: d.id, quantity: qty }
      }).sort((a, b) => a.name.localeCompare(b.name)))
    }).catch(() => { /* rules not yet deployed — quantities stay hidden */ })
  }, [])

  function setQty(id: string, val: string) {
    setQtys(prev => ({ ...prev, [id]: val }))
  }

  // Map supply name (lowercase) → { qty, threshold } for the current branch
  const supplyMap = useMemo(() => {
    const m = new Map<string, { qty: number; threshold: number; unit: string }>()
    const b = branch as SupplyBranch
    if (b !== 'Beirut' && b !== 'Zouk' && b !== 'Broummana') return m
    for (const s of supplies) {
      m.set(s.name.toLowerCase().trim(), { qty: s.quantity[b] ?? 0, threshold: s.threshold, unit: s.unit })
    }
    return m
  }, [supplies, branch])

  // Provider groups for the selected department only
  const provGroups = useMemo(() => {
    if (!dept) return []
    const deptItems = items.filter(i => (i.department ?? 'Kitchen') === dept)
    return groupByProvider(deptItems)
  }, [items, dept])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!branch) { setErr('Please select a branch.'); return }
    if (!dept)   { setErr('Please select a department.'); return }

    const reportItems = items
      .filter(i => (i.department ?? 'Kitchen') === dept)
      .map(item => {
        const qty = parseFloat(qtys[item.id] ?? '0') || 0
        return {
          templateId: item.id,
          name:       item.name,
          department: item.department ?? ('Kitchen' as Department),
          unit:       item.unit,
          quantity:   qty,
          ...(item.providerId != null && { providerId: item.providerId }),
          ...(item.category   != null && { category:   item.category }),
          ...(item.packSize   != null && { packSize:   item.packSize }),
          ...(item.packUnit   != null && { packUnit:   item.packUnit }),
        }
      })
      .filter(i => i.quantity > 0)

    if (reportItems.length === 0) { setErr('Please enter at least one quantity.'); return }

    setSaving(true); setErr('')
    try {
      await submitWeeklyReport({
        branch,
        weekStart:        week.startStr,
        weekLabel:        week.label,
        department:       dept,
        items:            reportItems,
        notes:            notes.trim(),
        submittedBy:      user?.uid ?? '',
        submittedByEmail: user?.email ?? '',
      })
      setDone(true)
    } catch {
      setErr('Submission failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (checking) return null

  const branchOptions = role === 'admin' ? [...BRANCHES] : branchIds

  if (done) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '3rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: '480px' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
          <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.5rem', color: 'var(--offwhite)', marginBottom: '0.5rem' }}>Report Submitted</h2>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.4)', marginBottom: '2rem' }}>
            {branch} — {dept} — {week.label}
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <a href="/admin/weekly-orders" style={{
              backgroundColor: 'var(--teal)', color: '#fff', textDecoration: 'none',
              padding: '0.7rem 1.5rem', borderRadius: '2px', fontSize: '0.75rem',
              letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
            }}>View Reports</a>
            <button onClick={() => { setDone(false); setQtys({}); setNotes('') }} style={{
              backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(245,242,236,0.5)', padding: '0.7rem 1.5rem', borderRadius: '2px',
              fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              cursor: 'pointer', fontFamily: 'var(--font-inter)',
            }}>Submit Another</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.5rem 1rem 4rem' : '3rem' }}>
      <div style={{ maxWidth: isMobile ? '600px' : '760px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <a href="/admin/weekly-orders" style={{
            fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
            marginBottom: '0.5rem', display: 'block', fontFamily: 'var(--font-inter)',
          }}>← Weekly Orders</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)', marginBottom: '0.25rem' }}>
            End of Week Order
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.4)' }}>
            Week of {week.label}
          </p>
        </div>

        {allowedDepts.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
            color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          }}>
            No departments assigned. Ask your admin to assign you a department at{' '}
            <a href="/admin/weekly-orders/access" style={{ color: 'var(--teal)' }}>
              Weekly Orders → Access
            </a>.
          </div>
        ) : loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading items…</p>
        ) : items.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
            color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          }}>
            No order items defined yet.{' '}
            {role === 'admin' && <a href="/admin/weekly-orders/template" style={{ color: 'var(--teal)' }}>Set up the template →</a>}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>

            {/* Branch selector */}
            <div style={{ marginBottom: '2rem' }}>
              <label style={{
                display: 'block', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.4rem',
                fontFamily: 'var(--font-inter)',
              }}>Branch</label>
              {branchOptions.length === 1 ? (
                <div style={{ ...inp, display: 'inline-block' }}>{branch}</div>
              ) : (
                <select value={branch} onChange={e => setBranch(e.target.value)} style={{ ...inp, minWidth: '200px', cursor: 'pointer' }}>
                  <option value="">— Select Branch —</option>
                  {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              )}
            </div>

            {/* Supplies panel — shown when branch is selected */}
            {branch && supplies.length > 0 && (() => {
              const branchKey = branch as SupplyBranch
              const validBranch = branchKey === 'Beirut' || branchKey === 'Zouk' || branchKey === 'Broummana'
              if (!validBranch) return null
              const alerts = supplies.filter(s => supplyStatus(s.quantity[branchKey] ?? 0, s.threshold) !== 'ok')
              const ok     = supplies.filter(s => supplyStatus(s.quantity[branchKey] ?? 0, s.threshold) === 'ok')
              return (
                <div style={{ marginBottom: '2rem', border: `1px solid ${alerts.length > 0 ? 'rgba(228,51,41,0.25)' : 'rgba(0,160,152,0.18)'}`, borderRadius: '6px', overflow: 'hidden' }}>
                  <button type="button" onClick={() => setSuppliesOpen(o => !o)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.65rem 1rem', background: alerts.length > 0 ? 'rgba(228,51,41,0.05)' : 'rgba(0,160,152,0.05)',
                    border: 'none', color: '#F5F2EC', cursor: 'pointer', fontFamily: 'var(--font-inter)',
                    fontSize: '0.72rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ color: alerts.length > 0 ? '#E43329' : '#00A098' }}>●</span>
                      {branch} Supplies
                      {alerts.length > 0
                        ? <span style={{ background: '#E43329', color: '#fff', borderRadius: '3px', padding: '0.05rem 0.35rem', fontSize: '0.6rem', fontWeight: 700 }}>{alerts.length} low</span>
                        : <span style={{ color: '#00A098', fontSize: '0.65rem' }}>All OK</span>
                      }
                    </span>
                    <span style={{ opacity: 0.4 }}>{suppliesOpen ? '▲' : '▼'}</span>
                  </button>

                  {suppliesOpen && (
                    <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {alerts.map(s => {
                        const qty = s.quantity[branchKey] ?? 0
                        const st  = supplyStatus(qty, s.threshold)
                        return (
                          <div key={s.id} style={{
                            background: st === 'out' ? 'rgba(228,51,41,0.1)' : 'rgba(201,150,44,0.09)',
                            border: `1px solid ${st === 'out' ? 'rgba(228,51,41,0.3)' : 'rgba(201,150,44,0.28)'}`,
                            borderRadius: '4px', padding: '0.3rem 0.65rem',
                            display: 'flex', alignItems: 'center', gap: '0.45rem',
                          }}>
                            <span style={{ fontSize: '0.75rem', color: '#F5F2EC' }}>{s.name}</span>
                            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: st === 'out' ? '#E43329' : '#C9962C' }}>{qty}</span>
                            <span style={{ fontSize: '0.6rem', color: 'rgba(245,242,236,0.3)' }}>{s.unit} · min {s.threshold}</span>
                          </div>
                        )
                      })}
                      {ok.map(s => (
                        <div key={s.id} style={{
                          background: 'rgba(0,160,152,0.06)', border: '1px solid rgba(0,160,152,0.16)',
                          borderRadius: '4px', padding: '0.3rem 0.65rem',
                          display: 'flex', alignItems: 'center', gap: '0.4rem',
                        }}>
                          <span style={{ fontSize: '0.75rem', color: 'rgba(245,242,236,0.55)' }}>{s.name}</span>
                          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#00A098' }}>{s.quantity[branchKey] ?? 0}</span>
                          <span style={{ fontSize: '0.6rem', color: 'rgba(245,242,236,0.25)' }}>{s.unit}</span>
                        </div>
                      ))}
                      <a href="/admin/supplies" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: '0.62rem', color: 'rgba(245,242,236,0.25)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        Update supplies →
                      </a>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Department selector */}
            <div style={{ marginBottom: '2.5rem' }}>
              <label style={{
                display: 'block', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.6rem',
                fontFamily: 'var(--font-inter)',
              }}>Department</label>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {allowedDepts.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setDept(d); setQtys({}) }}
                    style={{
                      backgroundColor: dept === d ? `${DEPT_COLOR[d]}20` : 'transparent',
                      border: `1px solid ${dept === d ? DEPT_COLOR[d] : 'rgba(255,255,255,0.12)'}`,
                      color: dept === d ? DEPT_COLOR[d] : 'rgba(245,242,236,0.5)',
                      padding: '0.55rem 1.2rem', borderRadius: '2px', fontSize: '0.78rem',
                      letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
                      fontFamily: 'var(--font-inter)', fontWeight: dept === d ? 600 : 400,
                      display: 'flex', alignItems: 'center', gap: '0.4rem',
                    }}
                  >
                    <span style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      backgroundColor: dept === d ? DEPT_COLOR[d] : 'rgba(255,255,255,0.2)',
                      flexShrink: 0,
                    }} />
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Items for selected department */}
            {dept ? (
              <>
                {provGroups.length === 0 ? (
                  <p style={{ color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem', marginBottom: '2rem' }}>
                    No items in the {dept} template yet.
                  </p>
                ) : (
                  <div style={{ marginBottom: '3rem' }}>
                    {/* Department header */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '0.7rem',
                      marginBottom: '1.25rem',
                      borderBottom: `1px solid ${DEPT_COLOR[dept]}40`,
                      paddingBottom: '0.65rem',
                    }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: DEPT_COLOR[dept], flexShrink: 0 }} />
                      <p style={{
                        fontFamily: 'var(--font-cinzel)', fontSize: '1rem',
                        color: DEPT_COLOR[dept], letterSpacing: '0.15em',
                      }}>{dept.toUpperCase()}</p>
                    </div>

                    {/* Provider groups */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      {provGroups.map(({ providerId, items: pItems }) => {
                        const provider = providerId ? providerMap[providerId] : undefined
                        const catGroups = groupByCategory(pItems)
                        const hasCategories = catGroups.some(g => g.category !== undefined)
                        return (
                          <div key={providerId ?? '__none__'}>
                            <p style={{
                              fontFamily: 'var(--font-inter)', fontSize: '0.78rem',
                              color: provider ? 'rgba(245,242,236,0.55)' : 'rgba(245,242,236,0.25)',
                              fontWeight: 600, marginBottom: '0.5rem',
                              letterSpacing: '0.04em',
                            }}>
                              {provider?.name ?? 'No Provider'}
                            </p>

                            <div style={{
                              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                              borderLeft: `3px solid ${DEPT_COLOR[dept]}30`,
                              borderRadius: '4px', overflow: 'clip',
                            }}>
                              {catGroups.map(({ category, items: cItems }) => (
                                <div key={category ?? '__none__'}>
                                  {hasCategories && (
                                    <div style={{
                                      position: 'sticky', top: 0, zIndex: 10,
                                      padding: '0.4rem 1.25rem',
                                      borderTop: '1px solid rgba(255,255,255,0.04)',
                                      background: '#1a1a1a',
                                      fontFamily: 'var(--font-inter)', fontSize: '0.7rem',
                                      letterSpacing: '0.1em', textTransform: 'uppercase',
                                      color: category ? DEPT_COLOR[dept] : 'rgba(245,242,236,0.25)',
                                      fontWeight: 600, display: 'flex', justifyContent: 'space-between',
                                      alignItems: 'center',
                                    }}>
                                      <span>{category ?? 'Other'}</span>
                                      {category && (() => {
                                        const ar = providerId ? providerMap[providerId]?.categoryTranslations?.[category] : undefined
                                        return ar ? <span dir="rtl" style={{ opacity: 0.6, letterSpacing: '0.02em', textTransform: 'none' }}>{ar}</span> : null
                                      })()}
                                    </div>
                                  )}
                                  {cItems.map((item, idx) => {
                                    const si = supplyMap.get(item.name.toLowerCase().trim())
                                    const st = si ? supplyStatus(si.qty, si.threshold) : null
                                    const stColor = st === 'ok' ? '#00A098' : st === 'low' ? '#C9962C' : st === 'out' ? '#E43329' : null
                                    const stBg    = st === 'ok' ? 'rgba(0,160,152,0.12)' : st === 'low' ? 'rgba(201,150,44,0.14)' : st === 'out' ? 'rgba(228,51,41,0.14)' : null
                                    return isMobile ? (
                                      // Mobile: input on top, name below
                                      <div key={item.id} style={{
                                        padding: '0.9rem 1.25rem',
                                        borderTop: (idx > 0 || hasCategories) ? '1px solid rgba(255,255,255,0.04)' : 'none',
                                      }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
                                          <input
                                            type="number" min="0" step="0.5"
                                            value={qtys[item.id] ?? ''}
                                            onChange={e => setQty(item.id, e.target.value)}
                                            placeholder="0"
                                            style={{ ...inp, width: '90px', textAlign: 'center', fontSize: '1rem' }}
                                          />
                                          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.4)' }}>
                                            {packLabel(item.unit, item.packSize, item.packUnit)}
                                          </span>
                                          {si && stColor && (
                                            <span style={{ marginLeft: 'auto', background: stBg!, borderRadius: '4px', padding: '0.2rem 0.5rem', fontSize: '0.72rem', fontWeight: 700, color: stColor, whiteSpace: 'nowrap' }}>
                                              {si.qty} {si.unit}
                                            </span>
                                          )}
                                        </div>
                                        <div>
                                          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'var(--offwhite)', fontWeight: 500 }}>{item.name}</span>
                                          {item.nameAr && (
                                            <span dir="rtl" style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: '#C9962C', marginLeft: '0.5rem' }}>{item.nameAr}</span>
                                          )}
                                        </div>
                                      </div>
                                    ) : (
                                      // Desktop: side-by-side with supply badge
                                      <div key={item.id} style={{
                                        display: 'grid', gridTemplateColumns: '1fr auto',
                                        alignItems: 'center', gap: '1rem',
                                        padding: '0.85rem 1.25rem',
                                        borderTop: (idx > 0 || hasCategories) ? '1px solid rgba(255,255,255,0.04)' : 'none',
                                      }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'var(--offwhite)', fontWeight: 500 }}>{item.name}</span>
                                          {item.nameAr && (
                                            <span dir="rtl" style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: '#C9962C' }}>{item.nameAr}</span>
                                          )}
                                          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.3)' }}>
                                            ({packLabel(item.unit, item.packSize, item.packUnit)})
                                          </span>
                                          {si && stColor && (
                                            <span style={{ background: stBg!, borderRadius: '4px', padding: '0.18rem 0.5rem', fontSize: '0.72rem', fontWeight: 700, color: stColor, whiteSpace: 'nowrap' }}>
                                              {si.qty} {si.unit}
                                            </span>
                                          )}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                          <input
                                            type="number" min="0" step="0.5"
                                            value={qtys[item.id] ?? ''}
                                            onChange={e => setQty(item.id, e.target.value)}
                                            placeholder="0"
                                            style={{ ...inp, width: '90px', textAlign: 'right' }}
                                          />
                                          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.35)', minWidth: '36px' }}>
                                            {packLabel(item.unit, item.packSize, item.packUnit)}
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div style={{ marginBottom: '2rem' }}>
                  <label style={{
                    display: 'block', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)',
                    letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.4rem',
                    fontFamily: 'var(--font-inter)',
                  }}>Notes (optional)</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Any additional notes or comments…"
                    style={{ ...inp, width: '100%', resize: 'vertical' }}
                  />
                </div>

                {err && (
                  <p style={{ color: 'var(--red)', fontSize: '0.82rem', marginBottom: '1rem', fontFamily: 'var(--font-inter)' }}>{err}</p>
                )}

                <button type="submit" disabled={saving} style={{
                  backgroundColor: dept ? DEPT_COLOR[dept] : 'var(--teal)', color: '#fff', border: 'none',
                  padding: '0.8rem 2rem', borderRadius: '2px', fontSize: '0.82rem',
                  letterSpacing: '0.08em', textTransform: 'uppercase', cursor: saving ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-inter)', opacity: saving ? 0.6 : 1,
                }}>
                  {saving ? 'Submitting…' : `Submit ${dept} Report`}
                </button>
              </>
            ) : (
              <p style={{ color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>
                Select a department above to see the order form.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
