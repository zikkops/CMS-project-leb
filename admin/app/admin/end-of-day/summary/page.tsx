'use client'

// Daily Summary (UPGRADE.md T7.1b): one day or a range, one branch, several
// or all, on the shared report picker. One day at one branch is the card it
// always was, with the tips entry; anything wider is one row per report
// (branch and cash-up day) and a totals row. Every figure is a stored
// report's own, worked out by computeTotals() at that report's own rate, and
// the totals only add those up: nothing here defines a new number.

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRANCHES } from '@big-cms/shared/branches'
import {
  listEndOfDayReportsBetween, updateEodTips, computeTotals, formatLbp, formatUsd, defaultEodDateStr,
  type EndOfDayReport,
} from '@big-cms/shared/endOfDay'
import type { FileColumn } from '@big-cms/shared/reportFile'
import { BRAND } from '@big-cms/shared/brand'
import { startLoad } from '@big-cms/shared/startLoad'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { Panel, DataTable, EmptyState, ErrorLine, Loading, type Column } from '../../../components/ui'
import { ReportRange, BranchTotals, type RangeChoice } from '../../../components/ui/ReportRange'
import { ReportDownloads, type ReportSheet } from '../../../components/ui/ReportDownloads'
import { reportHeader } from '../../reports/files'

const inp: React.CSSProperties = {
  backgroundColor: 'rgba(var(--overlay-rgb),0.04)',
  border: '1px solid rgba(var(--overlay-rgb),0.1)',
  color: 'var(--offwhite)',
  padding: '0.6rem 0.8rem',
  borderRadius: '2px',
  fontSize: '0.88rem',
  outline: 'none',
  fontFamily: 'var(--font-inter)',
  width: '100%',
}

function Row({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '0.85rem 1.25rem',
      borderBottom: '1px solid rgba(var(--overlay-rgb),0.05)',
    }}>
      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.45)', letterSpacing: '0.04em' }}>
        {label}
        {sub && <span style={{ display: 'block', fontSize: '0.68rem', color: 'rgba(var(--offwhite-rgb),0.25)', marginTop: '0.2rem' }}>{sub}</span>}
      </span>
      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.95rem', fontWeight: 600, color: color ?? 'var(--offwhite)', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}

/** One stored report's figures, as the one-day card shows them. */
interface SummaryRow {
  key: string
  branch: string
  date: string
  cashUsd: number        // counted, both currencies, in USD at the report's rate
  cashLbp: number        // the same, in LBP
  systemUsd: number
  systemLbp: number
  expensesUsd: number
  incomeUsd: number
  tipsUsd: number
  differenceUsd: number
  differenceLbp: number
  exchangeRate: number
  submittedBy: string
}

type Totals = Omit<SummaryRow, 'key' | 'branch' | 'date' | 'exchangeRate' | 'submittedBy'>
const SUMMED: (keyof Totals)[] = ['cashUsd', 'cashLbp', 'systemUsd', 'systemLbp', 'expensesUsd', 'incomeUsd', 'tipsUsd', 'differenceUsd', 'differenceLbp']

// report.exchangeRate, not the configured one: this is the rate the day was
// actually counted at, and it is stored on the report so that changing the
// setting later cannot re-value a night's cash.
function toRow(r: EndOfDayReport): SummaryRow {
  const t = computeTotals(r.cashLbp, r.cashUsd, r.systemLbp, r.systemUsd, r.expenses, r.income, r.exchangeRate)
  return {
    key: `${r.branch}_${r.date}`, branch: r.branch, date: r.date,
    cashUsd: t.grandTotalUsd, cashLbp: t.grandTotalLbp,
    systemUsd: Number(r.systemUsd) || 0, systemLbp: Number(r.systemLbp) || 0,
    expensesUsd: t.totalExpensesUsd, incomeUsd: t.totalIncomeUsd, tipsUsd: Number(r.tipsUsd) || 0,
    differenceUsd: t.differenceUsd, differenceLbp: t.differenceLbp,
    exchangeRate: r.exchangeRate, submittedBy: r.submittedByEmail ?? '',
  }
}

function sumRows(rows: readonly SummaryRow[]): Totals {
  return Object.fromEntries(SUMMED.map(k => [k, rows.reduce((s, r) => s + r[k], 0)])) as unknown as Totals
}

const diffColor = (n: number) => (n === 0 ? 'var(--teal)' : n > 0 ? 'var(--red)' : 'var(--brand-secondary)')

const tableColumns: Column<SummaryRow>[] = [
  { key: 'date', label: 'Day', render: r => r.date, sort: (a, b) => a.date.localeCompare(b.date) },
  { key: 'branch', label: 'Branch', render: r => r.branch, sort: (a, b) => a.branch.localeCompare(b.branch) },
  { key: 'cash', label: 'Counted', align: 'right', render: r => formatUsd(r.cashUsd), sort: (a, b) => a.cashUsd - b.cashUsd },
  {
    key: 'system', label: 'POS System', align: 'right', sort: (a, b) => a.systemUsd - b.systemUsd,
    render: r => <span style={{ color: 'var(--purple)' }}>{formatUsd(r.systemUsd)}<br /><small style={{ opacity: 0.6 }}>{formatLbp(r.systemLbp)}</small></span>,
  },
  { key: 'expenses', label: 'Expenses', align: 'right', render: r => <span style={{ color: 'var(--red)' }}>{formatUsd(r.expensesUsd)}</span>, sort: (a, b) => a.expensesUsd - b.expensesUsd },
  { key: 'income', label: 'Income', align: 'right', render: r => formatUsd(r.incomeUsd), sort: (a, b) => a.incomeUsd - b.incomeUsd },
  { key: 'tips', label: 'Tips', align: 'right', render: r => <span style={{ color: 'var(--brand-secondary)' }}>{formatUsd(r.tipsUsd)}</span>, sort: (a, b) => a.tipsUsd - b.tipsUsd },
  {
    key: 'difference', label: 'Difference vs POS', align: 'right', sort: (a, b) => a.differenceUsd - b.differenceUsd,
    render: r => (
      <span>
        <span style={{ color: diffColor(r.differenceUsd) }}>{formatUsd(r.differenceUsd)}</span><br />
        <small style={{ color: diffColor(r.differenceLbp) }}>{formatLbp(r.differenceLbp)}</small>
      </span>
    ),
  },
]

const fileColumns: FileColumn<SummaryRow>[] = [
  { label: 'Day', value: r => r.date }, { label: 'Branch', value: r => r.branch },
  { label: 'Counted USD (both currencies)', value: r => r.cashUsd }, { label: 'Counted LBP (both currencies)', value: r => Math.round(r.cashLbp) },
  { label: 'POS system USD', value: r => r.systemUsd }, { label: 'POS system LBP', value: r => Math.round(r.systemLbp) },
  { label: 'Expenses USD', value: r => r.expensesUsd }, { label: 'Income USD', value: r => r.incomeUsd }, { label: 'Tips USD', value: r => r.tipsUsd },
  { label: 'Difference vs POS USD', value: r => r.differenceUsd }, { label: 'Difference vs POS LBP', value: r => Math.round(r.differenceLbp) },
  { label: 'Rate (LBP per $1)', value: r => r.exchangeRate }, { label: 'Submitted by', value: r => r.submittedBy },
]

interface Result { from: string; to: string; branches: string[]; reports: EndOfDayReport[] }

/** Per branch, so each query stays scoped to one branch's reports. */
async function readReports(from: string, to: string, branches: readonly string[]): Promise<EndOfDayReport[]> {
  const lists = await Promise.all(branches.map(b => listEndOfDayReportsBetween(b, from, to)))
  return lists.flat().sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch))
}

function EndOfDaySummaryInner() {
  const params = useSearchParams()
  const { checking, role, branchIds, user } = useRequireRole(SECTION_ACCESS.endOfDayHistory)

  const branchOptions: string[] = role === 'admin' ? [...BRANCHES] : branchIds

  const [result,  setResult]  = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [tips,    setTips]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [err,     setErr]     = useState('')
  const asked = useRef(0)

  async function load(from: string, to: string, branches: string[]) {
    const n = ++asked.current
    setLoading(true); setLoadErr(''); setSaved(false); setErr('')
    try {
      const reports = await readReports(from, to, branches)
      if (n !== asked.current) return
      setResult({ from, to, branches, reports })
      const one = from === to && branches.length === 1 ? reports[0] : undefined
      setTips(one?.tipsUsd ? String(one.tipsUsd) : '')
    } catch (e) {
      if (n !== asked.current) return
      setLoadErr(isNetworkFailure(e) ? 'No connection. Try again when the internet is back.' : 'The reports could not be read.')
    } finally {
      if (n === asked.current) setLoading(false)
    }
  }

  function run(range: RangeChoice) {
    const chosen = range.branch ? range.branch.split(',').filter(b => branchOptions.includes(b)) : branchOptions
    void load(range.from, range.to, chosen)
  }

  // A link (e.g. from the EOD submit page) opens its branch and day, only a
  // branch the user has access to; a manager with one branch gets the usual
  // day for it, as before. Again whenever the address changes.
  const linkKey = checking ? null : `${params.toString()}|${branchOptions.join(',')}`
  useEffect(() => {
    if (linkKey === null) return
    const [query, allowed] = linkKey.split('|')
    const p = new URLSearchParams(query)
    const options = allowed ? allowed.split(',') : []
    const pb = p.get('branch')
    const pd = p.get('date')
    const branch = pb && options.includes(pb) ? pb : options.length === 1 ? options[0] : null
    if (!branch || (!pd && !pb && options.length !== 1)) return
    const day = pd || defaultEodDateStr()
    startLoad(() => load(day, day, [branch]))
  }, [linkKey])

  const reports = result?.reports ?? []
  const oneDay = !!result && result.from === result.to && result.branches.length === 1
  const report = oneDay ? reports[0] ?? null : null

  async function handleSaveTips(e: React.FormEvent) {
    e.preventDefault()
    if (!report || !user) return
    setSaving(true); setErr('')
    try {
      const value = Number(tips) || 0
      await updateEodTips(report.branch, report.date, value)
      setResult(prev => prev && {
        ...prev,
        reports: prev.reports.map(r => (r.branch === report.branch && r.date === report.date ? { ...r, tipsUsd: value } : r)),
      })
      setSaved(true)
    } catch {
      setErr('Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (checking) return null

  const rows = reports.map(toRow)
  const totals = sumRows(rows)
  const one = report ? toRow(report) : null
  const tipsNum = Number(tips) || (report?.tipsUsd ?? 0)

  const byBranch = (result?.branches ?? []).map(b => {
    const t = sumRows(rows.filter(r => r.branch === b))
    return { branch: b, totals: { cash: t.cashUsd, system: t.systemUsd, difference: t.differenceUsd, expenses: t.expensesUsd, income: t.incomeUsd, tips: t.tipsUsd } }
  })
  const period = result ? (result.from === result.to ? result.from : `${result.from} to ${result.to}`) : ''
  const sheets = [{ name: 'Daily Summary', columns: fileColumns, rows }] as unknown as ReportSheet<never>[]

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '2rem 1rem 4rem' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin/end-of-day/history" style={{
            fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(var(--offwhite-rgb),0.3)', textDecoration: 'none',
            display: 'block', marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
          }}>← EOD History</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
            Daily Summary
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.3)' }}>
            End-of-day totals for screenshotting. One day at one branch is the summary card; a range or several branches is one row per report.
          </p>
        </div>

        <ReportRange onRun={run} busy={loading} branches={branchOptions} />

        {loadErr && <ErrorLine>{loadErr}</ErrorLine>}
        {loading && <Loading label="Reading the reports…" />}

        {!loading && result && (<>
          <ReportDownloads
            header={{ ...reportHeader('Daily Summary', result.from, result.to, result.branches, 'cashUp'), currencies: ['USD', 'LBP'] }}
            sheets={sheets}
          />

          {oneDay && !report && (
            <div style={{
              border: '1px dashed rgba(var(--overlay-rgb),0.08)', borderRadius: '4px',
              padding: '2.5rem', textAlign: 'center',
              color: 'rgba(var(--offwhite-rgb),0.25)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
            }}>
              No report submitted for {result.branches[0]} on {result.from}.
            </div>
          )}

          {oneDay && report && one && (
            <div style={{ maxWidth: '520px', margin: '0 auto' }}>

              {/* Tips entry */}
              <form onSubmit={handleSaveTips} style={{ marginBottom: '1.5rem' }}>
                <label style={{
                  display: 'block', fontSize: '0.65rem', letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: 'var(--brand-secondary)',
                  marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
                }}>Tips (USD)</label>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1 }}>
                    <span style={{ color: 'rgba(var(--offwhite-rgb),0.4)', fontFamily: 'var(--font-inter)', fontSize: '0.9rem', flexShrink: 0 }}>$</span>
                    <input
                      type="number" min="0" step="0.01"
                      value={tips}
                      onChange={e => { setTips(e.target.value); setSaved(false) }}
                      placeholder="0.00"
                      style={{ ...inp, textAlign: 'right' }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{
                      backgroundColor: 'var(--brand-secondary)', color: '#000', border: 'none',
                      padding: '0.65rem 1.25rem', borderRadius: '2px',
                      fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase',
                      cursor: saving ? 'not-allowed' : 'pointer',
                      fontFamily: 'var(--font-inter)', fontWeight: 600,
                      opacity: saving ? 0.6 : 1, flexShrink: 0,
                    }}
                  >{saving ? 'Saving…' : 'Save'}</button>
                </div>
                {saved && (
                  <p style={{ color: 'var(--teal)', fontSize: '0.78rem', marginTop: '0.5rem', fontFamily: 'var(--font-inter)' }}>
                    ✓ Tips saved.
                  </p>
                )}
                {err && (
                  <p style={{ color: 'var(--red)', fontSize: '0.78rem', marginTop: '0.5rem', fontFamily: 'var(--font-inter)' }}>
                    {err}
                  </p>
                )}
              </form>

              {/* Screenshot card */}
              <div style={{
                background: 'rgba(var(--overlay-rgb),0.03)',
                border: '1px solid rgba(var(--overlay-rgb),0.1)',
                borderRadius: '6px',
                overflow: 'hidden',
              }}>
                {/* Card header */}
                <div style={{
                  background: 'rgba(var(--brand-secondary-rgb),0.08)',
                  borderBottom: '1px solid rgba(var(--brand-secondary-rgb),0.2)',
                  padding: '1rem 1.25rem',
                }}>
                  <p style={{
                    fontFamily: 'var(--font-cinzel)', fontSize: '0.85rem',
                    color: 'var(--brand-secondary)', letterSpacing: '0.15em', textTransform: 'uppercase',
                    marginBottom: '0.2rem',
                  }}>
                    {BRAND.name} — Daily Summary
                  </p>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.4)' }}>
                    {report.branch} · {report.date}
                  </p>
                </div>

                {/* The POS system's own figure, as stored on the report */}
                <Row
                  label="POS System"
                  sub={`LBP: ${formatLbp(one.systemLbp)}`}
                  value={formatUsd(one.systemUsd)}
                  color="var(--purple)"
                />

                <Row label="Expenses" value={formatUsd(one.expensesUsd)} color="var(--red)" />

                <Row label="Tips" value={formatUsd(tipsNum)} color="var(--brand-secondary)" />

                {/* Difference */}
                <div style={{
                  background: 'rgba(var(--overlay-rgb),0.02)',
                  borderTop: '1px solid rgba(var(--overlay-rgb),0.08)',
                }}>
                  <div style={{ padding: '0.6rem 1.25rem 0.2rem' }}>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.3)' }}>
                      Difference vs POS
                    </span>
                  </div>
                  <Row label="LBP" value={formatLbp(one.differenceLbp)} color={diffColor(one.differenceLbp)} />
                  <Row label="USD" value={formatUsd(one.differenceUsd)} color={diffColor(one.differenceUsd)} />
                </div>

                {/* Footer */}
                <div style={{
                  padding: '0.6rem 1.25rem',
                  borderTop: '1px solid rgba(var(--overlay-rgb),0.05)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', color: 'rgba(var(--offwhite-rgb),0.2)' }}>
                    Submitted by {report.submittedByEmail}
                  </span>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', color: 'rgba(var(--offwhite-rgb),0.2)' }}>
                    Rate: {formatLbp(report.exchangeRate)} LBP = $1
                  </span>
                </div>
              </div>
            </div>
          )}

          {!oneDay && (<>
            <BranchTotals rows={byBranch} columns={[
              { key: 'cash', label: 'Counted', money: true }, { key: 'system', label: 'POS System', money: true },
              { key: 'difference', label: 'Difference', money: true }, { key: 'expenses', label: 'Expenses', money: true },
              { key: 'income', label: 'Income', money: true }, { key: 'tips', label: 'Tips', money: true },
            ]} />
            <Panel title={`${period} · ${rows.length} report${rows.length === 1 ? '' : 's'}`}>
              <DataTable
                columns={tableColumns} rows={rows} rowKey={r => r.key}
                search={(r, q) => `${r.date} ${r.branch} ${r.submittedBy}`.toLowerCase().includes(q)} searchLabel="Find a day or branch"
                empty={<EmptyState title="No reports submitted in this range." />}
              />
              {rows.length > 1 && (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.8rem',
                  marginTop: '1rem', paddingTop: '1rem', borderTop: '2px solid rgba(var(--overlay-rgb),0.25)',
                  fontFamily: 'var(--font-inter)',
                }}>
                  {([
                    ['Counted', formatUsd(totals.cashUsd), formatLbp(totals.cashLbp), undefined],
                    ['POS System', formatUsd(totals.systemUsd), formatLbp(totals.systemLbp), 'var(--purple)'],
                    ['Expenses', formatUsd(totals.expensesUsd), '', 'var(--red)'],
                    ['Income', formatUsd(totals.incomeUsd), '', undefined],
                    ['Tips', formatUsd(totals.tipsUsd), '', 'var(--brand-secondary)'],
                    ['Difference vs POS', formatUsd(totals.differenceUsd), formatLbp(totals.differenceLbp), diffColor(totals.differenceUsd)],
                  ] as const).map(([label, value, sub, color]) => (
                    <div key={label}>
                      <p style={{ fontSize: '0.68rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.5)' }}>Total {label.toLowerCase()}</p>
                      <p style={{ fontSize: '1.1rem', fontWeight: 700, color: color ?? 'var(--offwhite)' }}>{value}</p>
                      {sub && <p style={{ fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>{sub}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </>)}
        </>)}

      </div>
    </div>
  )
}

export default function EndOfDaySummaryPage() {
  return (
    <Suspense fallback={null}>
      <EndOfDaySummaryInner />
    </Suspense>
  )
}
