'use client'

// Hourly sales (UPGRADE.md T3.4): what the till took in each hour of one café
// day, beside the same weekday a week before, to see when to put a second
// barista on. The hour is the café's clock, through the export's own day rules.
//
// No figure is worked out here: the server builds it with
// shared/src/salesReports.ts (verify:reports). The chart only draws it, and
// the table under it says the same thing in words.

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import type { HourRow, HourlySales } from '@big-cms/shared/salesReports'
import type { CutShort } from '@big-cms/shared/salesExport'
import { Page, PageHeader, Panel, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, BranchTotals, fetchReport, reportError, usd, type RangeChoice } from '../ReportRange'
import { ReportDownloads } from '../../../components/ui/ReportDownloads'
import { reportHeader, hourlySheets } from '../files'
import { HourChart, hourLabel } from './HourChart'

const change = (now: number, before: number) =>
  before === 0 ? (now === 0 ? '—' : 'new') : `${now >= before ? '+' : '−'}${Math.abs(Math.round(((now - before) / before) * 100))}%`

const columns: Column<HourRow>[] = [
  { key: 'hour', label: 'Hour', render: h => `${hourLabel(h.hour)}–${hourLabel((h.hour + 1) % 24)}`, sort: (a, b) => a.hour - b.hour },
  { key: 'net', label: 'Takings', align: 'right', render: h => `${usd(h.net)} · ${h.checks}`, sort: (a, b) => a.net - b.net },
  { key: 'compareNet', label: 'A week before', align: 'right', render: h => `${usd(h.compareNet)} · ${h.compareChecks}`, sort: (a, b) => a.compareNet - b.compareNet },
  { key: 'change', label: 'Change', align: 'right', render: h => change(h.net, h.compareNet) },
]

export default function HourlySalesPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<(HourlySales & { branches?: string[]; cutShort?: CutShort | null; byBranch?: { branch: string; totals: Record<string, number> }[] }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(range: RangeChoice) {
    setBusy(true); setError('')
    try { setReport(await fetchReport<HourlySales & { cutShort?: CutShort | null; byBranch?: { branch: string; totals: Record<string, number> }[] }>('hourly', range)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return null
  return (
    <Page width="wide">
      <PageHeader title="Hourly Sales"
        lead="What the till took in each hour of a day, beside the same day a week before. Hours are the café's own clock." />
      <ReportRange onRun={run} busy={busy} single />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Reading the checks…" />}
      {report && (
        <>
          <ReportDownloads header={reportHeader('Hourly Sales', report.day, report.day, report.branches ?? [])} sheets={hourlySheets(report)} />
          <BranchTotals rows={report.byBranch ?? []} columns={[
            { key: 'checks', label: 'Checks' }, { key: 'net', label: 'Takings', money: true },
            { key: 'compareChecks', label: 'Week before, checks' }, { key: 'compareNet', label: 'Week before', money: true },
          ]} />
          <Panel title={`${report.day} · ${usd(report.totals.net)} from ${report.totals.checks} checks · a week before ${usd(report.totals.compareNet)} (${change(report.totals.net, report.totals.compareNet)})`}>
            {report.peakHour !== null && (
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.9rem', color: 'rgba(var(--offwhite-rgb),0.75)', marginBottom: '0.8rem' }}>
                Busiest hour: {hourLabel(report.peakHour)}–{hourLabel((report.peakHour + 1) % 24)}, {usd(report.hours[report.peakHour].net)}.
              </p>
            )}
            <HourChart report={report} />
          </Panel>
          <Panel title="Hour by hour">
            <DataTable columns={columns} rows={report.hours.filter(h => h.checks > 0 || h.compareChecks > 0)} rowKey={h => String(h.hour)}
              empty={<EmptyState title="Nothing was sold on either day." />} />
          </Panel>
        </>
      )}
    </Page>
  )
}
