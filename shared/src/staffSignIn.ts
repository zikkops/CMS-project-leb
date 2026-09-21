// Scan to sign in on the online till (UPGRADE.md T6.4; T6.0's default, OWNER
// TO CONFIRM). Pure, asserted by verify:hub-sync; the server is
// shared/src/server/staffSignIn.ts and the route /api/staff-signin.
//
// For a café without a hub, a shared browser shows a QR instead of asking for
// an email and password:
//
//   1. The device asks the cloud for a request: a random id, and a secret to
//      collect with that only the device holds. The QR is a link into the till,
//      `/pos/approve#r=<id>`, so any phone camera opens it; the id rides in the
//      fragment, which never reaches a server log.
//   2. The staff member's own phone, already signed in to the till, opens it and
//      approves. Both screens show the same four-digit check, worked out from
//      the id, so nobody approves a device they cannot see.
//   3. The device collects a Firebase custom token for that person, once, and
//      signs in with it: their roles and grants come with the account.
//
// Two minutes, one use, secrets stored hashed, logged. The device never sees a
// password and the phone never sees the device's secret.

/** Server-only collection, no Firestore rule. */
export const STAFF_SIGNIN_REQUESTS = 'staffSignInRequests'
/** How long a request waits for a phone. */
export const STAFF_SIGNIN_MS = 2 * 60_000
/** The most requests a day, since asking needs no sign-in: a flood is refused, not stored. */
export const MAX_STAFF_SIGNIN_PER_DAY = 2_000

const REQUEST_ID = /^[A-Za-z0-9_-]{22,64}$/
const SECRET = /^[A-Za-z0-9_-]{43,86}$/

export const isSignInRequestId = (raw: unknown): raw is string => typeof raw === 'string' && REQUEST_ID.test(raw)
export const isSignInSecret = (raw: unknown): raw is string => typeof raw === 'string' && SECRET.test(raw)

/** The link the QR carries. */
export function approveLink(origin: string, id: string): string {
  return `${origin.replace(/\/+$/, '')}/pos/approve#r=${id}`
}

/** The request id from the approve page's fragment, or null. */
export function requestFromHash(hash: string): string | null {
  const m = /(?:^#|&)r=([A-Za-z0-9_-]+)/.exec(hash ?? '')
  return m && isSignInRequestId(m[1]) ? m[1] : null
}

/**
 * The check both screens show: four digits from the id's bytes (FNV-1a, so the
 * browser and the server agree without a digest API). Not a secret, and never
 * the proof: it only lets a person see they are approving the device in front
 * of them.
 */
export function checkDigits(id: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return String(h % 10_000).padStart(4, '0')
}

export type SignInState = 'waiting' | 'approved' | 'collected' | 'expired'

/** What a stored request is now. An approved request past its time can still be collected once, for a short grace. */
export function signInState(d: { status?: unknown; expiresAt?: number }, now: number): SignInState {
  if (d.status === 'collected') return 'collected'
  const expiresAt = Number(d.expiresAt ?? 0)
  if (d.status === 'approved') return now <= expiresAt + 30_000 ? 'approved' : 'expired'
  return now <= expiresAt ? 'waiting' : 'expired'
}
