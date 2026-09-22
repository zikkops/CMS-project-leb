'use client'

// Cash-up and drawer (UPGRADE.md T7.7): every drawer shift over a period of
// cash-up days, per currency and never netted, with its Z label, who opened and
// closed it, what it should have held, what was counted and the difference,
// and each day's End of Day count beside the shifts. Until now this was only on
// the till, one shift at a time. Rules: shared/src/cashUpReport.ts.

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import type { CashUpReport, DayLine, ShiftRow } from '@big-cms/shared/cashUpReport'
import type { Money2 } from '@big-cms/shared/drawer'
import type { FileColumn } from '@big-cms/shared/reportFile'
import { Page, PageHeader, Panel, DataTable, ErrorLine, Loading, type Column } from '../../../components/ui'
import { ReportRange, BranchTotals, fetchReport, reportError, type RangeChoice } from '../ReportRange'
import { ReportDownloads, type ReportSheet } from '../../../components/ui/ReportDownloads'
import { BarChart } from '../../../components/ui/Charts'
import { reportHeader } from '../files'

type Report = CashUpReport & { from: string; to: string; branches: string[] }

const both = (m: Money2 | null) => (m ? `$${m.usd.toFixed(2)} · ${Math.round(m.lbp).toLocaleString('en-US')} LBP` : '—')
const sheet = <T,>(name: string, columns: FileColumn<T>[], rows: readonly T[]) => ({ name, columns, rows }) as unknown as ReportSheet<never>
const money2 = <T,>(label: string, pick: (r: T) => Money2 | null): FileColumn<T>[] => [
  { label: `${label} USD`, value: r => pick(r)?.usd ?? null },
  { label: `${label} LBP`, value: r => pick(r)?.lbp ?? null },
]

const shiftColumns: Column<ShiftRow>[] = [
  { key: 'z', label: 'Z', render: s => `${s.z}${s.status === 'closed' ? '' : ' (open)'}` },
  { key: 'expected', label: 'Should hold', align: 'right', render: s => both(s.expected) },
  { key: 'counted', label: 'Counted', align: 'right', render: s => both(s.counted) },
  { key: 'diff', label: 'Difference', align: 'right', render: s => both(s.difference) },
  { key: 'who', label: 'Opened / closed by', render: s => `${s.openedBy}${s.closedBy ? ` / ${s.closedBy}` : ''}` },
]

const dayColumns: Column<DayLine>[] = [
  { key: 'day', label: 'Cash-up day', render: d => `${d.cashUpDay} · ${d.branch}` },
  { key: 'shifts', label: 'Shifts', align: 'right', render: d => String(d.shifts) },
  { key: 'expected', label: 'Shifts should hold', align: 'right', render: d => both(d.expected) },
  { key: 'counted', label: 'Shifts counted', align: 'right', render: d => both(d.counted) },
  { key: 'eod', label: 'End of Day counted', align: 'right', render: d => both(d.eodCounted) },
]

export default function CashUpReportPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(range: RangeChoice) {
    setBusy(true)
    setError('')
    try { setReport(await fetchReport<Report>('cashup', range)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return <Loading />
  return (
    <Page>
      <PageHeader title="Cash-up & Drawer"
        lead="Every drawer shift in the period, by cash-up day (before 10:00 counts as the night before): what it should have held, what was counted and the difference, in dollars and lira separately, with the End of Day count beside each day." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      {busy && !report && <Loading label="Reading the shifts…" />}
      {report && (
        <>
          <ReportDownloads header={{ ...reportHeader('Cash-up & Drawer', report.from, report.to, report.branches, 'cashUp'), currencies: ['USD', 'LBP'] }} sheets={[
            sheet<ShiftRow>('Shifts', [
              { label: 'Z', value: s => s.z }, { label: 'Branch', value: s => s.branch }, { label: 'Cash-up day', value: s => s.cashUpDay },
              { label: 'Status', value: s => s.status }, { label: 'Opened by', value: s => s.openedBy }, { label: 'Closed by', value: s => s.closedBy },
              ...money2<ShiftRow>('Float', s => s.float), ...money2<ShiftRow>('Cash in', s => s.cashIn), ...money2<ShiftRow>('Change', s => s.change),
              ...money2<ShiftRow>('Cash refunds', s => s.refunds), ...money2<ShiftRow>('Paid out', s => s.paidOuts), ...money2<ShiftRow>('Paid in', s => s.payIns),
              ...money2<ShiftRow>('To the safe', s => s.safeDrops), ...money2<ShiftRow>('Should hold', s => s.expected),
              ...money2<ShiftRow>('Counted', s => s.counted), ...money2<ShiftRow>('Difference', s => s.difference),
              ...money2<ShiftRow>('Card', s => s.card), { label: 'Card tips USD', value: s => s.cardTips }, { label: 'Note', value: s => s.note },
            ], report.shifts),
            sheet<DayLine>('Days', [
              { label: 'Cash-up day', value: d => d.cashUpDay }, { label: 'Branch', value: d => d.branch }, { label: 'Shifts', value: d => d.shifts },
              ...money2<DayLine>('Shifts should hold', d => d.expected), ...money2<DayLine>('Shifts counted', d => d.counted),
              ...money2<DayLine>('End of Day counted', d => d.eodCounted),
            ], report.days),
          ]} />
          <BranchTotals rows={report.byBranch.map(b => ({ branch: b.branch, totals: {
            shifts: b.totals.shifts, cashInUsd: b.totals.cashIn.usd, cashInLbp: b.totals.cashIn.lbp,
            diffUsd: b.totals.difference.usd, diffLbp: b.totals.difference.lbp, cardUsd: b.totals.card.usd, cardTips: b.totals.cardTips,
          } }))} columns={[
            { key: 'shifts', label: 'Shifts' }, { key: 'cashInUsd', label: 'Cash in', money: true }, { key: 'cashInLbp', label: 'Cash in LBP' },
            { key: 'diffUsd', label: 'Difference', money: true }, { key: 'diffLbp', label: 'Difference LBP' },
            { key: 'cardUsd', label: 'Card', money: true }, { key: 'cardTips', label: 'Card tips', money: true },
          ]} />
          <Panel title={`${report.total.shifts} shift${report.total.shifts === 1 ? '' : 's'}${report.total.openShifts ? `, ${report.total.openShifts} still open` : ''} · counted ${both(report.total.counted)} against ${both(report.total.expectedClosed)} · difference ${both(report.total.difference)}`}>
            <DataTable columns={shiftColumns} rows={report.shifts} rowKey={s => s.id} empty="No drawer shifts in this period." />
          </Panel>
          {/* Diverging, because the direction is the point: over and short
              are different problems, not one bigger number. */}
          <BarChart title="Cash difference by branch, US dollars" unit="usd" diverging
            note="Counted less what the drawer should hold. Over is not better than short — both mean the count and the till disagree."
            points={report.byBranch.map(b => ({ label: b.branch, value: b.totals.difference.usd }))} />
          <Panel title="By cash-up day">
            <DataTable columns={dayColumns} rows={report.days} rowKey={d => `${d.branch}|${d.cashUpDay}`} empty="Nothing counted in this period." />
          </Panel>
        </>
      )}
    </Page>
  )
}
