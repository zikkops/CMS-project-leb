'use client'

// Signing in to the till.
//
// The POS has its own login rather than borrowing the admin panel's, because
// after the app split they are different deployments — sending a waiter to the
// admin hostname to sign in would bounce them between two domains, and on a
// phone mid-service that is a lost order.
//
// Same Firebase Auth, same accounts, same session cookie. Only the page is
// separate.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '@big-cms/shared/firebase'
import { setAdminSessionCookie } from '@big-cms/shared/adminAuth'
import { BRAND } from '@big-cms/shared/brand'

// Duplicated per file by convention — see CLAUDE.md. Don't refactor to share.
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return isMobile
}

const field: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '4px', padding: '0.9rem 1rem', color: 'var(--offwhite)',
  fontFamily: 'var(--font-inter)', fontSize: '1rem', outline: 'none', width: '100%',
}

export default function PosLoginPage() {
  const router = useRouter()
  const isMobile = useIsMobile()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
      // Set before navigating: proxy.ts checks for this cookie on the way in,
      // and useRequireRole would bounce straight back here without it.
      setAdminSessionCookie()
      router.replace('/pos')
    } catch {
      // Deliberately one message for every failure. Distinguishing "no such
      // account" from "wrong password" tells anyone holding the login form
      // which emails are real.
      setError('That email and password did not match an account.')
      setBusy(false)
    }
  }

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: isMobile ? '1.5rem 1.25rem' : '2rem',
      fontFamily: 'var(--font-inter)',
    }}>
      <div style={{ width: '100%', maxWidth: '360px' }}>
        <p style={{
          fontSize: '0.6rem', letterSpacing: '0.25em', textTransform: 'uppercase',
          color: 'var(--teal)', marginBottom: '0.4rem', textAlign: 'center',
        }}>{BRAND.name}</p>
        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: '1.7rem', color: 'var(--offwhite)',
          marginBottom: '2rem', textAlign: 'center',
        }}>Point of Sale</h1>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email" autoComplete="username" required
            // inputMode and autoCapitalize matter here: this is a phone
            // keyboard, and an auto-capitalised email fails to match silently.
            inputMode="email" autoCapitalize="none" autoCorrect="off"
            style={field}
          />
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" autoComplete="current-password" required
            style={field}
          />

          {error && (
            <p style={{ color: 'var(--red)', fontSize: '0.82rem', lineHeight: 1.6 }}>{error}</p>
          )}

          <button
            type="submit" disabled={busy}
            style={{
              marginTop: '0.4rem', minHeight: '52px',
              backgroundColor: busy ? 'rgba(0,160,152,0.35)' : 'var(--teal)',
              color: '#fff', border: 'none', borderRadius: '4px',
              fontSize: '0.85rem', letterSpacing: '0.14em', textTransform: 'uppercase',
              fontFamily: 'var(--font-inter)', cursor: busy ? 'default' : 'pointer',
            }}
          >{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </main>
  )
}
