'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from 'firebase/auth'
import { getAuth } from 'firebase/auth'
import { getDoc, doc } from 'firebase/firestore'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons'
import {
  signInWithGoogle, signInCustomer, signUpWithEmail,
  linkGoogleWithPassword, resolveCustomerEmail, completeAccountSetup,
} from '../../../lib/customerAuth'
import { db } from '../../../lib/firebase'
import { setAdminSessionCookie } from '../../../lib/adminAuth'

async function postLoginTarget(user: User): Promise<string> {
  const snap = await getDoc(doc(db, 'users', user.uid))
  if (snap.exists() && snap.data()?.isStaff === true) {
    setAdminSessionCookie()
    const role = snap.data()?.role ?? ''
    return (role === 'kitchen_crew' || role === 'barista')
      ? '/admin/weekly-orders/submit'
      : '/admin'
  }
  return '/customer/profile'
}

type Mode = 'login' | 'signup'

function formatError(err: unknown): string {
  // console.warn (not .error) on purpose — Next.js dev mode pops up its
  // intrusive error overlay for any console.error call, even ones we're
  // about to catch and handle gracefully below, like a wrong password.
  console.warn('[customer-auth]', err)

  const message = err instanceof Error ? err.message : ''
  if (message === 'username-taken')    return 'That username is already taken — please choose another.'
  if (message === 'username-required') return 'Choose a username.'
  if (message === 'phone-required')    return 'Enter a valid phone number (7-20 digits).'
  if (message === 'name-required')     return 'Enter your first and last name.'
  if (message === 'name-too-long')     return 'First and last name must each be 50 characters or fewer.'
  if (message === 'email-mismatch')    return "That Google account doesn't match the email you entered."
  if (message === 'user-not-found')    return 'Incorrect email/username or password.'
  // The password was right — this account simply isn't a customer account.
  // Saying so plainly beats a generic failure the person will retry three
  // times before giving up. The sign-in is already undone by this point.
  if (message === 'staff-account')     return 'That is a staff account. Staff sign in at /admin — for a loyalty account, register with a different email address.'

  const code = (err as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/email-already-in-use': return 'An account with this email already exists.'
    case 'auth/invalid-email':        return 'Enter a valid email address.'
    case 'auth/weak-password':        return 'Password must be at least 6 characters.'
    case 'auth/missing-password':     return 'Enter a password.'
    case 'auth/provider-already-linked':
    case 'auth/credential-already-in-use': return 'This account already has a password — try logging in instead.'
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/user-not-found':       return 'Incorrect email/username or password.'
    case 'auth/popup-closed-by-user': return 'Sign-in was cancelled.'
    case 'auth/network-request-failed': return 'Network error — check your connection and try again.'
    case 'auth/too-many-requests':    return 'Too many attempts — please wait a moment and try again.'
    case 'auth/requires-recent-login': return 'Please sign in again to continue.'
    case 'permission-denied':         return 'Permission denied saving your account — the Firestore rules may not be set up yet.'
    case 'unavailable':               return 'Network issue reaching the database — please try again.'
    default:                          return `Something went wrong. Please try again. (${code || message || 'unknown error'})`
  }
}

const inputStyle = {
  width: '100%',
  backgroundColor: '#1a1a1a',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#F5F2EC',
  padding: '0.8rem 1rem',
  borderRadius: '4px',
  fontSize: '0.85rem',
  outline: 'none',
  fontFamily: 'var(--font-inter)',
}

const usernameInputProps = {
  minLength: 3,
  maxLength: 20,
  pattern: '[a-zA-Z0-9_]+',
  title: '3-20 characters: letters, numbers, and underscores only',
}

const phoneInputProps = {
  minLength: 7,
  maxLength: 20,
  pattern: '[0-9+\\-\\s()]{7,20}',
  title: '7-20 characters: digits, spaces, +, -, and () only',
}

export default function CustomerLoginPage() {
  const router = useRouter()
  const [mode, setMode]         = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone]       = useState('')
  const [identifier, setIdentifier] = useState('') // email (signup) or email-or-username (login)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [showLinkPrompt, setShowLinkPrompt] = useState(false)
  const [linkEmail, setLinkEmail] = useState('')

  // Set once a Google sign-in/link succeeds but the account has no username
  // yet — shows a one-question "choose a username" step before continuing.
  const [pendingUser, setPendingUser] = useState<User | null>(null)
  const [pendingUsername, setPendingUsername] = useState('')
  const [pendingPhone, setPendingPhone] = useState('')
  const [pendingFirstName, setPendingFirstName] = useState('')
  const [pendingLastName, setPendingLastName] = useState('')

  const [continueHovered, setContinueHovered] = useState(false)
  const [googleHovered, setGoogleHovered] = useState(false)
  const [eyeHovered, setEyeHovered] = useState(false)
  const [submitHovered, setSubmitHovered] = useState(false)
  const [linkGoogleHovered, setLinkGoogleHovered] = useState(false)
  const [modeSwitchHovered, setModeSwitchHovered] = useState(false)

  async function handleGoogle() {
    setBusy(true)
    setError('')
    setShowLinkPrompt(false)
    try {
      const { user, needsUsername } = await signInWithGoogle()
      if (needsUsername) {
        setPendingUser(user)
        setBusy(false)
        return
      }
      router.replace(await postLoginTarget(user))
    } catch (err) {
      setError(formatError(err))
      setBusy(false)
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setShowLinkPrompt(false)

    if (mode === 'signup') {
      try {
        await signUpWithEmail(username, identifier, password, phone, firstName, lastName)
        router.replace('/customer/profile')
      } catch (err) {
        setError(formatError(err))
        const code = (err as { code?: string })?.code ?? ''
        if (code === 'auth/email-already-in-use') {
          setLinkEmail(identifier)
          setShowLinkPrompt(true)
        }
        setBusy(false)
      }
      return
    }

    // Login — resolve the identifier (which may be a username) to a real
    // email up front, so it's available for the Google-link recovery below
    // without a second lookup.
    let resolvedEmail: string
    try {
      resolvedEmail = await resolveCustomerEmail(identifier)
    } catch (err) {
      setError(formatError(err))
      setBusy(false)
      return
    }

    try {
      await signInCustomer(identifier, password)
      const currentUser = getAuth().currentUser!
      router.replace(await postLoginTarget(currentUser))
    } catch (err) {
      setError(formatError(err))
      // Could be a wrong password, or a Google-only account that never had
      // one — offer the Google-link recovery either way. We can't reliably
      // tell which in advance (fetchSignInMethodsForEmail's accuracy depends
      // on the project's Email Enumeration Protection setting), so this is
      // just always available as a fallback; it's a no-op if it doesn't
      // apply — they'd cancel the popup or hit an email mismatch.
      setLinkEmail(resolvedEmail)
      setShowLinkPrompt(true)
      setBusy(false)
    }
  }

  async function handleLinkGoogle() {
    setBusy(true)
    setError('')
    try {
      const { user, needsUsername } = await linkGoogleWithPassword(linkEmail, password)
      if (needsUsername) {
        setPendingUser(user)
        setBusy(false)
        return
      }
      router.replace(await postLoginTarget(user))
    } catch (err) {
      setError(formatError(err))
      setBusy(false)
    }
  }

  async function handleCompleteSetup(e: React.FormEvent) {
    e.preventDefault()
    if (!pendingUser) return
    setBusy(true)
    setError('')
    try {
      await completeAccountSetup(pendingUser.uid, pendingUser.email ?? '', pendingUsername, pendingPhone, pendingFirstName, pendingLastName)
      router.replace(await postLoginTarget(pendingUser))
    } catch (err) {
      setError(formatError(err))
      setBusy(false)
    }
  }

  if (pendingUser) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: 'var(--black)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}>
        <div style={{ width: '100%', maxWidth: '380px' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h1 style={{
              fontFamily: 'var(--font-cinzel)',
              fontSize: '1.8rem',
              color: 'var(--offwhite)',
              marginBottom: '0.5rem',
            }}>One Last Step</h1>
            <p style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.85rem',
              color: 'rgba(245,242,236,0.4)',
            }}>Choose a username and add your phone number to finish setting up your account</p>
          </div>

          <form onSubmit={handleCompleteSetup} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <input
              type="text"
              placeholder="Username"
              value={pendingUsername}
              required
              {...usernameInputProps}
              onChange={e => setPendingUsername(e.target.value)}
              style={inputStyle}
            />
            <div style={{ display: 'flex', gap: '0.8rem' }}>
              <input
                type="text"
                placeholder="First Name"
                value={pendingFirstName}
                required
                maxLength={50}
                onChange={e => setPendingFirstName(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
              <input
                type="text"
                placeholder="Last Name"
                value={pendingLastName}
                required
                maxLength={50}
                onChange={e => setPendingLastName(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>
            <input
              type="tel"
              placeholder="Phone Number"
              value={pendingPhone}
              required
              {...phoneInputProps}
              onChange={e => setPendingPhone(e.target.value)}
              style={inputStyle}
            />
            <button type="submit" disabled={busy}
              onMouseEnter={() => setContinueHovered(true)}
              onMouseLeave={() => setContinueHovered(false)}
              style={{
                position: 'relative',
                overflow: 'hidden',
                backgroundColor: !busy && continueHovered ? 'rgba(106,106,183,0.15)' : 'var(--purple)',
                color: '#fff',
                padding: '0.9rem',
                borderRadius: '4px',
                border: '1px solid var(--purple)',
                fontSize: '0.8rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-inter)',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.6 : 1,
                backdropFilter: !busy && continueHovered ? 'blur(10px)' : 'none',
                transition: 'all 0.3s ease',
              }}>
              <span style={{
                position: 'absolute', top: 0,
                left: !busy && continueHovered ? '120%' : '-60%',
                width: '40%', height: '100%',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
                transform: 'skewX(-20deg)',
                transition: 'left 0.5s ease',
                pointerEvents: 'none',
              }} />
              {busy ? 'Please wait…' : 'Continue'}
            </button>
          </form>

          {error && (
            <p style={{
              marginTop: '1rem',
              fontSize: '0.78rem',
              color: 'var(--red)',
              fontFamily: 'var(--font-inter)',
              textAlign: 'center',
            }}>{error}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'var(--black)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
    }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{
            fontFamily: 'var(--font-cinzel)',
            fontSize: '1.8rem',
            color: 'var(--offwhite)',
            marginBottom: '0.5rem',
          }}>{mode === 'signup' ? 'Create Account' : 'Welcome Back'}</h1>
          <p style={{
            fontFamily: 'var(--font-inter)',
            fontSize: '0.85rem',
            color: 'rgba(245,242,236,0.4)',
          }}>{mode === 'signup' ? 'Sign up to get started' : 'Sign in to continue'}</p>
        </div>

        {/* Google */}
        <button onClick={handleGoogle} disabled={busy}
          onMouseEnter={() => setGoogleHovered(true)}
          onMouseLeave={() => setGoogleHovered(false)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            backgroundColor: !busy && googleHovered ? '#fff' : 'var(--offwhite)',
            color: '#1a1a1a',
            padding: '0.9rem',
            borderRadius: '4px',
            border: 'none',
            fontSize: '0.85rem',
            fontFamily: 'var(--font-inter)',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
            marginBottom: '1.5rem',
            boxShadow: !busy && googleHovered ? '0 4px 16px rgba(255,255,255,0.15)' : 'none',
            transform: !busy && googleHovered ? 'translateY(-2px)' : 'none',
            transition: 'all 0.2s ease',
          }}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9C16.64 14.2 17.64 11.9 17.64 9.2Z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.36 0-4.36-1.6-5.08-3.74H.9v2.33A9 9 0 0 0 9 18Z" />
            <path fill="#FBBC05" d="M3.92 10.68A5.4 5.4 0 0 1 3.64 9c0-.58.1-1.16.28-1.68V4.99H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.01l3.02-2.33Z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.34l2.58-2.58A9 9 0 0 0 .9 4.99l3.02 2.33C4.64 5.18 6.64 3.58 9 3.58Z" />
          </svg>
          {mode === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '1.5rem' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <span style={{
            fontFamily: 'var(--font-inter)',
            fontSize: '0.7rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)',
          }}>or continue with email</span>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.08)' }} />
        </div>

        {/* Email / Password */}
        <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          {mode === 'signup' && (
            <>
              <input
                type="text"
                placeholder="Username"
                value={username}
                required
                {...usernameInputProps}
                onChange={e => setUsername(e.target.value)}
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: '0.8rem' }}>
                <input
                  type="text"
                  placeholder="First Name"
                  value={firstName}
                  required
                  maxLength={50}
                  onChange={e => setFirstName(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <input
                  type="text"
                  placeholder="Last Name"
                  value={lastName}
                  required
                  maxLength={50}
                  onChange={e => setLastName(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
              </div>
              <input
                type="tel"
                placeholder="Phone Number"
                value={phone}
                required
                {...phoneInputProps}
                onChange={e => setPhone(e.target.value)}
                style={inputStyle}
              />
            </>
          )}
          <input
            type={mode === 'signup' ? 'email' : 'text'}
            placeholder={mode === 'signup' ? 'Email' : 'Email or Username'}
            value={identifier}
            required
            onChange={e => setIdentifier(e.target.value)}
            style={inputStyle}
          />
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              required
              minLength={6}
              onChange={e => setPassword(e.target.value)}
              style={{ ...inputStyle, paddingRight: '2.8rem' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(s => !s)}
              onMouseEnter={() => setEyeHovered(true)}
              onMouseLeave={() => setEyeHovered(false)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              style={{
                position: 'absolute',
                right: '0.9rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: eyeHovered ? 'var(--offwhite)' : 'rgba(245,242,236,0.4)',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                transition: 'color 0.2s ease',
              }}
            >
              <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} style={{ width: '16px' }} />
            </button>
          </div>

          <button type="submit" disabled={busy}
            onMouseEnter={() => setSubmitHovered(true)}
            onMouseLeave={() => setSubmitHovered(false)}
            style={{
              position: 'relative',
              overflow: 'hidden',
              backgroundColor: !busy && submitHovered ? 'rgba(106,106,183,0.15)' : 'var(--purple)',
              color: '#fff',
              padding: '0.9rem',
              borderRadius: '4px',
              border: '1px solid var(--purple)',
              fontSize: '0.8rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-inter)',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
              marginTop: '0.3rem',
              backdropFilter: !busy && submitHovered ? 'blur(10px)' : 'none',
              transition: 'all 0.3s ease',
            }}>
            <span style={{
              position: 'absolute', top: 0,
              left: !busy && submitHovered ? '120%' : '-60%',
              width: '40%', height: '100%',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
              transform: 'skewX(-20deg)',
              transition: 'left 0.5s ease',
              pointerEvents: 'none',
            }} />
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create Account' : 'Log In'}
          </button>
        </form>

        {error && (
          <p style={{
            marginTop: '1rem',
            fontSize: '0.78rem',
            color: 'var(--red)',
            fontFamily: 'var(--font-inter)',
            textAlign: 'center',
          }}>{error}</p>
        )}

        {showLinkPrompt && (
          <div style={{
            marginTop: '1rem',
            padding: '1rem',
            border: '1px solid rgba(106,106,183,0.3)',
            borderRadius: '4px',
            backgroundColor: 'rgba(106,106,183,0.08)',
            textAlign: 'center',
          }}>
            <p style={{
              fontSize: '0.78rem',
              color: 'rgba(245,242,236,0.6)',
              fontFamily: 'var(--font-inter)',
              marginBottom: '0.8rem',
              lineHeight: 1.5,
            }}>
              This is probably your Google account. Sign in with Google to confirm it&apos;s you, and
              we&apos;ll set this password on it so you can log in either way next time.
            </p>
            <button onClick={handleLinkGoogle} disabled={busy}
              onMouseEnter={() => setLinkGoogleHovered(true)}
              onMouseLeave={() => setLinkGoogleHovered(false)}
              style={{
                width: '100%',
                backgroundColor: !busy && linkGoogleHovered ? 'rgba(0,160,152,0.15)' : 'var(--teal)',
                color: '#fff',
                padding: '0.7rem',
                borderRadius: '2px',
                border: '1px solid var(--teal)',
                fontSize: '0.75rem',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-inter)',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.6 : 1,
                backdropFilter: !busy && linkGoogleHovered ? 'blur(10px)' : 'none',
                transition: 'all 0.3s ease',
              }}>Continue with Google</button>
          </div>
        )}

        <p style={{
          marginTop: '1.5rem',
          textAlign: 'center',
          fontSize: '0.8rem',
          fontFamily: 'var(--font-inter)',
          color: 'rgba(245,242,236,0.4)',
        }}>
          {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            type="button"
            onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(''); setShowLinkPrompt(false) }}
            onMouseEnter={() => setModeSwitchHovered(true)}
            onMouseLeave={() => setModeSwitchHovered(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--teal)',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.8rem',
              padding: 0,
              textDecoration: modeSwitchHovered ? 'underline' : 'none',
            }}>
            {mode === 'signup' ? 'Log In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  )
}
