'use client'

// Confirm-and-fix: the one-tap path
export function LinesToolbar({
  visibleCount, hiddenCount, exceptions, onConfirmAll,
}: {
  visibleCount: number
  hiddenCount: number
  exceptions: number
  onConfirmAll: () => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem',
    }}>
      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.4)' }}>
        {visibleCount} line{visibleCount === 1 ? '' : 's'}
        {hiddenCount > 0 && (
          <span style={{ color: 'rgba(var(--offwhite-rgb),0.28)' }}>
            {' '}· {hiddenCount} on this order from another supplier
          </span>
        )}
        {exceptions > 0 && (
          <span style={{ color: 'var(--brand-secondary)', fontWeight: 700 }}> · {exceptions} exception{exceptions === 1 ? '' : 's'}</span>
        )}
      </span>
      <button onClick={onConfirmAll} style={{
        background: 'rgba(var(--teal-rgb),0.12)', border: '1px solid var(--teal)',
        color: 'var(--teal)', padding: '0.55rem 1.25rem', borderRadius: '4px',
        fontSize: '0.74rem', letterSpacing: '0.06em', fontWeight: 600,
        cursor: 'pointer', fontFamily: 'var(--font-inter)',
      }}>Confirm all as ordered</button>
    </div>
  )
}
