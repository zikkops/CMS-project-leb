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
