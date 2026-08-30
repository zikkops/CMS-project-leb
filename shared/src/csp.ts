// The Content-Security-Policy, written once for all three apps.
//
// It lived in proxy.ts, which the split copied into web/, admin/ and pos/.
// Three copies of a security header is three places to add a host to and two
// to forget — and a CSP failure is silent: no error, no broken-image icon,
// just a thing that does not happen. Neither type-checking nor a successful
// build will ever catch one.
//
// If you add an external host anywhere, add it here, and for images add it to
// images.remotePatterns in each next.config.ts too. Then load the page and
// actually look at it.

export function buildCsp(isDev: boolean): string {
  return [
    "default-src 'self'",

    // Next's App Router emits <script src> chunk tags and inline <script> RSC
    // data blocks — neither gets a nonce without wiring the root layout to
    // read x-nonce from headers(). 'unsafe-inline' + 'self' is the standard
    // pragmatic approach for Next; the real auth boundary is Firebase.
    // 'unsafe-eval' is dev-only, for React's error overlay.
    //
    // apis.google.com is REQUIRED, and its absence was a live bug rather than
    // a hardening gap. signInWithPopup() loads apis.google.com/js/api.js, so
    // "Continue with Google" on the customer site failed with a console CSP
    // violation and no user-facing error at all — the popup simply never
    // appeared. Nothing in the codebase could have caught it: the code is
    // correct and the browser refuses it at runtime.
    `script-src 'self' 'unsafe-inline' https://apis.google.com${isDev ? " 'unsafe-eval'" : ''}`,

    // Inline styles are used throughout via JSX style={{}} props.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",

    // i.ibb.co: user-uploaded images. api.dicebear.com: avatars, both the
    // legacy flow and the demo's placeholder ones. images.unsplash.com: demo
    // placeholder photography — see placeholderAssets.ts.
    //
    // That last host is here because of a real silent bug: the menu hero
    // already pointed at Unsplash and was blocked, so it never rendered.
    "img-src 'self' blob: data: https://i.ibb.co https://api.dicebear.com https://images.unsplash.com",

    // Firebase Auth REST, Firestore including its WebSocket, token refresh.
    // api.mymemory.translated.net: translateToArabic() in weeklyOrders.ts.
    "connect-src 'self' https://*.googleapis.com wss://*.googleapis.com https://*.firebaseapp.com https://api.mymemory.translated.net",

    // The Google sign-in flow runs through an iframe on the project's own
    // firebaseapp.com auth handler, and accounts.google.com inside it. Without
    // this the popup opens and then fails, which is worse than not offering
    // the button.
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",

    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // frame-ancestors here + X-Frame-Options in next.config.ts cover both
    // modern browsers (CSP) and legacy ones.
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join('; ')
}
