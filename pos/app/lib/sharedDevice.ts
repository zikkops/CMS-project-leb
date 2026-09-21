'use client'

// Whether this device is shared (UPGRADE.md T6.2, T6.7; T6.0's default,
// OWNER TO CONFIRM): a café hub's own counter PC always is; an online-till
// browser is when somebody switches "This is a shared device" on, remembered
// here in localStorage. Every other device is one person's phone.
//
// A shared device says, large, who is signed in on every page, and offers
// Switch user; T6.7 adds its idle sign-out.

import { useSyncExternalStore } from 'react'
import { isCounterHost } from '@big-cms/shared/counterSignIn'
import { backend } from './backend'

const SHARED_KEY = 'pos.sharedDevice'
const SHARED_EVENT = 'pos-shared-device'

/** The switch as this browser remembers it. */
export function sharedSwitchOn(): boolean {
  try { return localStorage.getItem(SHARED_KEY) === 'yes' } catch { return false }
}

export function setSharedSwitch(on: boolean): void {
  try { localStorage.setItem(SHARED_KEY, on ? 'yes' : 'no') } catch { /* private mode: this page only */ }
  window.dispatchEvent(new Event(SHARED_EVENT))
}

/** Shared: the hub's counter PC, or a browser switched to shared. */
export function isSharedHere(): boolean {
  if (backend().kind === 'hub' && isCounterHost(window.location.host)) return true
  return sharedSwitchOn()
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(SHARED_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(SHARED_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** Whether this device is shared, following the switch as it changes. */
export function useSharedDevice(): boolean {
  return useSyncExternalStore(subscribe, isSharedHere, () => false)
}

/** The switch itself, for the online till's own setting. */
export function useSharedSwitch(): boolean {
  return useSyncExternalStore(subscribe, sharedSwitchOn, () => false)
}
