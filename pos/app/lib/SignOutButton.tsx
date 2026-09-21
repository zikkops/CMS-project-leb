'use client'

// One Sign out for every till screen (UPGRADE.md T6.1): the floor, the
// counter, the check, the kitchen display and the drawer. It ends the hub
// session or the Firebase sign-in through backend().signOut(), clears what the
// device kept, and lands on the sign-in page with a plain load, so the counter
// never waits on a server-rendered page during an outage.
//
// A kitchen screen session (a device, not a person, S19) has no Sign out here:
// it ends at 05:00, or when a manager ends it.
//
// Unsent lines or a queued outbox are said first and never stop it
// (signOutWarning()).

import { faRightFromBracket } from '@fortawesome/free-solid-svg-icons'
import { useClientValue } from '@big-cms/shared/useClientValue'
import { backend } from './backend'
import { readHubSession } from './backend/hub'
import { queuedOnThisDevice } from './useOutbox'
import { signOutWarning } from './signOut'
import { PosButton, type Size } from './posUi'

/** Ends whoever is signed in on this device and goes to the sign-in page. */
export async function signOutHere(drafts = 0): Promise<void> {
  const warning = signOutWarning({ ...queuedOnThisDevice(), drafts })
  if (warning && !window.confirm(warning)) return
  try { await backend().signOut() } catch { /* signed out on this device regardless */ }
  window.location.replace('/pos/login')
}

export function SignOutButton({ drafts = 0, size = 'sm' }: { drafts?: number; size?: Size }) {
  const kitchenScreen = useClientValue(() => readHubSession()?.scope === 'kds', false)
  if (kitchenScreen) return null
  return <PosButton icon={faRightFromBracket} label="Sign out" tone="quiet" size={size} onClick={() => { void signOutHere(drafts) }} />
}
