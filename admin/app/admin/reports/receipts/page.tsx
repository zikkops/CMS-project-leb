'use client'

// Receipt sequence (UPGRADE.md T7.10): every receipt number issued in a
// period, in order, with the gaps, the duplicates (which must be none) and the
// numbers issued with nothing to show for them. The audit trail that proves no
// sale went missing. One counter numbers every branch, so the sequence is
// judged whole; another branch's numbers are counted, not shown.
// Rules: shared/src/receiptSequence.ts.

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import {
  SEQUENCE_STATUS_LABELS, type ReceiptSequenceReport, type SequenceGap, type SequenceRow, type SequenceYear,
} from '@big-cms/shared/receiptSequence'
import type { CutShort } from '@big-cms/shared/salesExport'
import type { FileColumn } from '@big-cms/shared/reportFile'
import { Page, PageHeader, Panel, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, fetchReport, reportError, type RangeChoice } from '../ReportRange'
import { ReportDownloads, type ReportSheet } from '../../../components/ui/ReportDownloads'
import { reportHeader } from '../files'

type Report = ReceiptSequenceReport & { from: string; to: string; branches: string[]; cutShort?: CutShort | null }

const sheet = <T,>(name: string, columns: FileColumn<T>[], rows: readonly T[]) => ({ name, columns, rows }) as unknown as ReportSheet<never>
const range = (g: SequenceGap) => (g.from === g.to ? String(g.from) : `${g.from}–${g.to}`)

const yearColumns: Column<SequenceYear>[] = [
  { key: 'year', label: 'Year', render: y => `${y.year} · ${y.first}–${y.last}` },
  { key: 'used', label: 'On checks and sales', align: 'right', render: y => String(y.used) },
  { key: 'elsewhere', label: 'Other branches', align: 'right', render: y => String(y.usedElsewhere) },
  { key: 'wholesale', label: 'Wholesale', align: 'right', render: y => String(y.wholesale) },
  { key: 'noRecord', label: 'Issued, no record', align: 'right', render: y => String(y.noRecord) },
  { key: 'hub', label: 'Skipped in hub blocks', align: 'right', render: y => String(y.inHubBlocks) },
  { key: 'beforeLog', label: 'Before the log', align: 'right', render: y => String(y.beforeLog) },
  { key: 'missing', label: 'Missing', align: 'right', render: y => String(y.missing) },
  { key: 'dup', label: 'Duplicates', align: 'right', render: y => String(y.duplicates) },
]

const gapColumns: Column<SequenceGap>[] = [
  { key: 'range', label: 'Numbers', render: g => `${g.year} · ${range(g)}` },
  { key: 'count', label: 'How many', align: 'right', render: g => String(g.count) },
  { key: 'status', label: 'What it is', render: g => SEQUENCE_STATUS_LABELS[g.status] },
  { key: 'note', label: 'Note', render: g => g.note },
]

const noRecordColumns: Column<SequenceRow>[] = [
  { key: 'number', label: 'Number', render: r => r.number },
  { key: 'day', label: 'Issued', render: r => r.day },
  { key: 'note', label: 'For', render: r => r.note.replace(/^issued for /, '') },
]

export default function ReceiptSequencePage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(choice: RangeChoice) {
    setBusy(true)
    setError('')
    try { setReport(await fetchReport<Report>('receipts', choice)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return <Loading />
  const missing = report ? report.years.reduce((n, y) => n + y.missing, 0) : 0
  const noRecord = report ? report.rows.filter(r => r.status === 'issued, no record') : []
  return (
    <Page width="wide">
      <PageHeader title="Receipt Sequence"
        lead="Every receipt and invoice number issued in the period, in order. Duplicates must be none. A number burnt on a close that failed is listed, never hidden. Numbers a café hub reserved and never used are expected, and named with their block." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Reading every number…" />}
      {report && (
        <>
          <ReportDownloads header={reportHeader('Receipt Sequence', report.from, report.to, report.branches)} sheets={[
            sheet<SequenceRow>('Sequence', [
              { label: 'Year', value: r => r.year }, { label: 'Sequence', value: r => r.sequence }, { label: 'Number', value: r => r.number },
              { label: 'What it is', value: r => SEQUENCE_STATUS_LABELS[r.status] }, { label: 'Kind', value: r => r.kind },
              { label: 'Branch', value: r => r.branch }, { label: 'Day', value: r => r.day }, { label: 'Record id', value: r => r.id }, { label: 'Note', value: r => r.note },
            ], report.rows),
            sheet<SequenceGap>('Gaps', [
              { label: 'Year', value: g => g.year }, { label: 'From', value: g => g.from }, { label: 'To', value: g => g.to }, { label: 'How many', value: g => g.count },
              { label: 'What it is', value: g => SEQUENCE_STATUS_LABELS[g.status] }, { label: 'Note', value: g => g.note },
            ], report.gaps),
            sheet<Report['duplicates'][number]>('Duplicates', [
              { label: 'Year', value: d => d.year }, { label: 'Sequence', value: d => d.sequence },
              { label: 'Carried by', value: d => d.uses.map(u => `${u.kind} ${u.id} at ${u.branch || '—'} on ${u.day} (${u.number})`).join('; ') },
            ], report.duplicates),
            sheet<SequenceYear>('Years', [
              { label: 'Year', value: y => y.year }, { label: 'First', value: y => y.first }, { label: 'Last', value: y => y.last },
              { label: 'On checks and sales', value: y => y.used }, { label: 'Other branches', value: y => y.usedElsewhere }, { label: 'Wholesale', value: y => y.wholesale },
              { label: 'Issued, no record', value: y => y.noRecord }, { label: 'Skipped in hub blocks', value: y => y.inHubBlocks },
              { label: 'Before the log', value: y => y.beforeLog }, { label: 'Missing', value: y => y.missing }, { label: 'Duplicates', value: y => y.duplicates },
            ], report.years),
          ]} />
          <Panel title={report.duplicates.length === 0 && missing === 0 ? 'No duplicates and nothing missing' : `${report.duplicates.length} duplicate${report.duplicates.length === 1 ? '' : 's'} · ${missing} missing`}>
            <p style={{ fontFamily: 'var(--font-inter)', color: 'rgba(var(--offwhite-rgb),0.75)', fontSize: '0.92rem', marginBottom: '0.75rem' }}>
              Every number issued is written down with it from 21 Sep 2026. A number never seen that is older than the first one written down reads
              &ldquo;before the log&rdquo;: nothing can say whether it was issued. {report.rowsCutAt ? `The full list stops at ${report.rowsCutAt.toLocaleString('en-US')} numbers a year; the counts do not.` : ''}
              {report.unreadable.length > 0 ? ` ${report.unreadable.length} number${report.unreadable.length === 1 ? ' is' : 's are'} not in the receipt format and sit in no sequence.` : ''}
            </p>
            <DataTable columns={yearColumns} rows={report.years} rowKey={y => String(y.year)} empty={<EmptyState title="No numbers were issued in this period." />} />
          </Panel>
          {report.duplicates.length > 0 && (
            <Panel title="Duplicates: one number on more than one record">
              <DataTable
                columns={[
                  { key: 'seq', label: 'Number', render: d => `${d.year} · ${d.sequence}` },
                  { key: 'uses', label: 'Carried by', render: d => d.uses.map(u => `${u.kind} at ${u.branch || '—'} on ${u.day}`).join(' · ') },
                ]}
                rows={report.duplicates} rowKey={d => `${d.year}:${d.sequence}`} empty={null} />
            </Panel>
          )}
          <Panel title="Gaps">
            <DataTable columns={gapColumns} rows={report.gaps} rowKey={g => `${g.year}:${g.from}`} empty={<EmptyState title="No gaps in this period." />} />
          </Panel>
          <Panel title="Issued with nothing to show for it">
            <DataTable columns={noRecordColumns} rows={noRecord} rowKey={r => `${r.year}:${r.sequence}`} empty={<EmptyState title="Every number issued is on a check, a sale or an invoice." />} />
          </Panel>
        </>
      )}
    </Page>
  )
}
