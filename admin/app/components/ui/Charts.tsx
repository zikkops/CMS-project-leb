'use client'

// The charts the reports are drawn with (UPGRADE.md T7.19).
//
// Inline SVG, in the same hand-written style as every other admin control: no
// chart library, no classes. Two forms cover what these reports ask:
//
//   BarChart   magnitude, compared across a handful of named things — a day,
//              a branch, a supplier, an item. Bars start at zero, always.
//   LineChart  change over time, one or more series, with a crosshair.
//
// Rules these follow, so the charts are right rather than pretty:
//   · Series colours come from --chart-1…6 in fixed order and are never
//     cycled; a seventh thing folds into "Other" at the call site.
//   · One value axis. Two measures of different sizes are two charts.
//   · A bar that can go either way is coloured by direction (up / down), not
//     by rank, and the zero line is drawn.
//   · Every chart is hoverable, and carries the same numbers as a table
//     underneath, so nothing is only available by eye or only by colour.
//   · Grid and axes recede; the marks carry the ink.

import { useId, useState, type ReactNode } from 'react'

export type ChartUnit = 'usd' | 'lbp' | 'count' | 'percent' | 'hours'

export interface ChartPoint {
  /** What the mark is: a day, a branch, an item. */
  label: string
  value: number
  /** A shorter label for the axis, when the full one is long. */
  short?: string
}

export interface ChartSeries {
  name: string
  points: ChartPoint[]
}

const SERIES_VARS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'] as const

/** The colour of series i, in fixed order. Past the sixth, the call site folds the rest into "Other". */
export const seriesColour = (i: number): string => `var(${SERIES_VARS[Math.min(i, SERIES_VARS.length - 1)]})`

const ink = 'var(--offwhite)'
const inkSoft = 'rgba(var(--offwhite-rgb),0.62)'
const inkFaint = 'rgba(var(--overlay-rgb),0.12)'
const font = 'var(--font-inter)'

/** How a value is written, by what it is. */
export function formatValue(value: number, unit: ChartUnit): string {
  if (unit === 'usd') return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (unit === 'lbp') return `${Math.round(value).toLocaleString('en-US')} LBP`
  if (unit === 'percent') return `${(value * 100).toFixed(1)}%`
  if (unit === 'hours') return `${value.toFixed(1)} h`
  return value.toLocaleString('en-US')
}

/** A short form for an axis: $1.2k rather than $1,234.56. */
function compact(value: number, unit: ChartUnit): string {
  if (unit === 'percent') return `${Math.round(value * 100)}%`
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  const short = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}m`
    : abs >= 1_000 ? `${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`
      : String(Math.round(abs * 100) / 100)
  return unit === 'usd' ? `${sign}$${short}` : `${sign}${short}`
}

/** A round number at or above the biggest value, so the axis reads 0 / 500 / 1,000. */
function niceTop(max: number): number {
  if (!(max > 0)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (max <= step * magnitude) return step * magnitude
  }
  return 10 * magnitude
}

function Frame({ title, note, children, table }: { title?: string; note?: ReactNode; children: ReactNode; table: ReactNode }) {
  return (
    <figure style={{ margin: '0 0 1.2rem', fontFamily: font }}>
      {title && <figcaption style={{ color: ink, fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.15rem' }}>{title}</figcaption>}
      {note && <p style={{ color: inkSoft, fontSize: '0.82rem', margin: '0 0 0.5rem' }}>{note}</p>}
      {children}
      {/* No table when there is nothing to draw: a disclosure that opens on
          nothing reads as a chart that failed rather than a period with no
          sales in it. */}
      {table !== null && (
        <details style={{ marginTop: '0.4rem' }}>
          <summary style={{ color: inkSoft, fontSize: '0.78rem', cursor: 'pointer' }}>Show the numbers</summary>
          {table}
        </details>
      )}
    </figure>
  )
}

function NumbersTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  const cell = { padding: '0.3rem 0.6rem', fontSize: '0.82rem', color: ink, textAlign: 'right' as const }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontFamily: font, marginTop: '0.4rem' }}>
        <thead>
          <tr>{head.map((h, i) => <th key={h} style={{ ...cell, color: inkSoft, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} style={{ ...cell, textAlign: j === 0 ? 'left' : 'right' }}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Empty({ label }: { label: string }) {
  return <p style={{ fontFamily: font, color: inkSoft, fontSize: '0.88rem', padding: '1rem 0' }}>{label}</p>
}

/**
 * Magnitude across a handful of named things. `diverging` colours each bar by
 * its direction instead of one hue — for a difference, an over and a short.
 */
export function BarChart({ title, note, points, unit, diverging = false, height = 200, empty = 'Nothing to show for this period.' }: {
  title?: string
  note?: ReactNode
  points: readonly ChartPoint[]
  unit: ChartUnit
  diverging?: boolean
  height?: number
  empty?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  if (points.length === 0) return <Frame title={title} note={note} table={null}><Empty label={empty} /></Frame>

  const values = points.map(p => p.value)
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const top = niceTop(max)
  const bottom = min < 0 ? -niceTop(-min) : 0
  const span = top - bottom || 1

  const W = 720
  const padL = 56
  const padR = 12
  const padT = 14
  const padB = 34
  const plotW = W - padL - padR
  const plotH = height - padT - padB
  const y = (v: number) => padT + ((top - v) / span) * plotH
  const zeroY = y(0)
  // 2px of surface between bars, whatever the count (a gap, not a ratio).
  const slot = plotW / points.length
  const barW = Math.max(3, Math.min(48, slot - 2))
  // Every label would collide past a dozen or so: thin them, keep the ends.
  const every = Math.ceil(points.length / 12)

  return (
    <Frame
      title={title}
      note={note}
      table={<NumbersTable head={['', title ?? 'Value']} rows={points.map(p => [p.label, formatValue(p.value, unit)])} />}
    >
      <div style={{ position: 'relative' }}>
        {/* Scaled by width, with the height following: a fixed height and a
            viewBox of its own aspect letterboxes the drawing in a narrow
            column, which reads as a chart floating in a gap. */}
        <svg viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height: 'auto' }} role="img"
          aria-label={`${title ?? 'Chart'}: ${points.length} values, largest ${formatValue(max, unit)}`}>
          {[top, (top + bottom) / 2, bottom].map(v => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={inkFaint} strokeWidth={1} />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" fill={inkSoft} fontSize={11} fontFamily={font}>{compact(v, unit)}</text>
            </g>
          ))}
          {points.map((p, i) => {
            const x = padL + i * slot + (slot - barW) / 2
            const top0 = p.value >= 0 ? y(p.value) : zeroY
            const h = Math.max(2, Math.abs(y(p.value) - zeroY))
            const colour = diverging
              ? (p.value >= 0 ? 'var(--chart-up)' : 'var(--chart-down)')
              : seriesColour(0)
            return (
              <g key={`${id}-${p.label}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {/* A hit target the whole height of the plot: a 3px bar is not something to aim at. */}
                <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" />
                <rect x={x} y={top0} width={barW} height={h} rx={4} fill={colour} opacity={hover === null || hover === i ? 1 : 0.55} />
              </g>
            )
          })}
          {min < 0 && <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="rgba(var(--offwhite-rgb),0.45)" strokeWidth={1} />}
          {points.map((p, i) => (i % every === 0 || i === points.length - 1 ? (
            <text key={`x-${i}`} x={padL + i * slot + slot / 2} y={height - 12} textAnchor="middle" fill={inkSoft} fontSize={11} fontFamily={font}>
              {p.short ?? p.label}
            </text>
          ) : null))}
        </svg>
        {hover !== null && (
          <div role="status" style={{
            position: 'absolute', left: `${((padL + hover * slot + slot / 2) / W) * 100}%`, top: 0, transform: 'translateX(-50%)',
            background: 'var(--surface-deep)', border: '1px solid rgba(var(--overlay-rgb),0.18)', borderRadius: '6px',
            padding: '0.35rem 0.6rem', fontSize: '0.82rem', color: ink, pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>
            <strong>{points[hover].label}</strong> · {formatValue(points[hover].value, unit)}
          </div>
        )}
      </div>
    </Frame>
  )
}

/**
 * Change over time. One series needs no legend — the title names it; two or
 * more get one, and are direct-labelled at the last point, so identity never
 * rests on colour alone.
 */
export function LineChart({ title, note, series, unit, height = 220, empty = 'Nothing to show for this period.' }: {
  title?: string
  note?: ReactNode
  series: readonly ChartSeries[]
  unit: ChartUnit
  height?: number
  empty?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const live = series.filter(s => s.points.length > 0)
  if (live.length === 0) return <Frame title={title} note={note} table={null}><Empty label={empty} /></Frame>

  const labels = live[0].points.map(p => p.label)
  const all = live.flatMap(s => s.points.map(p => p.value))
  const max = Math.max(0, ...all)
  const min = Math.min(0, ...all)
  const top = niceTop(max)
  const bottom = min < 0 ? -niceTop(-min) : 0
  const span = top - bottom || 1

  const W = 720
  const padL = 56
  const padR = live.length > 1 ? 92 : 14
  const padT = 14
  const padB = 34
  const plotW = W - padL - padR
  const plotH = height - padT - padB
  const x = (i: number) => padL + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW)
  const y = (v: number) => padT + ((top - v) / span) * plotH
  const every = Math.ceil(labels.length / 10)

  return (
    <Frame
      title={title}
      note={note}
      table={<NumbersTable
        head={['', ...live.map(s => s.name)]}
        rows={labels.map((label, i) => [label, ...live.map(s => formatValue(s.points[i]?.value ?? 0, unit))])} />}
    >
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height: 'auto' }} role="img"
          aria-label={`${title ?? 'Chart'}: ${live.map(s => s.name).join(', ')} over ${labels.length} points`}
          onMouseLeave={() => setHover(null)}>
          {[top, (top + bottom) / 2, bottom].map(v => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={inkFaint} strokeWidth={1} />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" fill={inkSoft} fontSize={11} fontFamily={font}>{compact(v, unit)}</text>
            </g>
          ))}
          {min < 0 && <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="rgba(var(--offwhite-rgb),0.45)" strokeWidth={1} />}

          {live.map((s, si) => {
            const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ')
            return (
              <g key={s.name}>
                <path d={d} fill="none" stroke={seriesColour(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {/* Few enough points to aim at: draw them. */}
                {s.points.length <= 20 && s.points.map((p, i) => (
                  <circle key={i} cx={x(i)} cy={y(p.value)} r={4} fill={seriesColour(si)} stroke="var(--black)" strokeWidth={2} />
                ))}
                {live.length > 1 && (
                  <text x={W - padR + 6} y={y(s.points[s.points.length - 1]?.value ?? 0) + 4} fill={seriesColour(si)} fontSize={11} fontFamily={font}>
                    {s.name}
                  </text>
                )}
              </g>
            )
          })}

          {/* The crosshair, and a hit column per point. */}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="rgba(var(--offwhite-rgb),0.35)" strokeWidth={1} />}
          {labels.map((label, i) => (
            <rect key={`hit-${label}-${i}`} x={x(i) - plotW / Math.max(1, labels.length * 2) - 1} y={padT}
              width={Math.max(6, plotW / Math.max(1, labels.length))} height={plotH} fill="transparent"
              onMouseEnter={() => setHover(i)} />
          ))}
          {labels.map((label, i) => (i % every === 0 || i === labels.length - 1 ? (
            <text key={`x-${label}-${i}`} x={x(i)} y={height - 12} textAnchor="middle" fill={inkSoft} fontSize={11} fontFamily={font}>
              {live[0].points[i]?.short ?? label}
            </text>
          ) : null))}
        </svg>
        {hover !== null && (
          <div role="status" style={{
            position: 'absolute', left: `${(x(hover) / W) * 100}%`, top: 0, transform: 'translateX(-50%)',
            background: 'var(--surface-deep)', border: '1px solid rgba(var(--overlay-rgb),0.18)', borderRadius: '6px',
            padding: '0.4rem 0.65rem', fontSize: '0.82rem', color: ink, pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>
            <strong>{labels[hover]}</strong>
            {live.map((s, si) => (
              <span key={s.name} style={{ display: 'block' }}>
                <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: seriesColour(si), marginRight: 6 }} />
                {live.length > 1 ? `${s.name}: ` : ''}{formatValue(s.points[hover]?.value ?? 0, unit)}
              </span>
            ))}
          </div>
        )}
        {live.length > 1 && (
          <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
            {live.map((s, si) => (
              <span key={s.name} style={{ color: inkSoft, fontSize: '0.8rem' }}>
                <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: seriesColour(si), marginRight: 6 }} />
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Frame>
  )
}
