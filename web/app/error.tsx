'use client'

// What a customer sees when a public page throws.
//
// The least said the better. A visitor has no reference number to quote and
// nobody to quote it to, so the digest is logged rather than displayed —
// showing it turns a broken page into a page that looks broken AND technical.
//
// See pos/app/error.tsx for the note on why none of the three apps had a
// boundary at all until now.

import { useEffect } from 'react'
import { BRAND } from '@big-cms/shared/brand'
import { reportError } from '@big-cms/shared/reportError'

export default function WebError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[web] render error', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
      at: new Date().toISOString(),
      url: typeof window === 'undefined' ? '' : window.location.pathname,
    })
    // The console is no use at all here: this is a customer's phone, and
    // nobody opens a browser console or phones to say a page went blank. Of
    // the three apps this is the one that only ever reports — which is why
    // /api/errors takes an unauthenticated POST.
    reportError('web', error)
  }, [error])

  return (
    <main style={{
      minHeight: '70vh',
      backgroundColor: 'var(--black)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '4rem 1.5rem',
      textAlign: 'center',
    }}>
      <div style={{ maxWidth: '420px' }}>
        <h1 style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: '1.8rem',
          color: 'var(--offwhite)',
          marginBottom: '0.8rem',
        }}>This page didn&apos;t load</h1>

        <p style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '0.92rem',
          lineHeight: 1.7,
          color: 'rgba(var(--offwhite-rgb),0.6)',
          marginBottom: '2rem',
        }}>
          Something went wrong at our end, not yours. Try again in a moment.
        </p>

        <div style={{ display: 'flex', gap: '0.7rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={reset}
            style={{
              minHeight: '46px',
              padding: '0 1.7rem',
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

          {/* A full page load on purpose, not <Link>: this page shows because
              the app broke, and a fresh load is the way out of that state. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              minHeight: '46px',
              lineHeight: '46px',
              padding: '0 1.7rem',
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
          >{BRAND.shortName} home</a>
        </div>
      </div>
    </main>
  )
}
