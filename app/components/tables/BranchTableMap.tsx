'use client'

import { useState } from 'react'
import { capacityLabel, shapeStyle, pixelRectToPercent, TABLE_TYPE_LABELS, type TableMarker } from '../../lib/branchTableLayouts'

// Purely presentational — every selection rule (first-click-any-table,
// subsequent-clicks-must-be-adjacent, deselect-clears-all) lives in the
// caller (app/tables/page.tsx). This just renders bookable tables as
// clickable hotspots over the floor-plan image, converting each table's
// stored pixel rect to percent-of-container via pixelRectToPercent so
// positioning stays responsive — read-only here, no drag/resize.
export default function BranchTableMap({ imageUrl, imageWidth, imageHeight, tables, selectedIds, clickableIds, onToggle }: {
  imageUrl: string
  imageWidth: number | null
  imageHeight: number | null
  tables: TableMarker[]
  selectedIds: string[]
  clickableIds: Set<string>
  onToggle: (table: TableMarker) => void
}) {
  const bookable = tables.filter(t => t.bookable)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hovered = bookable.find(t => t.id === hoveredId)

  return (
    <div style={{ position: 'relative', width: '100%', border: '1px solid rgba(255,255,255,0.06)' }}>
      <img src={imageUrl} alt="Floor plan" style={{ display: 'block', width: '100%' }} />
      {bookable.map(table => {
        const selected = selectedIds.includes(table.id)
        const clickable = clickableIds.has(table.id)
        const { leftPct, topPct, widthPct, heightPct } = pixelRectToPercent(table, imageWidth, imageHeight)
        return (
          <button
            key={table.id}
            type="button"
            disabled={!clickable}
            onClick={() => onToggle(table)}
            onMouseEnter={() => setHoveredId(table.id)}
            onMouseLeave={() => setHoveredId(prev => (prev === table.id ? null : prev))}
            style={{
              position: 'absolute',
              left: `${leftPct}%`, top: `${topPct}%`,
              width: `${widthPct}%`, height: `${heightPct}%`,
              transform: `translate(-50%, -50%) rotate(${table.rotation}deg)`,
              backgroundColor: selected ? 'var(--teal)' : clickable ? 'rgba(0,160,152,0.4)' : 'rgba(20,20,20,0.35)',
              border: `2px solid ${selected ? 'var(--teal)' : clickable ? 'rgba(0,160,152,0.6)' : 'rgba(20,20,20,0.55)'}`,
              ...shapeStyle(table.shape),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: clickable ? 'pointer' : 'not-allowed',
              color: '#fff', fontFamily: 'var(--font-inter)', fontSize: '0.7rem', fontWeight: 600,
              padding: 0,
            }}
          >
            <span style={{ transform: `rotate(${-table.rotation}deg)`, display: 'inline-block' }}>{table.number}</span>
          </button>
        )
      })}

      {hovered && (
        <div style={{
          position: 'absolute',
          left: `${pixelRectToPercent(hovered, imageWidth, imageHeight).leftPct}%`,
          top: `${pixelRectToPercent(hovered, imageWidth, imageHeight).topPct}%`,
          transform: 'translate(-50%, calc(-100% - 14px))',
          backgroundColor: '#0d0d0d',
          border: '1px solid rgba(0,160,152,0.4)',
          borderRadius: '4px',
          padding: '0.5rem 0.8rem',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 10,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.78rem', color: 'var(--offwhite)' }}>
            Table {hovered.number} · seats {capacityLabel(hovered)}
          </p>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.5)', marginTop: '0.15rem' }}>
            {TABLE_TYPE_LABELS[hovered.tableType]}
          </p>
        </div>
      )}
    </div>
  )
}
