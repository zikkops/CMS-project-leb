'use client'

// Past end-of-day reports over a period and branches (UPGRADE.md T7.1b), on
// the shared report picker. Each figure is the report's own, worked out by
// computeTotals() at that report's own rate; the branch totals and the file
// only add up those per-report figures, never a new definition.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsMobile } from '@big-cms/shared/useIsMobile'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRANCHES } from '@big-cms/shared/branches'
import { BRAND } from '@big-cms/shared/brand'
import { todayYmd } from '@big-cms/shared/dates'
import { addDays } from '@big-cms/shared/reportPeriods'
import { startLoad } from '@big-cms/shared/startLoad'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import type { FileColumn } from '@big-cms/shared/reportFile'
import {
  listEndOfDayReportsBetween, computeTotals, formatLbp, formatUsd,
  type EndOfDayReport, type ComputedTotals,
} from '@big-cms/shared/endOfDay'
import { ErrorLine } from '../../../components/ui'
import { ReportRange, BranchTotals, type RangeChoice } from '../../../components/ui/ReportRange'
import { ReportDownloads, type ReportSheet } from '../../../components/ui/ReportDownloads'
import { reportHeader } from '../../reports/files'

interface Row { report: EndOfDayReport; totals: ComputedTotals }
interface Result { from: string; to: string; branches: string[]; rows: Row[] }

// Each report's OWN rate, not today's. These are historical figures and must
// not move when the rate does.
const totalsOf = (r: EndOfDayReport): ComputedTotals => computeTotals(
  r.cashLbp, r.cashUsd,
  r.systemLbp, r.systemUsd,
  r.expenses, r.income,
  r.exchangeRate,
)

const round2 = (n: number) => Math.round(n * 100) / 100

const fileColumns: FileColumn<Row>[] = [
  { label: 'Date', value: x => x.report.date },
  { label: 'Branch', value: x => x.report.branch },
  { label: 'Rate (LBP per USD)', value: x => x.report.exchangeRate },
  { label: 'Counted cash USD', value: x => round2(x.totals.totalCashUsd) },
  { label: 'Counted cash LBP', value: x => Math.round(x.totals.totalCashLbp) },
  { label: 'System USD', value: x => round2(Number(x.report.systemUsd) || 0) },
  { label: 'System LBP', value: x => Math.round(Number(x.report.systemLbp) || 0) },
  { label: 'Expenses USD', value: x => round2(x.totals.totalExpensesUsd) },
  { label: 'Income USD', value: x => round2(x.totals.totalIncomeUsd) },
  { label: 'Tips USD', value: x => round2(Number(x.report.tipsUsd) || 0) },
  { label: 'Diff USD', value: x => round2(x.totals.differenceUsd) },
  { label: 'Diff LBP', value: x => Math.round(x.totals.differenceLbp) },
  { label: 'Submitted by', value: x => x.report.submittedByEmail },
]

type TotalKey = 'reports' | 'cashUsd' | 'cashLbp' | 'expensesUsd' | 'incomeUsd' | 'tipsUsd'
const totalColumns: { key: TotalKey; label: string; money?: boolean }[] = [
  { key: 'reports', label: 'Reports' },
  { key: 'cashUsd', label: 'Counted USD', money: true },
  { key: 'cashLbp', label: 'Counted LBP' },
  { key: 'expensesUsd', label: 'Expenses', money: true },
  { key: 'incomeUsd', label: 'Income', money: true },
  { key: 'tipsUsd', label: 'Tips', money: true },
]

function branchTotals(rows: Row[], branches: string[]) {
  return branches.map(branch => {
    const mine = rows.filter(x => x.report.branch === branch)
    const sum = (f: (x: Row) => number) => mine.reduce((s, x) => s + (f(x) || 0), 0)
    return {
      branch,
      totals: {
        reports: mine.length,
        cashUsd: round2(sum(x => x.totals.totalCashUsd)),
        cashLbp: Math.round(sum(x => x.totals.totalCashLbp)),
        expensesUsd: round2(sum(x => x.totals.totalExpensesUsd)),
        incomeUsd: round2(sum(x => x.totals.totalIncomeUsd)),
        tipsUsd: round2(sum(x => Number(x.report.tipsUsd))),
      } satisfies Record<TotalKey, number>,
    }
  })
}

export default function EndOfDayHistoryPage() {
  const isMobile = useIsMobile()
  const { checking, role, branchIds } = useRequireRole(SECTION_ACCESS.endOfDayHistory)

  const isAdmin = role === 'admin'
  const branchKey = (isAdmin ? BRANCHES : branchIds).join(',')
  const branchOptions = branchKey ? branchKey.split(',') : []

  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)

  const run = useCallback(async (range: RangeChoice) => {
    const mine = branchKey ? branchKey.split(',') : []
    const chosen = range.branch ? range.branch.split(',').filter(b => mine.includes(b)) : mine
    const id = ++seq.current
    setBusy(true); setError('')
    try {
      // An admin asking for every branch reads them in one query; anybody
      // else reads only their own, one branch at a time.
      const lists = isAdmin && !range.branch
        ? [await listEndOfDayReportsBetween('all', range.from, range.to)]
        : await Promise.all(chosen.map(b => listEndOfDayReportsBetween(b, range.from, range.to)))
      const reports = lists.flat()
        .filter(r => chosen.includes(r.branch) || (isAdmin && !range.branch))
        .sort((a, b) => b.date.localeCompare(a.date) || a.branch.localeCompare(b.branch))
      if (id !== seq.current) return
      const branches = isAdmin && !range.branch
        ? [...new Set([...chosen, ...reports.map(r => r.branch)])]
        : chosen
      setResult({ from: range.from, to: range.to, branches, rows: reports.map(r => ({ report: r, totals: totalsOf(r) })) })
    } catch (err) {
      if (id !== seq.current) return
      setError(isNetworkFailure(err) ? 'No connection. Try again when the internet is back.' : 'The reports could not be read.')
    } finally {
      if (id === seq.current) setBusy(false)
    }
  }, [branchKey, isAdmin])

  // The picker's own default, the last seven café days over every branch, is
  // read as soon as the role is known, as the page always listed on opening.
  useEffect(() => {
    if (checking) return
    const today = todayYmd(BRAND.locale.timezone)
    startLoad(() => run({ from: addDays(today, -6), to: today, branch: '' }))
  }, [checking, run])

  if (checking) return null

  const reports = result?.rows ?? []
  const sheets: ReportSheet<never>[] = result
    ? [{ name: 'Reports', columns: fileColumns, rows: result.rows } as unknown as ReportSheet<never>]
    : []

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin/end-of-day" style={{
            fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(var(--offwhite-rgb),0.3)', textDecoration: 'none',
            display: 'block', marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
          }}>← Submit Report</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
            EOD History
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.3)' }}>
            Past end-of-day reports, filed under the cash-up day they were written for
          </p>
        </div>

        <ReportRange onRun={range => { void run(range) }} busy={busy} branches={branchOptions} />

        {error && <ErrorLine>{error}</ErrorLine>}

        {busy && !result && (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        )}

        {result && reports.length > 0 && (
          <>
            <ReportDownloads
              header={{ ...reportHeader('End of Day History', result.from, result.to, result.branches, 'cashUp'), currencies: ['USD', 'LBP'] }}
              sheets={sheets} />
            <BranchTotals rows={branchTotals(result.rows, result.branches)} columns={totalColumns} />
          </>
        )}

        {result && reports.length === 0 && (
          <div style={{
            border: '1px dashed rgba(var(--overlay-rgb),0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
            color: 'rgba(var(--offwhite-rgb),0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          }}>
            No reports for these days.{' '}
            <a href="/admin/end-of-day" style={{ color: 'var(--brand-secondary)' }}>Submit one →</a>
          </div>
        )}

        {reports.length > 0 && isMobile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {reports.map(({ report: r, totals: t }) => {
              const diffLbpColor = t.differenceLbp === 0 ? 'var(--teal)' : t.differenceLbp > 0 ? 'var(--red)' : 'var(--brand-secondary)'
              const diffUsdColor = t.differenceUsd  === 0 ? 'var(--teal)' : t.differenceUsd  > 0 ? 'var(--red)' : 'var(--brand-secondary)'
              return (
                <div key={r.id} style={{
                  background: 'rgba(var(--overlay-rgb),0.02)',
                  border: '1px solid rgba(var(--overlay-rgb),0.07)',
                  borderRadius: '4px',
                  padding: '0.9rem 1.1rem',
                  display: 'flex', flexDirection: 'column', gap: '0.5rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)', fontWeight: 500 }}>
                      {r.date}
                    </span>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>
                      {r.branch}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '1.5rem' }}>
                    <div>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.3)', marginBottom: '0.2rem' }}>Diff LBP</p>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: diffLbpColor, fontWeight: 600 }}>{formatLbp(t.differenceLbp)}</p>
                    </div>
                    <div>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.3)', marginBottom: '0.2rem' }}>Diff USD</p>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: diffUsdColor, fontWeight: 600 }}>{formatUsd(t.differenceUsd)}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(var(--overlay-rgb),0.05)' }}>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.35)' }}>
                      {r.submittedByEmail}
                    </span>
                    <a
                      href={`/admin/end-of-day?branch=${encodeURIComponent(r.branch)}&date=${r.date}`}
                      style={{
                        fontSize: '0.72rem', color: 'var(--brand-secondary)',
                        textDecoration: 'none', fontFamily: 'var(--font-inter)',
                        whiteSpace: 'nowrap',
                      }}
                    >Edit →</a>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {reports.length > 0 && !isMobile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '130px 110px 1fr 1fr 1fr 60px',
              gap: '0.75rem',
              padding: '0.5rem 1rem',
              fontFamily: 'var(--font-inter)', fontSize: '0.62rem',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'rgba(var(--offwhite-rgb),0.3)',
            }}>
              <span>Date</span>
              <span>Branch</span>
              <span>Diff LBP</span>
              <span>Diff USD</span>
              <span>Submitted by</span>
              <span />
            </div>

            {reports.map(({ report: r, totals: t }) => {
              const diffLbpColor = t.differenceLbp === 0 ? 'var(--teal)' : t.differenceLbp > 0 ? 'var(--red)' : 'var(--brand-secondary)'
              const diffUsdColor = t.differenceUsd  === 0 ? 'var(--teal)' : t.differenceUsd  > 0 ? 'var(--red)' : 'var(--brand-secondary)'
              return (
                <div key={r.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '130px 110px 1fr 1fr 1fr 60px',
                  gap: '0.75rem',
                  alignItems: 'center',
                  background: 'rgba(var(--overlay-rgb),0.02)',
                  border: '1px solid rgba(var(--overlay-rgb),0.07)',
                  borderRadius: '4px',
                  padding: '0.9rem 1rem',
                }}>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)', fontWeight: 500 }}>
                    {r.date}
                  </span>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>
                    {r.branch}
                  </span>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: diffLbpColor, fontWeight: 600 }}>
                    {formatLbp(t.differenceLbp)}
                  </span>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: diffUsdColor, fontWeight: 600 }}>
                    {formatUsd(t.differenceUsd)}
                  </span>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.35)' }}>
                    {r.submittedByEmail}
                  </span>
                  <a
                    href={`/admin/end-of-day?branch=${encodeURIComponent(r.branch)}&date=${r.date}`}
                    style={{
                      fontSize: '0.72rem', color: 'var(--brand-secondary)',
                      textDecoration: 'none', fontFamily: 'var(--font-inter)',
                      whiteSpace: 'nowrap',
                    }}
                  >Edit →</a>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
