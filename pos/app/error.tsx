'use client'

// What a waiter sees when the POS throws mid-service.
//
// Before this existed there was no error boundary anywhere in any of the three
// apps. A render error — a null the code did not expect, a document from
// Firestore shaped differently to its type — unmounts the React tree and
// leaves a blank white screen. On a phone, in a café, during service, with a
// table waiting. Nothing on screen, nothing to do, and nobody finds out until
// somebody complains.
//
// ── What this page is for ──────────────────────────────────────────────────
// One thing: get the waiter working again in the next ten seconds. That is why
// there is no stack trace, no error code in large type and no apology. Two big
// targets, and the one fact that actually matters — the order is not lost,
// because everything sent is already on the server.
//
// The digest is shown small at the bottom because it is the only handle
// anybody has on WHICH error this was, and a waiter who can read six
// characters down the phone turns "the POS broke" into something findable.
//
// ── Scope ──────────────────────────────────────────────────────────────────
// This catches render errors below it. It does NOT catch an error in the root
// layout — that is global-error.tsx — and it does not catch a rejected promise
// in an event handler, which React never surfaces to a boundary at all. Those
// still need their own try/catch at the call site.

import { useEffect } from 'react'
import { reportError } from '@big-cms/shared/reportError'

export default function PosError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The console keeps the whole thing for whoever is holding the device.
    console.error('[pos] render error', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
      at: new Date().toISOString(),
      url: typeof window === 'undefined' ? '' : window.location.pathname,
    })
    // And this is the seam the comment here used to promise (Phase 05 lists it
    // as the highest-leverage half-day in the plan): a scrubbed copy goes to
    // /api/errors, where one document per distinct fault counts how often it
    // happens. It never throws and is never awaited — a reporter that throws
    // inside an error boundary turns a handled error into a blank page.
    reportError('pos', error)
  }, [error])

  return (
    <main style={{
      minHeight: '100vh',
      backgroundColor: 'var(--black)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
    }}>
      <div style={{ width: '100%', maxWidth: '380px', textAlign: 'center' }}>

        <h1 style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: '1.5rem',
          color: 'var(--offwhite)',
          marginBottom: '0.6rem',
        }}>This screen stopped</h1>

        <p style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '0.9rem',
          lineHeight: 1.6,
          color: 'rgba(var(--offwhite-rgb),0.6)',
          marginBottom: '2rem',
        }}>
          Nothing you already sent is lost — it is on the server. Try again, and
          if this screen comes back, go to the floor and open the table fresh.
        </p>

        {/* Deliberately large. This gets tapped by someone holding a tray. */}
        <button
          onClick={reset}
          style={{
            width: '100%',
            minHeight: '56px',
            backgroundColor: 'var(--teal)',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.85rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            marginBottom: '0.75rem',
          }}
        >Try again</button>

        <a
          href="/pos"
          style={{
            display: 'block',
            width: '100%',
            minHeight: '52px',
            lineHeight: '52px',
            boxSizing: 'border-box',
            backgroundColor: 'transparent',
            border: '1px solid rgba(var(--offwhite-rgb),0.18)',
            borderRadius: '4px',
            color: 'rgba(var(--offwhite-rgb),0.75)',
            textDecoration: 'none',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.8rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >Back to the floor</a>

        {error.digest && (
          <p style={{
            marginTop: '2rem',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.65rem',
            letterSpacing: '0.12em',
            color: 'rgba(var(--offwhite-rgb),0.28)',
          }}>Reference {error.digest}</p>
        )}
      </div>
    </main>
  )
}
