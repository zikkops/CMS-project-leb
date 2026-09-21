'use client'

import React from 'react'
import { formatUsd } from '@big-cms/shared/endOfDay'
import { SectionTitle } from './parts'
import { inp, labelStyle } from './styles'
import type { PosState } from './PosSystemSection'

export function TipsSection({
  tipsUsd, setTipsUsd, tipsDeductionRate, fromPos, posNow,
}: {
  tipsUsd:           string
  setTipsUsd:        (v: string) => void
  tipsDeductionRate: number
  fromPos:           boolean
  posNow:            PosState | null
}) {
  return (
    <div style={{ marginBottom: '2.5rem' }}>
      <SectionTitle label="TIPS" color="var(--brand-secondary)" />
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 220px' }}>
          <label style={labelStyle}>Tips collected (USD)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ color: 'rgba(var(--offwhite-rgb),0.5)', fontFamily: 'var(--font-inter)', fontSize: '0.9rem', flexShrink: 0 }}>$</span>
            <input
              type="number" min="0" step="0.01"
              value={tipsUsd}
              onChange={e => setTipsUsd(e.target.value)}
              placeholder="0.00"
              style={{ ...inp, textAlign: 'right' }}
            />
          </div>
        </div>
        {Number(tipsUsd) > 0 && (
          <div style={{ paddingBottom: '0.6rem' }}>
            {/* The deduction in Business Settings, not a constant: this said 11% whatever the setting was. */}
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(var(--offwhite-rgb),0.35)', marginBottom: '0.2rem', letterSpacing: '0.05em' }}>
              After {+(tipsDeductionRate * 100).toFixed(2)}% deduction
            </p>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '1rem', color: 'var(--brand-secondary)', fontWeight: 600 }}>
              {formatUsd(Number(tipsUsd) * (1 - tipsDeductionRate))}
            </p>
          </div>
        )}
      </div>
      {/* Card tips from the till (UPGRADE.md T3.9): shown, not typed, and saved with the report by the server. */}
      {fromPos && (posNow?.data?.cardTipsUsd ?? 0) > 0 && (
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.7)', marginTop: '0.7rem' }}>
          Plus {formatUsd(posNow?.data?.cardTipsUsd ?? 0)} tipped on cards at the till, added to the pot when you submit.
        </p>
      )}
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(var(--offwhite-rgb),0.2)', marginTop: '0.5rem' }}>
        The tips in the jar. Used in the tips calculator to distribute among staff by shift
      </p>
    </div>
  )
}
