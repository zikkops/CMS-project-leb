'use client'

// Reconciliation (UPGRADE.md T7.16): every report over one period, and each
// pair that must agree, compared to the cent: the export's days and the sales
// summary, the product mix, the VAT report, payments and bills, the drawers
// and the payments taken into them, and the journal's debits and credits. It
// sits first in the reports so a mismatch is seen before the accountant sees
// it. Rules: shared/src/reconcile.ts; the same check runs in CI
// (verify:reconcile) over a generated history.

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import type { ReconcileLine } from '@big-cms/shared/reconcile'
import type { CutShort } from '@big-cms/shared/salesExport'
import { Page, PageHeader, Panel, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, fetchReport, reportError, usd, type RangeChoice } from '../ReportRange'

interface Report { from: string; to: string; branches: string[]; cutShort?: CutShort | null; lines: ReconcileLine[]; agrees: boolean }

const amount = (l: ReconcileLine, n: number) => (l.unit === 'LBP' ? `${Math.round(n).toLocaleString('en-US')} LBP` : usd(n))

const columns: Column<ReconcileLine>[] = [
  { key: 'label', label: 'Must agree', render: l => l.label },
  { key: 'left', label: '', align: 'right', render: l => `${l.leftLabel}: ${amount(l, l.left)}` },
  { key: 'right', label: '', align: 'right', render: l => `${l.rightLabel}: ${amount(l, l.right)}` },
  { key: 'diff', label: 'Difference', align: 'right', render: l => (l.difference === 0 ? '—' : amount(l, l.difference)) },
  { key: 'ok', label: '', render: l => (l.ok ? (l.difference === 0 ? 'Agrees' : `Within ${amount(l, l.tolerance)} of rounding`) : 'DOES NOT AGREE') },
]

export default function ReconcilePage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(choice: RangeChoice) {
    setBusy(true)
    setError('')
    try { setReport(await fetchReport<Report>('reconcile', choice)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return <Loading />
  const bad = report ? report.lines.filter(l => !l.ok) : []
  return (
    <Page width="wide">
      <PageHeader title="Reconciliation"
        lead="Run a period through every report and see that they agree before the accountant does: the export's days and the sales summary, the product mix, the VAT report, payments and bills, the drawers and the payments taken into them, and the journal. Any difference is shown to the cent, never rounded away." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Running every report…" />}
      {report && (
        <Panel title={report.agrees ? `Everything agrees, ${report.from === report.to ? report.from : `${report.from} to ${report.to}`}` : `${bad.length} thing${bad.length === 1 ? ' does' : 's do'} not agree`}>
          <p style={{ fontFamily: 'var(--font-inter)', color: 'rgba(var(--offwhite-rgb),0.75)', fontSize: '0.92rem', marginBottom: '0.75rem' }}>
            Only payments against bills may differ, by up to 5 cents a check: a bill paid in lira settles to the nearest 1,000 LBP.
            The drawers compare closed shifts of the period&apos;s cash-up days with the payments taken into them.
          </p>
          <DataTable columns={columns} rows={report.lines} rowKey={l => l.key} empty={<EmptyState title="Nothing to compare." />} />
        </Panel>
      )}
    </Page>
  )
}
