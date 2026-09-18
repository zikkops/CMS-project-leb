'use client'

// The hourly sales chart (UPGRADE.md T3.4): grouped bars, the day asked about
// beside the same day a week before, with a hover readout per hour. It only
// draws what the server worked out; the page's table says the same in words.
// Module scope (CONTRIBUTING.md gotcha #2).

import { useEffect, useRef, useState } from 'react'
import type { HourlySales } from '@big-cms/shared/salesReports'
import { EmptyState } from '../../../components/ui'
import { usd } from '../ReportRange'

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`
// The day asked about is the page's one colour; last week is the baseline it
// is read against, so it is recessive rather than a second loud hue.
const THIS_DAY = 'var(--teal)'
const LAST_WEEK = 'rgba(var(--offwhite-rgb),0.32)'
const INK_MUTED = 'rgba(var(--offwhite-rgb),0.5)'

/**
 * Hours are drawn from 05:00 round to 04:00, the café's own turn of the night
 * (the till's sessions end at 05:00 too), so an evening that runs past
 * midnight sits together instead of its last hours landing at the far left.
 * Only the drawing order: which hour a sale belongs to is the server's.
 */
const DAY_STARTS = 5
const drawOrder = (hour: number) => (hour - DAY_STARTS + 24) % 24

/** The chart's own width, so its text stays the size it was written at on any screen. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const seen = new ResizeObserver(entries => setWidth(Math.max(280, Math.round(entries[0].contentRect.width))))
    seen.observe(el)
    return () => seen.disconnect()
  }, [])
  return [ref, width]
}

/** Grouped bars, one pair per hour with any sales on either day. Module scope, so it never remounts. */
export function HourChart({ report }: { report: HourlySales }) {
  const [hover, setHover] = useState<number | null>(null)
  const [box, W] = useWidth()
  const ordered = [...report.hours].sort((a, b) => drawOrder(a.hour) - drawOrder(b.hour))
  const active = ordered.filter(h => h.checks > 0 || h.compareChecks > 0)
  if (active.length === 0) return <EmptyState title="Nothing was sold on either day." />
  // The span from the first hour with sales to the last, so a quiet hour in
  // the middle is shown as quiet rather than left out.
  const first = drawOrder(active[0].hour)
  const last = drawOrder(active[active.length - 1].hour)
  const hours = ordered.filter(h => drawOrder(h.hour) >= first && drawOrder(h.hour) <= last)

  const max = Math.max(...hours.map(h => Math.max(h.net, h.compareNet)))
  const step = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find(s => max / s <= 5) ?? Math.ceil(max / 5)
  const top = Math.max(step, Math.ceil(max / step) * step)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)

  const H = 260, left = 52, right = 8, topPad = 10, bottom = 26
  const plotW = W - left - right, plotH = H - topPad - bottom
  const slot = plotW / hours.length
  const barW = Math.max(3, Math.min(18, (slot - 6) / 2))
  const y = (v: number) => topPad + plotH - (v / top) * plotH
  /** A bar with a 4px rounded top, anchored square to the baseline. */
  const bar = (x: number, v: number) => {
    const h = Math.max(0, plotH + topPad - y(v))
    if (h <= 0) return ''
    const r = Math.min(4, h, barW / 2)
    const b = topPad + plotH
    return `M${x},${b} V${b - h + r} Q${x},${b - h} ${x + r},${b - h} H${x + barW - r} Q${x + barW},${b - h} ${x + barW},${b - h + r} V${b} Z`
  }
  const shown = hover === null ? null : hours.find(h => h.hour === hover) ?? null

  return (
    <div ref={box} style={{ position: 'relative', fontFamily: 'var(--font-inter)' }}>
      <div style={{ display: 'flex', gap: '1.2rem', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.75)', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
        <span><span aria-hidden style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: THIS_DAY, marginRight: '0.4rem' }} />{report.day}</span>
        <span><span aria-hidden style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: LAST_WEEK, marginRight: '0.4rem' }} />{report.compareDay}, a week before</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Takings by hour on ${report.day} and ${report.compareDay}; the table below has every figure`} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="rgba(var(--offwhite-rgb),0.08)" strokeWidth={1} />
            <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={INK_MUTED}>{t === 0 ? '$0' : `$${t}`}</text>
          </g>
        ))}
        {hours.map((h, i) => {
          const x0 = left + i * slot + (slot - (barW * 2 + 2)) / 2
          return (
            <g key={h.hour} onMouseEnter={() => setHover(h.hour)} onMouseLeave={() => setHover(null)}>
              {/* The hit target is the whole hour's column, bigger than either bar. */}
              <rect x={left + i * slot} y={topPad} width={slot} height={plotH} fill={hover === h.hour ? 'rgba(var(--offwhite-rgb),0.04)' : 'transparent'} />
              <path d={bar(x0, h.net)} fill={THIS_DAY} />
              <path d={bar(x0 + barW + 2, h.compareNet)} fill={LAST_WEEK} />
              {(slot >= 26 || i % Math.ceil(26 / slot) === 0) && (
                <text x={left + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize="11" fill={INK_MUTED}>{String(h.hour).padStart(2, '0')}</text>
              )}
            </g>
          )
        })}
        <line x1={left} x2={W - right} y1={topPad + plotH} y2={topPad + plotH} stroke="rgba(var(--offwhite-rgb),0.25)" strokeWidth={1} />
      </svg>
      {shown && (
        <div role="status" style={{
          position: 'absolute', top: '2rem', right: 0, pointerEvents: 'none',
          background: '#141414', border: '1px solid rgba(var(--offwhite-rgb),0.16)', borderRadius: '6px',
          padding: '0.5rem 0.7rem', fontSize: '0.8rem', color: 'var(--offwhite)', lineHeight: 1.6,
        }}>
          <strong>{hourLabel(shown.hour)}–{hourLabel((shown.hour + 1) % 24)}</strong><br />
          {report.day}: {usd(shown.net)} · {shown.checks} check{shown.checks === 1 ? '' : 's'}<br />
          <span style={{ color: 'rgba(var(--offwhite-rgb),0.6)' }}>{report.compareDay}: {usd(shown.compareNet)} · {shown.compareChecks}</span>
        </div>
      )}
    </div>
  )
}
