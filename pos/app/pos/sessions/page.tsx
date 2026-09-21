'use client'

// Where you are signed in at this café hub, and ending it from here (UPGRADE.md
// T6.5): the counter PC, a kitchen screen, another phone, with when each
// started and was last used. A manager or admin sees everybody's, for instance
// to sign out somebody who went home still signed in on the counter. The staff
// app shows this page too, since it opens the till's own pages.
//
// On a hub only: the online till's sign-ins are Firebase's, one per browser.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { faArrowLeft, faRightFromBracket } from '@fortawesome/free-solid-svg-icons'
import { startLoad } from '@big-cms/shared/startLoad'
import { useClientValue } from '@big-cms/shared/useClientValue'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { BRAND } from '@big-cms/shared/brand'
import { useTillAccess } from '../../lib/useTillAccess'
import { SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { backend } from '../../lib/backend'
import { PosButton, PosLoading, ErrorNote, StatusBadge } from '../../lib/posUi'
import { signOutHere } from '../../lib/SignOutButton'

interface Row { id: string; uid: string; name: string; email: string | null; device: string; scope: string | null; startedAt: number; lastActiveAt: number; expiresAt: number; current: boolean }

const time = (ms: number) => (ms ? new Date(ms).toLocaleTimeString('en-GB', { timeZone: BRAND.locale.timezone, hour: '2-digit', minute: '2-digit' }) : '—')
const words = (err: unknown, fallback: string) =>
  isNetworkFailure(err) ? 'No answer from the hub. Try again.' : err instanceof Error ? err.message : fallback

export default function SessionsPage() {
  const router = useRouter()
  const { checking } = useTillAccess(SECTION_ACCESS.pos)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [everyone, setEveryone] = useState(false)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  // Read after hydrating: the server renders without knowing it is a hub page.
  const onHub = useClientValue(() => backend().kind === 'hub', false)

  async function load() {
    try {
      const data = await backend().request('GET', '/api/hub/sessions')
      setRows((data.sessions ?? []) as Row[])
      setEveryone(data.everyone === true)
    } catch (err) {
      setProblem(words(err, 'The sessions could not be read.'))
    }
  }

  useEffect(() => {
    if (checking || backend().kind !== 'hub') return
    startLoad(load)
  }, [checking])

  async function end(row: Row) {
    if (row.current) { void signOutHere(); return }
    setBusy(row.id)
    setProblem('')
    try {
      await backend().request('POST', '/api/hub/sessions', { id: row.id })
      await load()
    } catch (err) {
      setProblem(words(err, 'That session was not ended.'))
    } finally {
      setBusy(null)
    }
  }

  if (checking) return <PosLoading />
  return (
    <main style={{ minHeight: '100vh', background: 'var(--black)', color: 'var(--offwhite)', fontFamily: 'var(--font-inter)', padding: '1.25rem' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        <PosButton icon={faArrowLeft} label="Floor" tone="quiet" size="sm" onClick={() => router.push('/pos')} />
        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', margin: '0.9rem 0 0.3rem' }}>{everyone ? 'Signed in at this hub' : 'Where you are signed in'}</h1>
        <p style={{ color: 'rgba(var(--offwhite-rgb),0.6)', marginBottom: '1rem' }}>
          {everyone ? 'Everybody signed in on the counter PC, a phone or a kitchen screen. End any of them.' : 'End any of them here. A manager can end anybody\'s.'}
        </p>
        {!onHub ? (
          <p>This is for a café hub. On the online till, each browser signs in on its own.</p>
        ) : !rows ? <PosLoading label="Reading the sessions…" /> : rows.length === 0 ? (
          <p>Nobody is signed in.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.6rem' }}>
            {rows.map(r => (
              <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', padding: '0.8rem 1rem', background: 'var(--surface-deep)', borderRadius: '10px' }}>
                <div>
                  <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                    {r.scope === 'kds' ? 'Kitchen screen' : r.name || r.email || 'Someone'} · {r.device}
                    {r.current && <span style={{ marginLeft: '0.5rem' }}><StatusBadge label="this device" tone="primary" /></span>}
                  </p>
                  <p style={{ color: 'rgba(var(--offwhite-rgb),0.6)', fontSize: '0.9rem' }}>
                    Since {time(r.startedAt)} · last used {time(r.lastActiveAt)} · ends by {time(r.expiresAt)}
                  </p>
                </div>
                <PosButton icon={faRightFromBracket} label={r.current ? 'Sign out' : 'End'} tone="danger" size="sm" disabled={busy === r.id} onClick={() => { void end(r) }} />
              </li>
            ))}
          </ul>
        )}
        {problem && <div style={{ marginTop: '1rem' }}><ErrorNote message={problem} /></div>}
      </div>
    </main>
  )
}
