'use client'

import type { WeeklyOrderReport } from '@big-cms/shared/weeklyOrders'
import { DEPARTMENT_COLOR as DEPT_COLOR } from '@big-cms/shared/departments'
import { fmtDate } from './fmtDate'

// The always-visible row of a report card: branch, department, week, who
// submitted it, and how far the sending has got.
export function ReportSummaryRow({
  report, open, onToggle, totalProvCt, allDone, pendingCount, itemCount,
}: {
  report:       WeeklyOrderReport
  open:         boolean
  onToggle:     () => void
  totalProvCt:  number
  allDone:      boolean
  pendingCount: number
  itemCount:    number
}) {
  return (
    <div style={{
      padding: '1rem 1.25rem',
      display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
      cursor: 'pointer',
    }} onClick={onToggle}>
      <span style={{
        backgroundColor: 'rgba(var(--teal-rgb),0.12)', border: '1px solid rgba(var(--teal-rgb),0.3)',
        color: 'var(--teal)', borderRadius: '2px', padding: '0.2rem 0.6rem',
        fontSize: '0.72rem', letterSpacing: '0.1em', fontFamily: 'var(--font-inter)', fontWeight: 600, flexShrink: 0,
      }}>
        {report.branch}
      </span>

      {report.department && (
        <span style={{
          backgroundColor: `${DEPT_COLOR[report.department]}18`,
          border: `1px solid ${DEPT_COLOR[report.department]}50`,
          color: DEPT_COLOR[report.department],
          borderRadius: '2px', padding: '0.2rem 0.6rem',
          fontSize: '0.72rem', letterSpacing: '0.1em',
          fontFamily: 'var(--font-inter)', fontWeight: 600, flexShrink: 0,
        }}>
          {report.department}
        </span>
      )}

      <div style={{ flex: 1, minWidth: '180px' }}>
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.9rem', color: 'var(--offwhite)', fontWeight: 600, marginBottom: '0.1rem' }}>
          {report.weekLabel}
        </p>
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.73rem', color: 'rgba(var(--offwhite-rgb),0.35)' }}>
          {report.submittedByEmail} · {fmtDate(report.submittedAt)}
        </p>
      </div>

      {totalProvCt > 0 ? (
        allDone ? (
          <span style={{
            backgroundColor: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.45)',
            color: '#25D366', borderRadius: '2px', padding: '0.2rem 0.7rem',
            fontSize: '0.72rem', letterSpacing: '0.1em', fontFamily: 'var(--font-inter)',
            fontWeight: 700, flexShrink: 0,
          }}>
            ✓ Done
          </span>
        ) : (
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.35)', flexShrink: 0 }}>
            {pendingCount} pending
          </span>
        )
      ) : (
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.3)', flexShrink: 0 }}>
          {itemCount} item{itemCount !== 1 ? 's' : ''}
        </span>
      )}

      <span style={{ color: 'rgba(var(--offwhite-rgb),0.25)', fontSize: '1.1rem', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>›</span>
    </div>
  )
}
