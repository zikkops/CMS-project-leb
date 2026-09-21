'use client'

import React from 'react'
import { BRAND } from '@big-cms/shared/brand'
import { LBP_DENOMS, USD_DENOMS, formatLbp, formatUsd, type ComputedTotals } from '@big-cms/shared/endOfDay'
import { SectionTitle } from './parts'
import { labelStyle, numInp } from './styles'

type CashSetter = React.Dispatch<React.SetStateAction<Record<string, string>>>

export function CashCountSection({
  isMobile, cashLbp, cashUsd, setCashLbp, setCashUsd, totals, exchangeRate,
}: {
  isMobile:     boolean
  cashLbp:      Record<string, string>
  cashUsd:      Record<string, string>
  setCashLbp:   CashSetter
  setCashUsd:   CashSetter
  totals:       ComputedTotals
  exchangeRate: number
}) {
  return (
    <div style={{ marginBottom: '2.5rem' }}>
      <SectionTitle label="CASH COUNT" color="var(--teal)" />
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1.5rem' }}>

        {/* LBP */}
        <div>
          <p style={{ ...labelStyle, color: 'var(--teal)', marginBottom: '0.75rem' }}>Lebanese Pound (LBP)</p>
          <div style={{ background: 'rgba(var(--overlay-rgb),0.02)', border: '1px solid rgba(var(--overlay-rgb),0.07)', borderRadius: '4px', overflow: 'hidden' }}>
            {LBP_DENOMS.map((denom, i) => (
              <div key={denom} style={{
                display: 'grid', gridTemplateColumns: '1fr auto',
                alignItems: 'center', gap: '0.75rem',
                padding: '0.65rem 1rem',
                borderTop: i > 0 ? '1px solid rgba(var(--overlay-rgb),0.04)' : 'none',
              }}>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.7)' }}>
                  {denom.toLocaleString()}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="number" min="0" step="1"
                    value={cashLbp[String(denom)] ?? ''}
                    onChange={e => setCashLbp(prev => ({ ...prev, [String(denom)]: e.target.value }))}
                    placeholder="0"
                    style={{ ...numInp, width: '80px' }}
                  />
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.3)', minWidth: '28px' }}>pcs</span>
                </div>
              </div>
            ))}
            <div style={{
              padding: '0.65rem 1rem',
              borderTop: '1px solid rgba(var(--overlay-rgb),0.08)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.4)', letterSpacing: '0.05em' }}>TOTAL</span>
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'var(--teal)', fontWeight: 600 }}>
                {totals.totalCashLbp.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* USD */}
        <div>
          <p style={{ ...labelStyle, color: 'var(--brand-secondary)', marginBottom: '0.75rem' }}>US Dollar (USD)</p>
          <div style={{ background: 'rgba(var(--overlay-rgb),0.02)', border: '1px solid rgba(var(--overlay-rgb),0.07)', borderRadius: '4px', overflow: 'hidden' }}>
            {USD_DENOMS.map((denom, i) => (
              <div key={denom} style={{
                display: 'grid', gridTemplateColumns: '1fr auto',
                alignItems: 'center', gap: '0.75rem',
                padding: '0.65rem 1rem',
                borderTop: i > 0 ? '1px solid rgba(var(--overlay-rgb),0.04)' : 'none',
              }}>
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.7)' }}>
                  ${denom}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="number" min="0" step="1"
                    value={cashUsd[String(denom)] ?? ''}
                    onChange={e => setCashUsd(prev => ({ ...prev, [String(denom)]: e.target.value }))}
                    placeholder="0"
                    style={{ ...numInp, width: '80px' }}
                  />
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.3)', minWidth: '28px' }}>pcs</span>
                </div>
              </div>
            ))}
            <div style={{
              padding: '0.65rem 1rem',
              borderTop: '1px solid rgba(var(--overlay-rgb),0.08)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.4)', letterSpacing: '0.05em' }}>TOTAL</span>
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'var(--brand-secondary)', fontWeight: 600 }}>
                ${totals.totalCashUsd.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Grand total row */}
      <div style={{
        marginTop: '1rem',
        background: 'rgba(var(--overlay-rgb),0.03)',
        border: '1px solid rgba(var(--overlay-rgb),0.08)',
        borderRadius: '4px',
        padding: '0.9rem 1.25rem',
        display: 'flex', justifyContent: 'space-around', gap: '1rem', flexWrap: 'wrap',
      }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.35)', marginBottom: '0.3rem' }}>Grand Total LBP</p>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '1rem', color: 'var(--offwhite)', fontWeight: 600 }}>{formatLbp(totals.grandTotalLbp)}</p>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.35)', marginBottom: '0.3rem' }}>Grand Total USD</p>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '1rem', color: 'var(--offwhite)', fontWeight: 600 }}>{formatUsd(totals.grandTotalUsd)}</p>
        </div>
        <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.2)', fontFamily: 'var(--font-inter)', alignSelf: 'center' }}>
          Rate: {exchangeRate.toLocaleString('en-US')} {BRAND.locale.secondaryCurrency} = 1 {BRAND.locale.currency}
        </div>
      </div>
    </div>
  )
}
