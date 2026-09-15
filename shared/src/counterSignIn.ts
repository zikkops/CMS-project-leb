// Signing in on the counter PC with your own phone — POS software, stage 5
// (owner's decisions S24–S25, 15 Sep 2026).
//
//   1. On the counter PC's sign-in screen, tap your name. The hub keeps a request
//      for two minutes, and the screen shows a four-digit code.
//   2. In your own staff app, tap "Sign in the counter PC", type that code, and
//      confirm with your fingerprint. The phone signs a message naming the code.
//   3. The counter collects a session for you, with no internet (S24), which ends
//      after 15 minutes without a tap, or when you sign out (S25).
//
// Why a code, not just "approve": the counter screen is shared, and anyone on
// the café wifi can start a request in somebody's name. The code ties the
// fingerprint to the request on the screen in front of that person; a request
// started elsewhere shows its code elsewhere, so nobody approves it blind.
//
// Pure, so the app signs exactly what the hub checks. The hub's side is
// server/hubCounterSignIn.ts. Asserted by verify:hub-sync.

/** Hub-only collection: `hubCounterRequests/{id}`. */
export const COUNTER_REQUESTS = 'hubCounterRequests'

/** How long a counter request waits for the person's phone. */
export const COUNTER_REQUEST_MS = 2 * 60_000

/** A counter session ends after this long without a tap (S25). */
export const COUNTER_IDLE_MS = 15 * 60_000

/** The till tells the hub about taps at most this often, so a tap is not a database write. */
export const TOUCH_EVERY_MS = 30_000

/** Four digits, from four random bytes. */
export function counterCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 4) throw new Error('four bytes')
  const n = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]
  return String(n % 10_000).padStart(4, '0')
}

export const isCounterCode = (raw: unknown): raw is string => typeof raw === 'string' && /^\d{4}$/.test(raw)

/** The code as typed on a phone: its digits only. */
export const readCounterCode = (raw: unknown): string => (typeof raw === 'string' ? raw.replace(/\D/g, '').slice(0, 4) : '')

/**
 * What the phone signs to sign its owner in on the counter. It names this hub's
 * certificate (as signing in does), the code on the counter screen, and the key,
 * with its own label so it is never a phone sign-in or a manager's approval.
 */
export function counterSignInMessage(hubFingerprintHex: string, code: string, keyId: string, nonce: string): string {
  return `bigcms-hub-counter:v1\n${hubFingerprintHex}\n${code}\n${keyId}\n${nonce}`
}

/**
 * Whether a request's Host names the counter PC itself. The Windows app opens the
 * till at localhost; phones reach the hub through its café-wifi door at the PC's
 * address. Not a proof, since a client chooses its Host, and the code is what
 * actually stops a request made elsewhere; this keeps the counter's sign-in off
 * phones.
 */
export function isCounterHost(host: unknown): boolean {
  if (typeof host !== 'string' || !host) return false
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return ['localhost', '127.0.0.1', '[::1]'].includes(name.toLowerCase())
}

/** Whether a session with an idle limit has gone that long without a tap. */
export function idleOver(lastActiveAt: number, idleMs: number, now: number): boolean {
  return !(lastActiveAt > 0) || now - lastActiveAt >= idleMs
}
