'use client'

import React from 'react'
import type { DaySystem } from '@big-cms/shared/drawer'
import { formatLbp, formatUsd } from '@big-cms/shared/endOfDay'
import { SectionTitle } from './parts'
import { inp, labelStyle } from './styles'

export type PosState = { key: string; data: DaySystem | null; err: string }

// Was labelled "SYSTEM (OMEGA)" — Omega being the incumbent POS this platform
// replaces. A product should not name a competitor in a section header of its
// own admin panel.
export function PosSystemSection({
  fromPos, posNow, systemLbp, setSystemLbp, systemUsdDerived,
}: {
  fromPos:          boolean
  posNow:           PosState | null
  systemLbp:        string
  setSystemLbp:     (v: string) => void
  systemUsdDerived: number
}) {
  return (
    <div style={{ marginBottom: '2.5rem' }}>
      <SectionTitle label="POS SYSTEM" color="var(--purple)" />
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 280px' }}>
          <label style={labelStyle}>System LBP</label>
          <input
            type="number" min="0" step="1"
            value={fromPos ? (posNow?.data ? String(posNow.data.systemLbp) : '') : systemLbp}
            onChange={e => setSystemLbp(e.target.value)}
            readOnly={fromPos}
            placeholder={fromPos ? 'From the POS…' : '0'}
            style={{ ...inp, ...(fromPos ? { opacity: 0.8, cursor: 'default' } : {}) }}
          />
        </div>
        <div style={{ paddingBottom: '0.6rem' }}>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.3)', marginBottom: '0.25rem', letterSpacing: '0.05em' }}>
            Auto-converted
          </p>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '1rem', color: 'var(--purple)', fontWeight: 600 }}>
            {formatUsd(systemUsdDerived)}
          </p>
        </div>
      </div>
      {fromPos && (
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.75rem', lineHeight: 1.6, maxWidth: '62ch',
          marginTop: '0.7rem', color: posNow?.err ? 'var(--red)' : 'rgba(var(--offwhite-rgb),0.45)',
        }}>
          {!posNow
            ? 'Reading the day’s drawer shifts…'
            : posNow.err
              ? posNow.err
              : !posNow.data || posNow.data.shifts === 0
                ? 'No drawer shift was opened at this branch for this day, so the POS figure is zero.'
                : `From the POS: ${posNow.data.shifts} drawer shift${posNow.data.shifts === 1 ? '' : 's'} should hold ` +
                  `${formatUsd(posNow.data.expected.usd)} and ${formatLbp(posNow.data.expected.lbp)} — cash sales with ` +
                  'the float, the way the drawer is counted. Card takings are not in it.' +
                  (posNow.data.open > 0
                    ? ` ${posNow.data.open} shift${posNow.data.open === 1 ? ' is' : 's are'} still open, so this will still move — close ${posNow.data.open === 1 ? 'it' : 'them'} before submitting.`
                    : '')}
        </p>
      )}
    </div>
  )
}
