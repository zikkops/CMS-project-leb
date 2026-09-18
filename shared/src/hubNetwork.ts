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
 * Adapters that are not a network a phone can be on: Windows' Hyper-V and WSL
 * switches, VirtualBox, VMware, Docker and VPN tunnels. Each has a private
 * address, and one sorted ahead of the café's Wi-Fi put ITS address in the QR
 * (UPGRADE.md T1.23).
 */
const VIRTUAL_ADAPTER = /vethernet|wsl|hyper-?v|virtualbox|vboxnet|vmware|vmnet|docker|\bveth|\bbr-|tailscale|zerotier|utun|\btun\d|\btap\d|loopback/i
/** Adapters that are the real network: listed first, Wi-Fi and Ethernet by name. */
const REAL_ADAPTER = /wi-?fi|wlan|wireless|ethernet|\beth\d|\ben[ops]\d|\bwl[ops]\d/i

/**
 * The addresses phones on the café wifi can use: this PC's private IPv4
 * addresses, on the encrypted port, the real network first. Loopback,
 * link-local, public addresses and virtual adapters are left out. A PC on two
 * real networks lists both.
 */
export function lanAddresses(interfaces: Record<string, NetInterface[] | undefined>, port: number): string[] {
  const found: { url: string; real: boolean }[] = []
  for (const [name, list] of Object.entries(interfaces)) {
    if (VIRTUAL_ADAPTER.test(name)) continue
    for (const i of list ?? []) {
      const v4 = i.family === 'IPv4' || i.family === 4
      const url = `https://${i.address}:${port}`
      if (v4 && !i.internal && isPrivateIPv4(i.address) && !found.some(f => f.url === url)) {
        found.push({ url, real: REAL_ADAPTER.test(name) })
      }
    }
  }
  return found
    .sort((a, b) => Number(b.real) - Number(a.real) || a.url.localeCompare(b.url))
    .map(f => f.url)
}

/**
 * The addresses in lanAddresses() whose adapter Windows treats as a Public
 * network (UPGRADE.md T2.19). Windows' firewall blocks phones on a Public
 * network even after "Allow" was answered, because that answer covers private
 * networks only, and nothing on the counter screen said so. The Windows app
 * asks Windows (Get-NetConnectionProfile) and writes the Public adapters'
 * names beside the hub's database; os.networkInterfaces() names adapters the
 * same way.
 */
export function addressesOnPublicNetwork(
  interfaces: Record<string, NetInterface[] | undefined>, port: number, publicAliases: readonly string[],
): string[] {
  const shown = new Set(lanAddresses(interfaces, port))
  const found: string[] = []
  for (const alias of publicAliases) {
    for (const i of interfaces[alias] ?? []) {
      const url = `https://${i.address}:${port}`
      if (shown.has(url) && !found.includes(url)) found.push(url)
    }
  }
  return found
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
