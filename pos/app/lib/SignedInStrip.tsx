'use client'

// On a shared device, every till page says who is signed in, large, with
// Switch user beside it (UPGRADE.md T6.2), so nobody takes an order under
// somebody else's name. A personal phone shows nothing extra, and neither does
// a kitchen screen, which is a device and names nobody.
//
// Switch user is signing out (signOutHere(), with its warning about unsent
// work), and lands on the sign-in page: on a hub's counter PC that lists the
// staff by first name to tap (S24); on the online till it is the scan-to-sign-in
// screen (T6.4). Staff names are never listed to a signed-out browser online.

import { useEffect, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { faUserGroup, faUsers, faList } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { backend } from './backend'
import { setSharedSwitch, useSharedDevice, useSharedSwitch } from './sharedDevice'
import { useClientValue } from '@big-cms/shared/useClientValue'
import { signOutHere } from './SignOutButton'
import { sharedIdleDue } from './signOut'
import { Chip, PosButton } from './posUi'

const subscribe = (onChange: () => void) => backend().watchAuth(() => onChange())

/**
 * "This is a shared device", on the online till (T6.2, T6.7): remembered by
 * this browser. A hub's counter PC is shared by definition and has no switch.
 */
export function SharedDeviceChip() {
  const online = useClientValue(() => backend().kind === 'cloud', false)
  const on = useSharedSwitch()
  if (!online) return null
  return <Chip icon={faUsers} label="Shared device" active={on} size="sm" onClick={() => setSharedSwitch(!on)} />
}

/** Where you are signed in at the hub, and ending it (T6.5). Hub only. */
export function SessionsButton() {
  const onHub = useClientValue(() => backend().kind === 'hub', false)
  if (!onHub) return null
  return <PosButton icon={faList} label="Sessions" tone="quiet" size="sm" onClick={() => { window.location.href = '/pos/sessions' }} />
}

const TAP_KEY = 'pos.lastTap'

/**
 * Idle sign-out on a shared online device (T6.7). Taps (pointer, key, wheel)
 * are remembered, across tabs, in localStorage; every 30 seconds the rule is
 * asked. Idle, the device signs out straight away with no question: nobody is
 * there to answer, and unsent work stays on the device as always.
 */
function useSharedIdle(shared: boolean, signedIn: boolean): void {
  useEffect(() => {
    const online = backend().kind === 'cloud'
    if (!shared || !online || !signedIn) return
    const mark = () => { try { localStorage.setItem(TAP_KEY, String(Date.now())) } catch { /* private mode */ } }
    const lastTap = () => { try { return Number(localStorage.getItem(TAP_KEY)) || 0 } catch { return 0 } }
    mark()
    const events = ['pointerdown', 'keydown', 'wheel'] as const
    for (const e of events) window.addEventListener(e, mark, { passive: true })
    const timer = setInterval(() => {
      if (!sharedIdleDue({ shared: true, online: true, signedIn: backend().signedIn(), lastTap: lastTap(), now: Date.now() })) return
      void backend().signOut().finally(() => window.location.replace('/pos/login'))
    }, 30_000)
    return () => {
      for (const e of events) window.removeEventListener(e, mark)
      clearInterval(timer)
    }
  }, [shared, signedIn])
}

export function SignedInStrip() {
  const pathname = usePathname() ?? ''
  const shared = useSharedDevice()
  const who = useSyncExternalStore(subscribe, () => backend().signedInAs() ?? '', () => '')
  useSharedIdle(shared, Boolean(who))
  if (!shared || !who || pathname.startsWith('/pos/login') || pathname.startsWith('/pos/hub')) return null
  return (
    <div role="status" aria-live="polite" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap',
      padding: '0.6rem 1rem', background: 'var(--surface-deep)', borderBottom: '2px solid var(--teal)',
      fontFamily: 'var(--font-inter)', color: 'var(--offwhite)',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.35rem', fontWeight: 700 }}>
        <FontAwesomeIcon icon={faUserGroup} style={{ color: 'var(--teal)' }} />
        Signed in: {who}
      </span>
      <PosButton icon={faUserGroup} label="Switch user" tone="neutral" size="sm" onClick={() => { void signOutHere() }} />
    </div>
  )
}
