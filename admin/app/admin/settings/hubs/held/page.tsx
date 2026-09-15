'use client'

// Held Hub Sales — POS software, stage 4 (owner's decision S22, 15 Sep 2026).
//
// While a branch trades on the online till because its counter PC was out of
// action (S21), whatever that PC sends up when it comes back is held here, never
// applied. A manager decides each item: Apply writes the counter PC's version
// over the cloud's, Dismiss leaves the cloud as it is. Each is decided once, and
// the branch cannot go back to its hub while any wait (S23).
//
// Gated on endOfDay, the people who do the cash-up: this is deciding what the
// branch took. The server also keeps a manager to their own branches.

import { useEffect, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { BRAND } from '@big-cms/shared/brand'

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

interface HeldItem {
  id: string
  hubName: string
  branch: string
  kind: 'doc' | 'move'
  collection: string
  docId: string
  summary: string
  cloudNow: string | null
  heldAt: number | null
  status: 'waiting' | 'applied' | 'dismissed'
  decidedByEmail: string
  decidedAt: number | null
}

const panel: React.CSSProperties = {
  marginBottom: '2rem',
  padding: '1.2rem 1.5rem 0.6rem',
  backgroundColor: 'rgba(var(--offwhite-rgb),0.02)',
  border: '1px solid rgba(var(--offwhite-rgb),0.07)',
  borderRadius: '4px',
}

const panelTitle: React.CSSProperties = {
  fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.2em',
  textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.55)', marginBottom: '0.2rem',
}

const small: React.CSSProperties = { fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.55)', lineHeight: 1.7, margin: 0 }

const button = (tone: 'main' | 'quiet', busy = false): React.CSSProperties => ({
  minHeight: '44px', padding: '0 1.4rem', borderRadius: '4px',
  fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600,
  letterSpacing: '0.08em', textTransform: 'uppercase',
  cursor: busy ? 'default' : 'pointer',
  border: tone === 'quiet' ? '1px solid rgba(var(--offwhite-rgb),0.2)' : 'none',
  backgroundColor: tone === 'main' ? (busy ? 'rgba(var(--teal-rgb),0.35)' : 'var(--teal)') : 'transparent',
  color: tone === 'quiet' ? 'rgba(var(--offwhite-rgb),0.75)' : '#fff',
})

function when(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: BRAND.locale.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function ItemCard({
  item, confirming, busy, onAsk, onCancel, onDecide,
}: {
  item: HeldItem
  confirming: 'apply' | 'dismiss' | null
  busy: boolean
  onAsk: (decision: 'apply' | 'dismiss') => void
  onCancel: () => void
  onDecide: (decision: 'apply' | 'dismiss') => void
}) {
  const waiting = item.status === 'waiting'
  return (
    <div style={{ padding: '1rem 0', borderTop: '1px solid rgba(var(--offwhite-rgb),0.07)' }}>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.92rem', color: 'var(--offwhite)', lineHeight: 1.5, margin: '0 0 0.25rem' }}>
        {item.summary}
      </p>
      <p style={small}>
        From {item.hubName || 'a café hub'} at {item.branch}, sent up {when(item.heldAt)}
      </p>
      {item.kind === 'doc' && (
        <p style={{ ...small, color: 'rgba(var(--offwhite-rgb),0.75)' }}>
          {item.cloudNow ? <>The cloud has now: {item.cloudNow}</> : <>The cloud has no copy of this.</>}
        </p>
      )}
      {!waiting && (
        <p style={{ ...small, color: item.status === 'applied' ? 'var(--teal)' : 'rgba(var(--offwhite-rgb),0.45)' }}>
          {item.status === 'applied' ? 'Applied' : 'Dismissed'} {when(item.decidedAt)}{item.decidedByEmail ? ` by ${item.decidedByEmail}` : ''}
        </p>
      )}

      {waiting && !confirming && (
        <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'space-between', maxWidth: '420px', marginTop: '0.7rem' }}>
          <button type="button" onClick={() => onAsk('dismiss')} style={button('quiet')}>Dismiss</button>
          <button type="button" onClick={() => onAsk('apply')} style={button('main')}>Apply</button>
        </div>
      )}
      {waiting && confirming && (
        <div style={{ marginTop: '0.8rem' }}>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.75)', lineHeight: 1.6, marginBottom: '0.7rem', maxWidth: '56ch' }}>
            {confirming === 'apply'
              ? item.kind === 'move'
                ? 'Apply this stock movement to the cloud\'s count? It is applied once.'
                : 'Write the counter PC\'s version over what the cloud has now? What the online till did to this document is replaced.'
              : 'Dismiss it? The cloud stays as it is, and this cannot be applied afterwards.'}
          </p>
          <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'space-between', maxWidth: '420px' }}>
            <button type="button" onClick={onCancel} disabled={busy} style={button('quiet', busy)}>Cancel</button>
            <button type="button" onClick={() => onDecide(confirming)} disabled={busy} style={button(confirming === 'apply' ? 'main' : 'quiet', busy)}>
              {busy ? 'Saving…' : confirming === 'apply' ? 'Apply it' : 'Dismiss it'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function HeldHubSalesPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const isMobile = useIsMobile()
  const [items, setItems] = useState<HeldItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<{ id: string; decision: 'apply' | 'dismiss' } | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const data = await unwrap(await authedFetch('/api/admin/hub-held', 'GET')) as { items: HeldItem[] }
      setItems(data.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load what the café hubs sent up.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (checking) return
    void load()
  }, [checking])

  async function decide(id: string, decision: 'apply' | 'dismiss') {
    setBusy(true)
    setError('')
    try {
      await unwrap(await authedFetch('/api/admin/hub-held', 'PATCH', { id, decision }))
      setConfirming(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that decision.')
    } finally {
      setBusy(false)
    }
  }

  if (checking) return null

  const waiting = items.filter(i => i.status === 'waiting')
  const decided = items.filter(i => i.status !== 'waiting')

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '2rem 1.25rem 4rem' : '3rem 2.5rem 5rem' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.25em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: '0.6rem' }}>End of Day</p>
        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.7rem' : '2.2rem', color: 'var(--offwhite)', marginBottom: '0.6rem' }}>Held Hub Sales</h1>
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.4)', lineHeight: 1.7, marginBottom: '2.5rem', maxWidth: '58ch' }}>
          When a counter PC was out of action and an admin switched its branch to the online till,
          whatever that PC sends up when it comes back waits here instead of changing anything.
          Compare it with what the cloud has now, then apply it or dismiss it. The branch goes
          back to its counter PC only once nothing here is waiting.
        </p>

        {error && <p style={{ color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', marginBottom: '1rem', lineHeight: 1.6 }}>{error}</p>}

        <section style={panel}>
          <h2 style={panelTitle}>Waiting for a decision</h2>
          {loading && <p style={{ ...small, padding: '1rem 0' }}>Loading…</p>}
          {!loading && waiting.length === 0 && <p style={{ ...small, padding: '1rem 0' }}>Nothing is waiting.</p>}
          {waiting.map(item => (
            <ItemCard
              key={item.id}
              item={item}
              confirming={confirming?.id === item.id ? confirming.decision : null}
              busy={busy}
              onAsk={decision => setConfirming({ id: item.id, decision })}
              onCancel={() => setConfirming(null)}
              onDecide={decision => decide(item.id, decision)}
            />
          ))}
        </section>

        {decided.length > 0 && (
          <section style={panel}>
            <h2 style={panelTitle}>Decided</h2>
            {decided.map(item => (
              <ItemCard key={item.id} item={item} confirming={null} busy={false} onAsk={() => {}} onCancel={() => {}} onDecide={() => {}} />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
