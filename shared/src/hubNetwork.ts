// Where phones find the café hub on the wifi — POS software (owner's decision
// S11, 15 Sep 2026: encrypted, through the app).
//
// The Windows app puts an encrypted door in front of the hub
// (desktop/hubLan.js). The counter screen shows its address and the
// certificate's fingerprint as a QR, and the Android app pairs by scanning it:
// it then trusts exactly that certificate and nothing else, so another machine
// on the wifi pretending to be the hub is refused.
//
// Pure, and asserted by verify:hub-sync.

/** One entry of Node's os.networkInterfaces(). */
export interface NetInterface {
  address: string
  family: string | number
  internal: boolean
}

/** The QR text starts with this, so the app can tell a hub's code from any other QR. */
export const HUB_LINK_SCHEME = 'bigcms-hub:'

/** An address on a private network: 10/8, 172.16/12 or 192.168/16. Never a public one. */
export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return false
  const [a, b, c, d] = m.slice(1).map(Number)
  if ([a, b, c, d].some(n => n > 255)) return false
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/**
 * The addresses phones on the café wifi can use: this PC's private IPv4
 * addresses, on the encrypted port. Loopback, link-local and public addresses
 * are left out. A PC on two networks lists both.
 */
export function lanAddresses(interfaces: Record<string, NetInterface[] | undefined>, port: number): string[] {
  const found = new Set<string>()
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      const v4 = i.family === 'IPv4' || i.family === 4
      if (v4 && !i.internal && isPrivateIPv4(i.address)) found.add(`https://${i.address}:${port}`)
    }
  }
  return [...found].sort()
}

/** A fingerprint as 64 lower-case hex digits, from `AB:CD:…` or plain hex; null when it is not one. */
export function normalizeFingerprint(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const hex = raw.replace(/:/g, '').toLowerCase()
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null
}

/** An address on a private network and a port, and nothing else. */
function hubOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'https:' || !isPrivateIPv4(url.hostname) || url.username || url.password) return null
  if (url.pathname !== '/' || url.search || url.hash) return null
  return url.origin
}

/** What the counter screen's QR says: `bigcms-hub:https://192.168.1.20:3443#sha256=<hex>`. Null when either half is wrong. */
export function hubLink(address: string, fingerprint: string): string | null {
  const origin = hubOrigin(address)
  const fp = normalizeFingerprint(fingerprint)
  return origin && fp ? `${HUB_LINK_SCHEME}${origin}#sha256=${fp}` : null
}

/**
 * The app's reading of a scanned QR. Anything but a hub on a private network,
 * over https, with a whole fingerprint, is not a hub: a QR is a thing anybody
 * can stick on a counter.
 */
export function parseHubLink(text: unknown): { address: string; fingerprint: string } | null {
  if (typeof text !== 'string' || !text.startsWith(HUB_LINK_SCHEME)) return null
  const rest = text.slice(HUB_LINK_SCHEME.length)
  const hash = rest.indexOf('#sha256=')
  if (hash < 0) return null
  const address = hubOrigin(rest.slice(0, hash))
  const fingerprint = normalizeFingerprint(rest.slice(hash + '#sha256='.length))
  return address && fingerprint ? { address, fingerprint } : null
}
