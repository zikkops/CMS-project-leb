'use client'

import { BRANCH_OPTIONS } from './eventModel'

export default function EventFilters({
  filterStatus,
  setFilterStatus,
  filterBranch,
  setFilterBranch,
}: {
  filterStatus: 'upcoming' | 'done'
  setFilterStatus: (status: 'upcoming' | 'done') => void
  filterBranch: string
  setFilterBranch: (branch: string) => void
}) {
  return (
    <div style={{ marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Upcoming / Done tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid rgba(var(--overlay-rgb),0.06)', paddingBottom: '0' }}>
        {(['upcoming', 'done'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: filterStatus === s ? '2px solid var(--red)' : '2px solid transparent',
              color: filterStatus === s ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.35)',
              padding: '0.6rem 1.2rem',
              marginBottom: '-1px',
              fontSize: '0.75rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
              transition: 'color 0.15s',
            }}
          >
            {s === 'upcoming' ? 'Upcoming' : 'Done'}
          </button>
        ))}
      </div>

      {/* Branch pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {[['all', 'All'], ...BRANCH_OPTIONS.map(b => [b, b])].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilterBranch(val)}
            style={{
              background: filterBranch === val ? 'rgba(var(--teal-rgb),0.15)' : 'transparent',
              border: `1px solid ${filterBranch === val ? 'var(--teal)' : 'rgba(var(--overlay-rgb),0.1)'}`,
              color: filterBranch === val ? 'var(--teal)' : 'rgba(var(--offwhite-rgb),0.4)',
              padding: '0.35rem 0.9rem',
              borderRadius: '2px',
              fontSize: '0.72rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
