import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
// One CSP for all three apps — see shared/src/csp.ts for why it is not three.
import { buildCsp } from '@big-cms/shared/csp'
import {
  hostConfigFromEnv, classifySurface, isPathAllowed, rootRedirectFor, shouldNoIndex,
} from '@big-cms/shared/hosts'
import { adminUrl, posUrl } from '@big-cms/shared/appUrls'

// A bare 404, not a redirect and not the styled not-found page. A redirect
// to /admin/login would confirm the admin panel exists on a host that is
// supposed to have no admin panel, and the branded page names the
// business. Nothing here is the whole point.
function bareNotFound(): NextResponse {
  return new NextResponse('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex, nofollow' },
  })
}

export function proxy(request: NextRequest) {
  const csp = buildCsp(process.env.NODE_ENV === 'development')

  const pathname = request.nextUrl.pathname

  // ── /admin and /pos are other apps now ───────────────────────────────────
  // Neither exists in this app since the split. What used to be here — send
  // /admin/** without a session cookie to /admin/login — sent every old
  // bookmark to a login page this app does not have, i.e. a 404 by way of a
  // redirect. Staff had cms-projectlb.com/admin saved for years.
  //
  // So they go to the app that has them, when this deployment says where it
  // is. Setting NEXT_PUBLIC_ADMIN_URL is already the decision to make the
  // admin app reachable from the customer site (see shared/src/appUrls.ts), so
  // the redirect comes before the hostname gate below rather than being
  // overruled by it. Unset, there is nowhere to send anyone, and the answer is
  // the same bare 404 the gate gives.
  //
  // Matched as a whole segment: /administrator is not /admin.
  const otherApp = /^\/admin(\/|$)/.test(pathname) ? 'admin'
    : /^\/pos(\/|$)/.test(pathname) ? 'pos'
    : null
  if (otherApp) {
    const target = otherApp === 'admin' ? adminUrl(pathname) : posUrl(pathname)
    if (target) return NextResponse.redirect(target + request.nextUrl.search)
    return bareNotFound()
  }

  // ── Which hostname is this, and does this path belong on it? ─────────────
  // Inert until ADMIN_HOST / POS_HOST are set: with neither configured every
  // path is allowed on every host, exactly as before. See shared/src/hosts.ts.
  // Named hosts, not config — `export const config` below is the matcher, and
  // shadowing it inside the handler is a trap for whoever reads this next.
  const hosts = hostConfigFromEnv(process.env)
  const surface = classifySurface(request.headers.get('host') ?? '', hosts)

  if (pathname === '/') {
    const root = rootRedirectFor(surface)
    if (root) return NextResponse.redirect(new URL(root, request.url))
  }

  if (!isPathAllowed(pathname, surface, hosts)) return bareNotFound()

  // Applied to every response below.
  const extra: Record<string, string> = { 'Content-Security-Policy': csp }
  if (shouldNoIndex(surface)) extra['X-Robots-Tag'] = 'noindex, nofollow'

  const response = NextResponse.next()
  for (const [k, v] of Object.entries(extra)) response.headers.set(k, v)
  return response
}

export const config = {
  matcher: [
    // Run on all page routes; skip API routes, Next.js internals, and prefetches
    // so we don't add nonce overhead to requests that don't render HTML.
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
