'use client'

// Says when a report's days fall in a closed period (UPGRADE.md T7.17), and
// lists what has changed on them since the figures were issued, as post-close
// adjustments. A report never silently disagrees with what was sent.

import { CLOSED_FIELD_LABELS, type Adjustment } from '@big-cms/shared/periodClose'
import { Panel } from '../../components/ui'

export interface ClosedNote { id: string; from: string; to: string; closedAt: string; adjustments: Adjustment[] }

const shown = (a: Adjustment, n: number) => (a.field === 'checks' ? String(n) : `$${n.toFixed(2)}`)

export function ClosedPeriodNote({ closed }: { closed?: readonly ClosedNote[] | null }) {
  if (!closed || closed.length === 0) return null
  return (
    <>
      {closed.map(c => (
        <Panel key={c.id} title={`${c.from} to ${c.to} was closed${c.closedAt ? ` on ${c.closedAt.slice(0, 10)}` : ''} and handed to the accountant`}>
          {c.adjustments.length === 0 ? (
            <p style={{ fontFamily: 'var(--font-inter)', color: 'rgba(var(--offwhite-rgb),0.75)', fontSize: '0.92rem' }}>
              Nothing has changed on those days since: the figures below are the figures issued.
            </p>
          ) : (
            <>
              <p style={{ fontFamily: 'var(--font-inter)', color: 'var(--offwhite)', fontSize: '0.92rem', marginBottom: '0.5rem' }}>
                These days have changed since they were issued. The figures below include the changes; these are the post-close adjustments to send:
              </p>
              <ul style={{ fontFamily: 'var(--font-inter)', color: 'var(--offwhite)', fontSize: '0.88rem', paddingLeft: '1.2rem', lineHeight: 1.6 }}>
                {c.adjustments.map(a => (
                  <li key={`${a.branch}|${a.day}|${a.field}`}>
                    {a.day} · {a.branch} · {CLOSED_FIELD_LABELS[a.field]}: issued {shown(a, a.issued)}, now {shown(a, a.now)} ({a.difference > 0 ? '+' : ''}{shown(a, a.difference)})
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      ))}
    </>
  )
}
