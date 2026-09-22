'use client'

// Loyalty liability (UPGRADE.md T7.14): points are a promise to give
// something away, so a liability, like tips. Issued, reversed and spent per
// branch over the period, each movement on its own day (a refund's reversal
// on the day of the refund), and the points owed at each end, valued at the
// point value in Business Settings when one is set. Rules:
// shared/src/loyaltyExport.ts.

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import type { LoyaltyDayRow, LoyaltyExport, LoyaltyLiability, PointsRow, RedemptionRow } from '@big-cms/shared/loyaltyExport'
import type { CutShort } from '@big-cms/shared/salesExport'
import type { FileColumn } from '@big-cms/shared/reportFile'
import { Page, PageHeader, Panel, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, BranchTotals, reportError, usd, type RangeChoice } from '../ReportRange'
import { ReportDownloads, type ReportSheet } from '../../../components/ui/ReportDownloads'
import { LineChart } from '../../../components/ui/Charts'
import { reportHeader } from '../files'

type Report = LoyaltyLiability & {
  from: string; to: string; branches: string[]; asOf: string; cutShort?: CutShort | null
  period: LoyaltyExport
}

/** The branches folded together, one point per day, for the chart. */
function loyaltySeries(days: readonly LoyaltyDayRow[]) {
  const by = new Map<string, { issued: number; reversed: number; spent: number }>()
  for (const d of days) {
    const at = by.get(d.day) ?? { issued: 0, reversed: 0, spent: 0 }
    by.set(d.day, { issued: at.issued + d.issued, reversed: at.reversed + d.reversed, spent: at.spent + d.spent })
  }
  const rows = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const points = (pick: (f: { issued: number; reversed: number; spent: number }) => number) =>
    rows.map(([day, f]) => ({ label: day, value: pick(f), short: day.slice(5) }))
  return [
    { name: 'Issued', points: points(f => f.issued) },
    { name: 'Spent', points: points(f => f.spent) },
    { name: 'Reversed', points: points(f => f.reversed) },
  ]
}

const sheet = <T,>(name: string, columns: FileColumn<T>[], rows: readonly T[]) => ({ name, columns, rows }) as unknown as ReportSheet<never>
const pts = (n: number) => n.toLocaleString('en-US')

const dayColumns: Column<LoyaltyDayRow>[] = [
  { key: 'day', label: 'Day', render: d => `${d.day} · ${d.branch || '—'}`, sort: (a, b) => a.day.localeCompare(b.day) },
  { key: 'issued', label: 'Issued', align: 'right', render: d => pts(d.issued), sort: (a, b) => a.issued - b.issued },
  { key: 'reversed', label: 'Reversed', align: 'right', render: d => pts(d.reversed), sort: (a, b) => a.reversed - b.reversed },
  { key: 'spent', label: 'Spent', align: 'right', render: d => pts(d.spent), sort: (a, b) => a.spent - b.spent },
  { key: 'net', label: 'Net', align: 'right', render: d => pts(d.net), sort: (a, b) => a.net - b.net },
]

export default function LoyaltyLiabilityPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.loyalty)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(choice: RangeChoice) {
    setBusy(true)
    setError('')
    try {
      const params = new URLSearchParams({ from: choice.from, to: choice.to })
      if (choice.branch) params.set('branch', choice.branch)
      setReport(await unwrap(await authedFetch(`/api/admin/reports/loyalty?${params}`, 'GET')) as unknown as Report)
    } catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return <Loading />
  const m = report?.movement
  const valued = (points: number, value: number | null) => `${pts(points)} points${value === null ? '' : ` · ${usd(value)}`}`
  return (
    <Page width="wide">
      <PageHeader title="Loyalty Liability"
        lead="Points are owed to members until they are spent, so they are a liability, like tips. Issued, reversed and spent over the period, per branch, each on the day it happened, and what the scheme owes at each end." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Reading the points ledger…" />}
      {report && m && (
        <>
          <ReportDownloads header={reportHeader('Loyalty Liability', report.from, report.to, report.branches)} sheets={[
            sheet<{ label: string; points: number; usd: number | null }>('Liability', [
              { label: 'Figure', value: r => r.label }, { label: 'Points', value: r => r.points }, { label: 'USD', value: r => r.usd },
            ], [
              { label: 'Owed at the start (whole scheme)', points: report.opening, usd: report.openingUsd },
              { label: 'Issued', points: m.issued, usd: null }, { label: 'Reversed', points: m.reversed, usd: null },
              { label: 'Spent', points: m.spent, usd: null }, { label: 'Net movement', points: m.net, usd: null },
              { label: 'Owed at the end (whole scheme)', points: report.closing, usd: report.closingUsd },
            ]),
            sheet<LoyaltyDayRow>('Days', [
              { label: 'Day', value: d => d.day }, { label: 'Branch', value: d => d.branch }, { label: 'Issued', value: d => d.issued },
              { label: 'Reversed', value: d => d.reversed }, { label: 'Spent', value: d => d.spent }, { label: 'Net', value: d => d.net },
            ], report.period.days),
            sheet<PointsRow>('Points', [
              { label: 'Day', value: p => p.day }, { label: 'Branch', value: p => p.branch }, { label: 'Type', value: p => p.type }, { label: 'Status', value: p => p.status },
              { label: 'Points each', value: p => p.perPerson }, { label: 'People', value: p => p.people }, { label: 'Issued', value: p => p.issued }, { label: 'Reversed', value: p => p.reversed },
              { label: 'Check', value: p => p.checkNumber }, { label: 'Event', value: p => p.eventName }, { label: 'Id', value: p => p.id },
            ], report.period.points),
            sheet<RedemptionRow>('Redemptions', [
              { label: 'Day', value: r => r.day }, { label: 'Branch', value: r => r.branch }, { label: 'Item', value: r => r.item },
              { label: 'Cost', value: r => r.cost }, { label: 'Spent', value: r => r.spent }, { label: 'Status', value: r => r.status },
            ], report.period.redemptions),
          ]} />
          <BranchTotals rows={report.byBranch.map(b => ({ branch: b.branch, totals: b.movement }))} columns={[
            { key: 'issued', label: 'Issued' }, { key: 'reversed', label: 'Reversed' }, { key: 'spent', label: 'Spent' }, { key: 'net', label: 'Net' },
          ]} />
          <Panel title={`Owed ${valued(report.opening, report.openingUsd)} at the start, ${valued(report.closing, report.closingUsd)} at the end`}>
            <p style={{ fontFamily: 'var(--font-inter)', color: 'rgba(var(--offwhite-rgb),0.75)', fontSize: '0.92rem', lineHeight: 1.6 }}>
              In the period: {pts(m.issued)} issued, {pts(m.reversed)} reversed on refunds, {pts(m.spent)} spent, net {pts(m.net)}.
              {' '}What is owed is the whole scheme&apos;s, since a member&apos;s points are theirs at every branch: {report.members.toLocaleString('en-US')} members hold points
              as of {report.asOf}, worked back through the ledger to the period&apos;s end.
              {report.pointValueUsd === null
                ? ' No value is set for a point, so it is shown in points only. Set one in Business Settings.'
                : ` Valued at $${report.pointValueUsd} a point.`}
            </p>
          </Panel>
          {/* Three series on one scale, because points are points: issued
              against what came back is the whole question. */}
          <LineChart title="Points, by day" unit="count" note="Every branch together. Spending is a customer taking value back, not a sale."
            series={loyaltySeries(report.period.days)} />
          <Panel title="By day">
            <DataTable columns={dayColumns} rows={report.period.days} rowKey={d => `${d.day}|${d.branch}`} empty={<EmptyState title="No points moved in this period." />} />
          </Panel>
        </>
      )}
    </Page>
  )
}
