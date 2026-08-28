'use client'

import { useEffect, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import { listEndOfDayLogs, type EndOfDayLog } from '../../../lib/endOfDay'

function fmtTs(ts: { seconds: number } | null): string {
  if (!ts) return '—'
  return new Date(ts.seconds * 1000).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function EndOfDayLogPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [logs,    setLogs]    = useState<EndOfDayLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (checking) return
    listEndOfDayLogs().then(data => { setLogs(data); setLoading(false) })
  }, [checking])

  if (checking) return null

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '3rem', fontFamily: 'var(--font-inter)' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>

        <a href="/admin/end-of-day" style={{
          fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
          color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
          display: 'block', marginBottom: '0.5rem',
        }}>← End of Day</a>

        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.25rem' }}>
          End of Day Log
        </h1>
        <p style={{ fontSize: '0.8rem', color: 'rgba(245,242,236,0.3)', marginBottom: '2rem' }}>
          All report submits and updates · most recent first
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
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '4px',
                padding: '0.85rem 1.1rem',
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '0.75rem 1.25rem',
                alignItems: 'center',
              }}>
                {/* Action badge */}
                <span style={{
                  display: 'inline-block',
                  backgroundColor: entry.action === 'submit'
                    ? 'rgba(0,160,152,0.12)'
                    : 'rgba(201,150,44,0.12)',
                  border: `1px solid ${entry.action === 'submit' ? 'rgba(0,160,152,0.3)' : 'rgba(201,150,44,0.3)'}`,
                  color: entry.action === 'submit' ? 'var(--teal)' : '#C9962C',
                  borderRadius: '2px', padding: '0.2rem 0.6rem',
                  fontSize: '0.66rem', letterSpacing: '0.1em', fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>
                  {entry.action === 'submit' ? 'SUBMITTED' : 'UPDATED'}
                </span>

                {/* Detail */}
                <div>
                  <p style={{ fontSize: '0.88rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
                    <span style={{ fontWeight: 600 }}>{entry.branch}</span>
                    {' · '}
                    <span style={{ color: 'rgba(245,242,236,0.6)' }}>{entry.date}</span>
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.73rem', color: 'rgba(245,242,236,0.35)' }}>
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
