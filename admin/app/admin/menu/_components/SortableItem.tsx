'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatUsd } from '@big-cms/shared/money'
import type { PriceSuggestion } from '../useSuggestedPrices'
import type { MenuItem } from './menuTypes'

export default function SortableItem({ item, suggestion, onEdit, onDelete, isMobile }: {
  item: MenuItem
  /** Admins only, and only for a dish with a costed recipe. */
  suggestion: PriceSuggestion | undefined
  onEdit: (item: MenuItem) => void
  onDelete: (id: string) => void
  isMobile: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={{
      ...style,
      display: 'flex',
      flexWrap: isMobile ? 'wrap' : 'nowrap',
      alignItems: 'center',
      gap: isMobile ? '0.6rem' : '1rem',
      padding: isMobile ? '0.8rem 1rem' : '0.9rem 1.2rem',
      borderBottom: '1px solid rgba(var(--overlay-rgb),0.04)',
      background: 'rgba(var(--overlay-rgb),0.01)',
    }}>
      <div {...attributes} {...listeners} style={{
        cursor: 'grab',
        color: 'rgba(var(--overlay-rgb),0.2)',
        fontSize: '1rem',
        flexShrink: 0,
      }}>⠿</div>

      <div style={{ flex: 1 }}>
        <p style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: '0.9rem',
          color: 'var(--offwhite)',
          marginBottom: '0.2rem',
        }}>{item.name}</p>
        <p style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '0.75rem',
          color: 'rgba(var(--offwhite-rgb),0.4)',
        }}>{item.description}</p>
      </div>

      {item.badge && (
        <span style={{
          fontSize: '0.65rem',
          padding: '0.2rem 0.6rem',
          borderRadius: '2px',
          backgroundColor: 'rgba(var(--teal-rgb),0.15)',
          color: 'var(--teal)',
          fontFamily: 'var(--font-inter)',
        }}>{item.badge}</span>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <span style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '0.9rem',
          color: 'var(--teal)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}>{formatUsd(item.price)}</span>
        {suggestion && (
          <span
            title={`Costs ${formatUsd(suggestion.costUsd)} to make. ${formatUsd(suggestion.roundedUsd)} makes a ${Math.round(suggestion.targetMargin * 100)}% margin before VAT.`}
            style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.68rem',
              whiteSpace: 'nowrap',
              color: item.price < suggestion.withVatUsd ? 'var(--brand-secondary)' : 'rgba(var(--offwhite-rgb),0.4)',
            }}>suggested {formatUsd(suggestion.roundedUsd)}</span>
        )}
      </div>

      <span style={{
        fontSize: '0.65rem',
        padding: '0.2rem 0.6rem',
        borderRadius: '2px',
        backgroundColor: item.available ? 'rgba(var(--teal-rgb),0.15)' : 'rgba(var(--red-rgb),0.15)',
        color: item.available ? 'var(--teal)' : 'var(--red)',
        fontFamily: 'var(--font-inter)',
      }}>{item.available ? 'Available' : 'Hidden'}</span>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={() => onEdit(item)} style={{
          background: 'transparent',
          border: '1px solid rgba(var(--overlay-rgb),0.1)',
          color: 'rgba(var(--offwhite-rgb),0.5)',
          padding: '0.35rem 0.7rem',
          borderRadius: '2px',
          fontSize: '0.7rem',
          cursor: 'pointer',
          fontFamily: 'var(--font-inter)',
        }}>Edit</button>
        <button onClick={() => onDelete(item.id)} style={{
          background: 'transparent',
          border: '1px solid rgba(var(--red-rgb),0.3)',
          color: 'var(--red)',
          padding: '0.35rem 0.7rem',
          borderRadius: '2px',
          fontSize: '0.7rem',
          cursor: 'pointer',
          fontFamily: 'var(--font-inter)',
        }}>Delete</button>
      </div>
    </div>
  )
}
