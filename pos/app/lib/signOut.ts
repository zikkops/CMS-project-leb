// What signing out of a till device should say first (UPGRADE.md T6.1). Pure,
// asserted by verify:counter; the button is SignOutButton.tsx.
//
// Signing out is never blocked. A device holding work it has not sent says so,
// once, and the person decides: the lines and the queued outbox stay on the
// device (localStorage), and whoever signs in next on it sends them.

export interface DeviceWork {
  /** Orders taken during an outage, waiting in this device's outbox. */
  queued: number
  /** The outbox stopped on a refusal someone has to look at. */
  stuck: boolean
  /** Lines tapped on the open check and not sent to the kitchen. */
  drafts: number
}

/**
 * Who a shared device should say is signed in (T6.2): the first name, else
 * the email, else "someone". A kitchen screen is a device, not a person, and
 * names nobody.
 */
export function personLabel(p: { name?: string | null; email?: string | null; scope?: string | null } | null): string | null {
  if (!p || p.scope === 'kds') return null
  const name = (p.name ?? '').trim()
  if (name) return name
  const email = (p.email ?? '').trim()
  return email || 'someone'
}

/** A shared online device signs out after this long without a tap (T6.7; T6.0's default, the counter PC's S25 limit). */
export const SHARED_IDLE_MS = 15 * 60_000

/**
 * Whether a shared online device has gone idle (UPGRADE.md T6.7): switched to
 * shared, on the online till (a hub's counter PC has its own server-side rule,
 * S25), somebody signed in, and no tap for the limit. Only taps count; the
 * page's own background requests never keep it signed in. A personal phone
 * keeps its sign-in.
 */
export function sharedIdleDue(s: { shared: boolean; online: boolean; signedIn: boolean; lastTap: number; now: number; idleMs?: number }): boolean {
  if (!s.shared || !s.online || !s.signedIn) return false
  if (!(s.lastTap > 0)) return false
  return s.now - s.lastTap >= (s.idleMs ?? SHARED_IDLE_MS)
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The question to ask before signing out, or null when nothing is waiting. */
export function signOutWarning(work: DeviceWork): string | null {
  const parts: string[] = []
  if (work.drafts > 0) parts.push(`${plural(work.drafts, 'line is', 'lines are')} on this check and not sent to the kitchen`)
  if (work.queued > 0) parts.push(`${plural(work.queued, 'change is', 'changes are')} waiting on this device for the connection`)
  if (work.stuck) parts.push('a change was refused and is waiting for someone to try again or drop it')
  if (parts.length === 0) return null
  return `${parts.join('; ')}. They stay on this device for the next person to sign in here. Sign out anyway?`
}
