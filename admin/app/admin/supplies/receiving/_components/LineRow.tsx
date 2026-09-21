'use client'

import { useState } from 'react'
import {
  judgeDeliveryTemp,
  type FoodSafetyLimits, type StorageKind,
} from '@big-cms/shared/foodSafety'
import {
  REJECT_REASON_LABELS, isShort, priceChange, round2,
  type Currency, type DeliveryLine, type RejectReason,
} from '@big-cms/shared/deliveries'
import { inp, labelStyle } from './styles'
import { fmt } from './fmt'

// ── One receiving line ─────────────────────────────────────────────────────
// Module scope, not nested in the page component. A component declared inside
// another component's render body gets a new function identity every render,
// so React unmounts and remounts it on every keystroke — which kills
// transitions and, here, would drop focus out of the input mid-typing.
// (CONTRIBUTING.md, gotcha #2.)
export function LineRow({
  line, index, currency, rate, isMobile, lastCost, onChange, storage, limits, askTemp,
}: {
  line: DeliveryLine
  index: number
  currency: Currency
  /** LBP per USD, or 0 when the delivery is priced in USD. */
  rate: number
  isMobile: boolean
  /** The running average, always in USD — see `lastCostLocal` below. */
  lastCost: number
  onChange: (index: number, patch: Partial<DeliveryLine>) => void
  /** The item's storage as stored. Chilled and frozen ask for a temperature. */
  storage: StorageKind | null
  /** The café's limits when this person can read them; null shows no verdict, and the server still judges. */
  limits: FoodSafetyLimits | null
  /** Food Safety is switched on. */
  askTemp: boolean
}) {
  const [showReject, setShowReject] = useState(line.qtyRejected > 0)

  const short = isShort(line)

  // avgUnitCost is stored in USD; line.unitCost is in the delivery's currency.
  // Comparing them directly made every LBP delivery read as a ~9,000,000%
  // price rise and flagged every single line as an exception — which is the
  // fastest way to teach someone to ignore the warning colour entirely.
  const lbp = currency === 'LBP' && rate > 0
  const lastCostLocal = lbp ? lastCost * rate : lastCost
  const usdEquivalent = lbp ? round2(line.unitCost / rate) : null

  const drift = priceChange(lastCostLocal, line.unitCost)
  const priceUp = drift !== null && drift > 0.02
  // Food safety (owner's decisions, 14 Sep 2026): a chilled or frozen line is
  // received with its temperature, and one that arrived too warm with what was
  // done about it. Only what is taken in needs one. The verdict here is the
  // server's own function, shown while typing; the server decides.
  const needsTemp = askTemp && (storage === 'chilled' || storage === 'frozen') && line.qtyReceived - line.qtyRejected > 0
  const verdict = needsTemp && limits && typeof line.tempC === 'number' ? judgeDeliveryTemp(storage, line.tempC, limits) : null
  const tempMissing = needsTemp && (line.tempC === null || line.tempC === undefined)
  const tooWarm = verdict?.status === 'breach'

  const touched = short || line.qtyRejected > 0 || priceUp || tempMissing || tooWarm

  // Quiet by default, loud only when something needs attention. The whole
  // point is that a receiver's eye lands on the exceptions.
  const accent = short || tooWarm ? 'var(--red)' : priceUp || tempMissing ? 'var(--brand-secondary)' : 'rgba(var(--teal-rgb),0.2)'

  return (
    <div style={{
      background: touched ? 'rgba(var(--brand-secondary-rgb),0.04)' : 'rgba(var(--overlay-rgb),0.02)',
      border: `1px solid ${touched ? accent : 'rgba(var(--overlay-rgb),0.07)'}`,
      borderRadius: '6px', padding: '0.8rem 0.9rem',
      display: 'flex', flexDirection: 'column', gap: '0.6rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.82rem', color: 'var(--offwhite)', lineHeight: 1.3 }}>
            {line.name}
          </p>
          {line.nameAr && (
            <p dir="rtl" style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--brand-secondary-rgb),0.8)', marginTop: '0.1rem' }}>
              {line.nameAr}
            </p>
          )}
        </div>
        {line.qtyOrdered > 0 && (
          <span style={{
            fontFamily: 'var(--font-inter)', fontSize: '0.62rem', letterSpacing: '0.06em',
            color: 'rgba(var(--offwhite-rgb),0.3)', whiteSpace: 'nowrap',
          }}>
            ordered {line.qtyOrdered} {line.unit}
          </span>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr auto',
        gap: '0.5rem', alignItems: 'end',
      }}>
        <div>
          <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Received</label>
          <input
            type="number" min="0" step="any" inputMode="decimal"
            value={line.qtyReceived}
            onChange={e => onChange(index, { qtyReceived: Number(e.target.value) })}
            style={{ ...inp, width: '100%', textAlign: 'center', fontWeight: 600, color: short ? 'var(--red)' : 'var(--teal)' }}
          />
        </div>
        <div>
          <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>
            Unit cost {currency === 'LBP' ? '(LBP)' : '($)'}
          </label>
          <input
            type="number" min="0" step="any" inputMode="decimal"
            value={line.unitCost}
            onChange={e => onChange(index, { unitCost: Number(e.target.value) })}
            style={{ ...inp, width: '100%', textAlign: 'center', fontWeight: 600, color: priceUp ? 'var(--brand-secondary)' : 'var(--offwhite)' }}
          />
          {/* Costs are entered in whatever the invoice is written in, but
              everything downstream — the running average, food cost — is USD.
              Showing the conversion as you type is what makes an LBP invoice
              checkable against the item's usual price without a calculator. */}
          {usdEquivalent !== null && (
            <p style={{
              fontFamily: 'var(--font-inter)', fontSize: '0.62rem', textAlign: 'center',
              color: 'rgba(var(--offwhite-rgb),0.3)', marginTop: '0.25rem',
            }}>
              ≈ ${usdEquivalent.toFixed(2)}
            </p>
          )}
        </div>
        <div style={{
          textAlign: isMobile ? 'left' : 'right', gridColumn: isMobile ? '1 / -1' : undefined,
          display: 'flex', flexDirection: isMobile ? 'row' : 'column',
          alignItems: isMobile ? 'center' : 'flex-end', gap: '0.5rem',
        }}>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.55)', fontWeight: 600 }}>
            {fmt(round2(line.qtyReceived * line.unitCost), currency)}
          </span>
          {/* Seeded from the item, overridable here: the same product arrives
              taxed from one supplier and untaxed from another, and the person
              holding the invoice is the only one who knows which. */}
          <button
            type="button"
            onClick={() => onChange(index, { vatable: line.vatable === false })}
            title={line.vatable === false ? 'No VAT on this line' : 'VAT applies to this line'}
            style={{
              background: line.vatable === false ? 'transparent' : 'rgba(var(--teal-rgb),0.1)',
              border: `1px solid ${line.vatable === false ? 'rgba(var(--overlay-rgb),0.1)' : 'rgba(var(--teal-rgb),0.35)'}`,
              color: line.vatable === false ? 'rgba(var(--offwhite-rgb),0.3)' : 'var(--teal)',
              borderRadius: '3px', padding: '0.2rem 0.45rem', cursor: 'pointer',
              fontFamily: 'var(--font-inter)', fontSize: '0.6rem', letterSpacing: '0.06em',
              fontWeight: 700, whiteSpace: 'nowrap',
            }}
          >{line.vatable === false ? 'NO VAT' : 'VAT'}</button>
        </div>
      </div>

      {needsTemp && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '130px 1fr', gap: '0.5rem', alignItems: 'end' }}>
          <div>
            <label style={{
              ...labelStyle, marginBottom: '0.25rem',
              color: tooWarm ? 'var(--red)' : tempMissing ? 'var(--brand-secondary)' : labelStyle.color,
            }}>
              {storage === 'frozen' ? 'Frozen' : 'Chilled'} · °C
            </label>
            <input
              type="number" step="0.1" inputMode="decimal"
              value={line.tempC ?? ''}
              placeholder={storage === 'frozen' ? '-18' : '5'}
              onChange={e => onChange(index, { tempC: e.target.value === '' ? null : Number(e.target.value) })}
              style={{
                ...inp, width: '100%', textAlign: 'center', fontWeight: 600,
                color: tooWarm ? 'var(--red)' : 'var(--offwhite)',
                borderColor: tooWarm ? 'var(--red)' : tempMissing ? 'rgba(var(--brand-secondary-rgb),0.6)' : 'rgba(var(--overlay-rgb),0.12)',
              }}
            />
          </div>
          {tooWarm ? (
            <div>
              <label style={{ ...labelStyle, marginBottom: '0.25rem', color: 'var(--red)' }}>What was done</label>
              <input
                value={line.tempNote ?? ''} maxLength={300}
                placeholder="e.g. into the walk-in at once, supplier told — or reject it"
                onChange={e => onChange(index, { tempNote: e.target.value })}
                style={{ ...inp, width: '100%' }}
              />
            </div>
          ) : (
            <p style={{
              fontFamily: 'var(--font-inter)', fontSize: '0.68rem', paddingBottom: '0.55rem',
              color: tempMissing ? 'var(--brand-secondary)' : 'rgba(var(--offwhite-rgb),0.4)',
            }}>
              {tempMissing ? 'Take its temperature. It cannot be received without one.' : verdict ? verdict.message : 'Recorded with the delivery.'}
            </p>
          )}
        </div>
      )}
      {tooWarm && verdict && (
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', fontWeight: 700, color: 'var(--red)' }}>
          {verdict.message}
        </span>
      )}

      {(short || priceUp) && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {short && (
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', fontWeight: 700, color: 'var(--red)' }}>
              short {line.qtyOrdered - line.qtyReceived} {line.unit}
            </span>
          )}
          {/* Supplier price drift, surfaced at the moment it happens rather
              than in a report nobody opens. "This provider raised olive oil
              22% in six weeks" is a renegotiation, and it starts here. */}
          {priceUp && drift !== null && (
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', fontWeight: 700, color: 'var(--brand-secondary)' }}>
              price up {(drift * 100).toFixed(0)}% vs {fmt(lastCostLocal, currency)}
            </span>
          )}
        </div>
      )}

      {!showReject ? (
        <button
          onClick={() => setShowReject(true)}
          style={{
            background: 'none', border: 'none', padding: 0, textAlign: 'left',
            color: 'rgba(var(--offwhite-rgb),0.28)', fontFamily: 'var(--font-inter)',
            fontSize: '0.68rem', cursor: 'pointer',
          }}
        >+ reject damaged / expired</button>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '0.5rem', alignItems: 'end' }}>
          <div>
            <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Rejected</label>
            <input
              type="number" min="0" step="any" inputMode="decimal"
              value={line.qtyRejected}
              onChange={e => onChange(index, { qtyRejected: Number(e.target.value) })}
              style={{ ...inp, width: '100%', textAlign: 'center', color: 'var(--red)', fontWeight: 600 }}
            />
          </div>
          <div>
            <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Reason</label>
            {/* The route refuses a rejection with no reason. "Why did we
                reject three crates" is the entire value of recording it. */}
            <select
              value={line.rejectReason ?? ''}
              onChange={e => onChange(index, { rejectReason: (e.target.value || null) as RejectReason | null })}
              style={{ ...inp, width: '100%', background: '#1a1a1a', cursor: 'pointer' }}
            >
              <option value="">— Select —</option>
              {Object.entries(REJECT_REASON_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
