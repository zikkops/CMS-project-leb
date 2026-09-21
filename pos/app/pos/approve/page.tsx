'use client'

// Approving a shared device's sign-in from your own phone (UPGRADE.md T6.4).
// The device showed a QR; the phone's camera opened this page with the
// request in the address's fragment, which no server sees. Signed in to the
// till on this phone, you check the four digits match the device and approve:
// the device then signs in as you.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { faCheck, faRightToBracket } from '@fortawesome/free-solid-svg-icons'
import { useClientValue } from '@big-cms/shared/useClientValue'
import { requestFromHash } from '@big-cms/shared/staffSignIn'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { backend } from '../../lib/backend'
import { PosButton, ErrorNote, PosLoading } from '../../lib/posUi'

const subscribe = (onChange: () => void) => backend().watchAuth(() => onChange())
const words = (err: unknown, fallback: string) =>
  isNetworkFailure(err) ? 'No connection. Try again when the internet is back.' : err instanceof Error ? err.message : fallback

export default function ApproveSignInPage() {
  const id = useClientValue(() => requestFromHash(window.location.hash), null)
  const who = useSyncExternalStore(subscribe, () => backend().signedInAs() ?? '', () => '')
  const [code, setCode] = useState<string | null>(null)
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id || !who) return
    backend().request('POST', '/api/staff-signin', { action: 'peek', id })
      .then(data => {
        if (data.state !== 'waiting') setProblem('That code has run out or was already used. Show a new one on the device.')
        else setCode(String(data.code))
      })
      .catch(err => setProblem(words(err, 'That code could not be checked.')))
  }, [id, who])

  async function approve() {
    setBusy(true)
    setProblem('')
    try {
      await backend().request('POST', '/api/staff-signin', { action: 'approve', id })
      setDone(true)
    } catch (err) {
      setProblem(words(err, 'The device was not signed in.'))
    } finally {
      setBusy(false)
    }
  }

  const box = { maxWidth: '380px', margin: '0 auto', padding: '2rem 1.25rem', fontFamily: 'var(--font-inter)', color: 'var(--offwhite)', textAlign: 'center' as const }
  if (!id) return <main style={box}><ErrorNote message="This is not a sign-in code. On the device, show a new code and scan it with your camera." /></main>
  if (!who) {
    return (
      <main style={box}>
        <p style={{ marginBottom: '1rem', lineHeight: 1.6 }}>Sign in to the till on this phone first, then scan the code on the device again.</p>
        <PosButton icon={faRightToBracket} label="Sign in on this phone" tone="primary" full onClick={() => { window.location.href = '/pos/login' }} />
      </main>
    )
  }
  return (
    <main style={box}>
      <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', marginBottom: '1rem' }}>Sign in the device</h1>
      {done ? (
        <p style={{ lineHeight: 1.6 }}>Done. The device signs in as {who} in a moment.</p>
      ) : code ? (
        <>
          <p style={{ lineHeight: 1.6 }}>The device shows this number. If it does not, do not approve.</p>
          <p aria-label="Check number" style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '2.6rem', letterSpacing: '0.3em', margin: '0.6rem 0 1rem' }}>{code}</p>
          <PosButton icon={faCheck} label={`Sign it in as ${who}`} tone="primary" size="lg" full disabled={busy} onClick={() => { void approve() }} />
        </>
      ) : !problem ? <PosLoading label="Checking the code…" /> : null}
      {problem && <div style={{ marginTop: '1rem' }}><ErrorNote message={problem} /></div>}
    </main>
  )
}
