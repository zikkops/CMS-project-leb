'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../../lib/firebase'
import { setAdminSessionCookie } from '../../lib/adminAuth'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const check = await fetch('/api/auth/login-preflight', { method: 'POST' })
      if (!check.ok) {
        setError('Too many login attempts. Please wait 15 minutes before trying again.')
        return
      }
      const { user } = await signInWithEmailAndPassword(auth, email, password)
      setAdminSessionCookie()
      const snap = await getDoc(doc(db, 'users', user.uid))
      const role = snap.data()?.role ?? ''
      const target = (role === 'kitchen_crew' || role === 'barista')
        ? '/admin/weekly-orders/submit'
        : '/admin'
      router.replace(target)
    } catch {
      setError('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'var(--black)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
    }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>

        <h1 style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: '2rem',
          color: 'var(--offwhite)',
          marginBottom: '0.5rem',
        }}>
          Admin
        </h1>
        <p style={{
          fontSize: '0.7rem',
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: 'rgba(245,242,236,0.25)',
          marginBottom: '3rem',
          fontFamily: 'var(--font-inter)',
        }}>
          Onboard — Games & Tales
        </p>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          <div>
            <label style={{
              display: 'block',
              fontSize: '0.7rem',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.35)',
              marginBottom: '0.5rem',
              fontFamily: 'var(--font-inter)',
            }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--offwhite)',
                padding: '0.85rem 1rem',
                borderRadius: '2px',
                fontSize: '0.9rem',
                outline: 'none',
                fontFamily: 'var(--font-inter)',
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: '0.7rem',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.35)',
              marginBottom: '0.5rem',
              fontFamily: 'var(--font-inter)',
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--offwhite)',
                padding: '0.85rem 1rem',
                borderRadius: '2px',
                fontSize: '0.9rem',
                outline: 'none',
                fontFamily: 'var(--font-inter)',
              }}
            />
          </div>

          {error && (
            <p style={{
              color: 'var(--red)',
              fontSize: '0.82rem',
              fontFamily: 'var(--font-inter)',
            }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              backgroundColor: 'var(--teal)',
              color: '#fff',
              padding: '0.9rem',
              border: 'none',
              borderRadius: '2px',
              fontSize: '0.78rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              fontFamily: 'var(--font-inter)',
              marginTop: '0.5rem',
            }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

        </form>
      </div>
    </div>
  )
}