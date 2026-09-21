'use client'

// The timesheet (UPGRADE.md T3.12): who clocked in and out with the staff app
// at a café hub, as shifts, and each person's hours over the days chosen.
// Pay and labour cost come later, once the owner has said who may see pay
// rates. The pairing is shared/src/timeClock.ts (verify:reports).

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRAND } from '@big-cms/shared/brand'
import type { PersonHours, Shift, Timesheet } from '@big-cms/shared/timeClock'
import type { CutShort } from '@big-cms/shared/salesExport'
import { Page, PageHeader, Panel, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, BranchTotals, fetchReport, reportError, type RangeChoice } from '../ReportRange'
import { ReportDownloads } from '../../../components/ui/ReportDownloads'
import { reportHeader, timesheetSheets } from '../files'

type Report = Timesheet & { from: string; to: string; branches: string[]; cutShort?: CutShort | null; byBranch?: { branch: string; totals: Record<string, number> }[] }

const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: BRAND.locale.timezone, hour: '2-digit', minute: '2-digit' })
const who = (name: string) => name || 'No first name yet'

const peopleColumns: Column<PersonHours>[] = [
  { key: 'name', label: 'Person', render: p => `${who(p.name)}${p.open ? ' · clocked in now' : ''}`, sort: (a, b) => a.name.localeCompare(b.name) },
  { key: 'shifts', label: 'Shifts', align: 'right', render: p => String(p.shifts), sort: (a, b) => a.shifts - b.shifts },
  { key: 'minutes', label: 'Hours', align: 'right', render: p => hours(p.minutes), sort: (a, b) => a.minutes - b.minutes },
]

const shiftColumns: Column<Shift>[] = [
  { key: 'day', label: 'Day', render: s => s.day, sort: (a, b) => a.inAt - b.inAt },
  { key: 'name', label: 'Person', render: s => who(s.name), sort: (a, b) => a.name.localeCompare(b.name) },
  { key: 'branch', label: 'Branch', render: s => s.branch },
  { key: 'in', label: 'In', render: s => clock(s.inAt) },
  { key: 'out', label: 'Out', render: s => (s.outAt === null ? 'still in' : clock(s.outAt)) },
  { key: 'minutes', label: 'Hours', align: 'right', render: s => `${s.minutes === null ? '—' : hours(s.minutes)}${s.long ? ' · check: over 16h' : ''}`, sort: (a, b) => (a.minutes ?? 0) - (b.minutes ?? 0) },
]

export default function TimesheetPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(range: RangeChoice) {
    setBusy(true); setError('')
    try { setReport(await fetchReport<Report>('timesheet', range)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return null
  return (
    <Page width="wide">
      <PageHeader title="Timesheet"
        lead="Who clocked in and out with the staff app at a café hub, and their hours. A clock needs the person's own fingerprint on their own registered phone." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Reading the clock-ins…" />}
      {report && (
        <>
          <ReportDownloads header={reportHeader('Timesheet', report.from, report.to, report.branches)} sheets={timesheetSheets(report)} />
          <BranchTotals rows={report.byBranch ?? []} columns={[{ key: 'shifts', label: 'Shifts' }, { key: 'minutes', label: 'Minutes worked' }]} />
          <Panel title="Hours by person">
            <DataTable columns={peopleColumns} rows={report.people} rowKey={p => p.uid}
              empty={<EmptyState title="Nobody clocked in on these days.">Staff clock in from the staff app on the café wifi: Sign in card → Clock in.</EmptyState>} />
          </Panel>
          <Panel title="Every shift">
            <DataTable columns={shiftColumns} rows={report.shifts} rowKey={s => `${s.uid}-${s.inAt}`}
              search={(s, q) => `${s.name} ${s.branch} ${s.day}`.toLowerCase().includes(q)} searchLabel="Find a person or day"
              empty={<EmptyState title="No shifts on these days." />} />
          </Panel>
          {report.unmatched.length > 0 && (
            <Panel title="Clock-outs with no clock-in">
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'rgba(var(--offwhite-rgb),0.7)' }}>
                {report.unmatched.map(e => `${who(e.name)} at ${clock(e.at)}`).join(' · ')}. Shown rather than guessed at.
              </p>
            </Panel>
          )}
        </>
      )}
    </Page>
  )
}
