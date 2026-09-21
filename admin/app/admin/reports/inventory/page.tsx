'use client'

// Inventory valuation and movement (UPGRADE.md T7.12). Each supply between
// its last count before the period and its last count in it: received,
// transferred, used by sales, wasted, what that says should be on the shelf,
// what was counted, and the difference nothing explains. Cost of goods sold
// the accountant's way: opening + purchases ± transfers − closing.
// Rules: shared/src/inventoryReport.ts.

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import type { InventoryReport, InventoryRow } from '@big-cms/shared/inventoryReport'
import type { CutShort } from '@big-cms/shared/salesExport'
import type { FileColumn } from '@big-cms/shared/reportFile'
import { Page, PageHeader, Panel, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, BranchTotals, fetchReport, reportError, usd, type RangeChoice } from '../ReportRange'
import { ReportDownloads, type ReportSheet } from '../../../components/ui/ReportDownloads'
import { reportHeader } from '../files'

type Report = InventoryReport & { from: string; to: string; branches: string[]; lookbackFrom: string; cutShort?: CutShort | null }

const sheet = <T,>(name: string, columns: FileColumn<T>[], rows: readonly T[]) => ({ name, columns, rows }) as unknown as ReportSheet<never>
const q = (n: number | null) => (n === null ? '—' : String(Math.round(n * 1000) / 1000))
const money = (n: number | null) => (n === null ? 'cost unknown' : usd(n))

const STATUS_LABEL: Record<InventoryRow['status'], string> = {
  'reconciled': '',
  'no opening count': 'No count before the period',
  'no closing count': 'Not counted in the period',
  'not counted': 'Not counted',
}

const rowColumns: Column<InventoryRow>[] = [
  { key: 'name', label: 'Supply', render: r => `${r.name}${r.unit ? ` (${r.unit})` : ''}${r.branch ? ` · ${r.branch}` : ''}`, sort: (a, b) => a.name.localeCompare(b.name) },
  { key: 'counts', label: 'Counted', render: r => (r.status === 'reconciled' ? `${r.openingDay} → ${r.closingDay}` : STATUS_LABEL[r.status]) },
  { key: 'opening', label: 'Opening', align: 'right', render: r => q(r.openingQty) },
  { key: 'in', label: 'Received', align: 'right', render: r => q(r.received) },
  { key: 'moved', label: 'Moved', align: 'right', render: r => (r.transfersIn || r.transfersOut ? q(r.transfersIn - r.transfersOut) : '') },
  { key: 'used', label: 'Used', align: 'right', render: r => q(r.used) },
  { key: 'waste', label: 'Waste', align: 'right', render: r => q(r.waste) },
  { key: 'expected', label: 'Should be', align: 'right', render: r => q(r.expectedQty) },
  { key: 'closing', label: 'Counted', align: 'right', render: r => q(r.closingQty) },
  { key: 'variance', label: 'Difference', align: 'right', render: r => (r.varianceQty === null ? '—' : `${q(r.varianceQty)} · ${money(r.varianceValue)}`), sort: (a, b) => (a.varianceValue ?? 0) - (b.varianceValue ?? 0) },
  { key: 'cogs', label: 'COGS', align: 'right', render: r => (r.status === 'reconciled' ? money(r.cogs) : ''), sort: (a, b) => (a.cogs ?? 0) - (b.cogs ?? 0) },
]

export default function InventoryReportPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(choice: RangeChoice) {
    setBusy(true)
    setError('')
    try { setReport(await fetchReport<Report>('inventory', choice)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return <Loading />
  const t = report?.total
  return (
    <Page width="wide">
      <PageHeader title="Inventory"
        lead="What the stock is worth, and each supply between its last count before the period and its last count in it: received, moved between branches, used by what sold, wasted, what should be on the shelf, and the difference nothing explains. Cost of goods sold is opening + purchases ± transfers − closing." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Reading counts, deliveries and sales…" />}
      {report && t && (
        <>
          <ReportDownloads header={reportHeader('Inventory', report.from, report.to, report.branches)} sheets={[
            sheet<InventoryRow>('Supplies', [
              { label: 'Branch', value: r => r.branch }, { label: 'Supply', value: r => r.name }, { label: 'Unit', value: r => r.unit },
              { label: 'Status', value: r => r.status }, { label: 'Opening count day', value: r => r.openingDay ?? '' }, { label: 'Closing count day', value: r => r.closingDay ?? '' },
              { label: 'Opening qty', value: r => r.openingQty }, { label: 'Received', value: r => r.received }, { label: 'Transferred in', value: r => r.transfersIn },
              { label: 'Transferred out', value: r => r.transfersOut }, { label: 'Used by sales', value: r => r.used }, { label: 'Waste', value: r => r.waste },
              { label: 'Expected qty', value: r => r.expectedQty }, { label: 'Counted qty', value: r => r.closingQty }, { label: 'Difference qty', value: r => r.varianceQty },
              { label: 'Opening value USD', value: r => r.openingValue }, { label: 'Purchases USD', value: r => r.purchasesValue }, { label: 'Transfers net USD', value: r => r.transfersValue },
              { label: 'Used USD', value: r => r.usedValue }, { label: 'Waste USD', value: r => r.wasteValue }, { label: 'Closing value USD', value: r => r.closingValue },
              { label: 'Difference USD', value: r => r.varianceValue }, { label: 'COGS USD', value: r => r.cogs },
            ], report.rows),
            sheet<{ branch: string; totals: Report['total'] }>('Branches', [
              { label: 'Branch', value: b => b.branch }, { label: 'Supplies', value: b => b.totals.supplies }, { label: 'Reconciled', value: b => b.totals.reconciled },
              { label: 'Reconciled, cost unknown', value: b => b.totals.uncosted },
              { label: 'Opening USD', value: b => b.totals.openingValue }, { label: 'Purchases USD', value: b => b.totals.purchasesValue },
              { label: 'Transfers net USD', value: b => b.totals.transfersValue }, { label: 'Closing USD', value: b => b.totals.closingValue },
              { label: 'COGS USD', value: b => b.totals.cogs }, { label: 'Used by sales USD', value: b => b.totals.usedValue }, { label: 'Waste USD', value: b => b.totals.wasteValue },
              { label: 'Difference USD', value: b => b.totals.varianceValue }, { label: 'Received in period USD', value: b => b.totals.purchasesInPeriod },
              { label: 'Stock value now USD', value: b => b.totals.valueNow },
            ], [...report.byBranch, { branch: 'All', totals: report.total }]),
          ]} />
          <BranchTotals rows={report.byBranch.map(b => ({ branch: b.branch, totals: {
            valueNow: b.totals.valueNow, purchases: b.totals.purchasesInPeriod, cogs: b.totals.cogs, used: b.totals.usedValue, waste: b.totals.wasteValue, variance: b.totals.varianceValue,
          } }))} columns={[
            { key: 'valueNow', label: 'Stock value now', money: true }, { key: 'purchases', label: 'Received', money: true }, { key: 'cogs', label: 'COGS', money: true },
            { key: 'used', label: 'Used by sales', money: true }, { key: 'waste', label: 'Waste', money: true }, { key: 'variance', label: 'Difference', money: true },
          ]} />
          <Panel title={`Stock worth ${usd(t.valueNow)} now · COGS ${usd(t.cogs)} on ${t.reconciled} of ${t.supplies} supplies counted at both ends`}>
            <p style={{ fontFamily: 'var(--font-inter)', color: 'rgba(var(--offwhite-rgb),0.75)', fontSize: '0.92rem', lineHeight: 1.6 }}>
              Of that cost of goods, recipes account for {usd(t.usedValue)} of what sold and {usd(t.wasteValue)} of waste; {usd(t.varianceValue)} is the difference the counts found and nothing explains
              {t.varianceValue < 0 ? ' (less on the shelf than there should be)' : t.varianceValue > 0 ? ' (more on the shelf than there should be)' : ''}.
              Opening {usd(t.openingValue)} + purchases {usd(t.purchasesValue)} {t.transfersValue >= 0 ? '+' : '−'} transfers {usd(Math.abs(t.transfersValue))} − closing {usd(t.closingValue)}.
              {' '}Received in the period, counted or not: {usd(t.purchasesInPeriod)} before VAT.
              {t.uncosted > 0 && ` ${t.uncosted} supplies counted at both ends have a cost nobody knows, and are left out of these values.`}
              {t.valueNowUncosted > 0 && ` ${t.valueNowUncosted} supplies on hand have no cost yet and are not in the stock value.`}
              {' '}Opening counts are looked for back to {report.lookbackFrom}. The value now uses one average cost per supply across branches.
            </p>
          </Panel>
          <Panel title="By supply">
            <DataTable columns={rowColumns} rows={report.rows} rowKey={r => `${r.branch}|${r.supplyId}`}
              search={(r, s) => `${r.name} ${r.branch}`.toLowerCase().includes(s)} searchLabel="Find a supply"
              empty={<EmptyState title="Nothing was counted, received or used in this period." />} />
          </Panel>
        </>
      )}
    </Page>
  )
}
