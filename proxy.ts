import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  hostConfigFromEnv, classifySurface, isPathAllowed, rootRedirectFor, shouldNoIndex,
} from './app/lib/hosts'

const SESSION_COOKIE = 'admin_session'

function buildCsp(): string {
  const isDev = process.env.NODE_ENV === 'development'
  return [
    "default-src 'self'",
    // Next.js App Router emits <script src> chunk tags and inline <script> RSC
    // data blocks — neither gets a nonce automatically without wiring the root
    // layout to read x-nonce from headers(). 'unsafe-inline' + 'self' is the
    // standard pragmatic approach for Next.js; the real auth boundary is Firebase.
    // 'unsafe-eval' is needed in dev because React uses eval for error overlays.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    // Inline styles are used throughout via JSX style={{}} props.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // i.ibb.co: user-uploaded images. api.dicebear.com: avatars, both the
    // legacy flow and the demo's placeholder avatars.
    //
    // images.unsplash.com: demo placeholder photography — see
    // app/lib/placeholderAssets.ts.
    //
    // NOTE: this line also fixes a real, previously silent bug. The menu hero
    // already pointed at images.unsplash.com and was blocked here, so it never
    // rendered — no error, no broken-image icon, just nothing. A CSP violation
    // is a runtime browser policy, so neither type-checking nor a successful
    // build will ever catch one. If you add an external image host, add it
    // here AND to images.remotePatterns in next.config.ts, then load the page
    // and actually look at it.
    "img-src 'self' blob: data: https://i.ibb.co https://api.dicebear.com https://images.unsplash.com",
    // Firebase Auth REST, Firestore (incl. WebSocket), token refresh.
    // api.mymemory.translated.net: translateToArabic() in weeklyOrders.ts.
    "connect-src 'self' https://*.googleapis.com wss://*.googleapis.com https://*.firebaseapp.com https://api.mymemory.translated.net",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // frame-ancestors here + X-Frame-Options in next.config.ts cover both
    // modern browsers (CSP) and legacy ones (X-Frame-Options).
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join('; ')
}

export function proxy(request: NextRequest) {
  const csp = buildCsp()

  const pathname = request.nextUrl.pathname

  // ── Which hostname is this, and does this path belong on it? ─────────────
  // Inert until ADMIN_HOST / POS_HOST are set: with neither configured every
  // path is allowed on every host, exactly as before. See app/lib/hosts.ts.
  // Named hosts, not config — `export const config` below is the matcher, and
  // shadowing it inside the handler is a trap for whoever reads this next.
  const hosts = hostConfigFromEnv(process.env)
  const surface = classifySurface(request.headers.get('host') ?? '', hosts)

  if (pathname === '/') {
    const root = rootRedirectFor(surface)
    if (root) return NextResponse.redirect(new URL(root, request.url))
  }

  if (!isPathAllowed(pathname, surface, hosts)) {
    // A bare 404, not a redirect and not the styled not-found page. A redirect
    // to /admin/login would confirm the admin panel exists on a host that is
    // supposed to have no admin panel, and the branded page names the
    // business. Nothing here is the whole point.
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex, nofollow' },
    })
  }

  // Applied to every response below via withHeaders().
  const extra: Record<string, string> = { 'Content-Security-Policy': csp }
  if (shouldNoIndex(surface)) extra['X-Robots-Tag'] = 'noindex, nofollow'

  const withHeaders = (response: NextResponse): NextResponse => {
    for (const [k, v] of Object.entries(extra)) response.headers.set(k, v)
    return response
  }

  // Let the login page through without a session check
  if (pathname === '/admin/login') {
    return withHeaders(NextResponse.next())
  }

  // All other /admin/** routes require the session cookie (optimistic check —
  // see ARCHITECTURE.md for why this isn't the real security boundary).
  if (pathname.startsWith('/admin') && !request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL('/admin/login', request.url))
  }

  return withHeaders(NextResponse.next())
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
