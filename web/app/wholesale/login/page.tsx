'use client'

// Sign-in for wholesale accounts. Separate from /admin/login and
// /customer/login because it lands somewhere different and because a shop
// signing in here should never be told whether an email belongs to a staff
// member or a customer.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '@big-cms/shared/firebase'
import { useWholesaleAccount } from '@big-cms/shared/wholesale'
import { BRAND } from '@big-cms/shared/brand'

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

export default function WholesaleLoginPage() {
  const router = useRouter()
  const isMobile = useIsMobile()
  const { account, loading } = useWholesaleAccount()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    if (!loading && account) router.replace('/wholesale')
  }, [loading, account, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password)
      // Force a token refresh so the `wholesale` claim is present before the
      // next page tries to read prices — a token minted a moment before the
      // claim was set would fail the rule and look like "no prices exist".
      await cred.user.getIdToken(true)
      router.replace('/wholesale')
    } catch {
      // Deliberately one message for every failure. Distinguishing "no such
      // account" from "wrong password" would let anyone enumerate which shops
      // and staff have logins here.
      setError('Email or password is incorrect.')
      await signOut(auth).catch(() => {})
      setBusy(false)
    }
  }

  const inp: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    backgroundColor: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#F5F2EC', padding: '0.8rem 1rem', borderRadius: '3px',
    fontSize: '0.9rem', outline: 'none', fontFamily: 'var(--font-inter)',
  }

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: 'var(--black, #0a0a0a)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: isMobile ? '1.5rem' : '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>

        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <Image src={BRAND.logoUrl} alt={BRAND.name} width={120} height={44}
            style={{ width: '120px', height: 'auto', margin: '0 auto 1.5rem' }} />
          <h1 style={{
            fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.5rem' : '1.8rem',
            color: 'var(--offwhite, #F5F2EC)', marginBottom: '0.4rem',
          }}>Wholesale</h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.35)' }}>
            Sign in to see trade pricing and place an order.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="email" required value={email} autoComplete="username"
            onChange={e => setEmail(e.target.value)}
            placeholder="Email" style={inp}
          />
          <input
            type="password" required value={password} autoComplete="current-password"
            onChange={e => setPassword(e.target.value)}
            placeholder="Password" style={inp}
          />

          {error && (
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--red, #E43329)' }}>
              {error}
            </p>
          )}

          <button
            type="submit" disabled={busy}
            style={{
              backgroundColor: busy ? 'rgba(255,255,255,0.08)' : 'var(--teal, #00A098)',
              color: busy ? 'rgba(245,242,236,0.3)' : '#000',
              border: 'none', borderRadius: '3px', padding: '0.85rem',
              fontSize: '0.82rem', fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase', cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-inter)', marginTop: '0.5rem',
            }}
          >{busy ? 'Signing in…' : 'Sign In'}</button>
        </form>

        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.75rem',
          color: 'rgba(245,242,236,0.25)', textAlign: 'center', marginTop: '2rem', lineHeight: 1.7,
        }}>
          Wholesale accounts are set up by {BRAND.name}.<br />
          Contact us if you need access.
        </p>
      </div>
    </div>
  )
}
