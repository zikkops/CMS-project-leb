// Which hostname serves which part of the app.
//
// Three surfaces on one deployment: the customer site, the admin panel, and
// the POS. Splitting them across hostnames means /admin never appears on the
// customer domain at all — not merely gated, absent — so nothing crawling the
// public site can discover that it exists.
//
// ── What this is NOT ───────────────────────────────────────────────────────
// It is not authentication. Anyone can resolve the admin hostname and reach
// it. The real boundary is unchanged and lives elsewhere: Firebase Auth,
// custom claims, firestore.rules, and every privileged mutation sitting
// behind a route handler.
//
// What it buys is separation — a smaller surface on each host, a session
// cookie that stops being sent to the customer site, one hostname to put a
// real network gate (Cloudflare Access and friends) in front of later without
// touching the customer site, and noindex on one host without the other.
//
// ── Inert until configured ─────────────────────────────────────────────────
// With no hostnames set, every path is allowed on every host, which is exactly
// what the app does today. Set one and only that surface moves; the other
// stays where it was. That is deliberate: the DNS may land weeks after this
// code, and a half-configured deployment must not lock anybody out.
//
// No React and no Firebase import — proxy.ts runs on the edge and imports
// this, and these are pure functions over strings so they can be reasoned
// about without a request.

export type Surface = 'public' | 'admin' | 'pos'

export interface HostConfig {
  /** Hostname serving /admin, or null when it has not been split out. */
  admin: string | null
  /** Hostname serving /pos, or null. */
  pos: string | null
}

/**
 * Deliberately not NEXT_PUBLIC_.
 *
 * Only proxy.ts reads these, and it runs on the server. A NEXT_PUBLIC_ copy
 * would inline the admin hostname into every customer's JS bundle, which is
 * the one thing this whole file exists to avoid.
 */
export function hostConfigFromEnv(env: Record<string, string | undefined>): HostConfig {
  const clean = (v: string | undefined): string | null => {
    const s = (v ?? '').trim().toLowerCase()
    return s ? s.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null
  }
  return { admin: clean(env.ADMIN_HOST), pos: clean(env.POS_HOST) }
}

/** Paths each surface owns. Anything unclaimed belongs to the customer site. */
const OWNED: Record<Exclude<Surface, 'public'>, string[]> = {
  admin: ['/admin'],
  // /admin/login rides along until the POS has a sign-in of its own: a waiter
  // on the POS hostname still has to authenticate, and sending them to a
  // hostname that 404s the login page would be a locked door with no handle.
  pos: ['/pos', '/admin/login'],
}

/**
 * Reachable on every host, whatever else is true.
 *
 * Framework assets and the well-known files a host is expected to answer for.
 * Getting this wrong does not 404 a page — it serves a page with no CSS.
 */
const ALWAYS: string[] = [
  '/_next', '/api', '/favicon.ico', '/robots.txt', '/sitemap.xml',
  '/manifest.json', '/manifest.webmanifest', '/.well-known',
]

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(p => pathname === p || pathname.startsWith(p + '/'))
}

/** Which surface a request landed on. Unconfigured hostnames are 'public'. */
export function classifySurface(hostname: string, config: HostConfig): Surface {
  // Port and case are noise; a Host header carries both.
  const host = (hostname ?? '').toLowerCase().split(':')[0]
  if (config.admin && host === config.admin) return 'admin'
  if (config.pos && host === config.pos) return 'pos'
  return 'public'
}

/**
 * Whether a path may be served on this surface.
 *
 * A surface with no hostname configured has not moved anywhere, so the paths
 * it would own stay reachable on the public host. That is what makes setting
 * only one of the two safe.
 */
export function isPathAllowed(pathname: string, surface: Surface, config: HostConfig): boolean {
  if (matches(pathname, ALWAYS)) return true

  if (surface === 'admin') return matches(pathname, OWNED.admin)
  if (surface === 'pos') return matches(pathname, OWNED.pos)

  // On the customer site: refuse a surface only once it has somewhere else to
  // live. Before that, refusing would take the admin panel offline and leave
  // no way back in.
  if (config.admin && matches(pathname, OWNED.admin)) return false
  if (config.pos && matches(pathname, ['/pos'])) return false
  return true
}

/**
 * Where '/' should go on a non-public host.
 *
 * The customer home page is not what somebody typing the admin hostname is
 * looking for, and serving them a 404 for the bare domain reads as broken.
 */
export function rootRedirectFor(surface: Surface): string | null {
  if (surface === 'admin') return '/admin'
  if (surface === 'pos') return '/pos'
  return null
}

/** Neither the admin panel nor the POS belongs in a search index. */
export function shouldNoIndex(surface: Surface): boolean {
  return surface !== 'public'
}
