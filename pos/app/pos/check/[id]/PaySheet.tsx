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
import { checkTotals, describeLine, lineTotal, type Check } from '@big-cms/shared/checks'
import {
  applyPayment, balance, fillAmount, tipProblem, CASH_LBP_STEP,
  type PayCurrency, type Tender,
} from '@big-cms/shared/payments'
import { splitEvenly, sharesByPerson, MAX_SPLIT_PEOPLE } from '@big-cms/shared/splits'
import { useFeature } from '../../../lib/useTillSettings'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { payCheck } from '../../../lib/usePos'
import { GOOD, GOOD_RGB, PosButton, Chip, Sheet } from '../../../lib/posUi'
import { faMoneyBillWave, faCreditCard, faCashRegister, faReceipt, faArrowLeft, faEquals, faMinus, faPlus } from '@fortawesome/free-solid-svg-icons'

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
  minHeight: '56px', padding: '0.7rem 1rem', borderRadius: '8px',
  fontFamily: 'var(--font-inter)', fontSize: '1rem', cursor: 'pointer',
}

const chip: React.CSSProperties = {
  ...tap, minHeight: '44px', padding: '0.45rem 0.8rem', fontSize: '0.92rem',
  backgroundColor: 'transparent', border: '1px solid rgba(var(--overlay-rgb),0.14)',
  color: 'rgba(var(--offwhite-rgb),0.75)',
}

type SplitMode = 'none' | 'even' | 'item'

/**
 * Working out each person's share — slice 3, reworked 14 Sep 2026 (owner's
 * request: choose how to split the bill, for any number of people). Seats left
 * ordering in the same change, so "by seat" became "by item": say who had each
 * item, and anything nobody is tapped for is shared by everyone.
 *
 * The arithmetic is shared/src/splits.ts (verify:payments). Every share is
 * built from the line totals the bill adds up, so the people always sum to the
 * bill, discounts included.
 *
 * Module scope, not declared inside PaySheet: a component defined in another
 * component's render body remounts on every state change (CLAUDE.md), which
 * here would forget who had what on every keystroke in the amount field.
 *
 * It only ever fills the amount. The waiter still chooses the money and
 * presses Take, so a split can never take a payment by itself.
 */
function SplitPanel({ check, onFill, disabled }: {
  check: Check
  onFill: (usd: number) => void
  disabled: boolean
}) {
  const [mode, setMode] = useState<SplitMode>('none')
  const [people, setPeople] = useState(Math.max(2, Math.min(check.guestCount || 2, MAX_SPLIT_PEOPLE)))
  // What is being typed into the people box, committed on blur or Enter — so
  // typing "12" does not pass through a clamped "1" on the way.
  const [typed, setTyped] = useState<string | null>(null)
  const [assigned, setAssigned] = useState<Record<string, number[]>>({})
  const [chosen, setChosen] = useState<number | null>(null)

  const live = check.lines.filter(l => l.status !== 'void')
  const shares = mode === 'even'
    ? splitEvenly(checkTotals(check).net, people).map((usd, i) => ({ person: i + 1, usd }))
    : sharesByPerson(check, people, assigned)

  function changePeople(next: number) {
    setTyped(null)
    setChosen(null)
    if (!Number.isFinite(next)) return
    setPeople(Math.max(2, Math.min(MAX_SPLIT_PEOPLE, Math.floor(next))))
  }

  function toggle(lineId: string, person: number) {
    setChosen(null)
    setAssigned(a => {
      const current = a[lineId] ?? []
      return { ...a, [lineId]: current.includes(person) ? current.filter(p => p !== person) : [...current, person] }
    })
  }

  const picked = (active: boolean): React.CSSProperties => ({
    borderColor: active ? 'var(--teal)' : 'rgba(var(--overlay-rgb),0.14)',
    backgroundColor: active ? 'rgba(var(--teal-rgb),0.15)' : 'transparent',
    color: active ? 'var(--offwhite)' : chip.color,
  })

  const tab = (m: SplitMode, label: string) => (
    <Chip key={m} label={label} size="sm" disabled={disabled} active={mode === m}
      onClick={() => { setMode(mode === m ? 'none' : m); setChosen(null) }} />
  )

  return (
    <div style={{ marginTop: '1.1rem' }}>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.9rem', color: 'rgba(var(--offwhite-rgb),0.6)', marginRight: '0.2rem' }}>
          Split
        </span>
        {tab('even', 'Evenly')}
        {tab('item', 'By item')}
      </div>

      {mode !== 'none' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.7rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.55)', minWidth: '3.5rem' }}>People</span>
            <PosButton icon={faMinus} label="One fewer person" iconOnly size="sm" disabled={disabled || people <= 2} onClick={() => changePeople(people - 1)} />
            <input
              value={typed ?? String(people)}
              inputMode="numeric"
              aria-label="Number of people"
              disabled={disabled}
              onChange={e => setTyped(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
              onBlur={() => { if (typed !== null) changePeople(Number(typed) || 2) }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              style={{ ...chip, width: '4.2rem', textAlign: 'center', color: 'var(--offwhite)', cursor: 'text' }}
            />
            <PosButton icon={faPlus} label="One more person" iconOnly size="sm" disabled={disabled || people >= MAX_SPLIT_PEOPLE} onClick={() => changePeople(people + 1)} />
          </div>

          {mode === 'item' && (
            <div style={{ marginTop: '0.8rem' }}>
              <p style={{ fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.5)', marginBottom: '0.4rem', lineHeight: 1.5 }}>
                Tap who had each item. An item nobody is tapped for is shared by everyone.
              </p>
              {live.map(l => {
                const who = (assigned[l.id] ?? []).filter(p => p <= people).sort((a, b) => a - b)
                return (
                  <div key={l.id} style={{ padding: '0.55rem 0', borderBottom: '1px solid rgba(var(--overlay-rgb),0.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', fontSize: '0.88rem', marginBottom: '0.35rem' }}>
                      <span>{describeLine(l)}</span>
                      <span style={{ color: 'rgba(var(--offwhite-rgb),0.6)', whiteSpace: 'nowrap' }}>
                        {usd(lineTotal(l, check.staffDiscount))} · {who.length === 0 ? 'everyone' : who.length === 1 ? `person ${who[0]}` : `${who.length} people`}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {Array.from({ length: people }, (_, i) => i + 1).map(p => (
                        <Chip key={p} label={String(p)} size="sm" disabled={disabled} active={who.includes(p)} onClick={() => toggle(l.id, p)} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <p style={{ fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.5)', margin: '0.8rem 0 0.4rem' }}>
            Tap a person to fill in their share, then choose the money and take it.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.4rem' }}>
            {shares.map(s => (
              <button key={s.person} disabled={disabled || s.usd <= 0}
                onClick={() => { setChosen(s.person); onFill(s.usd) }}
                style={{ ...chip, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.1rem', ...picked(chosen === s.person) }}>
                <span style={{ fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.55)' }}>Person {s.person}</span>
                <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--offwhite)' }}>{usd(s.usd)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
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
  // A tip on the card (UPGRADE.md T3.9), in dollars, on top of the amount.
  const { on: cardTipsOn } = useFeature('cardTips')
  const [tip, setTip] = useState('')
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

  const tipping = cardTipsOn && tender === 'card' && currency === 'USD'
  const req = { tender, currency, amount: Number(amount), ...(tipping && Number(tip) > 0 ? { tipUsd: Number(tip) } : {}) }
  const paid = amount === '' ? null : applyPayment(due, payments, rate, req)
  const tipIssue = tipProblem(req)
  // The tip is checked with the payment, so Take stays off until both are right.
  const preview = paid && paid.ok && tipIssue ? { ...paid, ok: false as const, reason: tipIssue } : paid

  function chooseTender(t: Tender, c: PayCurrency) {
    if (locked) return
    setTender(t)
    setCurrency(c)
    setAmount('')
    setTip('')
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

  // One person's share, from the split panel, in the money currently chosen.
  function fillShare(shareUsd: number) {
    if (locked) return
    const v = fillAmount(shareUsd, b, { tender, currency }, rate)
    setAmount(v > 0 ? (currency === 'USD' ? v.toFixed(2) : String(v)) : '')
    setError('')
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
      setTip('')
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
    <Sheet label="Payment" onClose={() => { if (!busy && !locked) onDismiss() }}>
      <div style={{ fontFamily: 'var(--font-inter)', color: 'var(--offwhite)' }}>
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
          <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(var(--overlay-rgb),0.08)', paddingTop: '0.7rem' }}>
            {payments.map(p => (
              <div key={p.key} style={{
                display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem',
                color: 'rgba(var(--offwhite-rgb),0.7)', padding: '0.2rem 0',
              }}>
                <span>
                  {p.tender === 'cash' ? 'Cash' : 'Card'}{' '}
                  {p.currency === 'USD' ? usd(p.amount) : lbp(p.amount)}
                  {(p.tipUsd ?? 0) > 0 && <span style={{ color: 'rgba(var(--offwhite-rgb),0.45)' }}> + {usd(p.tipUsd ?? 0)} tip</span>}
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
            backgroundColor: `rgba(${GOOD_RGB},0.15)`, border: `1px solid ${GOOD}`,
          }}>
            <div style={{ fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.6)', marginBottom: '0.2rem' }}>
              Give back
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 600 }}>{describeChange(change.usd, change.lbp)}</div>
          </div>
        )}

        {!b.settled && (
          <>
            <SplitPanel check={check} onFill={fillShare} disabled={locked} />

            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '1.1rem',
            }}>
              {TENDERS.map(t => {
                const on = t.tender === tender && t.currency === currency
                return (
                  <Chip key={t.label} label={t.label} icon={t.tender === 'cash' ? faMoneyBillWave : faCreditCard}
                    active={on} disabled={locked && !on} onClick={() => chooseTender(t.tender, t.currency)} />
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
                  ...tap, flex: 1, backgroundColor: 'var(--surface-deep)', color: 'var(--offwhite)',
                  border: '1px solid rgba(var(--overlay-rgb),0.14)', cursor: 'text', fontSize: '1rem',
                }}
              />
              <PosButton icon={faEquals} label="Exact" tone="quiet" disabled={locked} onClick={exact} />
            </div>
            {tipping && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.6rem', fontSize: '0.9rem', color: 'rgba(var(--offwhite-rgb),0.7)' }}>
                Tip on the card
                <input value={tip} disabled={locked} inputMode="decimal" placeholder="$0"
                  onChange={e => { if (!locked) { setTip(e.target.value.replace(/[^0-9.]/g, '')); setError('') } }}
                  style={{ ...tap, flex: 1, backgroundColor: 'var(--surface-deep)', color: 'var(--offwhite)', border: '1px solid rgba(var(--overlay-rgb),0.14)', cursor: 'text', fontSize: '1rem' }} />
              </label>
            )}
            {tipping && Number(tip) > 0 && !tipIssue && Number(amount) > 0 && (
              <p style={{ fontSize: '0.82rem', marginTop: '0.4rem', color: 'rgba(var(--offwhite-rgb),0.55)' }}>
                Charge the card {usd(Number(amount) + Number(tip))}: {usd(Number(amount))} for the bill and {usd(Number(tip))} to the tips pool.
              </p>
            )}

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

            <PosButton icon={faCashRegister} label={busy ? 'Taking…' : locked ? 'Take again' : 'Take payment'}
              tone="primary" size="lg" full style={{ marginTop: '0.8rem' }}
              disabled={busy || !preview || !preview.ok} onClick={() => { void take() }} />
          </>
        )}

        {error && (
          <p style={{ color: 'var(--red)', fontSize: '0.95rem', marginTop: '0.8rem', lineHeight: 1.6 }}>{error}</p>
        )}

        {b.settled && (
          <PosButton icon={faReceipt} label="Close & issue receipt" tone="primary" size="lg" full style={{ marginTop: '1.1rem' }} onClick={onPaid} />
        )}

        <PosButton icon={faArrowLeft} label="Back to the check" tone="quiet" full style={{ marginTop: '0.8rem' }}
          disabled={busy || locked} onClick={onDismiss} />
      </div>
    </Sheet>
  )
}
