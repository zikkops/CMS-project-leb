'use client'

// A manager's discount — Phase 04, slice 6.
//
// One sheet for both kinds of target: an item (comped, or a percentage off)
// and the whole check (a percentage, or an amount off). Only a manager or an
// admin ever sees the buttons that open it, and the server refuses anyone
// else regardless — the manager's own signed-in phone is the approval (owner's
// decision, 12 Sep 2026), so there is no PIN step here.
//
// Every discount needs a reason, from the same kind of short list voids use,
// because "why was this cheaper" is asked after the table has gone.
//
// Safe to repeat: applying sets a value, so a retry after a lost reply is the
// same state and cannot stack a discount twice.

import { useState } from 'react'
import { DISCOUNT_REASONS, type CheckDiscount, type CheckLine } from '@big-cms/shared/checks'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { discountLine, discountCheck, type DiscountRequest } from '../../../lib/usePos'
import { PosButton, Chip, Sheet } from '../../../lib/posUi'
import { faPercent, faXmark, faArrowLeft } from '@fortawesome/free-solid-svg-icons'

export type DiscountTarget =
  | { mode: 'line'; checkId: string; line: CheckLine }
  | { mode: 'check'; checkId: string; current: CheckDiscount | null }

const tap: React.CSSProperties = {
  minHeight: '56px', padding: '0.7rem 1rem', borderRadius: '8px',
  fontFamily: 'var(--font-inter)', fontSize: '1rem', cursor: 'pointer',
}
const label: React.CSSProperties = {
  fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'rgba(var(--offwhite-rgb),0.6)', margin: '1rem 0 0.45rem',
}

function describe(target: DiscountTarget): string | null {
  if (target.mode === 'line') {
    const d = target.line.discount
    if (!d) return null
    return d.kind === 'comp' ? 'On the house' : `${Math.round(d.percent * 100)}% off`
  }
  const d = target.current
  if (!d) return null
  return d.kind === 'percent' ? `${Math.round(d.value * 100)}% off the check` : `$${d.value.toFixed(2)} off the check`
}

export default function DiscountSheet({ target, onDone }: { target: DiscountTarget; onDone: () => void }) {
  const kinds: { kind: DiscountRequest['kind']; text: string }[] = target.mode === 'line'
    ? [{ kind: 'comp', text: 'On the house' }, { kind: 'percent', text: '% off' }]
    : [{ kind: 'percent', text: '% off' }, { kind: 'amount', text: '$ off' }]

  const [kind, setKind] = useState<DiscountRequest['kind']>(kinds[0].kind)
  const [value, setValue] = useState('')
  const [reasonKey, setReasonKey] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const n = Number(value)
  const amountOk = kind === 'comp' || (kind === 'percent' ? n > 0 && n <= 100 : n > 0)
  const ready = amountOk && reasonKey !== '' && (reasonKey !== 'other' || note.trim() !== '')
  const current = describe(target)

  async function apply(d: DiscountRequest | null) {
    setBusy(true)
    setError('')
    try {
      if (target.mode === 'line') await discountLine(target.checkId, target.line.id, d)
      else await discountCheck(target.checkId, d)
      onDone()
    } catch (e) {
      setError(isNetworkFailure(e)
        ? 'No connection — try again when the wifi is back. Applying it twice is harmless.'
        : e instanceof Error ? e.message : 'Could not apply the discount.')
    } finally {
      setBusy(false)
    }
  }

  function submit() {
    if (!ready) return
    void apply({
      kind,
      // Percentages travel as fractions, the way they are stored and checked.
      value: kind === 'percent' ? n / 100 : kind === 'amount' ? n : 1,
      reasonKey,
      note: note.trim(),
    })
  }

  return (
    <Sheet label="Discount" onClose={() => { if (!busy) onDone() }}>
      <div style={{ fontFamily: 'var(--font-inter)', color: 'var(--offwhite)' }}>
        <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.15rem', marginBottom: '0.3rem' }}>
          {target.mode === 'line' ? `Discount — ${target.line.quantity}× ${target.line.name}` : 'Discount the check'}
        </h2>

        {current && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem',
            padding: '0.6rem 0.8rem', borderRadius: '6px', margin: '0.6rem 0 0.2rem',
            backgroundColor: 'rgba(var(--teal-rgb),0.12)', border: '1px solid var(--teal)',
          }}>
            <span style={{ fontSize: '0.88rem' }}>Now: <strong>{current}</strong></span>
            <PosButton icon={faXmark} label="Remove" tone="quiet" size="sm" disabled={busy} onClick={() => { void apply(null) }} />
          </div>
        )}

        <p style={label}>{current ? 'Change it to' : 'What kind'}</p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {kinds.map(k => (
            <Chip key={k.kind} label={k.text} active={kind === k.kind} disabled={busy} onClick={() => { setKind(k.kind); setValue('') }} />
          ))}
        </div>

        {kind !== 'comp' && (
          <input
            value={value}
            onChange={e => setValue(e.target.value.replace(kind === 'amount' ? /[^0-9.]/g : /[^0-9]/g, ''))}
            inputMode={kind === 'amount' ? 'decimal' : 'numeric'}
            placeholder={kind === 'percent' ? 'Percent off, e.g. 10' : 'Dollars off, e.g. 5'}
            style={{
              ...tap, width: '100%', marginTop: '0.6rem', backgroundColor: 'var(--surface-deep)', color: 'var(--offwhite)',
              cursor: 'text', border: '1px solid rgba(var(--overlay-rgb),0.14)', fontSize: '1rem', textAlign: 'right',
            }}
          />
        )}
        {kind === 'percent' && value !== '' && !amountOk && (
          <p style={{ fontSize: '0.78rem', color: 'var(--red)', marginTop: '0.4rem' }}>Between 1% and 100%.</p>
        )}

        <p style={label}>Why</p>
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          {DISCOUNT_REASONS.map(r => (
            <button key={r.key} onClick={() => setReasonKey(r.key)} disabled={busy} style={{
              ...tap, width: '100%', textAlign: 'left', padding: '0.6rem 0.9rem',
              backgroundColor: reasonKey === r.key ? 'rgba(var(--teal-rgb),0.15)' : 'rgba(var(--overlay-rgb),0.03)',
              border: `1px solid ${reasonKey === r.key ? 'var(--teal)' : 'rgba(var(--overlay-rgb),0.12)'}`,
              color: 'var(--offwhite)',
            }}>{r.label}</button>
          ))}
        </div>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={reasonKey === 'other' ? 'What happened? (needed for Other)' : 'Note (optional)'}
          style={{
            ...tap, width: '100%', marginTop: '0.6rem', backgroundColor: 'var(--surface-deep)', color: 'var(--offwhite)',
            cursor: 'text', border: '1px solid rgba(var(--overlay-rgb),0.14)',
          }}
        />

        {error && (
          <p style={{ color: 'var(--red)', fontSize: '0.95rem', marginTop: '0.8rem', lineHeight: 1.6 }}>{error}</p>
        )}

        <PosButton icon={faPercent} label={busy ? 'Applying…' : 'Apply'} tone="primary" size="lg" full style={{ marginTop: '1rem' }}
          disabled={busy || !ready} onClick={() => { void submit() }} />

        <PosButton icon={faArrowLeft} label="Back to the check" tone="quiet" full style={{ marginTop: '0.6rem' }}
          disabled={busy} onClick={onDone} />
      </div>
    </Sheet>
  )
}
