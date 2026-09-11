'use client'

// Taking payment at the table — Phase 04, slice 1.
//
// Shown instead of the plain close confirmation when the `payments` feature is
// on. Everything it says about money comes from shared/src/payments.ts, the
// same functions the server runs, so what the waiter is told to hand back is
// what the server records — the preview is not a second opinion.
//
// ── A payment whose reply is lost ──────────────────────────────────────────
// Same contract as Send (see pendingKey in page.tsx): one key per attempt,
// kept until an answer arrives, the inputs locked meanwhile because an edit
// would make the retry a different payment. The live check settles it on its
// own — once a payment carrying the key appears, it was taken.

import { useEffect, useState } from 'react'
import { checkTotals, type Check } from '@big-cms/shared/checks'
import {
  applyPayment, balance, CASH_LBP_STEP,
  type PayCurrency, type Tender,
} from '@big-cms/shared/payments'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { payCheck } from '../../../lib/usePos'

const usd = (n: number) => `$${n.toFixed(2)}`
const lbp = (n: number) => `${Math.round(n).toLocaleString('en-US')} LBP`

function newPaymentKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`
}

function describeChange(changeUsd: number, changeLbp: number): string {
  return [changeUsd > 0 ? usd(changeUsd).replace('.00', '') : '', changeLbp > 0 ? lbp(changeLbp) : '']
    .filter(Boolean).join(' + ')
}

const TENDERS: { tender: Tender; currency: PayCurrency; label: string }[] = [
  { tender: 'cash', currency: 'USD', label: 'Cash $' },
  { tender: 'cash', currency: 'LBP', label: 'Cash LBP' },
  { tender: 'card', currency: 'USD', label: 'Card $' },
  { tender: 'card', currency: 'LBP', label: 'Card LBP' },
]

const tap: React.CSSProperties = {
  minHeight: '48px', padding: '0.7rem 1rem', borderRadius: '6px',
  fontFamily: 'var(--font-inter)', fontSize: '0.9rem', cursor: 'pointer',
}

export default function PaySheet({
  check, liveRate, onDismiss, onPaid,
}: {
  check: Check
  /** The business setting — used only until the first payment fixes the check's own rate. */
  liveRate: number
  onDismiss: () => void
  /** Called when the check is paid in full and the waiter asks to close it. */
  onPaid: () => void
}) {
  const [tender, setTender] = useState<Tender>('cash')
  const [currency, setCurrency] = useState<PayCurrency>('USD')
  const [amount, setAmount] = useState('')
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [change, setChange] = useState<{ usd: number; lbp: number } | null>(null)

  const payments = check.payments ?? []
  const rate = check.billRate ?? liveRate
  const due = checkTotals(check).net
  const b = balance(due, payments, rate)
  const locked = pendingKey !== null

  // An unanswered payment that the live check shows as taken was taken.
  useEffect(() => {
    if (!pendingKey) return
    const landed = (check.payments ?? []).find(p => p.key === pendingKey)
    if (!landed) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingKey(null)
    setError('')
    setChange({ usd: landed.changeUsd, lbp: landed.changeLbp })
    setAmount('')
  }, [check.payments, pendingKey])

  const req = { tender, currency, amount: Number(amount) }
  const preview = amount === '' ? null : applyPayment(due, payments, rate, req)

  function chooseTender(t: Tender, c: PayCurrency) {
    if (locked) return
    setTender(t)
    setCurrency(c)
    setAmount('')
    setError('')
  }

  // The exact figure in the chosen money. Lira cash rounds UP to a note —
  // the customer cannot hand over 895,900 in notes, and the change machinery
  // gives back the difference.
  function exact() {
    if (locked) return
    setAmount(currency === 'USD'
      ? b.remainingUsd.toFixed(2)
      : String(tender === 'cash'
        ? Math.ceil(b.remainingLbp / CASH_LBP_STEP) * CASH_LBP_STEP
        : b.remainingLbp))
  }

  async function take() {
    if (!preview || !preview.ok) return
    const key = pendingKey ?? newPaymentKey()
    setPendingKey(key)
    setBusy(true)
    setError('')
    setChange(null)
    try {
      const r = await payCheck(check.id, req, key)
      setPendingKey(null)
      setChange({ usd: r.payment.changeUsd, lbp: r.payment.changeLbp })
      setAmount('')
    } catch (err) {
      if (isNetworkFailure(err)) {
        // No answer: it may or may not have been taken. The key is kept, so
        // pressing Take again is safe — and the live check will say if it was.
        setError('No connection — this payment may or may not have gone through. Tap Take again when you are back on the wifi: it will not be taken twice.')
      } else {
        // An answer, and it was no: nothing was recorded.
        setPendingKey(null)
        setError(err instanceof Error ? err.message : 'Could not take the payment.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50,
      }}
      onClick={() => { if (!busy && !locked) onDismiss() }}
    >
      <div
        style={{
          backgroundColor: '#111', width: '100%', maxWidth: '640px',
          maxHeight: '88vh', overflowY: 'auto', borderRadius: '10px 10px 0 0',
          padding: '1.25rem 1rem 2rem', border: '1px solid rgba(255,255,255,0.1)',
          fontFamily: 'var(--font-inter)', color: 'var(--offwhite)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem', marginBottom: '0.9rem' }}>
          Table {check.tableNumber} — payment
        </h2>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ color: 'rgba(var(--offwhite-rgb),0.5)', fontSize: '0.85rem' }}>
            {b.settled ? 'Paid in full' : 'Left to pay'}
          </span>
          <span style={{ fontSize: '1.4rem', fontWeight: 600 }}>
            {b.settled ? usd(due) : usd(b.remainingUsd)}
          </span>
        </div>
        {!b.settled && (
          <div style={{ textAlign: 'right', color: 'rgba(var(--offwhite-rgb),0.6)', fontSize: '0.9rem' }}>
            {lbp(b.remainingLbp)}
          </div>
        )}
        <div style={{
          color: 'rgba(var(--offwhite-rgb),0.35)', fontSize: '0.75rem', marginTop: '0.3rem',
        }}>
          At {rate.toLocaleString('en-US')} LBP / $1{check.billRate ? '' : ' — fixed by the first payment'}
        </div>

        {payments.length > 0 && (
          <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.7rem' }}>
            {payments.map(p => (
              <div key={p.key} style={{
                display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem',
                color: 'rgba(var(--offwhite-rgb),0.7)', padding: '0.2rem 0',
              }}>
                <span>
                  {p.tender === 'cash' ? 'Cash' : 'Card'}{' '}
                  {p.currency === 'USD' ? usd(p.amount) : lbp(p.amount)}
                </span>
                {(p.changeUsd > 0 || p.changeLbp > 0) && (
                  <span style={{ color: 'rgba(var(--offwhite-rgb),0.45)' }}>
                    change {describeChange(p.changeUsd, p.changeLbp)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {change && (change.usd > 0 || change.lbp > 0) && (
          <div style={{
            marginTop: '1rem', padding: '0.9rem', borderRadius: '6px',
            backgroundColor: 'rgba(var(--teal-rgb),0.15)', border: '1px solid var(--teal)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.6)', marginBottom: '0.2rem' }}>
              Give back
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 600 }}>{describeChange(change.usd, change.lbp)}</div>
          </div>
        )}

        {!b.settled && (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '1.1rem',
            }}>
              {TENDERS.map(t => {
                const on = t.tender === tender && t.currency === currency
                return (
                  <button
                    key={t.label}
                    onClick={() => chooseTender(t.tender, t.currency)}
                    disabled={locked}
                    style={{
                      ...tap,
                      backgroundColor: on ? 'rgba(var(--teal-rgb),0.2)' : 'transparent',
                      border: `1px solid ${on ? 'var(--teal)' : 'rgba(255,255,255,0.14)'}`,
                      color: on ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.7)',
                      opacity: locked && !on ? 0.4 : 1,
                    }}
                  >{t.label}</button>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem' }}>
              <input
                value={amount}
                onChange={e => {
                  if (locked) return
                  setAmount(e.target.value.replace(currency === 'USD' ? /[^0-9.]/g : /[^0-9]/g, ''))
                  setError('')
                }}
                inputMode={currency === 'USD' ? 'decimal' : 'numeric'}
                placeholder={currency === 'USD' ? 'Amount in $' : 'Amount in LBP'}
                disabled={locked}
                style={{
                  ...tap, flex: 1, backgroundColor: '#0a0a0a', color: 'var(--offwhite)',
                  border: '1px solid rgba(255,255,255,0.14)', cursor: 'text', fontSize: '1rem',
                }}
              />
              <button onClick={exact} disabled={locked} style={{
                ...tap, backgroundColor: 'transparent', color: 'rgba(var(--offwhite-rgb),0.7)',
                border: '1px solid rgba(255,255,255,0.14)',
              }}>Exact</button>
            </div>

            {preview && (
              <p style={{
                fontSize: '0.82rem', marginTop: '0.6rem', lineHeight: 1.6,
                color: preview.ok ? 'rgba(var(--offwhite-rgb),0.55)' : 'var(--red)',
              }}>
                {!preview.ok
                  ? preview.reason
                  : preview.changeUsd > 0 || preview.changeLbp > 0
                    ? `Change to give back: ${describeChange(preview.changeUsd, preview.changeLbp)}`
                    : 'No change.'}
              </p>
            )}

            <button
              onClick={take}
              disabled={busy || !preview || !preview.ok}
              style={{
                ...tap, width: '100%', marginTop: '0.8rem', border: 'none',
                backgroundColor: busy || !preview || !preview.ok ? 'rgba(var(--teal-rgb),0.25)' : 'var(--teal)',
                color: '#fff', letterSpacing: '0.1em', textTransform: 'uppercase',
              }}
            >{busy ? 'Taking…' : locked ? 'Take again' : 'Take payment'}</button>
          </>
        )}

        {error && (
          <p style={{ color: 'var(--red)', fontSize: '0.82rem', marginTop: '0.8rem', lineHeight: 1.6 }}>{error}</p>
        )}

        {b.settled && (
          <button
            onClick={onPaid}
            style={{
              ...tap, width: '100%', marginTop: '1.1rem', border: 'none',
              backgroundColor: 'var(--red)', color: '#fff', letterSpacing: '0.1em', textTransform: 'uppercase',
            }}
          >Close &amp; issue receipt</button>
        )}

        <button
          onClick={onDismiss}
          disabled={busy || locked}
          style={{
            ...tap, width: '100%', marginTop: '0.8rem', backgroundColor: 'transparent',
            border: 'none', color: 'rgba(var(--offwhite-rgb),0.4)',
            opacity: busy || locked ? 0.4 : 1,
          }}
        >Back to the check</button>
      </div>
    </div>
  )
}
