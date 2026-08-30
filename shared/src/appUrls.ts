// Links from one app to another.
//
// The three surfaces are separate deployments on separate hostnames, so a
// staff member signing in on the customer site cannot be sent to "/admin" —
// that path does not exist there any more, and never will. It has to be an
// absolute URL to the admin app, or nothing at all.
//
// ── Returning null is the point ────────────────────────────────────────────
// When NEXT_PUBLIC_ADMIN_URL is unset there is no admin app to link to, and
// the honest answer is to render no link rather than one that 404s. That also
// happens to be the right default for the deployment shape this whole split
// exists to enable: an operator who wants the admin panel undiscoverable from
// the customer site simply leaves it unset, and no button appears.
//
// ── Why these two are NEXT_PUBLIC_ when ADMIN_HOST is not ──────────────────
// hosts.ts reads ADMIN_HOST server-side to decide what a hostname may serve,
// and keeping it out of the client bundle matters there. These are different:
// a link the user clicks puts the hostname in front of them anyway. Setting
// one is a decision to make the admin app reachable from the customer site,
// and that decision is what makes publishing the hostname acceptable.

function clean(raw: string | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  // Tolerate a bare hostname, a scheme, and a trailing slash — all three are
  // what somebody actually pastes into an environment variable.
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  return withScheme.replace(/\/+$/, '')
}

/**
 * Absolute URL into the admin app, or null when there isn't one.
 *
 * @param path path within the admin app, including its /admin prefix
 */
export function adminUrl(path = '/admin'): string | null {
  const base = clean(process.env.NEXT_PUBLIC_ADMIN_URL)
  if (!base) return null
  return base + (path.startsWith('/') ? path : `/${path}`)
}

/** Absolute URL into the POS app, or null when there isn't one. */
export function posUrl(path = '/pos'): string | null {
  const base = clean(process.env.NEXT_PUBLIC_POS_URL)
  if (!base) return null
  return base + (path.startsWith('/') ? path : `/${path}`)
}
