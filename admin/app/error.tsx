'use client'

// What a staff member sees when an admin screen throws.
//
// Same reasoning as pos/app/error.tsx — see the longer note there for why no
// error boundary existing at all is worse than it sounds. The difference is
// the audience. Nobody is standing at a table waiting, so this can afford to
// say a little more, and the person reading it is the person who will report
// it.
//
// It still does not print a stack trace. A stack on screen invites a
// screenshot instead of a reference, and the digest is the thing that actually
// finds the error in a log.

import { useEffect } from 'react'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[admin] render error', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
      at: new Date().toISOString(),
      url: typeof window === 'undefined' ? '' : window.location.pathname,
    })
  }, [error])

  return (
    <main style={{
      minHeight: '100vh',
      backgroundColor: 'var(--black)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 1.5rem',
    }}>
      <div style={{ width: '100%', maxWidth: '460px' }}>

        <p style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '0.65rem',
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: 'var(--red)',
          marginBottom: '0.75rem',
        }}>Something broke</p>

        <h1 style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: '1.6rem',
          color: 'var(--offwhite)',
          marginBottom: '0.9rem',
        }}>This page stopped loading</h1>

        <p style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '0.88rem',
          lineHeight: 1.7,
          color: 'rgba(var(--offwhite-rgb),0.6)',
          marginBottom: '1.8rem',
        }}>
          Nothing was saved by the attempt that failed, so nothing is
          half-written. Try again first — most of these are a bad response
          rather than a broken page. If it keeps happening, the reference below
          is what identifies this particular failure.
        </p>

        <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap' }}>
          <button
            onClick={reset}
            style={{
              minHeight: '46px',
              padding: '0 1.6rem',
              backgroundColor: 'var(--teal)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.78rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >Try again</button>

          <a
            href="/admin"
            style={{
              minHeight: '46px',
              lineHeight: '46px',
              padding: '0 1.6rem',
              boxSizing: 'border-box',
              border: '1px solid rgba(var(--offwhite-rgb),0.18)',
              borderRadius: '4px',
              color: 'rgba(var(--offwhite-rgb),0.75)',
              textDecoration: 'none',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.78rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >Dashboard</a>
        </div>

        {error.digest && (
          <p style={{
            marginTop: '2.2rem',
            paddingTop: '1.2rem',
            borderTop: '1px solid rgba(var(--offwhite-rgb),0.08)',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.68rem',
            letterSpacing: '0.1em',
            color: 'rgba(var(--offwhite-rgb),0.3)',
          }}>Reference {error.digest}</p>
        )}
      </div>
    </main>
  )
}
