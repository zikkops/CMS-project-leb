'use client'

import type { WeeklyOrderReport } from '@big-cms/shared/weeklyOrders'
import { inp, labelStyle } from './styles'

// Source order, and a warning for ordered items that no stocked supply stands behind.
export function OrderPicker({
  orderId, matchingReports, onPick, unlinkedCount,
}: {
  orderId: string
  matchingReports: WeeklyOrderReport[]
  onPick: (id: string) => void
  unlinkedCount: number
}) {
  return (
    <>
      {/* Source order */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={labelStyle}>Against which weekly order?</label>
        <select value={orderId} onChange={e => onPick(e.target.value)} style={{ ...inp, width: '100%', background: '#1a1a1a', cursor: 'pointer' }}>
          <option value="">— Unplanned delivery (no order) —</option>
          {matchingReports.map(r => (
            <option key={r.id} value={r.id}>{r.weekLabel}{r.department ? ` · ${r.department}` : ''}</option>
          ))}
        </select>
      </div>

      {unlinkedCount > 0 && (
        <div style={{
          background: 'rgba(var(--brand-secondary-rgb),0.08)', border: '1px solid rgba(var(--brand-secondary-rgb),0.22)',
          borderRadius: '4px', padding: '0.85rem 1.1rem', marginBottom: '1.25rem',
          fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--brand-secondary)', lineHeight: 1.5,
        }}>
          {unlinkedCount} ordered item{unlinkedCount === 1 ? '' : 's'} on this order {unlinkedCount === 1 ? 'is' : 'are'} not
          linked to a stocked supply, so {unlinkedCount === 1 ? 'it is' : 'they are'} not shown here — receiving
          {unlinkedCount === 1 ? ' it' : ' them'} would move no stock. Run <code>npm run link:supplies</code>, or add
          {unlinkedCount === 1 ? ' it' : ' them'} in Inventory Management.
        </div>
      )}
    </>
  )
}
