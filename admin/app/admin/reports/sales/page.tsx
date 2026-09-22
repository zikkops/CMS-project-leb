'use client'

// The sales summary (UPGRADE.md T7.3): gross sales, each kind of discount, net
// sales excluding VAT and service, VAT output, service charge, refunds in the
// period they were given, and card tips kept apart. One column per branch and
// an "All" column that is their sum. Definitions: shared/src/salesSummary.ts
// and docs/reporting.md, section 1.

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { SALES_FIGURE_ROWS, type SalesFigures, type SalesSummary } from '@big-cms/shared/salesSummary'
import type { CutShort } from '@big-cms/shared/salesExport'
import type { FileColumn } from '@big-cms/shared/reportFile'
import { Page, PageHeader, Panel, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, fetchReport, reportError, usd, type RangeChoice } from '../ReportRange'
import { ReportDownloads, type ReportSheet } from '../../../components/ui/ReportDownloads'
import { BarChart } from '../../../components/ui/Charts'
import { ClosedPeriodNote, type ClosedNote } from '../ClosedPeriodNote'
import { reportHeader } from '../files'

type Report = SalesSummary & { from: string; to: string; branches: string[]; cutShort?: CutShort | null; closed?: ClosedNote[] }

const lbp = (n: number) => `${Math.round(n).toLocaleString('en-US')} LBP`

/** One figure across the branches, then All: the rows of the table and the file. */
interface FigureRow { key: keyof SalesFigures; label: string; money: boolean; lbp?: boolean; values: number[] }

function figureRows(report: Report): FigureRow[] {
  const cols = report.byBranch.length > 1 ? [...report.byBranch.map(b => b.figures), report.total] : [report.total]
  return SALES_FIGURE_ROWS.map(r => ({ ...r, values: cols.map(c => c[r.key]) }))
}

function cell(row: FigureRow, v: number): string {
  return row.lbp ? lbp(v) : row.money ? usd(v) : v.toLocaleString('en-US')
}

export default function SalesSummaryPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(range: RangeChoice) {
    setBusy(true)
    setError('')
    try { setReport(await fetchReport<Report>('sales', range)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return <Loading />
  const rows = report ? figureRows(report) : []
  const heads = report ? (report.byBranch.length > 1 ? [...report.byBranch.map(b => b.branch), 'All'] : [report.branches.join(', ') || 'All']) : []
  const columns: Column<FigureRow>[] = [
    { key: 'label', label: 'Figure', render: r => r.label },
    ...heads.map((h, i) => ({ key: `c${i}`, label: h, align: 'right' as const, render: (r: FigureRow) => cell(r, r.values[i]) })),
  ]
  const sheets: ReportSheet<never>[] = report ? [
    {
      name: 'Summary',
      columns: [
        { label: 'Figure', value: r => r.label },
        ...heads.map((h, i) => ({ label: h, value: (r: FigureRow) => r.values[i] })),
      ] as FileColumn<FigureRow>[],
      rows,
    } as unknown as ReportSheet<never>,
    {
      name: 'By order type',
      columns: [
        { label: 'Order type', value: o => o.order }, { label: 'Checks', value: o => o.checks },
        { label: 'Billed USD (incl. VAT and service)', value: o => o.billed }, { label: 'Net sales USD (excl. VAT and service)', value: o => o.netSales },
      ] as FileColumn<SalesSummary['byOrderType'][number]>[],
      rows: report.byOrderType,
    } as unknown as ReportSheet<never>,
  ] : []

  return (
    <Page>
      <PageHeader title="Sales Summary"
        lead="What the period sold, the way an accountant reads it: gross sales, every discount, net sales excluding VAT and service, VAT, service charge, refunds in the period they were given, and card tips kept apart as money owed to staff." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      <ClosedPeriodNote closed={report?.closed} />
      {busy && !report && <Loading label="Reading the checks…" />}
      {report && (
        <>
          <ReportDownloads header={{ ...reportHeader('Sales Summary', report.from, report.to, report.branches), currencies: ['USD', 'LBP'] }} sheets={sheets} />
          <Panel title={`${report.from === report.to ? report.from : `${report.from} to ${report.to}`} · average check ${usd(report.averageCheck)}`}>
            {report.total.checks === 0 && report.total.refundsGiven === 0
              ? <EmptyState title="No closed checks and no refunds in this period." />
              : <DataTable columns={columns} rows={rows} rowKey={r => r.key} empty="Nothing to show." />}
          </Panel>
          {report.byBranch.length > 1 && (
            <BarChart title="Net sales by branch" unit="usd" note="Excluding VAT and service, the figure the accountant divides everything else into."
              points={report.byBranch.map(b => ({ label: b.branch, value: b.figures.netSales }))} />
          )}
          {report.byOrderType.length > 1 && (
            <BarChart title="Billed by order type" unit="usd" note="What each way of ordering took, the bill as the customer saw it."
              points={report.byOrderType.map(o => ({ label: o.order, value: o.billed }))} />
          )}
          {report.byOrderType.length > 1 && (
            <Panel title="By order type">
              <DataTable
                columns={[
                  { key: 'order', label: 'Order type', render: o => o.order },
                  { key: 'checks', label: 'Checks', align: 'right', render: o => String(o.checks) },
                  { key: 'billed', label: 'Billed', align: 'right', render: o => usd(o.billed) },
                  { key: 'net', label: 'Net sales', align: 'right', render: o => usd(o.netSales) },
                ]}
                rows={report.byOrderType} rowKey={o => o.order} empty="No sales." />
            </Panel>
          )}
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.55)', lineHeight: 1.6 }}>
            Sales are filed by the day the check closed and refunds by the day they were given, each on the café&apos;s calendar day. POS checks only: counter retail sales and wholesale orders are reported separately.
          </p>
        </>
      )}
    </Page>
  )
}
