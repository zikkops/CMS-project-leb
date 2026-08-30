'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { useRequireRole, ALL_ROLES, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import {
  listWeeklyReports, listTemplateItems, listProviders,
  generateOrderText, whatsappUrl, groupByProvider, groupByCategory, getProviderPhone,
  UNIT_LABELS, DEPARTMENTS,
  updateReportItemQty, deleteWeeklyReport, toggleWhatsappSent,
  type WeeklyOrderReport, type WeeklyOrderReportItem, type OrderProvider, type Department,
} from '@big-cms/shared/weeklyOrders'
import { BRANCHES, STOCKED_BRANCHES, emptyStock, PRIMARY_BRANCH } from '@big-cms/shared/branches'

// Configuration, not a constant — see app/admin/supplies/page.tsx for what
// the hardcoded version did to the stock figures.
const SUPPLY_BRANCHES = STOCKED_BRANCHES
type SupplyBranch = string

interface Supply {
  id: string
  name: string
  quantity: Record<SupplyBranch, number>
  unit: string
  threshold: number
  category: string
}

function minQty(qty: Record<SupplyBranch, number>): number {
  return Math.min(...SUPPLY_BRANCHES.map(b => qty[b] ?? 0))
}

function SuppliesStatus() {
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    getDocs(collection(db, 'supplies')).then(snap => {
      setSupplies(snap.docs.map(d => {
        const data = d.data() as Omit<Supply, 'id'>
        const qty = typeof data.quantity === 'number'
          ? { ...emptyStock(), [PRIMARY_BRANCH]: data.quantity }
          : (data.quantity ?? emptyStock())
        return { ...data, id: d.id, quantity: qty }
      }).sort((a, b) => a.name.localeCompare(b.name)))
    })
  }, [])

  // A supply is low if any branch is below threshold
  const alerts = supplies.filter(s => SUPPLY_BRANCHES.some(b => (s.quantity[b] ?? 0) < s.threshold))
  const ok     = supplies.filter(s => SUPPLY_BRANCHES.every(b => (s.quantity[b] ?? 0) >= s.threshold))

  if (supplies.length === 0) return null

  return (
    <div style={{ marginBottom: '2rem', border: `1px solid ${alerts.length > 0 ? 'rgba(228,51,41,0.3)' : 'rgba(0,160,152,0.2)'}`, borderRadius: '6px', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: alerts.length > 0 ? 'rgba(228,51,41,0.06)' : 'rgba(0,160,152,0.06)', border: 'none', color: '#F5F2EC', cursor: 'pointer', fontFamily: 'var(--font-inter)', fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ color: alerts.length > 0 ? '#E43329' : '#00A098' }}>●</span>
          Supplies Status
          {alerts.length > 0
            ? <span style={{ background: '#E43329', color: '#fff', borderRadius: '3px', padding: '0.05rem 0.4rem', fontSize: '0.65rem', fontWeight: 700 }}>{alerts.length} low</span>
            : <span style={{ color: '#00A098', fontSize: '0.7rem' }}>All OK</span>
          }
        </span>
        <span style={{ opacity: 0.4, fontSize: '0.9rem' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '0.75rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {alerts.map(s => {
            const lowBranches = SUPPLY_BRANCHES.filter(b => (s.quantity[b] ?? 0) < s.threshold)
            const out = lowBranches.some(b => (s.quantity[b] ?? 0) <= 0)
            return (
              <div key={s.id} style={{ background: out ? 'rgba(228,51,41,0.12)' : 'rgba(201,150,44,0.1)', border: `1px solid ${out ? 'rgba(228,51,41,0.35)' : 'rgba(201,150,44,0.3)'}`, borderRadius: '4px', padding: '0.3rem 0.7rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#F5F2EC' }}>{s.name}</span>
                <span style={{ fontSize: '0.65rem', color: out ? '#E43329' : '#C9962C', fontWeight: 600 }}>
                  {lowBranches.map(b => `${b} ${s.quantity[b]}`).join(' · ')}
                </span>
                <span style={{ fontSize: '0.62rem', color: 'rgba(245,242,236,0.3)' }}>/ min {s.threshold}</span>
              </div>
            )
          })}
          {ok.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              {ok.map(s => (
                <span key={s.id} style={{ background: 'rgba(0,160,152,0.07)', border: '1px solid rgba(0,160,152,0.18)', borderRadius: '4px', padding: '0.3rem 0.6rem', fontSize: '0.72rem', color: 'rgba(245,242,236,0.5)' }}>
                  {s.name}
                </span>
              ))}
            </div>
          )}
          <a href="/admin/supplies" style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'rgba(245,242,236,0.3)', textDecoration: 'none', alignSelf: 'center', whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>
            Manage supplies →
          </a>
        </div>
      )}
    </div>
  )
}

const DEPT_COLOR: Record<Department, string> = {
  Kitchen:  '#00A098',
  Bar:      '#C9962C',
  Cleaning: '#8B7CF6',
}

function fmtDate(ts: { seconds: number } | null): string {
  if (!ts) return '—'
  return new Date(ts.seconds * 1000).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function ReportCard({
  report,
  providers,
  nameArMap,
  canEdit = false,
  staffUid = '',
  staffEmail = '',
  onDeleted,
}: {
  report:      WeeklyOrderReport
  providers:   Record<string, OrderProvider>
  nameArMap:   Record<string, string>
  canEdit?:    boolean
  staffUid?:   string
  staffEmail?: string
  onDeleted?:  (id: string) => void
}) {
  const [open,       setOpen]      = useState(false)
  const [copied,     setCopied]    = useState(false)
  const [copiedProv, setCopiedProv] = useState<string | null>(null)
  const [items,      setItems]     = useState<WeeklyOrderReportItem[]>(report.items)
  const [editingId,  setEditingId] = useState<string | null>(null)
  const [editVal,    setEditVal]   = useState('')
  const [saving,     setSaving]    = useState(false)
  const [deleting,   setDeleting]  = useState(false)
  const [sentMap,    setSentMap]   = useState<Record<string, boolean>>(report.whatsappSent ?? {})

  // Track Escape so onBlur doesn't also save
  const skipBlurRef = useRef(false)

  const deptGroups = useMemo(() =>
    DEPARTMENTS.map(dept => {
      const deptItems = items.filter(i => (i.department ?? 'Kitchen') === dept)
      return { dept, provGroups: groupByProvider(deptItems) }
    }).filter(d => d.provGroups.some(pg => pg.items.length > 0)),
  [items])

  // Derive send-progress from current sentMap — recalculates whenever sentMap changes
  const uniqueProvKeys = [...new Set(
    deptGroups.flatMap(({ provGroups }) => provGroups.map(pg => pg.providerId ?? '__none__'))
  )]
  const totalProvCt  = uniqueProvKeys.length
  const pendingCount = uniqueProvKeys.filter(k => !sentMap[k]).length
  const allDone      = totalProvCt > 0 && pendingCount === 0

  function copyAll() {
    const text = generateOrderText({ ...report, items }, providers, nameArMap, true)
    navigator.clipboard.writeText(text)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  function copyProvider(providerId: string | undefined) {
    const text = generateOrderText({ ...report, items }, providers, nameArMap, true, providerId)
    const key = providerId ?? '__none__'
    navigator.clipboard.writeText(text)
    setCopiedProv(key); setTimeout(() => setCopiedProv(null), 2000)
  }

  async function handleToggleSent(provKey: string) {
    const next = !sentMap[provKey]
    setSentMap(prev => ({ ...prev, [provKey]: next }))
    try {
      await toggleWhatsappSent(report.id, provKey, next)
    } catch {
      // revert on failure
      setSentMap(prev => ({ ...prev, [provKey]: !next }))
    }
  }

  function startEdit(item: WeeklyOrderReportItem) {
    if (saving) return
    setEditingId(item.templateId)
    setEditVal(String(item.quantity))
  }

  function cancelEdit() {
    skipBlurRef.current = true
    setEditingId(null)
    setEditVal('')
  }

  async function commitEdit(item: WeeklyOrderReportItem) {
    if (skipBlurRef.current) {
      skipBlurRef.current = false
      return
    }
    const newQty = parseFloat(editVal)
    if (isNaN(newQty) || newQty < 0 || newQty === item.quantity) {
      setEditingId(null); setEditVal(''); return
    }
    setSaving(true)
    try {
      // The route writes the weeklyOrderLogs entry itself, in the same
      // call, so the edit and its audit record cannot come apart.
      setItems(await updateReportItemQty(report.id, items, item.templateId, newQty))
    } finally {
      setSaving(false)
      setEditingId(null)
      setEditVal('')
    }
  }

  async function handleDelete() {
    if (!confirm(
      `Delete the ${report.branch} report for "${report.weekLabel}"?\n\nThis cannot be undone.`
    )) return
    setDeleting(true)
    try {
      await deleteWeeklyReport(report.id)
      onDeleted?.(report.id)
    } catch {
      setDeleting(false)
    }
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '4px', overflow: 'hidden',
    }}>
      {/* Summary row */}
      <div style={{
        padding: '1rem 1.25rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
        cursor: 'pointer',
      }} onClick={() => { cancelEdit(); setOpen(o => !o) }}>
        <span style={{
          backgroundColor: 'rgba(0,160,152,0.12)', border: '1px solid rgba(0,160,152,0.3)',
          color: 'var(--teal)', borderRadius: '2px', padding: '0.2rem 0.6rem',
          fontSize: '0.72rem', letterSpacing: '0.1em', fontFamily: 'var(--font-inter)', fontWeight: 600, flexShrink: 0,
        }}>
          {report.branch}
        </span>

        {report.department && (
          <span style={{
            backgroundColor: `${DEPT_COLOR[report.department]}18`,
            border: `1px solid ${DEPT_COLOR[report.department]}50`,
            color: DEPT_COLOR[report.department],
            borderRadius: '2px', padding: '0.2rem 0.6rem',
            fontSize: '0.72rem', letterSpacing: '0.1em',
            fontFamily: 'var(--font-inter)', fontWeight: 600, flexShrink: 0,
          }}>
            {report.department}
          </span>
        )}

        <div style={{ flex: 1, minWidth: '180px' }}>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.9rem', color: 'var(--offwhite)', fontWeight: 600, marginBottom: '0.1rem' }}>
            {report.weekLabel}
          </p>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.73rem', color: 'rgba(245,242,236,0.35)' }}>
            {report.submittedByEmail} · {fmtDate(report.submittedAt)}
          </p>
        </div>

        {totalProvCt > 0 ? (
          allDone ? (
            <span style={{
              backgroundColor: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.45)',
              color: '#25D366', borderRadius: '2px', padding: '0.2rem 0.7rem',
              fontSize: '0.72rem', letterSpacing: '0.1em', fontFamily: 'var(--font-inter)',
              fontWeight: 700, flexShrink: 0,
            }}>
              ✓ Done
            </span>
          ) : (
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.35)', flexShrink: 0 }}>
              {pendingCount} pending
            </span>
          )
        ) : (
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.3)', flexShrink: 0 }}>
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
        )}

        <span style={{ color: 'rgba(245,242,236,0.25)', fontSize: '1.1rem', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>›</span>
      </div>

      {/* Expanded body */}
      {open && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {/* Action bar */}
          <div style={{
            padding: '0.75rem 1.25rem',
            background: 'rgba(255,255,255,0.02)',
            display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <button onClick={copyAll} style={{
              backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
              color: copied ? 'var(--teal)' : 'rgba(245,242,236,0.7)',
              padding: '0.45rem 1rem', borderRadius: '2px', fontSize: '0.72rem',
              letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
            }}>
              {copied ? '✓ Copied!' : '📋 Copy Full Order'}
            </button>

            {totalProvCt > 0 && (
              <span style={{
                fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600,
                color: allDone ? '#25D366' : 'rgba(245,242,236,0.4)',
                letterSpacing: '0.03em',
              }}>
                {allDone ? '✓ All providers sent' : `${pendingCount} of ${totalProvCt} pending`}
              </span>
            )}

            {canEdit && (
              <button
                onClick={e => { e.stopPropagation(); handleDelete() }}
                disabled={deleting}
                style={{
                  marginLeft: 'auto',
                  backgroundColor: 'rgba(220,50,50,0.08)', border: '1px solid rgba(220,50,50,0.25)',
                  color: deleting ? 'rgba(245,242,236,0.25)' : 'rgba(220,90,90,0.9)',
                  padding: '0.45rem 1rem', borderRadius: '2px', fontSize: '0.72rem',
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-inter)',
                }}
              >
                {deleting ? 'Deleting…' : 'Delete Report'}
              </button>
            )}
          </div>

          {/* Items */}
          <div style={{ padding: '1.25rem' }}>
            {canEdit && (
              <p style={{
                fontFamily: 'var(--font-inter)', fontSize: '0.68rem',
                color: 'rgba(245,242,236,0.22)', letterSpacing: '0.05em',
                marginBottom: '1rem',
              }}>
                Click any quantity to edit · Enter to save · Esc to cancel
              </p>
            )}

            {deptGroups.map(({ dept, provGroups }) => (
              <div key={dept} style={{ marginBottom: '1.75rem' }}>

                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  marginBottom: '0.85rem', paddingBottom: '0.45rem',
                  borderBottom: `1px solid ${DEPT_COLOR[dept]}30`,
                }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: DEPT_COLOR[dept], flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.7rem', color: DEPT_COLOR[dept], letterSpacing: '0.2em' }}>
                    {dept.toUpperCase()}
                  </span>
                </div>

                {provGroups.map(({ providerId, items: pItems }) => {
                  const provider = providerId ? providers[providerId] : undefined
                  const phone    = provider ? getProviderPhone(provider, report.branch) : ''
                  const waText   = generateOrderText(
                    { ...report, items }, providers, nameArMap, true, providerId,
                  )
                  const provKey  = providerId ?? '__none__'
                  const isSent   = !!sentMap[provKey]

                  return (
                    <div key={provKey} style={{
                      marginBottom: '1rem',
                      borderRadius: '4px',
                      border: `1px solid ${isSent ? 'rgba(37,211,102,0.35)' : 'rgba(255,255,255,0.06)'}`,
                      backgroundColor: isSent ? 'rgba(37,211,102,0.05)' : 'rgba(255,255,255,0.01)',
                      padding: '0.75rem 0.85rem',
                      transition: 'border-color 0.25s, background-color 0.25s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <div>
                          <span style={{
                            fontFamily: 'var(--font-inter)', fontSize: '0.83rem',
                            color: provider ? 'var(--offwhite)' : 'rgba(245,242,236,0.3)',
                            fontWeight: provider ? 600 : 400,
                          }}>
                            {provider?.name ?? 'No Provider'}
                          </span>
                          {phone && (
                            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)', marginLeft: '0.6rem' }}>
                              {phone}
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                          <button onClick={() => copyProvider(providerId)} style={{
                            backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                            color: copiedProv === provKey ? 'var(--teal)' : 'rgba(245,242,236,0.4)',
                            padding: '0.3rem 0.7rem', borderRadius: '2px', fontSize: '0.7rem',
                            cursor: 'pointer', fontFamily: 'var(--font-inter)',
                          }}>
                            {copiedProv === provKey ? '✓' : '📋'}
                          </button>

                          {phone && (
                            <a
                              href={whatsappUrl(phone, waText)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                                backgroundColor: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)',
                                color: '#25D366', padding: '0.3rem 0.75rem', borderRadius: '2px',
                                fontSize: '0.7rem', textDecoration: 'none', fontFamily: 'var(--font-inter)',
                              }}
                            >
                              WhatsApp {provider?.name ?? ''}
                            </a>
                          )}

                          {/* Checkmark shown for every provider regardless of WhatsApp */}
                          <button
                            onClick={e => { e.stopPropagation(); handleToggleSent(provKey) }}
                            title={isSent ? 'Sent — click to unmark' : 'Mark as sent'}
                            style={{
                              backgroundColor: isSent ? 'rgba(37,211,102,0.22)' : 'rgba(255,255,255,0.04)',
                              border: `1px solid ${isSent ? 'rgba(37,211,102,0.6)' : 'rgba(255,255,255,0.12)'}`,
                              color: isSent ? '#25D366' : 'rgba(245,242,236,0.3)',
                              padding: '0.3rem 0.75rem', borderRadius: '2px', fontSize: '0.72rem',
                              cursor: 'pointer', fontFamily: 'var(--font-inter)',
                              fontWeight: isSent ? 700 : 400, letterSpacing: '0.04em',
                              transition: 'all 0.2s',
                            }}
                          >
                            {isSent ? '✓ Sent' : '✓'}
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        {(() => {
                          const catGroups = groupByCategory(pItems)
                          const hasCategories = catGroups.some(g => g.category !== undefined)
                          return catGroups.map(({ category, items: cItems }) => (
                            <div key={category ?? '__none__'}>
                              {hasCategories && (
                                <div style={{
                                  padding: '0.3rem 0.9rem',
                                  fontFamily: 'var(--font-inter)', fontSize: '0.67rem',
                                  letterSpacing: '0.1em', textTransform: 'uppercase',
                                  color: category ? DEPT_COLOR[dept] : 'rgba(245,242,236,0.2)',
                                  fontWeight: 600, marginTop: '0.2rem',
                                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                }}>
                                  <span>{category ?? 'Other'}</span>
                                  {category && (() => {
                                    const ar = providerId ? providers[providerId]?.categoryTranslations?.[category] : undefined
                                    return ar ? <span dir="rtl" style={{ opacity: 0.6, letterSpacing: '0.02em', textTransform: 'none' }}>{ar}</span> : null
                                  })()}
                                </div>
                              )}
                              {cItems.map(item => {
                                const ar        = nameArMap[item.templateId]
                                const isEditing = editingId === item.templateId
                                return (
                                  <div key={item.templateId} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '0.5rem 0.9rem',
                                    background: isEditing
                                      ? 'rgba(0,160,152,0.06)'
                                      : 'rgba(255,255,255,0.025)',
                                    borderRadius: '2px',
                                    border: isEditing
                                      ? '1px solid rgba(0,160,152,0.25)'
                                      : '1px solid transparent',
                                  }}>
                                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)' }}>
                                      {item.name}
                                      {ar && (
                                        <span dir="rtl" style={{ color: '#C9962C', marginRight: '0.6rem', marginLeft: '0.6rem' }}>{ar}</span>
                                      )}
                                    </span>

                                    {canEdit ? (
                                      isEditing ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                                          <input
                                            autoFocus
                                            type="number"
                                            min="0"
                                            step="0.5"
                                            value={editVal}
                                            onChange={e => setEditVal(e.target.value)}
                                            onKeyDown={e => {
                                              if (e.key === 'Enter') { e.preventDefault(); commitEdit(item) }
                                              if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                                            }}
                                            onBlur={() => commitEdit(item)}
                                            style={{
                                              width: '75px',
                                              backgroundColor: '#1a1a1a',
                                              border: '1px solid rgba(0,160,152,0.6)',
                                              color: '#F5F2EC',
                                              padding: '0.3rem 0.5rem',
                                              borderRadius: '2px',
                                              fontSize: '0.88rem',
                                              textAlign: 'right',
                                              outline: 'none',
                                              fontFamily: 'var(--font-inter)',
                                            }}
                                          />
                                          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)', minWidth: '30px' }}>
                                            {UNIT_LABELS[item.unit]}
                                          </span>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => startEdit(item)}
                                          title="Click to edit quantity"
                                          style={{
                                            background: 'none', border: 'none',
                                            cursor: 'pointer',
                                            fontFamily: 'var(--font-inter)', fontSize: '0.88rem',
                                            color: 'var(--teal)', fontWeight: 700, flexShrink: 0,
                                            padding: '0.2rem 0.4rem', borderRadius: '2px',
                                            textDecoration: 'underline',
                                            textDecorationStyle: 'dotted',
                                            textUnderlineOffset: '3px',
                                          }}
                                        >
                                          {item.quantity} {UNIT_LABELS[item.unit]}
                                        </button>
                                      )
                                    ) : (
                                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'var(--teal)', fontWeight: 700, flexShrink: 0 }}>
                                        {item.quantity} {UNIT_LABELS[item.unit]}
                                      </span>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          ))
                        })()}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}

            {report.notes && (
              <div style={{ marginTop: '0.5rem', padding: '0.7rem 0.9rem', background: 'rgba(255,255,255,0.03)', borderRadius: '2px', borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.3)', marginBottom: '0.2rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Notes</p>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.7)' }}>{report.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function WeeklyOrdersPage() {
  const { checking, role, orderDepts, user } = useRequireRole(SECTION_ACCESS.weeklyOrders)
  const [reports,      setReports]      = useState<WeeklyOrderReport[]>([])
  const [providers,    setProviders]    = useState<Record<string, OrderProvider>>({})
  const [nameArMap,    setNameArMap]    = useState<Record<string, string>>({})
  const [loading,      setLoading]      = useState(true)
  const [branchFilter, setBranchFilter] = useState<string>('all')
  const [deptFilter,   setDeptFilter]   = useState<Department | 'all'>('all')

  const canEdit = role === 'admin' || role === 'manager'

  // Cast string[] from adminAuth to Department[]
  const allowedDepts = useMemo(
    () => DEPARTMENTS.filter(d => (orderDepts as string[]).includes(d)),
    [orderDepts],
  )

  useEffect(() => {
    Promise.all([listWeeklyReports(), listTemplateItems(), listProviders()]).then(
      ([reps, tItems, provs]) => {
        setReports(reps)
        setProviders(Object.fromEntries(provs.map(p => [p.id, p])))
        setNameArMap(Object.fromEntries(
          tItems.filter(i => i.nameAr).map(i => [i.id, i.nameAr!])
        ))
        setLoading(false)
      }
    )
  }, [])

  const visible = useMemo(() => reports.filter(r => {
    // Department access: admin/manager see all; other staff see only their depts
    if (canEdit) {
      // In a specific dept tab, show only reports for that dept (legacy mixed reports
      // only appear in the "all" tab)
      if (deptFilter !== 'all') {
        if (r.department !== deptFilter) return false
      }
    } else {
      // Non-admin/manager: only show reports for their assigned departments
      if (!r.department || !allowedDepts.includes(r.department)) return false
      if (deptFilter !== 'all' && r.department !== deptFilter) return false
    }
    // Branch filter
    if (branchFilter !== 'all' && r.branch !== branchFilter) return false
    return true
  }), [reports, canEdit, allowedDepts, deptFilter, branchFilter])

  if (checking) return null

  // Dept tabs: admin/manager see all 3; other staff see only their depts (skip tabs if only 1)
  const deptTabs: Array<Department | 'all'> = canEdit
    ? ['all', ...DEPARTMENTS]
    : allowedDepts.length > 1 ? ['all', ...allowedDepts] : []

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '3rem' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin" style={{
            fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
            marginBottom: '0.5rem', display: 'block', fontFamily: 'var(--font-inter)',
          }}>← Dashboard</a>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)', marginBottom: '0.25rem' }}>
                Weekly Order Reports
              </h1>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.3)' }}>
                End-of-week stock and supply orders — copy or WhatsApp directly to your suppliers
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <a href="/admin/weekly-orders/submit" style={{
                backgroundColor: 'var(--teal)', color: '#fff', textDecoration: 'none',
                padding: '0.65rem 1.4rem', borderRadius: '2px', fontSize: '0.75rem',
                letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
              }}>+ Submit Report</a>
              {role === 'admin' && (
                <>
                  <a href="/admin/weekly-orders/template" style={{
                    backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(245,242,236,0.5)', textDecoration: 'none',
                    padding: '0.65rem 1.2rem', borderRadius: '2px', fontSize: '0.72rem',
                    letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                  }}>Edit Template</a>
                  <a href="/admin/weekly-orders/access" style={{
                    backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(245,242,236,0.4)', textDecoration: 'none',
                    padding: '0.65rem 1.2rem', borderRadius: '2px', fontSize: '0.72rem',
                    letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                  }}>Dept Access</a>
                </>
              )}
              {canEdit && (
                <a href="/admin/weekly-orders/log" style={{
                  backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(245,242,236,0.4)', textDecoration: 'none',
                  padding: '0.65rem 1.2rem', borderRadius: '2px', fontSize: '0.72rem',
                  letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                }}>View Log</a>
              )}
            </div>
          </div>
        </div>

        {/* Supplies status */}
        <SuppliesStatus />

        {/* Department filter tabs */}
        {deptTabs.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {deptTabs.map(d => {
              const count = d === 'all'
                ? reports.filter(r => {
                    if (branchFilter !== 'all' && r.branch !== branchFilter) return false
                    if (!canEdit && (!r.department || !allowedDepts.includes(r.department))) return false
                    return true
                  }).length
                : reports.filter(r => r.department === d && (branchFilter === 'all' || r.branch === branchFilter)).length
              const color = d === 'all' ? 'rgba(245,242,236,0.5)' : DEPT_COLOR[d]
              const active = deptFilter === d
              return (
                <button key={d} onClick={() => setDeptFilter(d)} style={{
                  backgroundColor: active ? (d === 'all' ? 'rgba(255,255,255,0.08)' : `${color}18`) : 'transparent',
                  border: `1px solid ${active ? (d === 'all' ? 'rgba(255,255,255,0.2)' : color) : 'rgba(255,255,255,0.08)'}`,
                  color: active ? (d === 'all' ? 'var(--offwhite)' : color) : 'rgba(245,242,236,0.35)',
                  padding: '0.4rem 0.9rem', borderRadius: '2px', fontSize: '0.7rem',
                  letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
                  fontFamily: 'var(--font-inter)', display: 'flex', alignItems: 'center', gap: '0.35rem',
                }}>
                  {d !== 'all' && (
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: active ? color : 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                  )}
                  {d === 'all' ? `All (${count})` : `${d} (${count})`}
                </button>
              )
            })}
          </div>
        )}

        {/* Branch filter */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {(['all', ...BRANCHES] as const).map(b => (
            <button key={b} onClick={() => setBranchFilter(b)} style={{
              backgroundColor: branchFilter === b ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: `1px solid ${branchFilter === b ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
              color: branchFilter === b ? 'var(--offwhite)' : 'rgba(245,242,236,0.4)',
              padding: '0.4rem 0.9rem', borderRadius: '2px', fontSize: '0.7rem',
              letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
            }}>
              {b === 'all' ? `All Branches (${reports.length})` : `${b} (${reports.filter(r => r.branch === b).length})`}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : visible.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
            color: 'rgba(245,242,236,0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          }}>
            {deptFilter !== 'all'
              ? `No ${deptFilter} reports${branchFilter !== 'all' ? ` for ${branchFilter}` : ''} yet.`
              : branchFilter !== 'all'
                ? `No reports for ${branchFilter} yet.`
                : 'No reports submitted yet.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {visible.map(r => (
              <ReportCard
                key={r.id}
                report={r}
                providers={providers}
                nameArMap={nameArMap}
                canEdit={canEdit}
                staffUid={user?.uid ?? ''}
                staffEmail={user?.email ?? ''}
                onDeleted={id => setReports(prev => prev.filter(rr => rr.id !== id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
