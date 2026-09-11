'use client'

// The transport behind the error boundaries' seam. Phase 05 groundwork.
//
// What gets reported, and what counts as the same error, is decided in
// shared/src/errorReport.ts — pure, and asserted by `npm run verify:errors`.
// This file is only how it leaves the browser, and it is deliberately the
// dullest possible version of that.
//
// ── It must never throw, and never wait ────────────────────────────────────
// Every caller is an error boundary that is already displaying a failure. A
// reporter that throws inside one turns a handled error into a blank page —
// the exact thing the boundary exists to prevent. So everything here is inside
// a try/catch that swallows, and nothing awaits it.
//
// ── Why no auth ────────────────────────────────────────────────────────────
// A customer on the public site is signed out, and that is precisely the error
// worth hearing about. The route takes an unauthenticated POST, which is why
// the server treats every field as hostile: see shared/src/server/errorReports.ts.
//
// ── Adding Sentry later ────────────────────────────────────────────────────
// Add the transport here, beside the fetch. The call sites — four error
// components — do not change, and neither does what a report contains.

import {
  buildReport, shouldReport, EMPTY_THROTTLE,
  type AppName, type ErrorReportInput, type ThrottleState,
} from './errorReport'

// Per page load, which is the unit the cap is about. A reload is a fresh
// start, and a reload is what a person does when something breaks.
let throttle: ThrottleState = EMPTY_THROTTLE

/** Test seam: a page load's throttle state, reset between assertions. */
export function resetReportThrottle(): void {
  throttle = EMPTY_THROTTLE
}

export function reportError(
  app: AppName,
  error: { message?: string; stack?: string; digest?: string },
  extra: { path?: string } = {},
): void {
  try {
    const input: ErrorReportInput = {
      app,
      message: error?.message ?? '',
      stack: error?.stack ?? '',
      digest: error?.digest ?? '',
      path: extra.path ?? (typeof window === 'undefined' ? '' : window.location.pathname),
      at: new Date().toISOString(),
    }
    const report = buildReport(input)

    const decision = shouldReport(throttle, report.fingerprint, Date.now())
    throttle = decision.state
    if (!decision.send) return

    // keepalive: an error on the way out of a page — a failed navigation, a
    // tab being closed — would otherwise be cancelled with the document, and
    // those are the ones nobody can reproduce afterwards.
    void fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      keepalive: true,
    }).catch(() => {
      // Offline, blocked, refused — all fine. An error report that cannot be
      // delivered is not worth a second error, and the console still has it.
    })
  } catch {
    // Whatever went wrong in here is less important than the page the caller
    // is trying to render.
  }
}
