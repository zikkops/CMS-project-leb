'use client'

// The accountant's journal (UPGRADE.md T7.15): double-entry lines per café day
// and branch, a sales journal and a refunds journal (a reversing entry on the
// day the money went back), mapped to the account codes in Settings → Account
// Codes. The download is a PLAIN CSV (owner's decision): no header block, one
// line per account per journal, so it imports as it is. Every journal must
// balance, and this page says so before anyone downloads it.
// Rules: shared/src/journal.ts.

import { useState } from 'react'
import { faFileCsv } from '@fortawesome/free-solid-svg-icons'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { JOURNAL_COLUMNS, type Journal, type JournalExport, type JournalLine } from '@big-cms/shared/journal'
import { csvField } from '@big-cms/shared/reportFile'
import type { CutShort } from '@big-cms/shared/salesExport'
import { Page, PageHeader, Panel, Button, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, fetchReport, reportError, usd, type RangeChoice } from '../ReportRange'

type Report = JournalExport & { from: string; to: string; branches: string[]; cutShort?: CutShort | null }

const lbp = (n: number) => (n ? Math.round(n).toLocaleString('en-US') : '')
const money = (n: number) => (n ? usd(n) : '')

const lineColumns: Column<JournalLine>[] = [
  { key: 'journal', label: 'Journal', render: l => `${l.journal}` },
  { key: 'account', label: 'Account', render: l => `${l.code} ${l.account}` },
  { key: 'dUsd', label: 'Debit', align: 'right', render: l => money(l.debitUsd) },
  { key: 'cUsd', label: 'Credit', align: 'right', render: l => money(l.creditUsd) },
  { key: 'dLbp', label: 'Debit LBP', align: 'right', render: l => lbp(l.debitLbp) },
  { key: 'cLbp', label: 'Credit LBP', align: 'right', render: l => lbp(l.creditLbp) },
]

const journalColumns: Column<Journal>[] = [
  { key: 'journal', label: 'Journal', render: j => `${j.journal} · ${j.kind === 'sales' ? 'sales' : 'refunds'}, ${j.checks} check${j.checks === 1 ? '' : 's'}` },
  { key: 'usd', label: 'Debits = credits', align: 'right', render: j => `${usd(j.debitUsd)}${j.debitUsd === j.creditUsd ? '' : ` ≠ ${usd(j.creditUsd)}`}` },
  { key: 'lbp', label: 'LBP', align: 'right', render: j => `${lbp(j.debitLbp)}${j.debitLbp === j.creditLbp ? '' : ` ≠ ${lbp(j.creditLbp)}`}` },
  { key: 'ok', label: '', render: j => (j.balanced ? 'Balances' : 'DOES NOT BALANCE') },
]

/** The plain CSV: one heading row, then the lines, CRLF, formulas defused. */
function journalCsv(lines: readonly JournalLine[]): string {
  return [JOURNAL_COLUMNS.map(([, label]) => csvField(label)).join(','), ...lines.map(l => JOURNAL_COLUMNS.map(([k]) => csvField(l[k])).join(','))].join('\r\n') + '\r\n'
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function JournalPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(choice: RangeChoice) {
    setBusy(true)
    setError('')
    try { setReport(await fetchReport<Report>('journal', choice)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return <Loading />
  const unbalanced = report ? report.journals.filter(j => !j.balanced) : []
  return (
    <Page width="wide">
      <PageHeader title="Journal"
        lead="Double-entry journal lines for the accountant: one sales journal per day and branch, and one for the refunds given that day, posted to the codes in Settings → Account Codes. The download is a plain CSV that imports as it is." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Posting the checks…" />}
      {report && (
        <>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <Button tone="primary" icon={faFileCsv} disabled={report.lines.length === 0}
              onClick={() => download(`journal-${report.from}-to-${report.to}.csv`, journalCsv(report.lines))}>
              Download journal CSV
            </Button>
          </div>
          <Panel title={report.balanced ? `${report.journals.length} journal${report.journals.length === 1 ? '' : 's'}, every one balances` : `${unbalanced.length} journal${unbalanced.length === 1 ? ' does' : 's do'} not balance`}>
            <p style={{ fontFamily: 'var(--font-inter)', color: 'rgba(var(--offwhite-rgb),0.75)', fontSize: '0.92rem', marginBottom: '0.75rem' }}>
              Cash is what the drawer kept, net of change, per currency; card includes its tips, which are owed to staff.
              Sales are each line&apos;s price before discount and without VAT, by category; discounts post against them.
              A check closed without payments posts to &ldquo;Till receipts not itemised&rdquo;. Lira are at each check&apos;s own rate.
            </p>
            <DataTable columns={journalColumns} rows={report.journals} rowKey={j => j.journal} empty={<EmptyState title="Nothing closed or refunded in this period." />} />
          </Panel>
          <Panel title="Lines">
            <DataTable columns={lineColumns} rows={report.lines} rowKey={l => `${l.journal}|${l.code}|${l.account}`}
              search={(l, q) => `${l.journal} ${l.code} ${l.account}`.toLowerCase().includes(q)} searchLabel="Find a line"
              empty={<EmptyState title="No lines." />} />
          </Panel>
        </>
      )}
    </Page>
  )
}
