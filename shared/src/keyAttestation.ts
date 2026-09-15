// Android key attestation — POS software, stage 5 (owner's decisions S20,
// 15 Sep 2026).
//
// When a phone registers, it sends the certificate chain Android's Keystore
// wrote for its sign-in key. The first certificate carries Google's attestation
// extension: a statement, signed by the phone's secure hardware and chained to
// Google, of where the key lives and what unlocks it. The owner's decisions:
//   - a key that is not in secure hardware is refused (S20a)
//   - a phone whose system cannot prove it is untampered (unlocked, rooted) is
//     refused (S20b)
//   - a phone Google lists as compromised is refused, and when that list cannot
//     be fetched, registering waits (S20c)
// A refused phone signs in with a manager's approval instead.
//
// Pure: the DER reading and the rules. The chain's signatures, Google's roots
// and the revocation list are server/keyAttestation.ts. Asserted by
// verify:hub-sync.

/** The key attestation extension. */
export const ATTESTATION_OID = '1.3.6.1.4.1.11129.2.1.17'

/** The staff app, which must be the app that made the key. */
export const STAFF_APP_PACKAGE = 'com.bigcms.staff'

/** How long a registration challenge from the cloud may be used. */
export const ENROL_CHALLENGE_MS = 5 * 60_000

/** Server-only collection, no Firestore rule: `staffKeyChallenges/{sha256 of the challenge}`. */
export const STAFF_KEY_CHALLENGES = 'staffKeyChallenges'

// Values from Android's KeyMint, as the attestation records them.
const SECURITY_SOFTWARE = 0
const SECURITY_STRONGBOX = 2
const ALGORITHM_EC = 3
const CURVE_P256 = 1
const PURPOSE_SIGN = 2
const ORIGIN_GENERATED = 0
const AUTH_PASSWORD = 1
const AUTH_FINGERPRINT = 2
const BOOT_VERIFIED = 0

// ── DER, only as much as a certificate and the extension need ─────────────

export interface Der {
  /** 0 universal, 1 application, 2 context-specific, 3 private. */
  cls: number
  constructed: boolean
  tag: number
  content: Uint8Array
}

function readAt(bytes: Uint8Array, start: number): { el: Der; next: number } {
  let at = start
  if (at + 2 > bytes.length) throw new Error('truncated')
  const first = bytes[at++]
  let tag = first & 0x1f
  if (tag === 0x1f) {
    tag = 0
    for (let i = 0; ; i++) {
      if (at >= bytes.length || i >= 4) throw new Error('bad tag')
      const b = bytes[at++]
      tag = tag * 128 + (b & 0x7f)
      if (!(b & 0x80)) break
    }
  }
  if (at >= bytes.length) throw new Error('truncated')
  let length = bytes[at++]
  if (length & 0x80) {
    const n = length & 0x7f
    // Indefinite lengths (n = 0) are not DER.
    if (n === 0 || n > 4 || at + n > bytes.length) throw new Error('bad length')
    length = 0
    for (let i = 0; i < n; i++) length = length * 256 + bytes[at++]
  }
  if (at + length > bytes.length) throw new Error('truncated')
  return {
    el: { cls: first >> 6, constructed: (first & 0x20) !== 0, tag, content: bytes.subarray(at, at + length) },
    next: at + length,
  }
}

/** Exactly one DER element filling the bytes. Throws otherwise. */
export function readDer(bytes: Uint8Array): Der {
  const { el, next } = readAt(bytes, 0)
  if (next !== bytes.length) throw new Error('trailing bytes')
  return el
}

/** The elements inside a constructed element. */
export function derChildren(el: Der): Der[] {
  if (!el.constructed) throw new Error('not constructed')
  const out: Der[] = []
  for (let at = 0; at < el.content.length;) {
    const r = readAt(el.content, at)
    out.push(r.el)
    at = r.next
  }
  return out
}

const isUniversal = (el: Der | undefined, tag: number): el is Der => Boolean(el) && el!.cls === 0 && el!.tag === tag

/** A small INTEGER or ENUMERATED as a number; anything wider than 6 bytes is not needed here and throws. */
function smallInt(el: Der | undefined): number {
  if (!isUniversal(el, 2) && !isUniversal(el, 10)) throw new Error('not an integer')
  const c = el!.content
  if (c.length < 1 || c.length > 6) throw new Error('integer size')
  let n = c[0] & 0x80 ? -1 : 0
  for (const b of c) n = n * 256 + b
  return n
}

function oidText(content: Uint8Array): string {
  if (content.length === 0) throw new Error('empty oid')
  const parts: number[] = []
  let value = 0
  for (const b of content) {
    value = value * 128 + (b & 0x7f)
    if (!(b & 0x80)) { parts.push(value); value = 0 }
  }
  const first = parts.shift() ?? 0
  const head = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80]
  return [...head, ...parts].join('.')
}

/**
 * Every value of one extension in a DER certificate, in order. A list, so the
 * caller can refuse a certificate that carries it twice.
 */
export function certificateExtensions(certDer: Uint8Array, oid: string): Uint8Array[] {
  const cert = readDer(certDer)
  const tbs = derChildren(cert)[0]
  if (!isUniversal(tbs, 16)) throw new Error('not a certificate')
  const wrapper = derChildren(tbs).find(el => el.cls === 2 && el.tag === 3)
  if (!wrapper) return []
  const list = derChildren(wrapper)[0]
  if (!isUniversal(list, 16)) throw new Error('bad extensions')
  const out: Uint8Array[] = []
  for (const ext of derChildren(list)) {
    const parts = derChildren(ext)
    if (!isUniversal(parts[0], 6)) throw new Error('bad extension')
    const value = parts[parts.length - 1]
    if (!isUniversal(value, 4)) throw new Error('bad extension')
    if (oidText(parts[0].content) === oid) out.push(value.content)
  }
  return out
}

// ── The attestation itself ────────────────────────────────────────────────

export interface AuthorizationList {
  purpose?: number[]
  algorithm?: number
  ecCurve?: number
  noAuthRequired?: boolean
  userAuthType?: number
  authTimeout?: number
  origin?: number
  rootOfTrust?: { deviceLocked: boolean; verifiedBootState: number }
  osPatchLevel?: number
  /** From attestationApplicationId: the app or apps that own the key. */
  packageNames?: string[]
}

export interface KeyDescription {
  attestationVersion: number
  attestationSecurityLevel: number
  keyMintSecurityLevel: number
  challenge: Uint8Array
  softwareEnforced: AuthorizationList
  hardwareEnforced: AuthorizationList
}

const utf8 = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)

function readPackageNames(octets: Uint8Array): string[] {
  const [infos] = derChildren(readDer(octets))
  if (!isUniversal(infos, 17)) throw new Error('bad application id')
  return derChildren(infos).map(info => {
    const [name] = derChildren(info)
    if (!isUniversal(name, 4)) throw new Error('bad package')
    return utf8(name.content)
  })
}

function readAuthorizationList(el: Der): AuthorizationList {
  if (!isUniversal(el, 16)) throw new Error('bad authorization list')
  const out: AuthorizationList = {}
  const seen = new Set<number>()
  for (const item of derChildren(el)) {
    if (item.cls !== 2 || !item.constructed) throw new Error('bad authorization')
    // A tag given twice could say two things; neither is believed.
    if (seen.has(item.tag)) throw new Error('duplicate authorization')
    seen.add(item.tag)
    const inner = derChildren(item)
    if (inner.length !== 1) throw new Error('bad authorization')
    const v = inner[0]
    switch (item.tag) {
      case 1:
        if (!isUniversal(v, 17)) throw new Error('bad purpose')
        out.purpose = derChildren(v).map(smallInt)
        break
      case 2: out.algorithm = smallInt(v); break
      case 10: out.ecCurve = smallInt(v); break
      case 503:
        if (!isUniversal(v, 5)) throw new Error('bad noAuthRequired')
        out.noAuthRequired = true
        break
      case 504: out.userAuthType = smallInt(v); break
      case 505: out.authTimeout = smallInt(v); break
      case 702: out.origin = smallInt(v); break
      case 704: {
        const [, locked, state] = isUniversal(v, 16) ? derChildren(v) : []
        if (!isUniversal(locked, 1) || locked.content.length !== 1) throw new Error('bad root of trust')
        out.rootOfTrust = { deviceLocked: locked.content[0] !== 0, verifiedBootState: smallInt(state) }
        break
      }
      case 706: out.osPatchLevel = smallInt(v); break
      case 709:
        if (!isUniversal(v, 4)) throw new Error('bad application id')
        out.packageNames = readPackageNames(v.content)
        break
      default:
        // Tags these rules do not read, including ones wider than smallInt allows.
        break
    }
  }
  return out
}

/** The attestation extension's value read as a KeyDescription, or null when it is not one. */
export function readKeyDescription(value: Uint8Array): KeyDescription | null {
  try {
    const parts = derChildren(readDer(value))
    if (parts.length < 8 || !isUniversal(parts[4], 4)) return null
    return {
      attestationVersion: smallInt(parts[0]),
      attestationSecurityLevel: smallInt(parts[1]),
      keyMintSecurityLevel: smallInt(parts[3]),
      challenge: parts[4].content,
      softwareEnforced: readAuthorizationList(parts[6]),
      hardwareEnforced: readAuthorizationList(parts[7]),
    }
  } catch {
    return null
  }
}

export type AttestationRefusal =
  | 'software'
  | 'not-generated'
  | 'wrong-key'
  | 'no-biometric-lock'
  | 'pin-allowed'
  | 'not-per-use'
  | 'tampered'
  | 'wrong-app'

/** What the staff member is told. Each ends where a refused phone goes: a manager's approval. */
export const ATTESTATION_REFUSALS: Record<AttestationRefusal, string> = {
  'software': 'This phone keeps its sign-in key in software, not in secure hardware, so it cannot sign in by itself. Ask a manager to approve your sign-ins.',
  'not-generated': 'This sign-in key was not made inside this phone, so it cannot be registered. Ask a manager to approve your sign-ins.',
  'wrong-key': 'This is not the till\'s sign-in key. Update the staff app and register again.',
  'no-biometric-lock': 'This phone\'s sign-in key is not locked to a fingerprint or face, so it cannot be registered. Update the staff app and register again.',
  'pin-allowed': 'This phone\'s sign-in key could be unlocked with the phone\'s PIN, not only a fingerprint or face, so it cannot be registered. Update the staff app and register again.',
  'not-per-use': 'This phone\'s sign-in key stays unlocked after a fingerprint, so it cannot be registered. Update the staff app and register again.',
  'tampered': 'This phone\'s system has been unlocked or modified, so it cannot prove its fingerprint check is genuine. Ask a manager to approve your sign-ins.',
  'wrong-app': 'This sign-in key was not made by the BIG CMS staff app, so it cannot be registered.',
}

/**
 * Why a genuine attestation still does not register this phone, or null when
 * it may. Every rule reads the hardware-enforced list, never the software one,
 * except which app made the key: Android records that outside the hardware, and
 * it is believed only because the rest proves the system is untampered.
 */
export function attestationProblem(d: KeyDescription, packageName: string = STAFF_APP_PACKAGE): AttestationRefusal | null {
  // S20a: the statement is made by secure hardware, about a key kept there.
  if (d.attestationSecurityLevel <= SECURITY_SOFTWARE || d.attestationSecurityLevel > SECURITY_STRONGBOX) return 'software'
  if (d.keyMintSecurityLevel <= SECURITY_SOFTWARE || d.keyMintSecurityLevel > SECURITY_STRONGBOX) return 'software'
  const hw = d.hardwareEnforced
  if (hw.origin !== ORIGIN_GENERATED) return 'not-generated'
  if (hw.algorithm !== ALGORITHM_EC || hw.ecCurve !== CURVE_P256 || !hw.purpose?.includes(PURPOSE_SIGN)) return 'wrong-key'
  // S12: a strong fingerprint or face for every use, never the PIN.
  if (hw.noAuthRequired || hw.userAuthType === undefined || (hw.userAuthType & AUTH_FINGERPRINT) === 0) return 'no-biometric-lock'
  if ((hw.userAuthType & AUTH_PASSWORD) !== 0) return 'pin-allowed'
  if (hw.authTimeout !== undefined && hw.authTimeout > 0) return 'not-per-use'
  // S20b: a locked bootloader and a verified system, or the fingerprint check could be faked.
  if (!hw.rootOfTrust || !hw.rootOfTrust.deviceLocked || hw.rootOfTrust.verifiedBootState !== BOOT_VERIFIED) return 'tampered'
  const packages = d.softwareEnforced.packageNames ?? hw.packageNames
  if (!packages || packages.length !== 1 || packages[0] !== packageName) return 'wrong-app'
  return null
}

export const securityLevelName = (level: number): 'strongbox' | 'tee' => (level === SECURITY_STRONGBOX ? 'strongbox' : 'tee')

// ── Google's list of compromised keys (S20c) ──────────────────────────────

/** A certificate serial as the list writes it: lowercase hex, no leading zeros. */
export function normalizeSerial(hex: string): string {
  return hex.toLowerCase().replace(/^0+(?=.)/, '')
}

/**
 * Google's status list as the set of serials it names, or null when the reply
 * is not that list. Every entry refuses, suspended as well as revoked.
 */
export function readStatusList(raw: unknown): Set<string> | null {
  if (!raw || typeof raw !== 'object') return null
  const entries = (raw as Record<string, unknown>).entries
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return null
  const out = new Set<string>()
  for (const [serial, entry] of Object.entries(entries)) {
    if (!/^[0-9a-fA-F]{1,128}$/.test(serial)) return null
    if (!entry || typeof entry !== 'object' || typeof (entry as Record<string, unknown>).status !== 'string') return null
    out.add(normalizeSerial(serial))
  }
  return out
}

/** How long a fetched list is used, from its Cache-Control: at least an hour, never more than a day. */
export function statusListSeconds(cacheControl: string | null | undefined): number {
  const m = /(?:^|[,\s])max-age=(\d+)/i.exec(cacheControl ?? '')
  const seconds = m ? Number(m[1]) : 3600
  return Math.min(86_400, Math.max(3600, seconds))
}
