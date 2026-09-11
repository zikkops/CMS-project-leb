'use client'

// The last resort: an error in the ROOT LAYOUT itself.
//
// Next replaces the entire document with this, which has one consequence that
// is easy to miss and impossible to see coming:
//
//   THE BRAND VARIABLES DO NOT EXIST HERE.
//
// brandCssVars() is injected by each app's root layout, and the root layout is
// precisely what failed. So is next/font, so --font-brand-body is gone too.
// Every colour and every family below is therefore a literal, and that is not
// an oversight to tidy up later — writing var(--offwhite) here produces an
// unstyled page at the exact moment the app is already broken, and the
// branding audit will not flag it because a variable reference looks correct.
//
// It must also render its own <html> and <body>: there is no layout above it.
//
// Shared because all three apps need the identical thing, and three copies of
// a page nobody looks at is three copies that drift apart unnoticed.

import { useEffect } from 'react'
import { reportError } from '../reportError'

export function GlobalErrorPage({
  app,
  error,
  reset,
}: {
  /** Which app this is, for the log line. */
  app: 'web' | 'admin' | 'pos'
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(`[${app}] root layout error`, {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
      at: new Date().toISOString(),
    })
    // Worth reporting from here more than from anywhere else: the root layout
    // failing means the person saw nothing at all, and the Firebase SDK went
    // down with it — so there is no signed-in session to attach, which is
    // precisely why /api/errors takes an unauthenticated POST.
    reportError(app, error)
  }, [app, error])

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#0F0F11',
          color: '#EDEBE7',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem 1.5rem',
          textAlign: 'center',
        }}>
          <div style={{ maxWidth: '400px' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 600, margin: '0 0 0.8rem' }}>
              Something went wrong
            </h1>
            <p style={{
              fontSize: '0.9rem',
              lineHeight: 1.7,
              color: 'rgba(237, 235, 231, 0.6)',
              margin: '0 0 2rem',
            }}>
              The page could not start. Reloading usually fixes it.
            </p>
            <button
              onClick={reset}
              style={{
                minHeight: '48px',
                padding: '0 1.8rem',
                backgroundColor: '#4A8DB7',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                fontSize: '0.82rem',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >Reload</button>

            {error.digest && (
              <p style={{
                marginTop: '2rem',
                fontSize: '0.68rem',
                letterSpacing: '0.1em',
                color: 'rgba(237, 235, 231, 0.28)',
              }}>Reference {error.digest}</p>
            )}
          </div>
        </div>
      </body>
    </html>
  )
}
