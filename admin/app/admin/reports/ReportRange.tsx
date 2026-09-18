'use client'

// The date range and branch every sales report asks for (UPGRADE.md T3.2–T3.4),
// and the one read they all make: /api/admin/reports, which builds the figures
// on the server from the same checks the accountant's export reads.
// Module-scope components (CONTRIBUTING.md gotcha #2).

import { useState, type ReactNode } from 'react'
import { faMagnifyingGlassChart } from '@fortawesome/free-solid-svg-icons'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { BRAND } from '@big-cms/shared/brand'
import { todayYmd } from '@big-cms/shared/dates'
import { Button, Field, inputStyle } from '../../components/ui'

export const usd = (n: number) => `$${n.toFixed(2)}`

/** A café day n days before another, both YYYY-MM-DD. */
export function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)
}

export interface RangeChoice { from: string; to: string; branch: string }

/** Asks the server for one report over a range. The branch is '' for every branch the person has. */
export async function fetchReport<T>(report: string, range: RangeChoice): Promise<T> {
  const params = new URLSearchParams({ report, from: range.from, to: range.to })
  if (range.branch) params.set('branch', range.branch)
  return await unwrap(await authedFetch(`/api/admin/reports?${params}`, 'GET')) as T
}

export function reportError(err: unknown): string {
  return isNetworkFailure(err) ? 'No connection. Try again when the internet is back.' : err instanceof Error ? err.message : 'The report could not be read.'
}

/**
 * From, to and branch, starting on the last seven café days. `single` asks for
 * one day instead of a range (the hourly report compares a day with the same
 * day a week before).
 */
export function ReportRange({ onRun, busy, single = false, extra }: {
  onRun: (range: RangeChoice) => void
  busy: boolean
  single?: boolean
  extra?: ReactNode
}) {
  const today = todayYmd(BRAND.locale.timezone)
  const [from, setFrom] = useState(single ? today : daysBefore(today, 6))
  const [to, setTo] = useState(today)
  const [branch, setBranch] = useState('')

  return (
    <form
      onSubmit={e => { e.preventDefault(); onRun({ from, to: single ? from : to, branch }) }}
      style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.6rem' }}
    >
      <div style={{ minWidth: '10rem' }}>
        <Field id="report-from" label={single ? 'Day' : 'From'}>
          <input id="report-from" type="date" value={from} max={today} onChange={e => setFrom(e.target.value)} style={inputStyle} required />
        </Field>
      </div>
      {!single && (
        <div style={{ minWidth: '10rem' }}>
          <Field id="report-to" label="To">
            <input id="report-to" type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} style={inputStyle} required />
          </Field>
        </div>
      )}
      {BRAND.branches.length > 1 && (
        <div style={{ minWidth: '10rem' }}>
          <Field id="report-branch" label="Branch">
            <select id="report-branch" value={branch} onChange={e => setBranch(e.target.value)} style={inputStyle}>
              <option value="">All my branches</option>
              {BRAND.branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
        </div>
      )}
      {extra}
      <div style={{ marginBottom: '1.1rem' }}>
        <Button type="submit" tone="primary" icon={faMagnifyingGlassChart} disabled={busy}>{busy ? 'Reading…' : 'Show'}</Button>
      </div>
    </form>
  )
}
