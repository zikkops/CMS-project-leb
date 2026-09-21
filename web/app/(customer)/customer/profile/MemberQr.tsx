'use client'

// The customer's loyalty member code, as a QR for the till to scan — Phase 04,
// slice 5. Points now land the moment a check is paid, instead of from a
// photographed receipt waiting in an approval queue.
//
// The code comes from /api/customer/member-code, which makes it the first
// time it is asked for. The same code is printed underneath in groups, for a
// till whose phone cannot scan and a waiter who types it instead.

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { formatMemberCode } from '@big-cms/shared/memberCode'

// Black on white whatever the page's theme: a scanner reads contrast, and a
// brand-coloured code on a dark card is one a cheap phone camera gives up on.
const QR_COLOURS = { dark: '#000000', light: '#ffffff' }

export default function MemberQr() {
  const [state, setState] = useState<{ code: string; img: string } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await unwrap(await authedFetch('/api/customer/member-code', 'GET'))
        const code = String(data.code ?? '')
        const img = await QRCode.toDataURL(code, { margin: 1, width: 220, color: QR_COLOURS })
        if (!cancelled) setState({ code, img })
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Could not load your member code.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{
      marginTop: '1rem', padding: '1rem', borderRadius: '8px',
      backgroundColor: 'rgba(var(--overlay-rgb),0.06)', border: '1px solid rgba(var(--overlay-rgb),0.12)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', maxWidth: '280px',
    }}>
      <p style={{
        fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.18em',
        textTransform: 'uppercase', color: 'rgba(var(--overlay-rgb),0.6)',
      }}>Your member code</p>
      {err ? (
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--red)', textAlign: 'center' }}>{err}</p>
      ) : !state ? (
        <div style={{ width: '220px', height: '220px', borderRadius: '6px', backgroundColor: 'rgba(var(--overlay-rgb),0.08)' }} />
      ) : (
        <>
          {/* A data: URL, so nothing is fetched from anywhere the CSP would have to allow. */}
          <img src={state.img} alt={`Member code ${formatMemberCode(state.code)}`} width={220} height={220}
            style={{ borderRadius: '6px' }} />
          <p style={{
            fontFamily: 'var(--font-inter)', fontSize: '1.05rem', fontWeight: 600,
            letterSpacing: '0.12em', color: '#fff',
          }}>{formatMemberCode(state.code)}</p>
        </>
      )}
      <p style={{
        fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--overlay-rgb),0.5)',
        textAlign: 'center', lineHeight: 1.5,
      }}>Show this when you pay and the points go straight onto your account.</p>
    </div>
  )
}
