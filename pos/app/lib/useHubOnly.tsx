'use client'

// The till says when it may not change a branch's trading — POS software,
// stage 4 (owner's decisions S10 and S21).
//
// Online: while a branch has a paired hub, the cloud's till routes refuse to
// change its trading (shared/src/server/hubLock.ts). On the hub: while an admin
// has switched its branch to the online till because the counter PC was out of
// action, the hub's own routes refuse. The refusal is the lock; this is only
// the notice, so a waiter reads "view only" before tapping something that will
// be refused. It asks when a screen opens and every minute after, so a change
// during service reaches an open screen without a reload.

import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLock } from '@fortawesome/free-solid-svg-icons'
import { backend } from './backend'

const EVERY_MS = 60_000

export interface HubOnly {
  /** 'hub': the online till, locked by the branch's café hub. 'online': the café hub, locked while the branch trades online. */
  kind: 'hub' | 'online'
  name: string
}

/** Why this till may not change the branch's trading, or null when it may. */
export function useHubOnly(branch: string, enabled = true): HubOnly | null {
  const [hub, setHub] = useState<HubOnly | null>(null)

  useEffect(() => {
    if (!enabled || !branch) return
    let live = true
    const ask = () => {
      backend().request('GET', `/api/pos/hub-lock?branch=${encodeURIComponent(branch)}`)
        .then(res => {
          if (!live) return
          const h = res.hub as { name?: unknown } | null | undefined
          if (res.onlineInstead === true) setHub({ kind: 'online', name: '' })
          else setHub(h && typeof h === 'object' ? { kind: 'hub', name: typeof h.name === 'string' ? h.name : '' } : null)
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
  const [title, detail] = hub.kind === 'online'
    ? [
        `View only: ${branch} is trading on the online till`,
        'An admin switched the branch online while this counter PC was out of action. Take orders on the online till until an admin hands the branch back to this PC.',
      ]
    : [
        `View only: ${branch} trades on its café hub${hub.name ? ` (${hub.name})` : ''}`,
        'Open tables, take payment and work the drawer on the counter PC. What happens there shows here once the hub has sent it up.',
      ]
  return (
    <div role="status" style={{
      display: 'flex', gap: '0.9rem', alignItems: 'flex-start',
      padding: isMobile ? '0.85rem 1rem' : '1rem 1.2rem', marginBottom: '1.25rem',
      borderRadius: '12px', fontFamily: 'var(--font-inter)',
      background: 'rgba(var(--brand-secondary-rgb),0.14)', border: '2px solid rgba(var(--brand-secondary-rgb),0.55)',
    }}>
      <FontAwesomeIcon icon={faLock} style={{ color: 'var(--brand-secondary)', fontSize: '1.2rem', marginTop: '0.15rem' }} />
      <div>
        <p style={{ color: 'var(--brand-secondary)', fontWeight: 700, fontSize: '1rem', lineHeight: 1.4 }}>{title}</p>
        <p style={{ color: 'rgba(var(--offwhite-rgb),0.75)', fontSize: '0.88rem', lineHeight: 1.6, marginTop: '0.2rem' }}>{detail}</p>
      </div>
    </div>
  )
}
