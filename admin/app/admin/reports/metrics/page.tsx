'use client'

// The metrics explorer (UPGRADE.md T7.19): every figure the reports work out,
// in one place, switched on and off one at a time.
//
// Why it exists: the reports each answer one question well, and somebody
// asking "what did we take, what did it cost, and how many hours went into
// it" was reading three pages and a calculator. Here they pick the figures
// they want and get them side by side, over one range, for the branches they
// are allowed.
//
// Two things it deliberately does NOT do:
//  · It works nothing out. Every number comes from the server, from the same
//    function the report of that name uses, so this page and that report can
//    never print different answers to one question.
//  · It reads only the groups the chosen metrics belong to. Ticking "net
//    sales" runs the sales export; it does not run the inventory and labour
//    reads as well to fill in figures nobody asked for.
//
// The choice is remembered per browser, so coming back to it opens on the
// same figures rather than the defaults.

import { useEffect, useMemo, useState } from 'react'
import { useClientValue } from '@big-cms/shared/useClientValue'
import { faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useAdminUser } from '@big-cms/shared/adminAuth'
import {
  DEFAULT_METRICS, MAX_METRICS, METRIC_GROUPS, METRICS, metric, searchMetrics,
  type MetricDef, type MetricGroup, type MetricReport,
} from '@big-cms/shared/metrics'
import type { CutShort } from '@big-cms/shared/salesExport'
import type { FileColumn } from '@big-cms/shared/reportFile'
import { Page, PageHeader, Panel, Button, ErrorLine, Loading, CutShortNote, inputStyle } from '../../../components/ui'
import { BarChart, LineChart, formatValue, type ChartUnit } from '../../../components/ui/Charts'
import { ReportDownloads, type ReportSheet } from '../../../components/ui/ReportDownloads'
import { ReportRange, fetchReport, reportError, type RangeChoice } from '../ReportRange'
import { reportHeader } from '../files'

type Report = MetricReport & { from: string; to: string; branches: string[]; cutShort?: CutShort | null }

const REMEMBER = 'bigcms.metrics.chosen'
const sheet = <T,>(name: string, columns: FileColumn<T>[], rows: readonly T[]) => ({ name, columns, rows }) as unknown as ReportSheet<never>
// A metric's unit is the chart's unit: the same words either way.
const unitOf = (d: MetricDef): ChartUnit => d.unit as ChartUnit

/** What was remembered last time, if it is still a real list of real metrics. */
function fromStored(raw: string): string[] {
  try {
    if (!raw) return [...DEFAULT_METRICS]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_METRICS]
    const kept = parsed.filter((k): k is string => typeof k === 'string' && metric(k) !== null)
    return kept.length > 0 ? kept.slice(0, MAX_METRICS) : [...DEFAULT_METRICS]
  } catch { return [...DEFAULT_METRICS] }
}

/** The stored string, or '' on the server and in a browser that refuses. */
const readStored = () => { try { return window.localStorage.getItem(REMEMBER) ?? '' } catch { return '' } }

export default function MetricsPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const { role, superadmin } = useAdminUser()
  const isAdmin = role === 'admin' || superadmin

  // What was remembered is read through useSyncExternalStore, not set from an
  // effect: the server has no localStorage, and setting it after mounting is
  // a second render and a lint error (react-hooks/set-state-in-effect).
  // Once somebody ticks something, their choice stands and the stored value
  // is only written to.
  const stored = useClientValue(readStored, '')
  const [edited, setEdited] = useState<string[] | null>(null)
  const fromLast = useMemo(() => fromStored(stored), [stored])
  const chosen = edited ?? fromLast
  const setChosen = (next: string[] | ((now: string[]) => string[])) =>
    setEdited(now => (typeof next === 'function' ? next(now ?? fromLast) : next))
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<MetricGroup[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [range, setRange] = useState<RangeChoice | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (edited === null) return
    try { window.localStorage.setItem(REMEMBER, JSON.stringify(edited)) } catch { /* a private window is not an error */ }
  }, [edited])

  // Pay is not offered to somebody who may not see it, rather than offered
  // and refused: a tick that does nothing is worse than no tick.
  const offered = useMemo(() => METRICS.filter(d => isAdmin || !METRIC_GROUPS.find(g => g.key === d.group)?.adminOnly), [isAdmin])
  const shown = useMemo(() => searchMetrics(query, groups, offered), [query, groups, offered])
  const chosenDefs = useMemo(() => chosen.map(metric).filter((d): d is MetricDef => d !== null), [chosen])

  function toggle(key: string) {
    setChosen(now => (now.includes(key) ? now.filter(k => k !== key) : now.length >= MAX_METRICS ? now : [...now, key]))
  }
  function toggleGroup(key: MetricGroup) {
    setGroups(now => (now.includes(key) ? now.filter(g => g !== key) : [...now, key]))
  }

  async function run(choice: RangeChoice) {
    setRange(choice)
    if (chosen.length === 0) { setError('Choose at least one metric.'); return }
    setBusy(true)
    setError('')
    try { setReport(await fetchReport<Report>('metrics', choice, { keys: chosen.join(',') })) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return <Loading />
  const answered = report ? chosenDefs.filter(d => d.key in report.values) : []
  const daily = answered.filter(d => d.daily && (report?.days.length ?? 0) > 1)
  const manyBranches = (report?.byBranch.length ?? 0) > 1

  return (
    <Page width="wide">
      <PageHeader title="Metrics" lead="Every figure the reports work out, in one place. Search for what you want, switch it on, and read it over any range — the numbers are the reports' own, so this page and they always agree." />

      <Panel title={`Metrics — ${chosen.length} on${chosen.length >= MAX_METRICS ? `, the most at once` : ''}`}>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.8rem' }}>
          <input
            type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search metrics — vat, tips, waste…" aria-label="Search metrics"
            style={{ ...inputStyle, flex: '1 1 240px', minWidth: '200px' }} />
          <Button icon={faRotateLeft} onClick={() => { setChosen([...DEFAULT_METRICS]); setQuery(''); setGroups([]) }}>Start again</Button>
        </div>
        <div role="group" aria-label="Categories" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          {METRIC_GROUPS.filter(g => isAdmin || !g.adminOnly).map(g => {
            const on = groups.includes(g.key)
            return (
              <button key={g.key} type="button" onClick={() => toggleGroup(g.key)} title={g.purpose} aria-pressed={on}
                style={{
                  fontFamily: 'var(--font-inter)', fontSize: '0.78rem', padding: '0.35rem 0.7rem', borderRadius: '999px', cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--teal)' : 'rgba(var(--overlay-rgb),0.18)'}`,
                  background: on ? 'color-mix(in srgb, var(--teal) 22%, transparent)' : 'transparent',
                  color: on ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.7)',
                }}>{g.label}</button>
            )
          })}
        </div>
        {shown.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.6)' }}>Nothing matches that. Try a shorter word, or clear the categories.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '0.45rem' }}>
            {shown.map(d => {
              const on = chosen.includes(d.key)
              const full = !on && chosen.length >= MAX_METRICS
              return (
                <label key={d.key} title={full ? `That is ${MAX_METRICS} metrics already — switch one off first.` : d.help}
                  style={{
                    display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.5rem 0.6rem', borderRadius: '8px',
                    fontFamily: 'var(--font-inter)', fontSize: '0.82rem', lineHeight: 1.35, cursor: full ? 'not-allowed' : 'pointer',
                    border: `1px solid ${on ? 'var(--teal)' : 'rgba(var(--overlay-rgb),0.12)'}`,
                    background: on ? 'color-mix(in srgb, var(--teal) 12%, transparent)' : 'rgba(var(--overlay-rgb),0.04)',
                    opacity: full ? 0.45 : 1,
                  }}>
                  <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(d.key)} style={{ marginTop: '0.15rem' }} />
                  <span>
                    <span style={{ color: 'var(--offwhite)' }}>{d.label}</span>
                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'rgba(var(--offwhite-rgb),0.55)' }}>{d.help}</span>
                  </span>
                </label>
              )
            })}
          </div>
        )}
      </Panel>

      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {report?.refused.map(r => (
        <ErrorLine key={r.group}>{METRIC_GROUPS.find(g => g.key === r.group)?.label ?? r.group}: {r.reason}</ErrorLine>
      ))}
      {busy && !report && <Loading label="Reading the figures…" />}

      {report && range && (
        <>
          <ReportDownloads header={reportHeader('Metrics', report.from, report.to, report.branches)} sheets={[
            sheet<MetricDef>('Totals', [
              { label: 'Metric', value: d => d.label },
              { label: 'Value', value: d => report.values[d.key] ?? 0 },
              { label: 'Unit', value: d => d.unit },
            ], answered),
            sheet<{ day: string; values: Record<string, number> }>('By day', [
              { label: 'Day', value: r => r.day },
              ...answered.map(d => ({ label: d.label, value: (r: { values: Record<string, number> }) => r.values[d.key] ?? 0 })),
            ], report.days),
            sheet<{ branch: string; values: Record<string, number> }>('By branch', [
              { label: 'Branch', value: r => r.branch },
              ...answered.map(d => ({ label: d.label, value: (r: { values: Record<string, number> }) => r.values[d.key] ?? 0 })),
            ], report.byBranch),
          ]} />

          <Panel title={`${report.from} to ${report.to}${report.branches.length === 1 ? ` — ${report.branches[0]}` : ''}`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.6rem' }}>
              {answered.map(d => (
                <div key={d.key} style={{ padding: '0.75rem 0.85rem', borderRadius: '10px', background: 'rgba(var(--overlay-rgb),0.06)', border: '1px solid rgba(var(--overlay-rgb),0.1)' }}>
                  <div style={{ fontFamily: 'var(--font-inter)', fontSize: '0.74rem', color: 'rgba(var(--offwhite-rgb),0.6)' }}>{d.label}</div>
                  <div style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.5rem', color: 'var(--offwhite)', marginTop: '0.25rem' }}>
                    {formatValue(report.values[d.key] ?? 0, unitOf(d))}
                  </div>
                </div>
              ))}
              {answered.length === 0 && (
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.6)' }}>No figures came back for these metrics.</p>
              )}
            </div>
          </Panel>

          {daily.map(d => (
            <LineChart key={d.key} title={`${d.label}, by day`} note={d.help} unit={unitOf(d)}
              series={[{ name: d.label, points: report.days.map(r => ({ label: r.day, value: r.values[d.key] ?? 0, short: r.day.slice(5) })) }]} />
          ))}

          {manyBranches && answered.map(d => (
            <BarChart key={d.key} title={`${d.label}, by branch`} unit={unitOf(d)} diverging={d.better === null}
              points={report.byBranch.map(b => ({ label: b.branch, value: b.values[d.key] ?? 0 }))} />
          ))}

          {daily.length === 0 && answered.length > 0 && (
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.55)', lineHeight: 1.6 }}>
              These figures are a position at the end of the range, not a day-by-day movement, so there is no line to draw. Choose a longer range, or a metric that changes daily, to see one.
            </p>
          )}
        </>
      )}
    </Page>
  )
}
