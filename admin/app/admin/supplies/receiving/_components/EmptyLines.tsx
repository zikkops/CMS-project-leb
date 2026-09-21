'use client'

import type { SupplyRow } from './types'
import { inp } from './styles'

// No lines yet: say why, and offer the department's supplies for an unplanned delivery.
export function EmptyLines({
  orderId, supplies, department, onAdd,
}: {
  orderId: string
  supplies: SupplyRow[]
  department: string
  onAdd: (supplyId: string) => void
}) {
  return (
    <div style={{ border: '1px dashed rgba(var(--overlay-rgb),0.08)', borderRadius: '4px', padding: '2.5rem 1.5rem', textAlign: 'center', marginBottom: '1.5rem' }}>
      <p style={{ color: 'rgba(var(--offwhite-rgb),0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        {orderId ? 'No stocked items on this order.' : 'Pick a weekly order above, or add items for an unplanned delivery.'}
      </p>
      <select
        value=""
        onChange={e => onAdd(e.target.value)}
        style={{ ...inp, background: '#1a1a1a', cursor: 'pointer', minWidth: '240px' }}
      >
        <option value="">+ Add an item…</option>
        {supplies.filter(s => s.category === department).map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </div>
  )
}
