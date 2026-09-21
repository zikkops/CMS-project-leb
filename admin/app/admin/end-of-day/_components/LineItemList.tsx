'use client'

import React from 'react'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { formatUsd } from '@big-cms/shared/endOfDay'

export function LineItemList({
  items,
  addLine,
  removeLine,
  updateLine,
  totalUsd,
  color,
}: {
  items: { name: string; amountUsd: string }[]
  addLine: () => void
  removeLine: (i: number) => void
  updateLine: (i: number, f: 'name' | 'amountUsd', v: string) => void
  totalUsd: number
  color: string
}) {
  const isMobile = useIsMobile()
  const inp2: React.CSSProperties = {
    backgroundColor: 'rgba(var(--overlay-rgb),0.04)',
    border: '1px solid rgba(var(--overlay-rgb),0.1)',
    color: 'var(--offwhite)',
    padding: '0.55rem 0.75rem',
    borderRadius: '2px',
    fontSize: '0.85rem',
    outline: 'none',
    fontFamily: 'var(--font-inter)',
  }

  return (
    <div>
      {items.length > 0 && (
        <div style={{ background: 'rgba(var(--overlay-rgb),0.02)', border: '1px solid rgba(var(--overlay-rgb),0.06)', borderRadius: '4px', overflow: 'hidden', marginBottom: '0.75rem' }}>
          {items.map((item, idx) => (
            <div key={idx} style={{
              display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto',
              gap: '0.6rem', alignItems: 'center',
              padding: '0.65rem 1rem',
              borderTop: idx > 0 ? '1px solid rgba(var(--overlay-rgb),0.04)' : 'none',
            }}>
              <input
                type="text"
                placeholder="Description"
                value={item.name}
                onChange={e => updateLine(idx, 'name', e.target.value)}
                style={{ ...inp2, width: '100%' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', width: isMobile ? '100%' : '110px', flex: isMobile ? 1 : 'initial' }}>
                  <span style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>$</span>
                  <input
                    type="number" min="0" step="0.01"
                    placeholder="0.00"
                    value={item.amountUsd}
                    onChange={e => updateLine(idx, 'amountUsd', e.target.value)}
                    style={{ ...inp2, textAlign: 'right', width: '100%' }}
                  />
                </div>
                <button
                  type="button" onClick={() => removeLine(idx)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(var(--offwhite-rgb),0.25)', fontSize: '1rem', padding: '0.2rem 0.4rem', flexShrink: 0 }}
                >×</button>
              </div>
            </div>
          ))}
          <div style={{
            padding: '0.65rem 1rem',
            borderTop: '1px solid rgba(var(--overlay-rgb),0.08)',
            display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', alignItems: 'center',
          }}>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.4)', letterSpacing: '0.05em' }}>TOTAL USD</span>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.9rem', color, fontWeight: 600 }}>{formatUsd(totalUsd)}</span>
          </div>
        </div>
      )}
      <button
        type="button" onClick={addLine}
        style={{
          backgroundColor: 'transparent',
          border: `1px dashed ${color}50`,
          color: color,
          padding: '0.5rem 1rem',
          borderRadius: '2px', fontSize: '0.75rem',
          cursor: 'pointer', fontFamily: 'var(--font-inter)',
        }}
      >+ Add line</button>
    </div>
  )
}
