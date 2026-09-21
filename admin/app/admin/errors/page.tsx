'use client'

// What broke, for whom, and how often. Phase 05 groundwork, 12 Sep 2026.
//
// One row per distinct fault rather than per occurrence — see
// shared/src/errorReport.ts for why the fingerprint is the document id. The
// count is the column that matters: "seen 340 times since this morning" is a
// different conversation from "seen twice last week", and a list of individual
// occurrences buries both.
//
// Admin only, gated the same way /admin/logs is — `useRequireRole(['admin'])`
// rather than a new SECTION_ACCESS key. CLAUDE.md warns against adding keys
// casually because /admin/users renders a grant checkbox per key, and "can see
// the crash reports" is not a shift-by-shift permission anybody hands out.

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { useRequireRole } from '@big-cms/shared/adminAuth'
import { timestampMs } from '@big-cms/shared/timestamps'

// Duplicated per file by convention — see CLAUDE.md. Don't refactor to share.
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

interface ErrorRow {
  id: string
  app: 'web' | 'admin' | 'pos'
  message: string
  stack: string
  digest: string
  path: string
  count: number
  firstSeenAt: unknown
  lastSeenAt: unknown
}

const APP_COLOUR: Record<string, string> = {
  pos: 'var(--teal)',
  admin: 'var(--purple)',
  web: 'var(--brand-secondary)',
}

function when(value: unknown): string {
  // 0 as the fallback, not Date.now(): a report with no timestamp yet should
  // read as unknown, not as "just now", which is a fact rather than a gap.
  const ms = timestampMs(value, 0)
  if (!ms) return '—'
  const mins = Math.round((Date.now() - ms) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / (60 * 24))}d ago`
}

export default function AdminErrorsPage() {
  const { checking } = useRequireRole(['admin'])
  const isMobile = useIsMobile()
  const [rows, setRows] = useState<ErrorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [appFilter, setAppFilter] = useState<'all' | ErrorRow['app']>('all')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(
          query(collection(db, 'errorReports'), orderBy('lastSeenAt', 'desc'), limit(200))
        )
        setRows(snap.docs.map(d => ({ id: d.id, ...d.data() } as ErrorRow)))
      } catch (err) {
        // The commonest cause by far is the rule for this collection not being
        // deployed yet, and a silent empty list would read as "nothing has
        // broken" — which is the most reassuring possible way to be wrong.
        console.error('[admin/errors] could not read the reports:', err)
        setError('Could not read the error reports. If this section is new, the Firestore rule for `errorReports` may not be deployed yet.')
      }
      setLoading(false)
    }
    load()
  }, [])

  const shown = useMemo(
    () => appFilter === 'all' ? rows : rows.filter(r => r.app === appFilter),
    [rows, appFilter],
  )
  const total = useMemo(() => shown.reduce((s, r) => s + (r.count ?? 0), 0), [shown])

  if (checking) return null

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '1.25rem 1rem 4rem' : '2rem 2rem 5rem',
      fontFamily: 'var(--font-inter)', color: 'var(--offwhite)',
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        <p style={{
          fontSize: '0.6rem', letterSpacing: '0.25em', textTransform: 'uppercase',
          color: 'var(--teal)', marginBottom: '0.3rem',
        }}>Diagnostics</p>
        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.5rem' : '1.9rem',
          marginBottom: '0.5rem',
        }}>What broke</h1>
        <p style={{
          fontSize: '0.84rem', lineHeight: 1.7,
          color: 'rgba(var(--offwhite-rgb),0.45)', marginBottom: '1.4rem', maxWidth: '60ch',
        }}>
          One row per distinct fault, newest first. The count is how many times it has been
          seen — the same fault from fifty phones is one row with fifty against it, not fifty
          rows. Nothing here is a customer&apos;s data: messages and paths are scrubbed before
          they are written.
        </p>

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.2rem' }}>
          {(['all', 'pos', 'admin', 'web'] as const).map(a => (
            <button key={a} onClick={() => setAppFilter(a)} style={{
              minHeight: '38px', padding: '0 0.9rem', borderRadius: '4px', cursor: 'pointer',
              backgroundColor: appFilter === a ? 'rgba(var(--overlay-rgb),0.08)' : 'transparent',
              border: `1px solid ${appFilter === a ? 'rgba(var(--overlay-rgb),0.25)' : 'rgba(var(--overlay-rgb),0.1)'}`,
              color: 'var(--offwhite)', fontFamily: 'var(--font-inter)', fontSize: '0.78rem',
            }}>{a === 'all' ? 'All three' : a}</button>
          ))}
          <span style={{
            marginLeft: 'auto', alignSelf: 'center',
            fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.4)',
          }}>{shown.length} faults · {total.toLocaleString('en-US')} occurrences</span>
        </div>

        {error && (
          <p style={{
            color: 'var(--brand-secondary)', fontSize: '0.82rem', lineHeight: 1.6,
            background: 'rgba(var(--brand-secondary-rgb),0.08)',
            border: '1px solid rgba(var(--brand-secondary-rgb),0.25)',
            borderRadius: '4px', padding: '0.8rem 0.9rem', marginBottom: '1rem',
          }}>{error}</p>
        )}

        {loading ? (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontSize: '0.85rem' }}>Loading…</p>
        ) : shown.length === 0 && !error ? (
          <p style={{
            color: 'rgba(var(--offwhite-rgb),0.3)', fontSize: '0.9rem',
            lineHeight: 1.8, padding: '2.5rem 0', textAlign: 'center',
          }}>
            Nothing has been reported.<br />
            That is either good news or a sign nothing is reporting — the seam is in each
            app&apos;s <code>error.tsx</code>.
          </p>
        ) : (
          shown.map(r => (
            <div key={r.id} style={{
              border: '1px solid rgba(var(--overlay-rgb),0.1)', borderRadius: '6px',
              padding: '0.9rem 1rem', marginBottom: '0.6rem',
            }}>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '0.6rem', letterSpacing: '0.14em', textTransform: 'uppercase',
                  color: APP_COLOUR[r.app] ?? 'var(--offwhite)',
                }}>{r.app}</span>
                <span style={{
                  fontSize: '0.82rem', flex: 1, minWidth: '12rem',
                  wordBreak: 'break-word',
                }}>{r.message}</span>
                <span style={{
                  fontSize: '0.8rem', fontWeight: 700,
                  color: (r.count ?? 0) > 20 ? 'var(--red)' : 'rgba(var(--offwhite-rgb),0.6)',
                }}>×{(r.count ?? 0).toLocaleString('en-US')}</span>
              </div>

              <div style={{
                display: 'flex', gap: '0.9rem', flexWrap: 'wrap', marginTop: '0.45rem',
                fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.35)',
              }}>
                {r.path && <span>{r.path}</span>}
                <span>last {when(r.lastSeenAt)}</span>
                <span>first {when(r.firstSeenAt)}</span>
                {r.digest && <span>ref {r.digest}</span>}
                {r.stack && (
                  <button
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      color: 'var(--teal)', fontFamily: 'var(--font-inter)', fontSize: '0.72rem',
                    }}
                  >{open === r.id ? 'hide stack' : 'stack'}</button>
                )}
              </div>

              {open === r.id && (
                <pre style={{
                  marginTop: '0.7rem', padding: '0.7rem', borderRadius: '4px',
                  background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(var(--overlay-rgb),0.08)',
                  fontSize: '0.7rem', lineHeight: 1.6, color: 'rgba(var(--offwhite-rgb),0.6)',
                  overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>{r.stack}</pre>
              )}
            </div>
          ))
        )}
      </div>
    </main>
  )
}
