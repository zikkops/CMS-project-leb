'use client'

import { useEffect, useState } from 'react'
import { useRequireRole } from '../../../lib/adminAuth'
import { listWeeklyOrderLogs, UNIT_LABELS, type WeeklyOrderLog } from '../../../lib/weeklyOrders'

function fmtTs(ts: { seconds: number } | null): string {
  if (!ts) return '—'
  return new Date(ts.seconds * 1000).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function WeeklyOrderLogPage() {
  const { checking, role } = useRequireRole(['admin', 'manager'])
  const [logs,    setLogs]    = useState<WeeklyOrderLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (checking) return
    listWeeklyOrderLogs().then(data => { setLogs(data); setLoading(false) })
  }, [checking])

  if (checking) return null

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '3rem', fontFamily: 'var(--font-inter)' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        <a href="/admin/weekly-orders" style={{
          fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
          color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
          display: 'block', marginBottom: '0.5rem',
        }}>← Weekly Orders</a>

        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.25rem' }}>
          Weekly Orders Log
        </h1>
        <p style={{ fontSize: '0.8rem', color: 'rgba(245,242,236,0.3)', marginBottom: '2rem' }}>
          Edits and deletions made by admins and managers · most recent first
        </p>

        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)' }}>Loading…</p>
        ) : logs.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
            color: 'rgba(245,242,236,0.25)', fontSize: '0.85rem',
          }}>
            No log entries yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {logs.map(entry => (
              <div key={entry.id} style={{
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${entry.action === 'delete_report' ? 'rgba(220,50,50,0.2)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: '4px',
                padding: '0.85rem 1.1rem',
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '0.75rem 1.25rem',
                alignItems: 'start',
              }}>
                {/* Action badge */}
                <span style={{
                  display: 'inline-block',
                  backgroundColor: entry.action === 'delete_report'
                    ? 'rgba(220,50,50,0.15)'
                    : 'rgba(0,160,152,0.12)',
                  border: `1px solid ${entry.action === 'delete_report' ? 'rgba(220,50,50,0.35)' : 'rgba(0,160,152,0.3)'}`,
                  color: entry.action === 'delete_report' ? 'rgba(220,100,100,0.9)' : 'var(--teal)',
                  borderRadius: '2px', padding: '0.2rem 0.6rem',
                  fontSize: '0.66rem', letterSpacing: '0.1em', fontWeight: 600,
                  whiteSpace: 'nowrap', marginTop: '2px',
                }}>
                  {entry.action === 'delete_report' ? 'DELETED' : 'EDITED QTY'}
                </span>

                {/* Detail */}
                <div>
                  {entry.action === 'edit_quantity' ? (
                    <p style={{ fontSize: '0.88rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 600 }}>{entry.itemName}</span>
                      {' '}
                      <span style={{ color: 'rgba(220,90,90,0.8)' }}>{entry.oldQty}</span>
                      {' → '}
                      <span style={{ color: 'var(--teal)', fontWeight: 600 }}>{entry.newQty}</span>
                      {' '}
                      <span style={{ color: 'rgba(245,242,236,0.4)', fontSize: '0.82rem' }}>
                        {entry.unit ? UNIT_LABELS[entry.unit as keyof typeof UNIT_LABELS] ?? entry.unit : ''}
                      </span>
                    </p>
                  ) : (
                    <p style={{ fontSize: '0.88rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
                      Deleted report{' '}
                      <span style={{ color: 'rgba(245,242,236,0.5)' }}>({entry.deletedCount ?? 0} items)</span>
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.73rem', color: 'rgba(245,242,236,0.35)' }}>
                      {entry.branch} · {entry.weekLabel}
                    </span>
                    <span style={{ fontSize: '0.73rem', color: 'rgba(245,242,236,0.3)' }}>
                      {entry.staffEmail}
                    </span>
                    <span style={{ fontSize: '0.73rem', color: 'rgba(245,242,236,0.22)' }}>
                      {fmtTs(entry.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
