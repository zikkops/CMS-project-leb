'use client'

// Café hubs: the counter PCs that run the POS for a branch with no internet.
// POS software, stage 4.
//
// Admin only, like Printers. Pairing gives a PC this café's menu, settings and
// staff roles; unpairing is what happens to a PC that walked out of the building.
//
// ── A code, shown once ─────────────────────────────────────────────────────
// The code is on this screen and nowhere else: the cloud keeps only a hash of
// it, it is not in the activity log, and it works once, for fifteen minutes.
// So it is shown big enough to read across a counter, with how long it has
// left, and the list below refreshes while it is showing, so the new hub
// appears here as soon as it pairs.

import { useEffect, useState } from 'react'
import { useRequireRole, type Role } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { BRANCHES } from '@big-cms/shared/branches'
import { BRAND } from '@big-cms/shared/brand'
import { PAIRING_CODE_MINUTES, formatPairingCode } from '@big-cms/shared/hubSync'
import { startLoad } from '@big-cms/shared/startLoad'

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

interface HubRow {
  id: string
  name: string
  branch: string
  pairedAt: number | null
  pairedByEmail: string
  lastSeenAt: number | null
  revoked: boolean
  revokedAt: number | null
  onlineSince: number | null
  onlineByEmail: string
  caughtUpAt: number | null
  heldWaiting: number
  /** Who is signed in at the hub, as it last reported (T6.5). */
  sessions: { id: string; name: string; email: string; device: string; kitchenScreen: boolean; startedAt: number; lastActiveAt: number }[]
  sessionsAt: number | null
  endSessions: string[]
}

type HubAction = 'revoke' | 'online' | 'handback'

interface Issued {
  code: string
  expiresAt: number
  branch: string
  name: string
}

const label: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-inter)',
  fontSize: '0.62rem',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'rgba(var(--offwhite-rgb),0.35)',
  marginBottom: '0.35rem',
}

const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: '42px',
  padding: '0.5rem 0.7rem',
  backgroundColor: 'rgba(var(--offwhite-rgb),0.04)',
  border: '1px solid rgba(var(--offwhite-rgb),0.12)',
  borderRadius: '3px',
  color: 'var(--offwhite)',
  fontFamily: 'var(--font-inter)',
  fontSize: '0.85rem',
}

const panel: React.CSSProperties = {
  marginBottom: '2rem',
  padding: '1.4rem 1.5rem',
  backgroundColor: 'rgba(var(--offwhite-rgb),0.02)',
  border: '1px solid rgba(var(--offwhite-rgb),0.07)',
  borderRadius: '4px',
}

const panelTitle: React.CSSProperties = {
  fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.2em',
  textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.55)',
  marginBottom: '1rem',
}

const button = (tone: 'main' | 'danger' | 'quiet', busy = false): React.CSSProperties => ({
  minHeight: '44px', padding: '0 1.4rem', borderRadius: '4px',
  fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600,
  letterSpacing: '0.08em', textTransform: 'uppercase',
  cursor: busy ? 'default' : 'pointer',
  border: tone === 'quiet' ? '1px solid rgba(var(--offwhite-rgb),0.2)' : 'none',
  backgroundColor: tone === 'main' ? (busy ? 'rgba(var(--teal-rgb),0.35)' : 'var(--teal)')
    : tone === 'danger' ? 'var(--red)' : 'transparent',
  color: tone === 'quiet' ? 'rgba(var(--offwhite-rgb),0.75)' : '#fff',
})

/** A moment in the café's day, whatever zone this browser is in. */
function when(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: BRAND.locale.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function ago(ms: number | null, now: number): string {
  if (!ms) return 'not yet'
  const minutes = Math.round((now - ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : when(ms)
}

function HubCard({
  hub, now, confirming, busy, onAsk, onCancel, onConfirm, onEndSession,
}: {
  hub: HubRow
  now: number
  confirming: HubAction | null
  busy: boolean
  onAsk: (action: HubAction) => void
  onCancel: () => void
  onConfirm: (action: HubAction) => void
  onEndSession?: (sessionId: string) => void
}) {
  const online = hub.onlineSince !== null
  const confirmText: Record<HubAction, string> = {
    revoke: `Unpair ${hub.name || 'this hub'}? It stops taking the menu and settings at its next pull, and has to be paired again with a new code.`,
    online: `Switch ${hub.branch} to the online till? Do this only when ${hub.name || 'the counter PC'} is out of action: the online till opens for ${hub.branch} straight away, the counter PC stops taking orders as soon as it is back in touch, and whatever it sends up then is held for a manager in Held Hub Sales.`,
    handback: `Hand ${hub.branch} back to ${hub.name || 'the counter PC'}? The online till becomes view-only there again, and the counter PC starts clean, with no tables or drawer shift of its own.`,
  }
  const confirmLabel: Record<HubAction, [string, string]> = {
    revoke: ['Unpair', 'Unpairing…'],
    online: ['Trade online', 'Switching…'],
    handback: ['Hand back', 'Handing back…'],
  }
  return (
    <div style={{ padding: '1rem 0', borderTop: '1px solid rgba(var(--offwhite-rgb),0.07)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1rem', color: 'var(--offwhite)' }}>
          {hub.name || 'Unnamed hub'}
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.45)', marginLeft: '0.6rem' }}>{hub.branch}</span>
        </span>
        <span style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.12em', textTransform: 'uppercase',
          color: hub.revoked ? 'rgba(var(--offwhite-rgb),0.4)' : online ? 'var(--brand-secondary)' : 'var(--teal)',
        }}>{hub.revoked ? `Unpaired ${when(hub.revokedAt)}` : online ? 'Branch trading online' : 'Paired'}</span>
      </div>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.5)', lineHeight: 1.7, margin: '0.35rem 0 0' }}>
        Paired {when(hub.pairedAt)}{hub.pairedByEmail ? ` by ${hub.pairedByEmail}` : ''}
        {!hub.revoked && <> · last took the menu {ago(hub.lastSeenAt, now)}</>}
      </p>

      {!hub.revoked && online && (
        <div style={{
          marginTop: '0.7rem', padding: '0.8rem 1rem', borderRadius: '4px',
          border: '1px solid color-mix(in srgb, var(--brand-secondary) 55%, transparent)',
          backgroundColor: 'color-mix(in srgb, var(--brand-secondary) 10%, transparent)',
          fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.8)', lineHeight: 1.7,
        }}>
          {hub.branch} has traded on the online till since {when(hub.onlineSince)}{hub.onlineByEmail ? ` (switched by ${hub.onlineByEmail})` : ''}.
          {' '}{hub.caughtUpAt && hub.onlineSince && hub.caughtUpAt >= hub.onlineSince
            ? `The counter PC has been back in touch with nothing left unsent (${when(hub.caughtUpAt)}).`
            : 'The counter PC has not been back in touch since, so it may still hold sales it never sent up.'}
          {hub.heldWaiting > 0 && (
            <> {' '}<a href="/admin/settings/hubs/held" style={{ color: 'var(--teal)' }}>
              {hub.heldWaiting === 1 ? 'One item it sent up waits' : `${hub.heldWaiting} items it sent up wait`} in Held Hub Sales.
            </a></>
          )}
        </div>
      )}

      {!hub.revoked && (hub.sessions ?? []).length > 0 && (
        <div style={{ marginTop: '0.7rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.8)' }}>
          <p style={{ marginBottom: '0.35rem', color: 'rgba(var(--offwhite-rgb),0.55)' }}>
            Signed in there{hub.sessionsAt ? `, as of ${ago(hub.sessionsAt, now)}` : ''}. Ending one happens at the hub&apos;s next sync, within two minutes.
          </p>
          {hub.sessions.map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', alignItems: 'center', padding: '0.3rem 0' }}>
              <span>{s.kitchenScreen ? 'Kitchen screen' : s.name || s.email || 'Someone'} · {s.device} · since {when(s.startedAt)}</span>
              {(hub.endSessions ?? []).includes(s.id)
                ? <span style={{ color: 'rgba(var(--offwhite-rgb),0.55)' }}>Ending at the next sync</span>
                : onEndSession && <button type="button" onClick={() => onEndSession(s.id)} disabled={busy} style={button('quiet', busy)}>End</button>}
            </div>
          ))}
        </div>
      )}

      {!hub.revoked && !confirming && (
        <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: '0.7rem' }}>
          <button type="button" onClick={() => onAsk('revoke')} style={button('quiet')}>Unpair</button>
          {online
            ? <button type="button" onClick={() => onAsk('handback')} style={button('main')}>Hand back to the counter PC</button>
            : <button type="button" onClick={() => onAsk('online')} style={button('quiet')}>Trade online</button>}
        </div>
      )}
      {!hub.revoked && confirming && (
        <div style={{ marginTop: '0.8rem' }}>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.75)', lineHeight: 1.6, marginBottom: '0.7rem', maxWidth: '58ch' }}>
            {confirmText[confirming]}
          </p>
          <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'space-between', maxWidth: '360px' }}>
            <button type="button" onClick={onCancel} disabled={busy} style={button('quiet', busy)}>Cancel</button>
            <button type="button" onClick={() => onConfirm(confirming)} disabled={busy}
              style={button(confirming === 'revoke' ? 'danger' : 'main', busy)}>
              {busy ? confirmLabel[confirming][1] : confirmLabel[confirming][0]}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function HubsPage() {
  const { checking } = useRequireRole(['admin'] as Role[])
  const isMobile = useIsMobile()

  const [hubs, setHubs] = useState<HubRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [branch, setBranch] = useState<string>(BRANCHES[0] ?? '')
  const [name, setName] = useState('')
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [confirming, setConfirming] = useState<{ id: string; action: HubAction } | null>(null)
  const [acting, setActing] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  async function loadHubs() {
    try {
      const data = await unwrap(await authedFetch('/api/admin/hubs', 'GET')) as { hubs: HubRow[] }
      setHubs(data.hubs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the hubs.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (checking) return
    startLoad(loadHubs)
  }, [checking])

  // The countdown, and — while a code is showing — the list, so a hub that
  // pairs appears without a reload.
  const live = Boolean(issued && issued.expiresAt > now)
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])
  useEffect(() => {
    if (!live) return
    const poll = setInterval(() => { void loadHubs() }, 10_000)
    return () => clearInterval(poll)
  }, [live])

  async function issue() {
    setIssuing(true)
    setError('')
    try {
      const data = await unwrap(await authedFetch('/api/admin/hubs', 'POST', { branch, name })) as unknown as Issued
      setIssued(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make a pairing code.')
    } finally {
      setIssuing(false)
    }
  }

  async function act(id: string, action: HubAction) {
    setActing(true)
    setError('')
    try {
      await unwrap(await authedFetch('/api/admin/hubs', 'PATCH', { deviceId: id, action }))
      setConfirming(null)
      await loadHubs()
    } catch (err) {
      // A refused hand-back says what is still in the way (S23).
      setError(err instanceof Error ? err.message : 'Could not change the hub.')
      setConfirming(null)
    } finally {
      setActing(false)
    }
  }

  async function endSession(id: string, sessionId: string) {
    setActing(true)
    setError('')
    try {
      await unwrap(await authedFetch('/api/admin/hubs', 'PATCH', { deviceId: id, action: 'endSession', sessionId }))
      await loadHubs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end that session.')
    } finally {
      setActing(false)
    }
  }

  if (checking) return null

  const left = issued ? Math.max(0, issued.expiresAt - now) : 0
  const mm = Math.floor(left / 60_000)
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')
  const active = hubs.filter(h => !h.revoked)
  const unpaired = hubs.filter(h => h.revoked)

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '2rem 1.25rem 4rem' : '3rem 2.5rem 5rem',
    }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.25em',
          textTransform: 'uppercase', color: 'var(--teal)', marginBottom: '0.6rem',
        }}>Settings</p>
        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.7rem' : '2.2rem',
          color: 'var(--offwhite)', marginBottom: '0.6rem',
        }}>Café Hubs</h1>
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          color: 'rgba(var(--offwhite-rgb),0.4)', lineHeight: 1.7,
          marginBottom: '2.5rem', maxWidth: '56ch',
        }}>
          A café hub is a counter PC running the POS app as the hub: the till keeps
          taking orders there with no internet. Pair it here once, and it takes this
          café&apos;s menu, settings and staff roles every few minutes while it is online.
          While a branch has a hub paired, the online till for that branch is view-only:
          tables, payments and the drawer are worked on the counter PC.
        </p>
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          color: 'rgba(var(--offwhite-rgb),0.4)', lineHeight: 1.7,
          marginTop: '-1.5rem', marginBottom: '2.5rem', maxWidth: '56ch',
        }}>
          If a counter PC is out of action, <strong>Trade online</strong> opens the online till for
          its branch. When the PC is back and has synced, close the online tables and the drawer
          shift, decide anything it sent up in <a href="/admin/settings/hubs/held" style={{ color: 'var(--teal)' }}>Held Hub Sales</a>,
          then hand the branch back.
        </p>

        <section style={panel}>
          <h2 style={panelTitle}>Pair a new hub</h2>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.4fr', gap: '0.8rem', marginBottom: '1rem' }}>
            <div>
              <span style={label}>Branch</span>
              <select value={branch} onChange={e => setBranch(e.target.value)} style={field}>
                {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <span style={label}>A name for the PC</span>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Counter PC" maxLength={60} style={field} />
            </div>
          </div>
          <button type="button" onClick={issue} disabled={issuing || !name.trim()} style={button('main', issuing || !name.trim())}>
            {issuing ? 'Making a code…' : 'Get a pairing code'}
          </button>

          {issued && left > 0 && (
            <div style={{ marginTop: '1.4rem', paddingTop: '1.2rem', borderTop: '1px solid rgba(var(--offwhite-rgb),0.07)' }}>
              <span style={label}>Pairing code for {issued.name} at {issued.branch}</span>
              <p style={{
                fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: isMobile ? '2rem' : '2.6rem',
                letterSpacing: '0.12em', color: 'var(--offwhite)', margin: '0.2rem 0 0.4rem',
              }}>{formatPairingCode(issued.code)}</p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.55)', lineHeight: 1.7 }}>
                Works once, for {mm}:{ss} more. On the counter PC, open the POS app; on its sign-in
                screen choose <strong>Pair it</strong>, and type this code. This page shows the hub
                below as soon as it pairs.
              </p>
            </div>
          )}
          {issued && left === 0 && (
            <p style={{ marginTop: '1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>
              That code has run out ({PAIRING_CODE_MINUTES} minutes). Get a new one when you are at the PC.
            </p>
          )}
        </section>

        {error && (
          <p style={{ color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', marginBottom: '1rem', lineHeight: 1.6 }}>{error}</p>
        )}

        <section style={{ ...panel, paddingBottom: '0.6rem' }}>
          <h2 style={{ ...panelTitle, marginBottom: '0.2rem' }}>Paired hubs</h2>
          {loading && <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)', padding: '1rem 0' }}>Loading…</p>}
          {!loading && active.length === 0 && (
            <p style={{ color: 'rgba(var(--offwhite-rgb),0.4)', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', padding: '1rem 0' }}>
              No hub is paired. Every till is online-only until one is.
            </p>
          )}
          {active.map(hub => (
            <HubCard
              key={hub.id}
              hub={hub}
              now={now}
              confirming={confirming?.id === hub.id ? confirming.action : null}
              busy={acting}
              onAsk={action => setConfirming({ id: hub.id, action })}
              onCancel={() => setConfirming(null)}
              onConfirm={action => act(hub.id, action)}
              onEndSession={sessionId => { void endSession(hub.id, sessionId) }}
            />
          ))}
        </section>

        {unpaired.length > 0 && (
          <section style={{ ...panel, paddingBottom: '0.6rem' }}>
            <h2 style={{ ...panelTitle, marginBottom: '0.2rem' }}>Unpaired</h2>
            {unpaired.map(hub => (
              <HubCard key={hub.id} hub={hub} now={now} confirming={null} busy={false} onAsk={() => {}} onCancel={() => {}} onConfirm={() => {}} />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
