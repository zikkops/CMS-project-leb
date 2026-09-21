'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  generateOrderText, whatsappUrl, groupByProvider, groupByCategory, getProviderPhone,
  DEPARTMENTS,
  updateReportItemQty, deleteWeeklyReport, toggleWhatsappSent,
  type WeeklyOrderReport, type WeeklyOrderReportItem, type OrderProvider,
} from '@big-cms/shared/weeklyOrders'
import {
  listDeliveriesForOrder, fulfilmentByTemplateId, type Delivery,
} from '@big-cms/shared/deliveries'
import { DEPARTMENT_COLOR as DEPT_COLOR } from '@big-cms/shared/departments'
import { ReportSummaryRow } from './ReportSummaryRow'
import { ReportActionBar } from './ReportActionBar'
import { ReportItemRow } from './ReportItemRow'

export function ReportCard({
  report,
  providers,
  nameArMap,
  canEdit = false,
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

  // Deliveries booked against this order. null = not looked up yet.
  //
  // Fetched when the card OPENS, not on mount: this page renders every order
  // for the branch, and a query per card on first paint would be dozens of
  // reads for cards nobody expanded.
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null)

  useEffect(() => {
    if (!open || deliveries !== null) return
    let cancelled = false
    listDeliveriesForOrder(report.id)
      .then(d => { if (!cancelled) setDeliveries(d) })
      // An empty array on failure, so a refused read shows "no deliveries yet"
      // rather than leaving the card in a permanent loading state.
      .catch(() => { if (!cancelled) setDeliveries([]) })
    return () => { cancelled = true }
  }, [open, deliveries, report.id])

  const received = useMemo(
    () => (deliveries ? fulfilmentByTemplateId(deliveries) : {}),
    [deliveries],
  )

  // Suppliers split shipments, so this is a sum across every delivery booked
  // against the order — never a delivered / not-delivered flag.
  const fulfilment = useMemo(() => {
    if (!deliveries || deliveries.length === 0) return null
    let full = 0, partial = 0
    for (const item of items) {
      const got = received[item.templateId] ?? 0
      if (got <= 0) continue
      if (got + 1e-9 >= item.quantity) full++
      else partial++
    }
    return { full, partial, total: items.length, deliveryCount: deliveries.length }
  }, [deliveries, received, items])

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
      background: 'rgba(var(--overlay-rgb),0.02)', border: '1px solid rgba(var(--overlay-rgb),0.06)',
      borderRadius: '4px', overflow: 'hidden',
    }}>
      {/* Summary row */}
      <ReportSummaryRow
        report={report}
        open={open}
        onToggle={() => { cancelEdit(); setOpen(o => !o) }}
        totalProvCt={totalProvCt}
        allDone={allDone}
        pendingCount={pendingCount}
        itemCount={items.length}
      />

      {/* Expanded body */}
      {open && (
        <div style={{ borderTop: '1px solid rgba(var(--overlay-rgb),0.06)' }}>
          <ReportActionBar
            copied={copied}
            onCopyAll={copyAll}
            totalProvCt={totalProvCt}
            allDone={allDone}
            pendingCount={pendingCount}
            fulfilment={fulfilment}
            canEdit={canEdit}
            deleting={deleting}
            onDelete={handleDelete}
          />

          {/* Items */}
          <div style={{ padding: '1.25rem' }}>
            {canEdit && (
              <p style={{
                fontFamily: 'var(--font-inter)', fontSize: '0.68rem',
                color: 'rgba(var(--offwhite-rgb),0.22)', letterSpacing: '0.05em',
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
                      border: `1px solid ${isSent ? 'rgba(37,211,102,0.35)' : 'rgba(var(--overlay-rgb),0.06)'}`,
                      backgroundColor: isSent ? 'rgba(37,211,102,0.05)' : 'rgba(var(--overlay-rgb),0.01)',
                      padding: '0.75rem 0.85rem',
                      transition: 'border-color 0.25s, background-color 0.25s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <div>
                          <span style={{
                            fontFamily: 'var(--font-inter)', fontSize: '0.83rem',
                            color: provider ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.3)',
                            fontWeight: provider ? 600 : 400,
                          }}>
                            {provider?.name ?? 'No Provider'}
                          </span>
                          {phone && (
                            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.4)', marginLeft: '0.6rem' }}>
                              {phone}
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                          <button onClick={() => copyProvider(providerId)} style={{
                            backgroundColor: 'transparent', border: '1px solid rgba(var(--overlay-rgb),0.1)',
                            color: copiedProv === provKey ? 'var(--teal)' : 'rgba(var(--offwhite-rgb),0.4)',
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
                              backgroundColor: isSent ? 'rgba(37,211,102,0.22)' : 'rgba(var(--overlay-rgb),0.04)',
                              border: `1px solid ${isSent ? 'rgba(37,211,102,0.6)' : 'rgba(var(--overlay-rgb),0.12)'}`,
                              color: isSent ? '#25D366' : 'rgba(var(--offwhite-rgb),0.3)',
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
                                  color: category ? DEPT_COLOR[dept] : 'rgba(var(--offwhite-rgb),0.2)',
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
                              {cItems.map(item => (
                                <ReportItemRow
                                  key={item.templateId}
                                  item={item}
                                  ar={nameArMap[item.templateId]}
                                  isEditing={editingId === item.templateId}
                                  fulfilment={fulfilment}
                                  received={received}
                                  canEdit={canEdit}
                                  editVal={editVal}
                                  setEditVal={setEditVal}
                                  startEdit={startEdit}
                                  commitEdit={commitEdit}
                                  cancelEdit={cancelEdit}
                                />
                              ))}
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
              <div style={{ marginTop: '0.5rem', padding: '0.7rem 0.9rem', background: 'rgba(var(--overlay-rgb),0.03)', borderRadius: '2px', borderLeft: '2px solid rgba(var(--overlay-rgb),0.1)' }}>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(var(--offwhite-rgb),0.3)', marginBottom: '0.2rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Notes</p>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.7)' }}>{report.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
