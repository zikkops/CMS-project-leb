'use client'

// Purchases (UPGRADE.md T7.13): every delivery received in the period, by
// supplier and branch, with the supplier's invoice number and date, net before
// VAT, input VAT and total, in dollars and lira; and how much of each weekly
// order it was booked against has arrived. The same delivery rows as the VAT
// report's input VAT. Rules: shared/src/purchasesReport.ts.

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import type { OrderFulfilment, PurchaseRow, PurchaseTotals, PurchasesReport } from '@big-cms/shared/purchasesReport'
import type { CutShort } from '@big-cms/shared/salesExport'
import type { FileColumn } from '@big-cms/shared/reportFile'
import { Page, PageHeader, Panel, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, BranchTotals, fetchReport, reportError, usd, type RangeChoice } from '../ReportRange'
import { ReportDownloads, type ReportSheet } from '../../../components/ui/ReportDownloads'
import { reportHeader } from '../files'

type Report = PurchasesReport & { from: string; to: string; branches: string[]; cutShort?: CutShort | null }

const sheet = <T,>(name: string, columns: FileColumn<T>[], rows: readonly T[]) => ({ name, columns, rows }) as unknown as ReportSheet<never>
const lbp = (n: number) => `${Math.round(n).toLocaleString('en-US')} LBP`
const own = (r: PurchaseRow, n: number) => (r.currency === 'LBP' ? lbp(n) : usd(n))

const rowColumns: Column<PurchaseRow>[] = [
  { key: 'day', label: 'Received', render: r => `${r.day} · ${r.branch}`, sort: (a, b) => a.day.localeCompare(b.day) },
  { key: 'supplier', label: 'Supplier', render: r => r.supplier, sort: (a, b) => a.supplier.localeCompare(b.supplier) },
  { key: 'invoice', label: 'Invoice', render: r => `${r.invoiceNumber || '—'}${r.invoiceDate ? ` · ${r.invoiceDate}` : ''}` },
  { key: 'net', label: 'Net', align: 'right', render: r => own(r, r.net), sort: (a, b) => a.netUsd - b.netUsd },
  { key: 'vat', label: 'VAT', align: 'right', render: r => own(r, r.vat), sort: (a, b) => a.vatUsd - b.vatUsd },
  { key: 'total', label: 'Total', align: 'right', render: r => own(r, r.total), sort: (a, b) => a.totalUsd - b.totalUsd },
  { key: 'other', label: 'In the other currency', align: 'right', render: r => (r.currency === 'LBP' ? usd(r.totalUsd) : `${lbp(r.totalLbp)}*`) },
]

const supplierColumns: Column<{ supplier: string; totals: PurchaseTotals }>[] = [
  { key: 'supplier', label: 'Supplier', render: s => s.supplier, sort: (a, b) => a.supplier.localeCompare(b.supplier) },
  { key: 'n', label: 'Deliveries', align: 'right', render: s => String(s.totals.deliveries), sort: (a, b) => a.totals.deliveries - b.totals.deliveries },
  { key: 'net', label: 'Net', align: 'right', render: s => usd(s.totals.netUsd), sort: (a, b) => a.totals.netUsd - b.totals.netUsd },
  { key: 'vat', label: 'VAT', align: 'right', render: s => usd(s.totals.vatUsd), sort: (a, b) => a.totals.vatUsd - b.totals.vatUsd },
  { key: 'total', label: 'Total', align: 'right', render: s => usd(s.totals.totalUsd), sort: (a, b) => a.totals.totalUsd - b.totals.totalUsd },
  { key: 'lbp', label: 'Total LBP', align: 'right', render: s => lbp(s.totals.totalLbp), sort: (a, b) => a.totals.totalLbp - b.totals.totalLbp },
]

const orderColumns: Column<OrderFulfilment>[] = [
  { key: 'week', label: 'Weekly order', render: o => `Week of ${o.weekStart} · ${o.branch}`, sort: (a, b) => a.weekStart.localeCompare(b.weekStart) },
  { key: 'lines', label: 'Lines', align: 'right', render: o => String(o.lines) },
  { key: 'full', label: 'Arrived', align: 'right', render: o => String(o.full) },
  { key: 'part', label: 'In part', align: 'right', render: o => String(o.part) },
  { key: 'none', label: 'Not yet', align: 'right', render: o => String(o.none) },
  { key: 'deliveries', label: 'Deliveries', align: 'right', render: o => String(o.deliveries) },
]

export default function PurchasesReportPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(choice: RangeChoice) {
    setBusy(true)
    setError('')
    try { setReport(await fetchReport<Report>('purchases', choice)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return <Loading />
  const t = report?.total
  return (
    <Page width="wide">
      <PageHeader title="Purchases"
        lead="Every delivery received in the period, by supplier and branch: the supplier's invoice number and date, net before VAT, input VAT and total, in dollars and lira. Beside it, how much of each weekly order has arrived." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Reading the deliveries…" />}
      {report && t && (
        <>
          <ReportDownloads header={{ ...reportHeader('Purchases', report.from, report.to, report.branches), currencies: ['USD', 'LBP'] }} sheets={[
            sheet<PurchaseRow>('Deliveries', [
              { label: 'Received', value: r => r.day }, { label: 'Branch', value: r => r.branch }, { label: 'Department', value: r => r.department },
              { label: 'Supplier', value: r => r.supplier }, { label: 'Invoice number', value: r => r.invoiceNumber }, { label: 'Invoice date', value: r => r.invoiceDate ?? '' },
              { label: 'Currency', value: r => r.currency }, { label: 'Rate used', value: r => (r.currency === 'LBP' ? r.rateUsed : null) }, { label: 'Status', value: r => r.status },
              { label: 'Net', value: r => r.net }, { label: 'VAT', value: r => r.vat }, { label: 'Total', value: r => r.total },
              { label: 'Net USD', value: r => r.netUsd }, { label: 'VAT USD', value: r => r.vatUsd }, { label: 'Total USD', value: r => r.totalUsd },
              { label: 'Net LBP', value: r => r.netLbp }, { label: 'VAT LBP', value: r => r.vatLbp }, { label: 'Total LBP', value: r => r.totalLbp },
              { label: 'LBP at business rate', value: r => (r.lbpAtBusinessRate ? 'yes' : '') }, { label: 'Weekly order', value: r => r.orderReportId ?? '' },
            ], report.rows),
            sheet<{ supplier: string; totals: PurchaseTotals }>('Suppliers', [
              { label: 'Supplier', value: s => s.supplier }, { label: 'Deliveries', value: s => s.totals.deliveries },
              { label: 'Net USD', value: s => s.totals.netUsd }, { label: 'VAT USD', value: s => s.totals.vatUsd }, { label: 'Total USD', value: s => s.totals.totalUsd },
              { label: 'Net LBP', value: s => s.totals.netLbp }, { label: 'VAT LBP', value: s => s.totals.vatLbp }, { label: 'Total LBP', value: s => s.totals.totalLbp },
            ], report.bySupplier),
            sheet<OrderFulfilment>('Weekly orders', [
              { label: 'Week of', value: o => o.weekStart }, { label: 'Branch', value: o => o.branch }, { label: 'Lines', value: o => o.lines },
              { label: 'Arrived', value: o => o.full }, { label: 'In part', value: o => o.part }, { label: 'Not yet', value: o => o.none }, { label: 'Deliveries', value: o => o.deliveries },
            ], report.orders),
          ]} />
          <BranchTotals rows={report.byBranch.map(b => ({ branch: b.branch, totals: {
            deliveries: b.totals.deliveries, netUsd: b.totals.netUsd, vatUsd: b.totals.vatUsd, totalUsd: b.totals.totalUsd, totalLbp: b.totals.totalLbp,
          } }))} columns={[
            { key: 'deliveries', label: 'Deliveries' }, { key: 'netUsd', label: 'Net', money: true }, { key: 'vatUsd', label: 'VAT', money: true },
            { key: 'totalUsd', label: 'Total', money: true }, { key: 'totalLbp', label: 'Total LBP' },
          ]} />
          <Panel title={`${t.deliveries} deliver${t.deliveries === 1 ? 'y' : 'ies'} · net ${usd(t.netUsd)} + VAT ${usd(t.vatUsd)} = ${usd(t.totalUsd)} · ${lbp(t.totalLbp)}`}>
            <p style={{ fontFamily: 'var(--font-inter)', color: 'rgba(var(--offwhite-rgb),0.75)', fontSize: '0.92rem', marginBottom: '0.75rem' }}>
              The VAT here is the input VAT on the VAT report. An invoice in lira is in dollars at the rate it was received at; one in dollars is in lira at the business rate
              ({report.businessRate.toLocaleString('en-US')}), marked *.
              {t.withoutInvoiceDate > 0 && ` ${t.withoutInvoiceDate} invoice${t.withoutInvoiceDate === 1 ? ' has' : 's have'} no invoice date recorded.`}
              {t.unplanned > 0 && ` ${t.unplanned} deliver${t.unplanned === 1 ? 'y was' : 'ies were'} booked against no weekly order.`}
            </p>
            <DataTable columns={supplierColumns} rows={report.bySupplier} rowKey={s => s.supplier} empty={<EmptyState title="Nothing was received in this period." />} />
          </Panel>
          <Panel title="Weekly orders these deliveries were booked against">
            <DataTable columns={orderColumns} rows={report.orders} rowKey={o => o.id} empty={<EmptyState title="No delivery in this period was booked against a weekly order." />} />
          </Panel>
          <Panel title="Every delivery">
            <DataTable columns={rowColumns} rows={report.rows} rowKey={r => r.id || `${r.day}${r.invoiceNumber}`}
              search={(r, s) => `${r.supplier} ${r.invoiceNumber} ${r.branch}`.toLowerCase().includes(s)} searchLabel="Find a delivery"
              empty={<EmptyState title="Nothing was received in this period." />} />
          </Panel>
        </>
      )}
    </Page>
  )
}
