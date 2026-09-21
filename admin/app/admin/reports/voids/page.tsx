'use client'

// Voids and discounts (UPGRADE.md T3.2): by day, by person and by reason, over
// the checks that closed in a range. Who voided a line is recorded from
// 18 Sep 2026; older voids say "Not recorded" rather than a guess.
//
// No figure is worked out here: the server builds the report with
// shared/src/salesReports.ts (verify:reports).

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { DISCOUNT_KIND_LABELS, type DiscountRow, type Tally, type VoidDiscountReport, type VoidRow } from '@big-cms/shared/salesReports'
import type { CutShort } from '@big-cms/shared/salesExport'
import { Page, PageHeader, Panel, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, BranchTotals, fetchReport, reportError, usd, type RangeChoice } from '../ReportRange'
import { ReportDownloads } from '../../../components/ui/ReportDownloads'
import { reportHeader, voidSheets } from '../files'

type Report = VoidDiscountReport & { from: string; to: string; branches: string[]; checks: number; cutShort?: CutShort | null; byBranch?: { branch: string; totals: Record<string, number> }[] }

const tallyColumns: Column<Tally>[] = [
  { key: 'label', label: '', render: t => t.label, sort: (a, b) => a.label.localeCompare(b.label) },
  { key: 'count', label: 'How many', align: 'right', render: t => String(t.count), sort: (a, b) => a.count - b.count },
  { key: 'value', label: 'Value', align: 'right', render: t => usd(t.value), sort: (a, b) => a.value - b.value },
]
const tallyTable = (rows: Tally[], label: string, empty: string) => (
  <DataTable columns={tallyColumns.map(c => (c.key === 'label' ? { ...c, label } : c))} rows={rows} rowKey={t => t.key || t.label}
    empty={<EmptyState title={empty} />} />
)

const voidColumns: Column<VoidRow>[] = [
  { key: 'day', label: 'When', render: v => `${v.day} ${v.time}`, sort: (a, b) => `${a.day}${a.time}`.localeCompare(`${b.day}${b.time}`) },
  { key: 'item', label: 'Item', render: v => `${v.quantity} × ${v.item}${v.table ? ` · table ${v.table}` : ''}` },
  { key: 'reason', label: 'Reason', render: v => `${v.reason}${v.waste ? ' (waste)' : ''}${v.afterSending ? '' : ' · before sending'}` },
  { key: 'by', label: 'By', render: v => v.by, sort: (a, b) => a.by.localeCompare(b.by) },
  { key: 'value', label: 'Value', align: 'right', render: v => usd(v.value), sort: (a, b) => a.value - b.value },
]

const discountColumns: Column<DiscountRow>[] = [
  { key: 'day', label: 'When', render: d => `${d.day} ${d.time}`, sort: (a, b) => `${a.day}${a.time}`.localeCompare(`${b.day}${b.time}`) },
  { key: 'kind', label: 'What', render: d => `${DISCOUNT_KIND_LABELS[d.kind]}${d.item ? `: ${d.item}` : ''}` },
  { key: 'reason', label: 'Reason', render: d => d.reason },
  { key: 'by', label: 'By', render: d => d.by, sort: (a, b) => a.by.localeCompare(b.by) },
  { key: 'amount', label: 'Took off', align: 'right', render: d => usd(d.amount), sort: (a, b) => a.amount - b.amount },
]

export default function VoidsReportPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(range: RangeChoice) {
    setBusy(true); setError('')
    try { setReport(await fetchReport<Report>('voids', range)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return null
  return (
    <Page width="wide">
      <PageHeader title="Voids & Discounts"
        lead="Everything struck off a check and every discount given, by reason and by person, over the checks that closed on the days you choose." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Reading the checks…" />}
      {report && (
        <>
          <ReportDownloads header={reportHeader('Voids & Discounts', report.from, report.to, report.branches)} sheets={voidSheets(report)} />
          <BranchTotals rows={report.byBranch ?? []} columns={[
            { key: 'voids', label: 'Voids' }, { key: 'voidValue', label: 'Voided', money: true }, { key: 'wasteValue', label: 'Waste', money: true },
            { key: 'discounts', label: 'Discounts' }, { key: 'discountValue', label: 'Took off', money: true },
          ]} />
          <Panel title={`${report.from === report.to ? report.from : `${report.from} to ${report.to}`} · ${report.checks} closed check${report.checks === 1 ? '' : 's'}`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', fontFamily: 'var(--font-inter)' }}>
              {[
                ['Voids', `${report.totals.voids}`, `${usd(report.totals.voidValue)} of items`],
                ['Of that, waste', usd(report.totals.wasteValue), 'made, then lost'],
                ['Discounts', `${report.totals.discounts}`, `${usd(report.totals.discountValue)} taken off`],
              ].map(([label, value, detail]) => (
                <div key={label}>
                  <p style={{ fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.5)' }}>{label}</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--offwhite)' }}>{value}</p>
                  <p style={{ fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>{detail}</p>
                </div>
              ))}
            </div>
          </Panel>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '0 1.5rem' }}>
            <Panel title="Voids by reason">{tallyTable(report.voidsByReason, 'Reason', 'No voids in this range.')}</Panel>
            <Panel title="Voids by person">{tallyTable(report.voidsByStaff, 'Person', 'No voids in this range.')}</Panel>
            <Panel title="Discounts by reason">{tallyTable(report.discountsByReason, 'Reason', 'No discounts in this range.')}</Panel>
            <Panel title="Discounts by person">{tallyTable(report.discountsByStaff, 'Person', 'No discounts in this range.')}</Panel>
          </div>

          <Panel title="By day">
            <DataTable
              columns={[
                { key: 'day', label: 'Day', render: d => d.day, sort: (a, b) => a.day.localeCompare(b.day) },
                { key: 'voids', label: 'Voids', align: 'right', render: d => `${d.voids} · ${usd(d.voidValue)}`, sort: (a, b) => a.voidValue - b.voidValue },
                { key: 'discounts', label: 'Discounts', align: 'right', render: d => `${d.discounts} · ${usd(d.discountValue)}`, sort: (a, b) => a.discountValue - b.discountValue },
              ]}
              rows={report.byDay} rowKey={d => d.day}
              empty={<EmptyState title="Nothing was voided or discounted in this range." />} />
          </Panel>

          <Panel title="Every void">
            <DataTable columns={voidColumns} rows={report.voids} rowKey={v => v.id}
              search={(v, q) => `${v.item} ${v.reason} ${v.by} ${v.receipt}`.toLowerCase().includes(q)} searchLabel="Find a void"
              empty={<EmptyState title="No voids in this range." />} />
          </Panel>

          <Panel title="Every discount">
            <DataTable columns={discountColumns} rows={report.discounts} rowKey={d => d.id}
              search={(d, q) => `${d.item ?? ''} ${d.reason} ${d.by} ${d.receipt}`.toLowerCase().includes(q)} searchLabel="Find a discount"
              empty={<EmptyState title="No discounts in this range." />} />
          </Panel>
        </>
      )}
    </Page>
  )
}
