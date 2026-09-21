'use client'

export interface Fulfilment {
  full:          number
  partial:       number
  total:         number
  deliveryCount: number
}

// The strip across the top of an opened report card, and the thin bar under
// it showing how much of the order has arrived.
export function ReportActionBar({
  copied, onCopyAll, totalProvCt, allDone, pendingCount, fulfilment,
  canEdit, deleting, onDelete,
}: {
  copied:       boolean
  onCopyAll:    () => void
  totalProvCt:  number
  allDone:      boolean
  pendingCount: number
  fulfilment:   Fulfilment | null
  canEdit:      boolean
  deleting:     boolean
  onDelete:     () => void
}) {
  return (
    <>
      {/* Action bar */}
      <div style={{
        padding: '0.75rem 1.25rem',
        background: 'rgba(var(--overlay-rgb),0.02)',
        display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
        borderBottom: '1px solid rgba(var(--overlay-rgb),0.06)',
      }}>
        <button onClick={onCopyAll} style={{
          backgroundColor: 'rgba(var(--overlay-rgb),0.05)', border: '1px solid rgba(var(--overlay-rgb),0.12)',
          color: copied ? 'var(--teal)' : 'rgba(var(--offwhite-rgb),0.7)',
          padding: '0.45rem 1rem', borderRadius: '2px', fontSize: '0.72rem',
          letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
          fontFamily: 'var(--font-inter)',
        }}>
          {copied ? '✓ Copied!' : '📋 Copy Full Order'}
        </button>

        {totalProvCt > 0 && (
          <span style={{
            fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600,
            color: allDone ? '#25D366' : 'rgba(var(--offwhite-rgb),0.4)',
            letterSpacing: '0.03em',
          }}>
            {allDone ? '✓ All providers sent' : `${pendingCount} of ${totalProvCt} pending`}
          </span>
        )}

        {fulfilment && (
          <span style={{
            fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600,
            color: fulfilment.full === fulfilment.total ? 'var(--teal)' : 'var(--brand-secondary)',
            letterSpacing: '0.03em',
          }}>
            {fulfilment.full === fulfilment.total
              ? `✓ All ${fulfilment.total} lines received`
              : `${fulfilment.full} of ${fulfilment.total} lines received in full`}
            <span style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontWeight: 400 }}>
              {' · '}{fulfilment.deliveryCount}{' '}
              {fulfilment.deliveryCount === 1 ? 'delivery' : 'deliveries'}
            </span>
          </span>
        )}

        {canEdit && (
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            disabled={deleting}
            style={{
              marginLeft: 'auto',
              backgroundColor: 'rgba(220,50,50,0.08)', border: '1px solid rgba(220,50,50,0.25)',
              color: deleting ? 'rgba(var(--offwhite-rgb),0.25)' : 'rgba(220,90,90,0.9)',
              padding: '0.45rem 1rem', borderRadius: '2px', fontSize: '0.72rem',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              cursor: deleting ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-inter)',
            }}
          >
            {deleting ? 'Deleting…' : 'Delete Report'}
          </button>
        )}
      </div>

      {/* Fulfilment bar — teal for lines received in full, amber for short */}
      {fulfilment && (
        <div style={{ display: 'flex', height: '3px', background: 'rgba(var(--overlay-rgb),0.05)' }}>
          <div style={{
            width: `${(fulfilment.full / fulfilment.total) * 100}%`,
            backgroundColor: 'var(--teal)',
          }} />
          <div style={{
            width: `${(fulfilment.partial / fulfilment.total) * 100}%`,
            backgroundColor: 'var(--brand-secondary)',
          }} />
        </div>
      )}
    </>
  )
}
