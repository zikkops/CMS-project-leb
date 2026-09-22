'use client'

// Voids and discounts (UPGRADE.md T3.2): by day, by person and by reason, over
// the checks that closed in a range. Who voided a line is recorded from
// 18 Sep 2026; older voids say "Not recorded" rather than a guess.
//
// The exception report (T7.9): who rang each voided item up, whether each void
// after sending and each refund was approved by a manager (the role stamped
// from 21 Sep 2026), the refunds given in the period on the day they were
// given, and what sold at a price rule.
//
// No figure is worked out here: the server builds the report with
// shared/src/salesReports.ts (verify:reports).

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { APPROVAL_LABELS, DISCOUNT_KIND_LABELS, type DiscountRow, type RefundRow, type Tally, type VoidDiscountReport, type VoidRow } from '@big-cms/shared/salesReports'
import type { CutShort } from '@big-cms/shared/salesExport'
import { Page, PageHeader, Panel, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, BranchTotals, fetchReport, reportError, usd, type RangeChoice } from '../ReportRange'
import { ReportDownloads } from '../../../components/ui/ReportDownloads'
import { BarChart } from '../../../components/ui/Charts'
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
  { key: 'rungUp', label: 'Rung up by', render: v => v.rungUpBy, sort: (a, b) => a.rungUpBy.localeCompare(b.rungUpBy) },
  { key: 'by', label: 'Voided by', render: v => v.by, sort: (a, b) => a.by.localeCompare(b.by) },
  { key: 'approval', label: 'Approval', render: v => APPROVAL_LABELS[v.approval], sort: (a, b) => a.approval.localeCompare(b.approval) },
  { key: 'value', label: 'Value', align: 'right', render: v => usd(v.value), sort: (a, b) => a.value - b.value },
]

const refundColumns: Column<RefundRow>[] = [
  { key: 'day', label: 'Given', render: r => `${r.day} ${r.time}`, sort: (a, b) => `${a.day}${a.time}`.localeCompare(`${b.day}${b.time}`) },
  { key: 'receipt', label: 'Receipt', render: r => `${r.receipt || '—'} · sold ${r.originalDay}` },
  { key: 'reason', label: 'Reason', render: r => `${r.reason}${r.waste ? ' (waste)' : ''}` },
  { key: 'by', label: 'By', render: r => r.by, sort: (a, b) => a.by.localeCompare(b.by) },
  { key: 'approval', label: 'Approval', render: r => APPROVAL_LABELS[r.approval], sort: (a, b) => a.approval.localeCompare(b.approval) },
  { key: 'amount', label: 'Given back', align: 'right', render: r => usd(r.amount), sort: (a, b) => a.amount - b.amount },
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
        lead="The exception report: everything struck off a check, every discount and every refund, by reason, by who did it and by who approved it, and what sold at a price rule, over the days you choose. Refunds are filed on the day they were given." />
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
            { key: 'refunds', label: 'Refunds' }, { key: 'refundValue', label: 'Given back', money: true },
            { key: 'unapproved', label: 'No approval' },
          ]} />
          <Panel title={`${report.from === report.to ? report.from : `${report.from} to ${report.to}`} · ${report.checks} closed check${report.checks === 1 ? '' : 's'}`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', fontFamily: 'var(--font-inter)' }}>
              {[
                ['Voids', `${report.totals.voids}`, `${usd(report.totals.voidValue)} of items`],
                ['Of that, waste', usd(report.totals.wasteValue), 'made, then lost'],
                ['Discounts', `${report.totals.discounts}`, `${usd(report.totals.discountValue)} taken off`],
                ['Refunds', `${report.totals.refunds}`, `${usd(report.totals.refundValue)} given back`],
                ['No manager approval', `${report.totals.unapproved}`, 'voids after sending and refunds, none recorded or not a manager'],
                ['At a price rule', usd(report.totals.priceRuleValue), 'sold at a time price'],
              ].map(([label, value, detail]) => (
                <div key={label}>
                  <p style={{ fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.5)' }}>{label}</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--offwhite)' }}>{value}</p>
                  <p style={{ fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>{detail}</p>
                </div>
              ))}
            </div>
          </Panel>

          <BarChart title="Voids by reason" unit="usd" note="What was struck off, by why. The tables below have the counts."
            points={report.voidsByReason.map(t => ({ label: t.label, value: t.value }))} />
          <BarChart title="Given away, by reason" unit="usd" note="Discounts and comps, by why."
            points={report.discountsByReason.map(t => ({ label: t.label, value: t.value }))} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '0 1.5rem' }}>
            <Panel title="Voids by reason">{tallyTable(report.voidsByReason, 'Reason', 'No voids in this range.')}</Panel>
            <Panel title="Voids by who voided them">{tallyTable(report.voidsByStaff, 'Person', 'No voids in this range.')}</Panel>
            <Panel title="Voids by who rang them up">{tallyTable(report.voidsByRungUp, 'Person', 'No voids in this range.')}</Panel>
            <Panel title="Voids after sending and refunds, by approval">{tallyTable(report.byApproval, 'Approval', 'Nothing needed approving in this range.')}</Panel>
            <Panel title="Refunds by reason">{tallyTable(report.refundsByReason, 'Reason', 'No refunds in this range.')}</Panel>
            <Panel title="Refunds by person">{tallyTable(report.refundsByStaff, 'Person', 'No refunds in this range.')}</Panel>
            <Panel title="Sold at a price rule">{tallyTable(report.priceRules, 'Rule', 'Nothing sold at a price rule in this range.')}</Panel>
            <Panel title="Discounts by reason">{tallyTable(report.discountsByReason, 'Reason', 'No discounts in this range.')}</Panel>
            <Panel title="Discounts by person">{tallyTable(report.discountsByStaff, 'Person', 'No discounts in this range.')}</Panel>
          </div>

          <Panel title="By day">
            <DataTable
              columns={[
                { key: 'day', label: 'Day', render: d => d.day, sort: (a, b) => a.day.localeCompare(b.day) },
                { key: 'voids', label: 'Voids', align: 'right', render: d => `${d.voids} · ${usd(d.voidValue)}`, sort: (a, b) => a.voidValue - b.voidValue },
                { key: 'discounts', label: 'Discounts', align: 'right', render: d => `${d.discounts} · ${usd(d.discountValue)}`, sort: (a, b) => a.discountValue - b.discountValue },
                { key: 'refunds', label: 'Refunds', align: 'right', render: d => `${d.refunds} · ${usd(d.refundValue)}`, sort: (a, b) => a.refundValue - b.refundValue },
              ]}
              rows={report.byDay} rowKey={d => d.day}
              empty={<EmptyState title="Nothing was voided, discounted or refunded in this range." />} />
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

          <Panel title="Every refund">
            <DataTable columns={refundColumns} rows={report.refunds} rowKey={r => r.id}
              search={(r, q) => `${r.receipt} ${r.reason} ${r.by}`.toLowerCase().includes(q)} searchLabel="Find a refund"
              empty={<EmptyState title="No refunds given in this range." />} />
          </Panel>
        </>
      )}
    </Page>
  )
}
