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

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '@big-cms/shared/firebase'
import { setAdminSessionCookie } from '@big-cms/shared/adminAuth'
import { BRAND } from '@big-cms/shared/brand'
import { backend } from '../../lib/backend'
import {
  adoptHubSession, askCounterSignIn, collectCounterSignIn, counterPeople, startHubSessionFromFirebase,
  type CounterRequest, type HubSession,
} from '../../lib/backend/hub'
import { tokenFromHandoff } from '@big-cms/shared/staffKeys'
import { isCounterHost } from '@big-cms/shared/counterSignIn'
import { startLoad } from '@big-cms/shared/startLoad'
import { useClientValue } from '@big-cms/shared/useClientValue'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { PosButton, ErrorNote } from '../../lib/posUi'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMobileScreen, faEnvelope, faUser, faXmark, faRightToBracket } from '@fortawesome/free-solid-svg-icons'

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

/**
 * On a café hub, one line under the form: which branch it serves, or that it
 * is not paired yet and where to pair it (POS software, stage 4). A hub that
 * is not paired has no menu, and this is the first screen somebody setting it
 * up sees.
 */
function HubNotice() {
  const [status, setStatus] = useState<{ paired: boolean; revoked: boolean; branch: string | null } | null>(null)

  useEffect(() => {
    if (backend().kind !== 'hub') return
    let live = true
    fetch('/api/hub/pairing', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (live && data) setStatus(data) })
      .catch(() => { /* the hub is this PC; nothing to add */ })
    return () => { live = false }
  }, [])

  if (!status) return null
  const link = (text: string) => <a href="/pos/hub" style={{ color: 'var(--teal)' }}>{text}</a>
  return (
    <p style={{ marginTop: '1.4rem', textAlign: 'center', fontSize: '0.8rem', lineHeight: 1.6, color: 'rgba(255,255,255,0.5)' }}>
      {!status.paired
        ? <>This café hub is not paired, so it has no menu yet. {link('Pair it')}</>
        // Unpaired by an admin, it still has what it took; it just takes nothing new.
        : status.revoked
          ? <>An admin unpaired this café hub. It keeps its menu but takes no updates. {link('Pair it again')}</>
          : <>Café hub for {status.branch} · {link('status')}</>}
    </p>
  )
}

/** Each way of signing in is its own card, titled, so the two never read as one form (UPGRADE.md T1.12). */
const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '12px', padding: '1.1rem 1rem 1.2rem',
}
const cardTitle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '1.05rem', fontWeight: 700,
  color: 'var(--offwhite)', marginBottom: '0.3rem',
}
const cardNote: React.CSSProperties = { fontSize: '0.85rem', lineHeight: 1.5, color: 'rgba(var(--offwhite-rgb),0.6)', marginBottom: '0.9rem' }
const label: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 600, color: 'rgba(var(--offwhite-rgb),0.75)', marginBottom: '0.3rem', display: 'block' }

/**
 * On the counter PC of a café hub, sign in with your own phone (S24): tap your
 * name, and type the code shown here into your staff app. No internet needed.
 * The session ends after 15 minutes without a tap (S25). Only on the counter PC
 * itself: a phone signs itself in from the staff app.
 */
function CounterSignIn({ onSignedIn }: { onSignedIn: (session: HubSession) => void }) {
  // Only on the counter PC itself, and only on a hub: both are the browser's
  // to know, so they are read after hydrating.
  const shown = useClientValue(() => backend().kind === 'hub' && isCounterHost(window.location.host), false)
  const [people, setPeople] = useState<{ uid: string; label: string }[]>([])
  const [request, setRequest] = useState<CounterRequest | null>(null)
  const [problem, setProblem] = useState('')
  const [asking, setAsking] = useState(false)

  const [peopleLoaded, setPeopleLoaded] = useState(false)
  useEffect(() => {
    if (!shown) return
    counterPeople()
      .then(list => { setPeople(list); setPeopleLoaded(true) })
      .catch(err => { setProblem(err instanceof Error ? err.message : 'The hub did not answer.'); setPeopleLoaded(true) })
  }, [shown])

  // Waits for the person's phone, asking every two seconds, until the request runs out.
  useEffect(() => {
    if (!request) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (!live) return
      if (Date.now() > request.expiresAt + 3_000) {
        setRequest(null)
        setProblem('Nobody confirmed on a phone in time. Tap your name again.')
        return
      }
      try {
        const answer = await collectCounterSignIn(request)
        if (!live) return
        if (typeof answer === 'object') { onSignedIn(answer); return }
        if (answer !== 'waiting') {
          setRequest(null)
          setProblem(answer === 'expired' ? 'Nobody confirmed on a phone in time. Tap your name again.' : 'That sign-in is closed. Tap your name again.')
          return
        }
      } catch {
        // No answer this time: keep asking until the request runs out.
      }
      timer = setTimeout(() => { void tick() }, 2_000)
    }
    timer = setTimeout(() => { void tick() }, 2_000)
    return () => { live = false; clearTimeout(timer) }
  }, [request, onSignedIn])

  async function ask(uid: string) {
    setAsking(true)
    setProblem('')
    try {
      setRequest(await askCounterSignIn(uid))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The hub did not take the sign-in.')
    } finally {
      setAsking(false)
    }
  }

  if (!shown) return null
  return (
    <section aria-labelledby="with-phone" style={{ ...card, marginBottom: '1rem' }}>
      <h2 id="with-phone" style={cardTitle}><FontAwesomeIcon icon={faMobileScreen} />With your phone</h2>
      <p style={cardNote}>Tap your name, then confirm on your phone. Works without the internet.</p>
      {request ? (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.9rem', lineHeight: 1.6 }}>
            {request.label.charAt(0).toUpperCase() + request.label.slice(1)}: in the staff app on your phone, tap
            <strong> Sign in the counter PC</strong>, type this code, and confirm with your fingerprint.
          </p>
          <p aria-label="Code for your phone" style={{
            fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '3rem', letterSpacing: '0.3em',
            color: 'var(--offwhite)', margin: '0.6rem 0 0.8rem',
          }}>{request.code}</p>
          <PosButton icon={faXmark} label="Cancel" tone="quiet" full onClick={() => setRequest(null)} />
        </div>
      ) : !peopleLoaded ? (
        <p role="status" style={{ ...cardNote, marginBottom: 0 }}>Loading staff…</p>
      ) : people.length === 0 && !problem ? (
        <p style={{ ...cardNote, marginBottom: 0 }}>
          No staff on this hub yet. Pair it, and give each staff account a first name in the admin panel.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.6rem' }}>
          {people.map(person => (
            <PosButton key={person.uid} icon={faUser} disabled={asking} onClick={() => { void ask(person.uid) }}
              label={person.label.charAt(0).toUpperCase() + person.label.slice(1)} />
          ))}
        </div>
      )}
      {problem && <div style={{ marginTop: '0.7rem' }}><ErrorNote message={problem} /></div>}
      <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)', marginTop: '0.9rem' }}>
        Signs out after 15 minutes without a tap.
      </p>
    </section>
  )
}

export default function PosLoginPage() {
  const router = useRouter()
  const isMobile = useIsMobile()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Read after hydrating: the server renders without knowing it is a hub page.
  const onHubHere = useClientValue(() => backend().kind === 'hub', false)

  const counterSignedIn = useCallback((session: HubSession) => {
    setAdminSessionCookie()
    router.replace(session.scope === 'kds' ? '/pos/kds' : '/pos')
  }, [router])

  // The staff app signed this phone in with its key and handed the session over
  // in the address (stage 5). Take it, take it out of the address, and go on.
  useEffect(() => {
    if (backend().kind !== 'hub') return
    const token = tokenFromHandoff(window.location.hash)
    if (!token) return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    startLoad(() => {
      setBusy(true)
      return adoptHubSession(token)
        .then(session => {
          setAdminSessionCookie()
          router.replace(session.scope === 'kds' ? '/pos/kds' : '/pos')
        })
        .catch(err => {
          setError(err instanceof Error ? err.message : 'The phone sign-in did not work. Sign in again.')
          setBusy(false)
        })
    })
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (err) {
      // No internet is not a wrong password: email sign-in asks Google, and on
      // a café hub with the line down it cannot. Said as it is, with the way
      // that does work (UPGRADE.md T1.5).
      if (isNetworkFailure(err)) {
        setError(backend().kind === 'hub'
          ? 'No internet, so email sign-in cannot work. Sign in with your phone instead.'
          : 'No internet connection. Check the wifi and try again.')
        setBusy(false)
        return
      }
      // Otherwise deliberately one message for every failure. Distinguishing
      // "no such account" from "wrong password" tells anyone holding the login
      // form which emails are real.
      setError('That email and password did not match an account.')
      setBusy(false)
      return
    }

    // On a café hub the Firebase sign-in is swapped for a hub session that
    // lasts the night (POS software, stage 3). The hub's refusal is shown as
    // it is: only staff may sign in, or the hub needs the internet to check.
    if (backend().kind === 'hub') {
      try {
        const user = auth.currentUser
        if (!user) throw new Error('That sign-in did not finish. Please try again.')
        await startHubSessionFromFirebase(await user.getIdToken())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The hub did not sign you in.')
        setBusy(false)
        return
      }
    }

    // Set before navigating: proxy.ts checks for this cookie on the way in,
    // and useRequireRole would bounce straight back here without it.
    setAdminSessionCookie()
    router.replace('/pos')
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
          fontSize: '0.8rem', letterSpacing: '0.2em', textTransform: 'uppercase',
          color: 'rgba(var(--offwhite-rgb),0.6)', marginBottom: '0.4rem', textAlign: 'center',
        }}>{BRAND.name}</p>
        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: '1.7rem', color: 'var(--offwhite)',
          marginBottom: '2rem', textAlign: 'center',
        }}>Point of Sale</h1>

        <CounterSignIn onSignedIn={counterSignedIn} />

        <form onSubmit={handleSubmit} aria-labelledby="with-email" style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div>
            <h2 id="with-email" style={cardTitle}><FontAwesomeIcon icon={faEnvelope} />With your email</h2>
            {onHubHere && <p style={{ ...cardNote, marginBottom: 0 }}>Needs the internet.</p>}
          </div>
          <div>
          <label htmlFor="pos-email" style={label}>Email</label>
          <input
            id="pos-email"
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            autoComplete="username" required
            // inputMode and autoCapitalize matter here: this is a phone
            // keyboard, and an auto-capitalised email fails to match silently.
            inputMode="email" autoCapitalize="none" autoCorrect="off"
            style={field}
          />
          </div>
          <div>
          <label htmlFor="pos-password" style={label}>Password</label>
          <input
            id="pos-password"
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete="current-password" required
            style={field}
          />
          </div>

          {error && <ErrorNote message={error} />}

          <PosButton type="submit" icon={faRightToBracket} label={busy ? 'Signing in…' : 'Sign in'}
            tone="primary" size="lg" full disabled={busy} />
        </form>

        <HubNotice />
      </div>
    </main>
  )
}
