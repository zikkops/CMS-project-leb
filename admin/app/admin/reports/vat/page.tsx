'use client'

// The VAT report, for the VAT return (UPGRADE.md T7.6): output VAT by rate
// (with the service charge's share apart), VAT reversed on refunds in the
// period they were given, input VAT from received deliveries, and the net
// position. Rules: shared/src/vatReport.ts.

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { rateLabel, type InputVatLine, type RefundVatLine, type VatLine, type VatReport } from '@big-cms/shared/vatReport'
import type { CutShort } from '@big-cms/shared/salesExport'
import type { FileColumn } from '@big-cms/shared/reportFile'
import { Page, PageHeader, Panel, DataTable, ErrorLine, Loading, CutShortNote } from '../../../components/ui'
import { ReportRange, BranchTotals, fetchReport, reportError, usd, type RangeChoice } from '../ReportRange'
import { ReportDownloads, type ReportSheet } from '../../../components/ui/ReportDownloads'
import { reportHeader } from '../files'

type Report = VatReport & { from: string; to: string; branches: string[]; cutShort?: CutShort | null }

const sheet = <T,>(name: string, columns: FileColumn<T>[], rows: readonly T[]) => ({ name, columns, rows }) as unknown as ReportSheet<never>

export default function VatReportPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(range: RangeChoice) {
    setBusy(true)
    setError('')
    try { setReport(await fetchReport<Report>('vat', range)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return <Loading />
  const t = report?.total
  return (
    <Page>
      <PageHeader title="VAT"
        lead="For the VAT return: output VAT at each rate the checks closed at (a mid-quarter change shows as two lines), the service charge's share apart, VAT reversed on refunds in the period they were given, input VAT from received deliveries, and what that leaves owed." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Reading checks and deliveries…" />}
      {report && t && (
        <>
          <ReportDownloads header={reportHeader('VAT', report.from, report.to, report.branches)} sheets={[
            sheet<{ branch: string; o: number; r: number; i: number; n: number }>('Position', [
              { label: 'Branch', value: x => x.branch }, { label: 'Output VAT USD', value: x => x.o }, { label: 'Reversed on refunds USD', value: x => x.r },
              { label: 'Input VAT USD', value: x => x.i }, { label: 'Net VAT USD', value: x => x.n },
            ], [...report.byBranch.map(b => ({ branch: b.branch, o: b.figures.outputVat, r: b.figures.refundVat, i: b.figures.inputVat, n: b.figures.netVat })),
              { branch: 'All', o: t.outputVat, r: t.refundVat, i: t.inputVat, n: t.netVat }]),
            sheet<VatLine>('Output', [
              { label: 'Rate', value: l => rateLabel(l.rate) }, { label: 'Checks', value: l => l.checks },
              { label: 'Net sales USD (excl. VAT)', value: l => l.netSales }, { label: 'VAT on sales USD', value: l => l.goodsVat },
              { label: 'Service net USD', value: l => l.serviceNet }, { label: 'VAT on service USD', value: l => l.serviceVat },
              { label: 'Billed with no VAT recorded USD', value: l => l.billedWithoutVat },
            ], t.output),
            sheet<RefundVatLine>('Refunds', [
              { label: 'Rate', value: l => rateLabel(l.rate) }, { label: 'Refunds', value: l => l.refunds },
              { label: 'Net refunded USD (excl. VAT)', value: l => l.netSales }, { label: 'VAT reversed USD', value: l => l.vat },
            ], t.refunds),
            sheet<InputVatLine>('Input', [
              { label: 'Rate', value: l => rateLabel(l.rate) }, { label: 'Deliveries', value: l => l.deliveries },
              { label: 'Taxable USD', value: l => l.taxableUsd }, { label: 'Input VAT USD', value: l => l.vatUsd },
            ], t.input),
          ]} />
          <BranchTotals rows={report.byBranch.map(b => ({ branch: b.branch, totals: { outputVat: b.figures.outputVat, refundVat: b.figures.refundVat, inputVat: b.figures.inputVat, netVat: b.figures.netVat } }))}
            columns={[{ key: 'outputVat', label: 'Output VAT', money: true }, { key: 'refundVat', label: 'Reversed', money: true }, { key: 'inputVat', label: 'Input VAT', money: true }, { key: 'netVat', label: 'Net VAT', money: true }]} />
          <Panel title={`Net VAT ${usd(t.netVat)} = output ${usd(t.outputVat)} − reversed on refunds ${usd(t.refundVat)} − input ${usd(t.inputVat)}`}>
            <DataTable
              columns={[
                { key: 'rate', label: 'Output, by rate', render: (l: VatLine) => rateLabel(l.rate) },
                { key: 'checks', label: 'Checks', align: 'right', render: l => String(l.checks) },
                { key: 'net', label: 'Net sales', align: 'right', render: l => usd(l.netSales) },
                { key: 'vat', label: 'VAT on sales', align: 'right', render: l => usd(l.goodsVat) },
                { key: 'svc', label: 'Service net', align: 'right', render: l => usd(l.serviceNet) },
                { key: 'svat', label: 'VAT on service', align: 'right', render: l => usd(l.serviceVat) },
                { key: 'none', label: 'Billed, no VAT recorded', align: 'right', render: l => (l.rate === null ? usd(l.billedWithoutVat) : '') },
              ]}
              rows={t.output} rowKey={l => rateLabel(l.rate)} empty="No sales in this period." />
          </Panel>
          {t.refunds.length > 0 && (
            <Panel title="Reversed on refunds">
              <DataTable
                columns={[
                  { key: 'rate', label: 'Rate', render: (l: RefundVatLine) => rateLabel(l.rate) },
                  { key: 'n', label: 'Refunds', align: 'right', render: l => String(l.refunds) },
                  { key: 'net', label: 'Net refunded', align: 'right', render: l => usd(l.netSales) },
                  { key: 'vat', label: 'VAT reversed', align: 'right', render: l => usd(l.vat) },
                ]}
                rows={t.refunds} rowKey={l => rateLabel(l.rate)} empty="" />
            </Panel>
          )}
          <Panel title="Input VAT, received deliveries">
            <DataTable
              columns={[
                { key: 'rate', label: 'Rate', render: (l: InputVatLine) => rateLabel(l.rate) },
                { key: 'n', label: 'Deliveries', align: 'right', render: l => String(l.deliveries) },
                { key: 'tax', label: 'Taxable', align: 'right', render: l => usd(l.taxableUsd) },
                { key: 'vat', label: 'Input VAT', align: 'right', render: l => usd(l.vatUsd) },
              ]}
              rows={t.input} rowKey={l => rateLabel(l.rate)} empty="No received deliveries in this period." />
          </Panel>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.55)', lineHeight: 1.6 }}>
            {t.checksWithoutVatRate > 0 ? `${t.checksWithoutVatRate} check${t.checksWithoutVatRate === 1 ? '' : 's'} closed before VAT rates were recorded: they carry no VAT here, never a guess. ` : ''}
            The service charge is treated as subject to VAT (the default; confirm with the accountant). A delivery invoiced in lira is converted at its own exchange rate.
          </p>
        </>
      )}
    </Page>
  )
}
