'use client'

import { UNIT_LABELS, type WeeklyOrderReportItem } from '@big-cms/shared/weeklyOrders'
import { ReceivedTag } from './ReceivedTag'
import type { Fulfilment } from './ReportActionBar'

// One ordered line: name, Arabic name, what arrived, and the quantity —
// editable in place for admins and managers.
export function ReportItemRow({
  item, ar, isEditing, fulfilment, received, canEdit,
  editVal, setEditVal, startEdit, commitEdit, cancelEdit,
}: {
  item:       WeeklyOrderReportItem
  ar:         string | undefined
  isEditing:  boolean
  fulfilment: Fulfilment | null
  received:   Record<string, number>
  canEdit:    boolean
  editVal:    string
  setEditVal: (v: string) => void
  startEdit:  (item: WeeklyOrderReportItem) => void
  commitEdit: (item: WeeklyOrderReportItem) => void
  cancelEdit: () => void
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '0.5rem 0.9rem',
      background: isEditing
        ? 'rgba(var(--teal-rgb),0.06)'
        : 'rgba(var(--overlay-rgb),0.025)',
      borderRadius: '2px',
      border: isEditing
        ? '1px solid rgba(var(--teal-rgb),0.25)'
        : '1px solid transparent',
    }}>
      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)' }}>
        {item.name}
        {ar && (
          <span dir="rtl" style={{ color: 'var(--brand-secondary)', marginRight: '0.6rem', marginLeft: '0.6rem' }}>{ar}</span>
        )}
        {fulfilment && (
          <ReceivedTag
            ordered={item.quantity}
            received={received[item.templateId] ?? 0}
            unit={UNIT_LABELS[item.unit]}
          />
        )}
      </span>

      {canEdit ? (
        isEditing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
            <input
              autoFocus
              type="number"
              min="0"
              step="0.5"
              value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(item) }
                if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
              }}
              onBlur={() => commitEdit(item)}
              style={{
                width: '75px',
                backgroundColor: '#1a1a1a',
                border: '1px solid rgba(var(--teal-rgb),0.6)',
                color: 'var(--offwhite)',
                padding: '0.3rem 0.5rem',
                borderRadius: '2px',
                fontSize: '0.88rem',
                textAlign: 'right',
                outline: 'none',
                fontFamily: 'var(--font-inter)',
              }}
            />
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.4)', minWidth: '30px' }}>
              {UNIT_LABELS[item.unit]}
            </span>
          </div>
        ) : (
          <button
            onClick={() => startEdit(item)}
            title="Click to edit quantity"
            style={{
              background: 'none', border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)', fontSize: '0.88rem',
              color: 'var(--teal)', fontWeight: 700, flexShrink: 0,
              padding: '0.2rem 0.4rem', borderRadius: '2px',
              textDecoration: 'underline',
              textDecorationStyle: 'dotted',
              textUnderlineOffset: '3px',
            }}
          >
            {item.quantity} {UNIT_LABELS[item.unit]}
          </button>
        )
      ) : (
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'var(--teal)', fontWeight: 700, flexShrink: 0 }}>
          {item.quantity} {UNIT_LABELS[item.unit]}
        </span>
      )}
    </div>
  )
}
