// A loyalty member code — Phase 04, slice 5.
//
// What the customer's app shows as a QR code and the till scans (owner's
// decision, 12 Sep 2026), with the same code typed by hand wherever a phone
// cannot scan — Safari has no built-in barcode reader.
//
// ── Why not the account id ─────────────────────────────────────────────────
// A uid is not a secret — it sits in URLs and public documents — so a QR of
// one is a code anyone could print for anyone. This is a random code with no
// meaning, held server-side in memberCodes/{code}, which no browser can read.
//
// ── The alphabet ───────────────────────────────────────────────────────────
// 31 characters with no 0/O, 1/I/L or U/V pair a waiter could misread off a
// cracked screen. Ten of them is ~50 bits: not guessable by trying, and still
// short enough to read aloud as three groups.
//
// No React and no Firebase, so the till, the server and a verifier share it.

export const MEMBER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTWXYZ'
export const MEMBER_CODE_LENGTH = 10
const PATTERN = new RegExp(`^[${MEMBER_CODE_ALPHABET}]{${MEMBER_CODE_LENGTH}}$`)

/**
 * A new code, from a source of random integers. Passed in, so the server can
 * use crypto and a verifier can be deterministic.
 */
export function newMemberCode(randomInt: (maxExclusive: number) => number): string {
  let s = ''
  for (let i = 0; i < MEMBER_CODE_LENGTH; i++) s += MEMBER_CODE_ALPHABET[randomInt(MEMBER_CODE_ALPHABET.length)]
  return s
}

/**
 * What a waiter typed or a scanner read, as a code — or null.
 *
 * Forgiving about what people do (spaces, dashes, lower case, a URL prefix a
 * QR app might add) and strict about what a code is. The two look-alikes
 * that still get typed are folded: O → 0 is not in the alphabet, so it is not
 * folded; only case and separators are.
 */
export function normalizeMemberCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const tail = raw.trim().split(/[/:=]/).pop() ?? ''
  const s = tail.toUpperCase().replace(/[\s-]/g, '')
  return PATTERN.test(s) ? s : null
}

/** For reading aloud and printing: XXXX-XXXX-XX. */
export function formatMemberCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`
}
