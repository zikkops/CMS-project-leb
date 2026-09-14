'use client'

// The online till says when a café hub trades its branch — POS software,
// stage 4 (owner's decision S10, 14 Sep 2026).
//
// While a branch has a paired hub, the cloud's till routes refuse to change its
// trading (shared/src/server/hubLock.ts). The refusal is the lock; this is only
// the notice, so a waiter reads "view only" before tapping something that will
// be refused. It asks when a screen opens and every minute after, so a hub
// paired or unpaired during service reaches an open screen without a reload.

import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLock } from '@fortawesome/free-solid-svg-icons'
import { backend } from './backend'

const EVERY_MS = 60_000

export interface HubOnly {
  name: string
}

/** The café hub trading this branch, or null. Always null on the hub itself. */
export function useHubOnly(branch: string, enabled = true): HubOnly | null {
  const [hub, setHub] = useState<HubOnly | null>(null)

  useEffect(() => {
    if (!enabled || !branch || backend().kind === 'hub') return
    let live = true
    const ask = () => {
      backend().request('GET', `/api/pos/hub-lock?branch=${encodeURIComponent(branch)}`)
        .then(res => {
          if (!live) return
          const h = res.hub as { name?: unknown } | null | undefined
          setHub(h && typeof h === 'object' ? { name: typeof h.name === 'string' ? h.name : '' } : null)
        })
        // No answer: keep what was last known. The routes refuse either way.
        .catch(() => {})
    }
    ask()
    const timer = setInterval(ask, EVERY_MS)
    return () => { live = false; clearInterval(timer) }
  }, [branch, enabled])

  return hub
}

/** Amber, because it needs attention, not because anything is wrong. */
export function HubOnlyBanner({ hub, branch, isMobile }: { hub: HubOnly | null; branch: string; isMobile: boolean }) {
  if (!hub) return null
  return (
    <div role="status" style={{
      display: 'flex', gap: '0.9rem', alignItems: 'flex-start',
      padding: isMobile ? '0.85rem 1rem' : '1rem 1.2rem', marginBottom: '1.25rem',
      borderRadius: '12px', fontFamily: 'var(--font-inter)',
      background: 'rgba(var(--brand-secondary-rgb),0.14)', border: '2px solid rgba(var(--brand-secondary-rgb),0.55)',
    }}>
      <FontAwesomeIcon icon={faLock} style={{ color: 'var(--brand-secondary)', fontSize: '1.2rem', marginTop: '0.15rem' }} />
      <div>
        <p style={{ color: 'var(--brand-secondary)', fontWeight: 700, fontSize: '1rem', lineHeight: 1.4 }}>
          View only: {branch} trades on its café hub{hub.name ? ` (${hub.name})` : ''}
        </p>
        <p style={{ color: 'rgba(var(--offwhite-rgb),0.75)', fontSize: '0.88rem', lineHeight: 1.6, marginTop: '0.2rem' }}>
          Open tables, take payment and work the drawer on the counter PC. What happens there shows here once the hub has sent it up.
        </p>
      </div>
    </div>
  )
}
