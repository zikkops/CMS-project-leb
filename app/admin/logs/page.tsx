'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, orderBy, limit, Timestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useRequireRole } from '../../lib/adminAuth'
import type { FieldChange } from '../../lib/activityLog'

interface LogEntry {
  id: string
  action: 'create' | 'update' | 'delete'
  section: string
  label: string
  changes?: FieldChange[] | null
  snapshot?: Record<string, unknown> | null
  userEmail: string
  createdAt: Timestamp | null
}

const ACTION_LABELS: Record<LogEntry['action'], string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
}

const ACTION_COLORS: Record<LogEntry['action'], string> = {
  create: 'var(--teal)',
  update: 'var(--purple)',
  delete: 'var(--red)',
}

const SNAPSHOT_HIDE = ['image', 'description']

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    return entries.length ? entries.map(([k, val]) => `${k}: ${val}`).join(', ') : '—'
  }
  const s = String(v)
  return s.length > 60 ? s.slice(0, 60) + '…' : s
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return isMobile
}

function Details({ log }: { log: LogEntry }) {
  const rowStyle = { fontSize: '0.76rem', fontFamily: 'var(--font-inter)', lineHeight: 1.6 }

  if (log.action === 'update' && log.changes && log.changes.length > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
        {log.changes.map(c => (
          <div key={c.field} style={rowStyle}>
            <span style={{ color: 'rgba(245,242,236,0.4)' }}>{c.field}:</span>{' '}
            <span style={{ color: 'rgba(228,51,41,0.7)' }}>{formatValue(c.before)}</span>
            <span style={{ color: 'rgba(245,242,236,0.3)' }}> → </span>
            <span style={{ color: 'var(--teal)' }}>{formatValue(c.after)}</span>
          </div>
        ))}
      </div>
    )
  }

  if (log.snapshot) {
    const entries = Object.entries(log.snapshot).filter(([k]) => !SNAPSHOT_HIDE.includes(k))
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
        {entries.map(([k, v]) => (
          <div key={k} style={rowStyle}>
            <span style={{ color: 'rgba(245,242,236,0.4)' }}>{k}:</span>{' '}
            <span style={{ color: 'rgba(245,242,236,0.6)' }}>{formatValue(v)}</span>
          </div>
        ))}
      </div>
    )
  }

  return <span style={{ color: 'rgba(245,242,236,0.2)' }}>—</span>
}

export default function AdminLogsPage() {
  const { checking } = useRequireRole(['admin'])
  const isMobile = useIsMobile()
  const [logs, setLogs]       = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionFilter, setActionFilter] = useState<'all' | LogEntry['action']>('all')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function load() {
      const snap = await getDocs(
        query(collection(db, 'activityLog'), orderBy('createdAt', 'desc'), limit(300))
      )
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as LogEntry)))
      setLoading(false)
    }
    load()
  }, [])

  const sections = useMemo(
    () => Array.from(new Set(logs.map(l => l.section))).sort(),
    [logs]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logs.filter(log => {
      if (actionFilter !== 'all' && log.action !== actionFilter) return false
      if (sectionFilter !== 'all' && log.section !== sectionFilter) return false
      if (q) {
        const matchesLabel = log.label.toLowerCase().includes(q)
        const matchesField = log.changes?.some(c => c.field.toLowerCase().includes(q)) ?? false
        const matchesSnapshotField = log.snapshot
          ? Object.keys(log.snapshot).some(k => k.toLowerCase().includes(q))
          : false
        if (!matchesLabel && !matchesField && !matchesSnapshotField) return false
      }
      return true
    })
  }, [logs, actionFilter, sectionFilter, search])

  if (checking) return null

  const inputStyle = {
    backgroundColor: '#1a1a1a',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#F5F2EC',
    padding: '0.6rem 0.9rem',
    borderRadius: '2px',
    fontSize: '0.82rem',
    outline: 'none',
    fontFamily: 'var(--font-inter)',
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '1300px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin" style={{
            fontSize: '0.7rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)',
            textDecoration: 'none',
            fontFamily: 'var(--font-inter)',
            marginBottom: '0.5rem',
            display: 'block',
          }}>← Back to Dashboard</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)' }}>
            Activity Log
          </h1>
        </div>

        <p style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '0.78rem',
          color: 'rgba(245,242,236,0.3)',
          marginBottom: '1.5rem',
          lineHeight: 1.6,
        }}>
          Every entry created, edited, or deleted across the admin panel, with who made the change and when.
          Visible to Admins only.
        </p>

        {/* Filters */}
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: '0.8rem',
          marginBottom: '2rem',
        }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {(['all', 'create', 'update', 'delete'] as const).map(a => (
              <button key={a} onClick={() => setActionFilter(a)} style={{
                backgroundColor: actionFilter === a ? (a === 'all' ? 'var(--offwhite)' : ACTION_COLORS[a]) : 'transparent',
                border: `1px solid ${actionFilter === a ? 'transparent' : 'rgba(255,255,255,0.1)'}`,
                color: actionFilter === a ? '#0a0a0a' : 'rgba(245,242,236,0.5)',
                padding: '0.5rem 1rem',
                borderRadius: '2px',
                fontSize: '0.72rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontFamily: 'var(--font-inter)',
              }}>{a === 'all' ? 'All' : ACTION_LABELS[a]}</button>
            ))}
          </div>

          <select
            value={sectionFilter}
            onChange={e => setSectionFilter(e.target.value)}
            style={{ ...inputStyle, color: '#F5F2EC', backgroundColor: '#1a1a1a', minWidth: isMobile ? 'auto' : '180px' }}
          >
            <option value="all">All Sections</option>
            {sections.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <input
            type="text"
            placeholder="Search item or field (e.g. price)…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
        </div>

        {/* Table */}
        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)',
            borderRadius: '4px',
            padding: '4rem',
            textAlign: 'center',
            color: 'rgba(245,242,236,0.2)',
            fontFamily: 'var(--font-inter)',
          }}>No activity matches these filters.</div>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {filtered.map(log => (
              <div key={log.id} style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '4px',
                padding: '1rem 1.2rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '0.25rem 0.7rem',
                    borderRadius: '2px',
                    backgroundColor: `${ACTION_COLORS[log.action]}25`,
                    color: ACTION_COLORS[log.action],
                    fontFamily: 'var(--font-inter)',
                    letterSpacing: '0.05em',
                    whiteSpace: 'nowrap',
                  }}>{ACTION_LABELS[log.action] ?? log.action}</span>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)', whiteSpace: 'nowrap' }}>
                    {log.createdAt?.toDate().toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) ?? '—'}
                  </span>
                </div>
                <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--offwhite)' }}>
                  {log.section} — {log.label}
                </p>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)' }}>
                  {log.userEmail}
                </p>
                <div style={{ paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <Details log={log} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Time', 'User', 'Action', 'Section', 'Item', 'Details'].map(h => (
                    <th key={h} style={{
                      padding: '1rem 1.2rem',
                      textAlign: 'left',
                      fontSize: '0.65rem',
                      letterSpacing: '0.2em',
                      textTransform: 'uppercase',
                      color: 'rgba(245,242,236,0.3)',
                      fontFamily: 'var(--font-inter)',
                      fontWeight: 400,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(log => (
                  <tr key={log.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.5)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      {log.createdAt?.toDate().toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) ?? '—'}
                    </td>
                    <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)', verticalAlign: 'top' }}>
                      {log.userEmail}
                    </td>
                    <td style={{ padding: '1rem 1.2rem', verticalAlign: 'top' }}>
                      <span style={{
                        fontSize: '0.7rem',
                        padding: '0.25rem 0.7rem',
                        borderRadius: '2px',
                        backgroundColor: `${ACTION_COLORS[log.action]}25`,
                        color: ACTION_COLORS[log.action],
                        fontFamily: 'var(--font-inter)',
                        letterSpacing: '0.05em',
                        whiteSpace: 'nowrap',
                      }}>{ACTION_LABELS[log.action] ?? log.action}</span>
                    </td>
                    <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.5)', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      {log.section}
                    </td>
                    <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.5)', verticalAlign: 'top' }}>
                      {log.label}
                    </td>
                    <td style={{ padding: '1rem 1.2rem', verticalAlign: 'top' }}>
                      <Details log={log} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
