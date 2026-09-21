'use client'

// The period and branches every report asks for (UPGRADE.md T7.1): one day or
// a from–to range, quick picks from the café's today, and one branch, several
// or all. The rules are shared/src/reportPeriods.ts; the server reads the same
// branch list with requestedBranches(), so a report can never be asked for a
// branch the person does not have.
// Module-scope components (CONTRIBUTING.md gotcha #2).

import { useState, type ReactNode } from 'react'
import { faMagnifyingGlassChart } from '@fortawesome/free-solid-svg-icons'
import { BRAND } from '@big-cms/shared/brand'
import { todayYmd } from '@big-cms/shared/dates'
import { QUICK_PERIODS, quickRange, addDays, type QuickPeriod } from '@big-cms/shared/reportPeriods'
import { Button, Field, inputStyle } from './index'

/** From, to, and the branches as the server reads them: '' for all of the person's, else a comma list. */
export interface RangeChoice { from: string; to: string; branch: string }

const chip = (on: boolean) => ({
  minHeight: '36px', padding: '0.35rem 0.75rem', borderRadius: '999px', cursor: 'pointer',
  fontFamily: 'var(--font-inter)', fontSize: '0.82rem', fontWeight: 600,
  background: on ? 'color-mix(in srgb, var(--teal) 18%, transparent)' : 'transparent',
  border: `1px solid ${on ? 'var(--teal)' : 'rgba(var(--offwhite-rgb),0.18)'}`,
  color: on ? 'var(--teal)' : 'rgba(var(--offwhite-rgb),0.75)',
}) as const

/**
 * `single` asks for one day (the hourly report). `branches` is the list the
 * person may choose from; with one branch there is nothing to choose.
 */
export function ReportRange({ onRun, busy, single = false, extra, branches = BRAND.branches }: {
  onRun: (range: RangeChoice) => void
  busy: boolean
  single?: boolean
  extra?: ReactNode
  branches?: readonly string[]
}) {
  const today = todayYmd(BRAND.locale.timezone)
  // The last seven café days, or today for a one-day report.
  const [from, setFrom] = useState(single ? today : addDays(today, -6))
  const [to, setTo] = useState(today)
  // Empty means every branch the person has.
  const [chosen, setChosen] = useState<string[]>([])
  const all = chosen.length === 0 || chosen.length === branches.length

  function pick(key: QuickPeriod) {
    const r = quickRange(key, today)
    setFrom(single ? r.to : r.from)
    setTo(r.to)
  }

  function toggle(b: string) {
    setChosen(prev => {
      const base = prev.length === 0 ? [] : prev
      return base.includes(b) ? base.filter(x => x !== b) : [...base, b]
    })
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); onRun({ from, to: single ? from : to, branch: all ? '' : branches.filter(b => chosen.includes(b)).join(',') }) }}
      style={{ marginBottom: '1.6rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}
    >
      <div role="group" aria-label="Quick periods" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {QUICK_PERIODS.filter(p => !single || p.key === 'today' || p.key === 'yesterday').map(p => (
          <button key={p.key} type="button" onClick={() => pick(p.key)}
            style={chip(from === quickRange(p.key, today).from && to === quickRange(p.key, today).to)}>{p.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ minWidth: '10rem' }}>
          <Field id="report-from" label={single ? 'Day' : 'From'}>
            <input id="report-from" type="date" value={from} max={today} onChange={e => setFrom(e.target.value)} style={inputStyle} required />
          </Field>
        </div>
        {!single && (
          <div style={{ minWidth: '10rem' }}>
            <Field id="report-to" label="To">
              <input id="report-to" type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} style={inputStyle} required />
            </Field>
          </div>
        )}
        {extra}
        <div style={{ marginBottom: '1.1rem' }}>
          <Button type="submit" tone="primary" icon={faMagnifyingGlassChart} disabled={busy || chosen.length === 0 && branches.length === 0}>
            {busy ? 'Reading…' : 'Show'}
          </Button>
        </div>
      </div>
      {branches.length > 1 && (
        <div role="group" aria-label="Branches" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.55)', marginRight: '0.3rem' }}>Branches</span>
          <button type="button" aria-pressed={all} onClick={() => setChosen([])} style={chip(all)}>All</button>
          {branches.map(b => (
            <button key={b} type="button" aria-pressed={!all && chosen.includes(b)} onClick={() => toggle(b)} style={chip(!all && chosen.includes(b))}>{b}</button>
          ))}
        </div>
      )}
    </form>
  )
}

/**
 * Per-branch totals with the consolidated row underneath (UPGRADE.md T7.1).
 * The "All" row is the SUM of the branch rows shown, never a separate
 * calculation, so the columns always add up to it.
 */
export function BranchTotals<K extends string>({ rows, columns }: {
  rows: readonly { branch: string; totals: Record<K, number> }[]
  columns: readonly { key: K; label: string; money?: boolean }[]
}) {
  if (rows.length < 2) return null
  const sum = Object.fromEntries(columns.map(c => [c.key, Math.round(rows.reduce((s, r) => s + (r.totals[c.key] ?? 0), 0) * 100) / 100])) as Record<K, number>
  const cell = (v: number, money?: boolean) => (money ? `$${v.toFixed(2)}` : v.toLocaleString('en-US'))
  const th = { textAlign: 'right' as const, padding: '0.45rem 0.6rem', fontWeight: 600, color: 'rgba(var(--offwhite-rgb),0.6)', fontSize: '0.78rem' }
  const td = { textAlign: 'right' as const, padding: '0.45rem 0.6rem' }
  return (
    <div style={{ overflowX: 'auto', marginBottom: '1.4rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'var(--offwhite)' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Branch</th>
            {columns.map(c => <th key={c.key} style={th}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.branch} style={{ borderTop: '1px solid rgba(var(--overlay-rgb),0.08)' }}>
              <td style={{ ...td, textAlign: 'left' }}>{r.branch}</td>
              {columns.map(c => <td key={c.key} style={td}>{cell(r.totals[c.key] ?? 0, c.money)}</td>)}
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid rgba(var(--overlay-rgb),0.25)', fontWeight: 700 }}>
            <td style={{ ...td, textAlign: 'left' }}>All</td>
            {columns.map(c => <td key={c.key} style={td}>{cell(sum[c.key], c.money)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
