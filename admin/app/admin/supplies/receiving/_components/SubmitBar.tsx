'use client'

// The outcome messages and the two ways out: a draft, or receiving for real.
export function SubmitBar({
  err, warning, done, ready, saving, deptColor, onSubmit,
}: {
  err: string
  warning: string
  done: string
  /** Truthy once a branch, a department and at least one line are chosen. */
  ready: string | boolean
  saving: boolean
  deptColor: string
  onSubmit: (status: 'draft' | 'received') => void
}) {
  return (
    <>
      {err && <p style={{ color: 'var(--red)', fontSize: '0.82rem', marginBottom: '1rem', fontFamily: 'var(--font-inter)' }}>{err}</p>}
      {warning && (
        <div style={{
          background: 'rgba(var(--brand-secondary-rgb),0.08)', border: '1px solid rgba(var(--brand-secondary-rgb),0.22)',
          borderRadius: '4px', padding: '0.85rem 1.1rem', marginBottom: '1rem',
          fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--brand-secondary)', lineHeight: 1.5,
        }}>{warning}</div>
      )}
      {done && <p style={{ color: 'var(--teal)', fontSize: '0.82rem', marginBottom: '1rem', fontFamily: 'var(--font-inter)' }}>✓ {done}</p>}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => onSubmit('draft')}
          disabled={!ready || saving}
          style={{
            background: 'transparent', border: '1px solid rgba(var(--overlay-rgb),0.15)',
            color: 'rgba(var(--offwhite-rgb),0.6)', padding: '0.75rem 1.5rem', borderRadius: '2px',
            fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase',
            cursor: ready && !saving ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-inter)', opacity: saving ? 0.6 : 1,
          }}
        >{saving ? 'Saving…' : 'Save Draft'}</button>

        <button
          onClick={() => onSubmit('received')}
          disabled={!ready || saving}
          title={!ready ? 'Add at least one line first' : undefined}
          style={{
            background: ready ? deptColor : 'rgba(var(--overlay-rgb),0.08)',
            color: ready ? '#000' : 'rgba(var(--offwhite-rgb),0.3)', border: 'none',
            padding: '0.75rem 2rem', borderRadius: '2px',
            fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700,
            cursor: ready && !saving ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-inter)', opacity: saving ? 0.6 : 1,
          }}
        >{saving ? 'Saving…' : 'Receive Delivery'}</button>

        {/* A draft moves nothing. Said plainly, because a receiver
            walking away mid-entry at a back door is the normal case,
            not the edge case. */}
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(var(--offwhite-rgb),0.28)' }}>
          A draft moves no stock. Receiving does, and can&apos;t be edited afterwards.
        </span>
      </div>
    </>
  )
}
