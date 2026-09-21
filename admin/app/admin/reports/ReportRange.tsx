'use client'

// The date range and branch every sales report asks for (UPGRADE.md T3.2–T3.4),
// and the one read they all make: /api/admin/reports, which builds the figures
// on the server from the same checks the accountant's export reads.
// Module-scope components (CONTRIBUTING.md gotcha #2).

import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { isNetworkFailure } from '@big-cms/shared/netErrors'

export const usd = (n: number) => `$${n.toFixed(2)}`

/** A café day n days before another, both YYYY-MM-DD. */
export function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)
}

export type { RangeChoice } from '../../components/ui/ReportRange'
import type { RangeChoice } from '../../components/ui/ReportRange'

/** Asks the server for one report over a range. The branch is '' for every branch the person has, or a comma list. */
export async function fetchReport<T>(report: string, range: RangeChoice): Promise<T> {
  const params = new URLSearchParams({ report, from: range.from, to: range.to })
  if (range.branch) params.set('branch', range.branch)
  return await unwrap(await authedFetch(`/api/admin/reports?${params}`, 'GET')) as T
}

export function reportError(err: unknown): string {
  return isNetworkFailure(err) ? 'No connection. Try again when the internet is back.' : err instanceof Error ? err.message : 'The report could not be read.'
}

// The picker itself moved to the admin UI kit (UPGRADE.md T7.1), with quick
// periods and several branches; re-exported so the reports keep one import.
export { ReportRange, BranchTotals } from '../../components/ui/ReportRange'
