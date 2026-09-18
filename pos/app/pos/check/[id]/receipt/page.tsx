'use client'

// The printable receipt for a closed check.
//
// Deliberately a separate route rather than a panel on the check screen. A
// receipt is printed, and printing wants a page with nothing else on it —
// putting it behind its own URL means the print stylesheet has one job and the
// floor screen keeps none of the weight.
//
// ── What prints today, and what will later ─────────────────────────────────
// The printer make and model are not decided, so there is no thermal transport
// yet. What there is: the exact document, laid out at a real roll width, that
// a browser can send to any ordinary printer. That is enough to pilot with —
// one section of one branch, old till still taking payment — and when the
// hardware question is answered, the transport takes the same text from
// receiptToText() rather than a second layout being written here.
//
// The width toggle is not a preference. 58mm rolls print 32 columns and 80mm
// rolls print 42, and which one the café has is part of the same unanswered
// question. Seeing both now is how the layout gets checked before there is a
// device to check it against.

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useTillAccess } from '../../../../lib/useTillAccess'
import { receiptOptionsFor } from '../../../../lib/receiptOptions'
import { useBusinessSettings } from '../../../../lib/useTillSettings'
import {
  buildReceipt, receiptToText, receiptBlockedReason, RECEIPT_WIDTHS,
} from '@big-cms/shared/receipt'
import { useCheck } from '../../../../lib/usePos'
import { PosLoading, PosButton, Chip } from '../../../../lib/posUi'
import { faPrint } from '@fortawesome/free-solid-svg-icons'

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


export default function ReceiptPage() {
  // The routes are not optional here. Left off, useRequireRole falls back to
  // its admin defaults and sends an unauthenticated visitor to /admin/login —
  // a path the POS app does not have, so the sign-in page is a 404 and the
  // receipt looks broken rather than locked. Same for `home` when the pos
  // feature is off. Every other POS page passes these; this one did not.
  const { checking } = useTillAccess(SECTION_ACCESS.pos, { login: '/pos/login', home: '/pos' })
  const params = useParams<{ id: string }>()
  const checkId = String(params?.id ?? '')
  const isMobile = useIsMobile()

  const { check, loading, error } = useCheck(checkId)
  const { settings } = useBusinessSettings()

  const [width, setWidth] = useState<number>(RECEIPT_WIDTHS.narrow)

  const blocked = check ? receiptBlockedReason(check) : null

  const text = useMemo(() => {
    if (!check || blocked) return ''
    // Shared with the KDS's receipt-on-close, so a reprint always matches the
    // receipt the customer was first handed.
    const rows = buildReceipt(check, receiptOptionsFor(settings.exchangeRate))
    return receiptToText(rows, width)
  }, [check, blocked, settings.exchangeRate, width])

  if (checking) return <PosLoading />

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '1.5rem 1rem 4rem' }}>
      {/* Only the paper prints. `visibility` rather than `display` so the
          receipt keeps its own layout instead of collapsing with the page. */}
      <style>{`
        @media print {
          @page { margin: 4mm; }
          body * { visibility: hidden; }
          #receipt-paper, #receipt-paper * { visibility: visible; }
          #receipt-paper {
            position: absolute; left: 0; top: 0;
            background: #fff; color: #000;
            box-shadow: none; border: none; padding: 0;
          }
        }
      `}</style>

      <div style={{ maxWidth: '560px', margin: '0 auto' }}>

        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '1.2rem', marginBottom: '0.6rem', fontFamily: 'var(--font-inter)' }}>
            {/* Closing a check lands here now (UPGRADE.md T2.7), so the floor is one tap away. */}
            <a href="/pos" style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--offwhite)', textDecoration: 'none' }}>← Floor</a>
            <a href={`/pos/check/${checkId}`} style={{ fontSize: '0.95rem', color: 'rgba(var(--offwhite-rgb),0.6)', textDecoration: 'none' }}>The check</a>
          </div>
          <h1 style={{
            fontFamily: 'var(--font-cinzel)', fontSize: '1.5rem',
            color: 'var(--offwhite)', marginBottom: '0.2rem',
          }}>Receipt</h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.3)' }}>
            Prints to whatever printer this device has. No thermal printer is wired up yet.
          </p>
        </div>

        {loading && (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)', padding: '2rem 0' }}>
            Loading…
          </p>
        )}

        {error && (
          <p style={{ color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>
            {error}
          </p>
        )}

        {!loading && !error && !check && (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.35)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>
            No check with that id.
          </p>
        )}

        {check && blocked && (
          <p style={{
            color: 'var(--brand-secondary)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
            lineHeight: 1.6, padding: '1rem 0',
          }}>{blocked}</p>
        )}

        {check && !blocked && (<>
          <div style={{
            display: 'flex', gap: '0.6rem', flexWrap: 'wrap',
            alignItems: 'center', marginBottom: '1.25rem',
          }}>
            <PosButton icon={faPrint} label="Print" tone="primary" onClick={() => window.print()} />

            {([RECEIPT_WIDTHS.narrow, RECEIPT_WIDTHS.wide] as number[]).map(w => (
              <Chip key={w} size="sm" active={width === w} onClick={() => setWidth(w)}
                label={w === RECEIPT_WIDTHS.narrow ? '58mm · 32 col' : '80mm · 42 col'} />
            ))}
          </div>

          {/* The paper. White on black is the wrong way round for a receipt,
              so this one panel inverts — it is a preview of something printed
              on paper, not another dark admin surface. */}
          <div
            id="receipt-paper"
            style={{
              background: '#fff',
              color: '#000',
              padding: '1.25rem',
              borderRadius: '2px',
              display: 'inline-block',
              maxWidth: '100%',
              overflowX: 'auto',
            }}
          >
            <pre style={{
              margin: 0,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: isMobile ? '11px' : '13px',
              lineHeight: 1.45,
              whiteSpace: 'pre',
            }}>{text}</pre>
          </div>
        </>)}

      </div>
    </div>
  )
}
