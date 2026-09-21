'use client'

// Labour (UPGRADE.md T7.11): hours per person and in total, labour cost at
// each person's rate as it stood on the day worked (Staff Pay, T7.18), tips
// from the same split the tips page makes, what payroll owes, and labour as a
// share of net sales per branch and day. Admin only: it shows pay.
// Rules: shared/src/labourReport.ts.

import { useState } from 'react'
import { useRequireRole, type Role } from '@big-cms/shared/adminAuth'
import type { LabourDay, LabourPerson, LabourReport, LabourShift } from '@big-cms/shared/labourReport'
import type { CutShort } from '@big-cms/shared/salesExport'
import type { FileColumn } from '@big-cms/shared/reportFile'
import { BRAND } from '@big-cms/shared/brand'
import { Page, PageHeader, Panel, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, BranchTotals, fetchReport, reportError, usd, type RangeChoice } from '../ReportRange'
import { ReportDownloads, type ReportSheet } from '../../../components/ui/ReportDownloads'
import { reportHeader } from '../files'

type Report = LabourReport & { from: string; to: string; branches: string[]; cutShort?: CutShort | null }

const sheet = <T,>(name: string, columns: FileColumn<T>[], rows: readonly T[]) => ({ name, columns, rows }) as unknown as ReportSheet<never>
const hours = (minutes: number) => (minutes / 60).toFixed(2)
const lbp = (n: number) => `${Math.round(n).toLocaleString('en-US')} LBP`
const both = (u: number, l: number) => (l ? `${usd(u)} · ${lbp(l)}` : usd(u))
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
const at = (ms: number | null) => (ms === null ? '' : new Date(ms).toLocaleString('en-GB', { timeZone: BRAND.locale.timezone }))

const peopleColumns: Column<LabourPerson>[] = [
  { key: 'name', label: 'Person', render: p => p.name, sort: (a, b) => a.name.localeCompare(b.name) },
  { key: 'hours', label: 'Hours', align: 'right', render: p => `${hours(p.minutes)}${p.openShifts ? ` (+${p.openShifts} open)` : ''}`, sort: (a, b) => a.minutes - b.minutes },
  { key: 'unpriced', label: 'Not priced', align: 'right', render: p => (p.unpricedMinutes ? `${hours(p.unpricedMinutes)} h` : ''), sort: (a, b) => a.unpricedMinutes - b.unpricedMinutes },
  { key: 'cost', label: 'Pay', align: 'right', render: p => both(p.costUsd, p.costLbp), sort: (a, b) => a.costUsd - b.costUsd },
  { key: 'tips', label: 'Tips', align: 'right', render: p => usd(p.tipsUsd), sort: (a, b) => a.tipsUsd - b.tipsUsd },
  { key: 'owed', label: 'Owed', align: 'right', render: p => both(p.owedUsd, p.owedLbp), sort: (a, b) => a.owedUsd - b.owedUsd },
]

const dayColumns: Column<LabourDay>[] = [
  { key: 'day', label: 'Day', render: d => `${d.day} · ${d.branch}`, sort: (a, b) => `${a.day}${a.branch}`.localeCompare(`${b.day}${b.branch}`) },
  { key: 'hours', label: 'Hours', align: 'right', render: d => hours(d.minutes), sort: (a, b) => a.minutes - b.minutes },
  { key: 'cost', label: 'Labour cost', align: 'right', render: d => both(d.costUsd, d.costLbp), sort: (a, b) => a.costUsd - b.costUsd },
  { key: 'sales', label: 'Net sales', align: 'right', render: d => usd(d.netSales), sort: (a, b) => a.netSales - b.netSales },
  { key: 'pct', label: 'Labour %', align: 'right', render: d => pct(d.labourPercent), sort: (a, b) => (a.labourPercent ?? -1) - (b.labourPercent ?? -1) },
]

const flaggedColumns: Column<LabourShift>[] = [
  { key: 'name', label: 'Person', render: s => s.name },
  { key: 'in', label: 'Clocked in', render: s => `${at(s.inAt)} · ${s.branch}` },
  { key: 'why', label: 'Why', render: s => (s.outAt === null ? 'No clock-out yet' : 'Longer than 16 hours') },
]

export default function LabourReportPage() {
  const { checking } = useRequireRole(['admin'] as Role[])
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(choice: RangeChoice) {
    setBusy(true)
    setError('')
    try { setReport(await fetchReport<Report>('labour', choice)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return <Loading />
  const flagged = report ? report.shifts.filter(s => s.flagged) : []
  return (
    <Page width="wide">
      <PageHeader title="Labour"
        lead="Hours from the staff app's clock-ins, pay at each person's rate as it stood on the day worked, tips from the tips split, and what payroll owes each person. Labour as a share of net sales, per branch and day." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Reading the clock-ins…" />}
      {report && (
        <>
          <ReportDownloads header={{ ...reportHeader('Labour', report.from, report.to, report.branches), currencies: ['USD', 'LBP'] }} sheets={[
            sheet<LabourPerson>('Payroll', [
              { label: 'Person', value: p => p.name }, { label: 'Account id', value: p => p.uid }, { label: 'Shifts', value: p => p.shifts },
              { label: 'Open or too long', value: p => p.openShifts }, { label: 'Hours', value: p => Number(hours(p.minutes)) },
              { label: 'Hours not priced', value: p => Number(hours(p.unpricedMinutes)) },
              { label: 'Pay USD', value: p => p.costUsd }, { label: 'Pay LBP', value: p => p.costLbp }, { label: 'Tips USD', value: p => p.tipsUsd },
              { label: 'Owed USD', value: p => p.owedUsd }, { label: 'Owed LBP', value: p => p.owedLbp },
            ], report.people),
            sheet<LabourDay>('Days', [
              { label: 'Day', value: d => d.day }, { label: 'Branch', value: d => d.branch }, { label: 'Hours', value: d => Number(hours(d.minutes)) },
              { label: 'Hours not priced', value: d => Number(hours(d.unpricedMinutes)) },
              { label: 'Labour cost USD', value: d => d.costUsd }, { label: 'Labour cost LBP', value: d => d.costLbp },
              { label: 'Net sales USD (excl. VAT and service)', value: d => d.netSales },
              { label: 'Labour %', value: d => (d.labourPercent === null ? null : Math.round(d.labourPercent * 10000) / 100) },
            ], report.days),
            sheet<LabourShift>('Shifts', [
              { label: 'Day', value: s => s.day }, { label: 'Branch', value: s => s.branch }, { label: 'Person', value: s => s.name },
              { label: 'In', value: s => at(s.inAt) }, { label: 'Out', value: s => at(s.outAt) },
              { label: 'Minutes', value: s => (s.flagged ? null : s.minutes) }, { label: 'Flagged', value: s => (s.flagged ? 'yes' : '') },
              { label: 'Rate', value: s => s.rate }, { label: 'Currency', value: s => s.currency ?? '' },
              { label: 'Cost USD', value: s => s.costUsd }, { label: 'Cost LBP', value: s => s.costLbp },
            ], report.shifts),
            sheet<Report['unmatchedTips'][number]>('Tips not matched', [
              { label: 'Branch', value: t => t.branch }, { label: 'Name on End of Day', value: t => t.name }, { label: 'Tips USD', value: t => t.tipsUsd },
            ], report.unmatchedTips),
          ]} />
          <BranchTotals rows={report.byBranch.map(b => ({ branch: b.branch, totals: {
            hours: Number(hours(b.totals.minutes)), costUsd: b.totals.costUsd, costLbp: b.totals.costLbp, tipsUsd: b.totals.tipsUsd, netSales: b.totals.netSales,
          } }))} columns={[
            { key: 'hours', label: 'Hours' }, { key: 'costUsd', label: 'Pay', money: true }, { key: 'costLbp', label: 'Pay LBP' },
            { key: 'tipsUsd', label: 'Tips', money: true }, { key: 'netSales', label: 'Net sales', money: true },
          ]} />
          <Panel title={`${hours(report.total.minutes)} hours · pay ${both(report.total.costUsd, report.total.costLbp)} · tips ${usd(report.total.tipsUsd)} · labour ${pct(report.total.labourPercent)} of ${usd(report.total.netSales)} net sales`}>
            <p style={{ fontFamily: 'var(--font-inter)', color: 'rgba(var(--offwhite-rgb),0.75)', fontSize: '0.92rem', marginBottom: '0.75rem' }}>
              {report.total.unpricedMinutes > 0 && `${hours(report.total.unpricedMinutes)} hours were worked by people with no rate set on that day, so they are not in the pay figures. Set rates on Staff Pay. `}
              {report.total.costLbp > 0 && `Labour % counts pay in lira at ${report.lbpRate.toLocaleString('en-US')} LBP to the dollar. `}
              Tips are after each day&apos;s deduction; hours on shifts still open or longer than 16 hours are left out until they are corrected.
            </p>
            <DataTable columns={peopleColumns} rows={report.people} rowKey={p => p.uid} empty={<EmptyState title="Nobody clocked in or shared tips in this period." />} />
          </Panel>
          {flagged.length > 0 && (
            <Panel title={`${flagged.length} shift${flagged.length === 1 ? '' : 's'} with no clock-out, or too long to trust`}>
              <DataTable columns={flaggedColumns} rows={flagged} rowKey={s => `${s.uid}:${s.inAt}`} empty={null} />
            </Panel>
          )}
          {report.unsharedTips.length > 0 && (
            <Panel title="Tips with nobody to share them">
              <p style={{ fontFamily: 'var(--font-inter)', color: 'var(--offwhite)', fontSize: '0.92rem' }}>
                {report.unsharedTips.map(t => `${usd(t.tipsUsd)} at ${t.branch}`).join(' · ')}: the End of Day reports in this period list nobody with a shift, so the split has no one to pay. Fix the attendance on those days.
              </p>
            </Panel>
          )}
          {report.unmatchedTips.length > 0 && (
            <Panel title="Tips for names that match no staff account">
              <DataTable
                columns={[
                  { key: 'name', label: 'Name on End of Day', render: t => `${t.name} · ${t.branch}` },
                  { key: 'tips', label: 'Tips', align: 'right', render: t => usd(t.tipsUsd) },
                ]}
                rows={report.unmatchedTips} rowKey={t => `${t.branch}:${t.name}`} empty={null} />
            </Panel>
          )}
          <Panel title="By day">
            <DataTable columns={dayColumns} rows={report.days} rowKey={d => `${d.branch}|${d.day}`} empty={<EmptyState title="Nothing in this period." />} />
          </Panel>
        </>
      )}
    </Page>
  )
}
