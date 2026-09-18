// What the staff app says when something goes wrong (UPGRADE.md T1.18).
//
// The phone's native side used to hand Android's own words straight to the
// screen: "The phone could not reach the hub: failed to connect to
// /192.168.68.148 (port 3443) from /10.32.155.185 (port 48698) after 15000ms".
// That was a phone on mobile data, and nothing in the sentence said so. Now the
// native side names WHAT happened with a short code (HubHttp.classify() in
// Java), and this turns the code into what to do about it.
//
// Pure, no imports: bundled into the app (phone/src/app.ts) and asserted by
// `npm run verify:phone`.

/** What the native side can report, besides a refusal with its own words. */
export type PhoneErrorCode =
  /** Nothing answered at the hub's address: wrong network, mobile data, or the counter PC is off. */
  | 'UNREACHABLE'
  /** Something answered, but not with the certificate this phone pinned. */
  | 'WRONG_HUB'
  /** An internet request (Firebase, the cloud) got no answer. */
  | 'OFFLINE'
  /** The person closed the fingerprint prompt. */
  | 'CANCELLED'

export const PHONE_MESSAGES: Record<PhoneErrorCode, string> = {
  UNREACHABLE: 'Can’t reach the café hub. Check this phone is on the café Wi-Fi (not mobile data) and the counter PC is on.',
  WRONG_HUB: 'This isn’t the café hub this phone was set up with. If the counter PC was reinstalled, scan its new code.',
  OFFLINE: 'This needs the internet. Check this phone’s connection, then try again.',
  CANCELLED: 'Cancelled.',
}

/**
 * The sentence to show for an error from the native side, or `fallback`.
 *
 * A known code wins over the error's own text; an error with no known code
 * keeps its own text, because those are the app's and the hub's refusals,
 * already written for people ("That request is closed").
 */
export function phoneMessage(err: unknown, fallback: string): string {
  const e = (err ?? {}) as { code?: unknown; message?: unknown }
  const code = typeof e.code === 'string' ? e.code : ''
  // Own keys only: `in` would take 'toString' for a code.
  if (Object.prototype.hasOwnProperty.call(PHONE_MESSAGES, code)) return PHONE_MESSAGES[code as PhoneErrorCode]
  return typeof e.message === 'string' && e.message.trim() ? e.message : fallback
}

/** What the scanner's failure means, when it is not the person closing it. */
export const SCAN_FAILED = 'Couldn’t read the code. Hold the phone about 20 cm from the screen, or paste the link below.'

/** Whether a scanner error is only the person closing the camera. */
export function scanWasCancelled(err: unknown): boolean {
  const message = (err as { message?: unknown } | null)?.message
  return typeof message === 'string' && /cancel/i.test(message)
}
