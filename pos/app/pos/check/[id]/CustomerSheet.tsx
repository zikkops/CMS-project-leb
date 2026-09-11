'use client'

// Putting the loyalty customer on a check — Phase 04, slice 5.
//
// The customer shows the member code from their profile; the till scans it,
// or the waiter types it where the phone cannot scan. Their points are
// credited when the check closes, in the same transaction.
//
// Scanning uses the browser's own BarcodeDetector, where there is one
// (Chrome on Android). Safari has none, and a QR decoder in the bundle for
// that one case is weight every waiter's phone would carry; the typed code
// works everywhere, so it is the fallback rather than a library.
//
// Safe to repeat: attaching the same customer twice is the same state, so a
// retry after a lost reply cannot do anything a first try would not.

import { useEffect, useRef, useState } from 'react'
import type { Check } from '@big-cms/shared/checks'
import { formatMemberCode, normalizeMemberCode } from '@big-cms/shared/memberCode'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { setCheckCustomer } from '../../../lib/usePos'

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> }

function makeDetector(): Detector | null {
  const BD = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
  try { return BD ? new BD({ formats: ['qr_code'] }) : null } catch { return null }
}

const tap: React.CSSProperties = {
  minHeight: '48px', padding: '0.7rem 1rem', borderRadius: '6px',
  fontFamily: 'var(--font-inter)', fontSize: '0.9rem', cursor: 'pointer',
}

export default function CustomerSheet({ check, onDone }: { check: Check; onDone: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)
  // Decided once, on the device: whether this browser can read a QR at all.
  const [canScan] = useState(() => typeof window !== 'undefined' && makeDetector() !== null)
  const videoRef = useRef<HTMLVideoElement>(null)

  async function attach(code: string | null) {
    setBusy(true)
    setError('')
    try {
      await setCheckCustomer(check.id, code)
      onDone()
    } catch (e) {
      setError(isNetworkFailure(e)
        ? 'No connection — try again when the wifi is back. Adding the customer twice is harmless.'
        : e instanceof Error ? e.message : 'Could not add the customer.')
    } finally {
      setBusy(false)
      setScanning(false)
    }
  }

  // The camera runs only while scanning, and stops the moment a code is read
  // or the sheet closes — a till is somebody's own phone.
  useEffect(() => {
    if (!scanning) return
    const detector = makeDetector()
    if (!detector) return
    let stream: MediaStream | null = null
    let stop = false
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        const video = videoRef.current
        if (!video || stop) return
        video.srcObject = stream
        await video.play()
        while (!stop) {
          const found = await detector.detect(video).catch(() => [])
          const code = found.map(f => normalizeMemberCode(f.rawValue)).find(Boolean)
          if (code) { stop = true; void attach(code); break }
          await new Promise(r => setTimeout(r, 250))
        }
      } catch {
        setError('The camera could not be opened here — type the code instead.')
        setScanning(false)
      }
    })()
    return () => { stop = true; stream?.getTracks().forEach(t => t.stop()) }
    // attach is stable enough for this: it only closes over the check id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning])

  const code = normalizeMemberCode(typed)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50,
      }}
      onClick={() => { if (!busy) onDone() }}
    >
      <div
        style={{
          backgroundColor: '#111', width: '100%', maxWidth: '640px', maxHeight: '88vh', overflowY: 'auto',
          borderRadius: '10px 10px 0 0', padding: '1.25rem 1rem 2rem',
          border: '1px solid rgba(255,255,255,0.1)', fontFamily: 'var(--font-inter)', color: 'var(--offwhite)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem', marginBottom: '0.6rem' }}>
          Loyalty customer
        </h2>

        {check.loyalty ? (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem',
            padding: '0.7rem 0.8rem', borderRadius: '6px', marginBottom: '0.9rem',
            backgroundColor: 'rgba(var(--teal-rgb),0.12)', border: '1px solid var(--teal)',
          }}>
            <span style={{ fontSize: '0.9rem' }}>Collecting: <strong>{check.loyalty.name}</strong></span>
            <button onClick={() => attach(null)} disabled={busy} style={{
              ...tap, minHeight: '40px', padding: '0.4rem 0.8rem', backgroundColor: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(var(--offwhite-rgb),0.75)',
            }}>Remove</button>
          </div>
        ) : (
          <p style={{ fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.5)', lineHeight: 1.6, marginBottom: '0.9rem' }}>
            Scan the code on the customer&apos;s profile, or type it. Their points go on when the check closes.
          </p>
        )}

        {canScan && (
          scanning ? (
            <video ref={videoRef} muted playsInline style={{
              width: '100%', borderRadius: '8px', backgroundColor: '#000', marginBottom: '0.7rem',
            }} />
          ) : (
            <button onClick={() => { setError(''); setScanning(true) }} disabled={busy} style={{
              ...tap, width: '100%', marginBottom: '0.7rem', border: 'none',
              backgroundColor: 'var(--teal)', color: '#fff', letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>Scan code</button>
          )
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            value={typed}
            onChange={e => { setTyped(e.target.value); setError('') }}
            placeholder="ABCD-EFGH-JK"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            style={{
              ...tap, flex: 1, backgroundColor: '#0a0a0a', color: 'var(--offwhite)', cursor: 'text',
              border: '1px solid rgba(255,255,255,0.14)', fontSize: '1rem', letterSpacing: '0.1em',
            }}
          />
          <button onClick={() => code && attach(code)} disabled={busy || !code} style={{
            ...tap, border: 'none', color: '#fff',
            backgroundColor: code ? 'var(--teal)' : 'rgba(var(--teal-rgb),0.25)',
          }}>{busy ? '…' : 'Add'}</button>
        </div>
        {typed.trim() !== '' && !code && (
          <p style={{ fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.45)', marginTop: '0.4rem' }}>
            A member code is 10 letters and digits, like {formatMemberCode('ABCDEFGHJK')}.
          </p>
        )}

        {error && (
          <p style={{ color: 'var(--red)', fontSize: '0.82rem', marginTop: '0.8rem', lineHeight: 1.6 }}>{error}</p>
        )}

        <button onClick={onDone} disabled={busy} style={{
          ...tap, width: '100%', marginTop: '0.9rem', backgroundColor: 'transparent', border: 'none',
          color: 'rgba(var(--offwhite-rgb),0.4)',
        }}>Back to the check</button>
      </div>
    </div>
  )
}
