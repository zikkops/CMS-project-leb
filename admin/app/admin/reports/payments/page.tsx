'use client'

// Payments and tenders (UPGRADE.md T7.5): cash in each currency as handed
// over, change and kept; card in each currency; card tips apart; refunds by
// tender on the day they were given; and whether what was applied to the bills
// matches what those bills came to. Currencies are never converted into each
// other. Definitions: shared/src/tenderSummary.ts.

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { TENDER_FIGURE_ROWS, tendersReconcile, type TenderSummary } from '@big-cms/shared/tenderSummary'
import type { CutShort } from '@big-cms/shared/salesExport'
import { Page, PageHeader, Panel, EmptyState, ErrorLine, Loading, CutShortNote } from '../../../components/ui'
import { ReportRange, fetchReport, reportError, usd, type RangeChoice } from '../ReportRange'
import { ReportDownloads } from '../../../components/ui/ReportDownloads'
import { BarChart } from '../../../components/ui/Charts'
import { FiguresTable, figuresSheet } from '../FiguresTable'
import { reportHeader } from '../files'

type Report = TenderSummary & { from: string; to: string; branches: string[]; paidChecks: number; cutShort?: CutShort | null }

export default function PaymentsReportPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(range: RangeChoice) {
    setBusy(true)
    setError('')
    try { setReport(await fetchReport<Report>('payments', range)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return <Loading />
  const t = report?.total
  const agrees = t ? tendersReconcile(t, report.paidChecks) : true
  return (
    <Page>
      <PageHeader title="Payments & Tenders"
        lead="How the period was paid: cash in each currency as handed over, as change and as kept; card in each currency; card tips apart; and refunds by tender on the day they were given. Dollars and lira are never converted into each other." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Reading the payments…" />}
      {report && t && (
        <>
          <ReportDownloads header={{ ...reportHeader('Payments & Tenders', report.from, report.to, report.branches), currencies: ['USD', 'LBP'] }}
            sheets={[figuresSheet('Tenders', TENDER_FIGURE_ROWS, report.byBranch, report.total)]} />
          <Panel title={report.from === report.to ? report.from : `${report.from} to ${report.to}`}>
            {t.payments === 0 && t.refundCashUsd === 0 && t.refundCardUsd === 0 && t.checksWithoutPayment === 0
              ? <EmptyState title="No payments in this period." />
              : <FiguresTable defs={TENDER_FIGURE_ROWS} byBranch={report.byBranch} total={report.total} />}
          </Panel>
          {/* Dollars only: lira on the same scale would be a bar a million
              times the others, and the two are not one quantity anyway. */}
          <BarChart title="How the money came in, US dollars" unit="usd"
            note="Cash kept is what stayed in the drawer, after change. Lira cash is in the table above, on its own scale."
            points={[
              { label: 'Cash kept', value: t.cashUsdKept },
              { label: 'Card', value: t.cardUsd },
              { label: 'Change given', value: t.changeUsd },
            ]} />
          <p role={agrees ? undefined : 'alert'} style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', lineHeight: 1.6, color: agrees ? 'rgba(var(--offwhite-rgb),0.7)' : 'var(--red)' }}>
            {agrees
              ? `Applied to bills (${usd(t.appliedUsd)}) matches what the paid checks billed (${usd(t.billedPaid)}) within the lira rounding.`
              : `Applied to bills (${usd(t.appliedUsd)}) does not match what the paid checks billed (${usd(t.billedPaid)}). A payment or a check needs looking at before this goes to the accountant.`}
          </p>
        </>
      )}
    </Page>
  )
}
