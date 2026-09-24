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

import { useEffect, useId, useState, type ReactNode } from 'react'

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

/** Deliberately duplicated rather than imported — see CLAUDE.md. */
function useIsMobile(bp = 880) {
  const [v, setV] = useState(false)
  useEffect(() => {
    const fn = () => setV(window.innerWidth < bp)
    fn(); window.addEventListener('resize', fn); return () => window.removeEventListener('resize', fn)
  }, [bp])
  return v
}

/**
 * The drawing's own width. The SVG scales to its container, so this is really
 * a choice about how big the text comes out: at 720 units in a 360px-wide
 * phone every label renders at half size, which is why the first version was
 * unreadable on a phone. A narrow viewBox on a narrow screen keeps roughly
 * one unit to one pixel, and the 11px labels stay 11px.
 */
const chartWidth = (isMobile: boolean) => (isMobile ? 360 : 720)
const LABEL_PX = 11
/** Room for the value axis and its numbers. */
const AXIS_W = 56

/**
 * Roughly how wide a string is at LABEL_PX, without touching the DOM.
 * Measuring properly costs a layout read per render, and this only has to be
 * close enough to decide whether a name fits in a column.
 */
const textWidth = (s: string) => s.length * 6.1

/** A name cut to the room it has, with an ellipsis, never overlapping its neighbour. */
function clip(s: string, room: number): string {
  if (textWidth(s) <= room) return s
  const keep = Math.max(1, Math.floor(room / 6.1) - 1)
  return `${s.slice(0, keep).trimEnd()}…`
}

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
 * Magnitude across a handful of named things.
 *
 * It lays itself out on its side when the names will not fit standing up —
 * ten dish names under vertical bars overlap into mush, and squinting past
 * that is not something to ask of a reader. On its side each name has a whole
 * row to itself and reads left to right, which is what a ranked list wants
 * anyway.
 *
 * `diverging` colours each bar by its direction instead of one hue — for a
 * difference, an over and a short.
 */
export function BarChart({ title, note, points, unit, diverging = false, height = 200, layout = 'auto', empty = 'Nothing to show for this period.' }: {
  title?: string
  note?: ReactNode
  points: readonly ChartPoint[]
  unit: ChartUnit
  diverging?: boolean
  height?: number
  /** 'auto' turns the chart on its side when the names need it. */
  layout?: 'auto' | 'vertical' | 'horizontal'
  empty?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const isMobile = useIsMobile()
  const id = useId()
  if (points.length === 0) return <Frame title={title} note={note} table={null}><Empty label={empty} /></Frame>

  const values = points.map(p => p.value)
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const top = niceTop(max)
  const bottom = min < 0 ? -niceTop(-min) : 0
  const span = top - bottom || 1
  const table = <NumbersTable head={['', title ?? 'Value']} rows={points.map(p => [p.label, formatValue(p.value, unit)])} />

  const W = chartWidth(isMobile)
  const nameOf = (p: ChartPoint) => p.short ?? p.label
  const widest = Math.max(...points.map(p => textWidth(nameOf(p))))
  const standing = (W - AXIS_W - 12) / points.length
  // Standing up only while every name fits in its own column, with a little
  // air either side. Otherwise on its side, where there is a row each.
  const sideways = layout === 'horizontal' || (layout === 'auto' && widest > standing - 6)

  if (sideways) {
    const gutter = Math.min(W * 0.42, widest + 8)
    const valueRoom = Math.max(...points.map(p => textWidth(compact(p.value, unit)))) + 14
    const rowH = isMobile ? 30 : 28
    const padT = 6
    const padB = 6
    const plotW = Math.max(20, W - gutter - valueRoom)
    const tall = points.length * rowH + padT + padB
    const x = (v: number) => gutter + ((v - bottom) / span) * plotW
    const zeroX = x(0)
    const barH = Math.min(22, rowH - 6)

    return (
      <Frame title={title} note={note} table={table}>
        <svg viewBox={`0 0 ${W} ${tall}`} style={{ width: '100%', height: 'auto' }} role="img"
          aria-label={`${title ?? 'Chart'}: ${points.length} values, largest ${formatValue(max, unit)}`}>
          {min < 0 && <line x1={zeroX} x2={zeroX} y1={padT} y2={tall - padB} stroke="rgba(var(--offwhite-rgb),0.45)" strokeWidth={1} />}
          {points.map((p, i) => {
            const rowY = padT + i * rowH
            const barY = rowY + (rowH - barH) / 2
            const from = p.value >= 0 ? zeroX : x(p.value)
            const w = Math.max(2, Math.abs(x(p.value) - zeroX))
            const colour = diverging ? (p.value >= 0 ? 'var(--chart-up)' : 'var(--chart-down)') : seriesColour(0)
            return (
              <g key={`${id}-${p.label}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={0} y={rowY} width={W} height={rowH} fill={hover === i ? 'rgba(var(--overlay-rgb),0.06)' : 'transparent'} />
                <text x={gutter - 6} y={rowY + rowH / 2 + 4} textAnchor="end" fill={inkSoft} fontSize={LABEL_PX} fontFamily={font}>
                  {clip(nameOf(p), gutter - 8)}
                  <title>{p.label}</title>
                </text>
                <rect x={from} y={barY} width={w} height={barH} rx={4} fill={colour} opacity={hover === null || hover === i ? 1 : 0.55} />
                {/* Every value in one column at the right, not trailing its
                    own bar: a short negative bar's figure landed on top of
                    the name, and a column is easier to read down anyway. The
                    bars can never reach it — valueRoom is held back from
                    plotW. */}
                <text x={W - 2} y={rowY + rowH / 2 + 4} textAnchor="end" fill={inkSoft} fontSize={LABEL_PX} fontFamily={font}>
                  {compact(p.value, unit)}
                </text>
              </g>
            )
          })}
        </svg>
      </Frame>
    )
  }

  const padL = AXIS_W
  const padR = 12
  const padT = 14
  const padB = 34
  const tall = isMobile ? Math.max(height, 180) : height
  const plotW = W - padL - padR
  const plotH = tall - padT - padB
  const y = (v: number) => padT + ((top - v) / span) * plotH
  const zeroY = y(0)
  // 2px of surface between bars, whatever the count (a gap, not a ratio).
  const slot = plotW / points.length
  const barW = Math.max(3, Math.min(48, slot - 2))
  // Keep only the names that fit, and always the last one.
  const every = Math.max(1, Math.ceil(widest / Math.max(1, slot - 4)))

  return (
    <Frame title={title} note={note} table={table}>
      <div style={{ position: 'relative' }}>
        {/* Scaled by width, with the height following: a fixed height and a
            viewBox of its own aspect letterboxes the drawing in a narrow
            column, which reads as a chart floating in a gap. */}
        <svg viewBox={`0 0 ${W} ${tall}`} style={{ width: '100%', height: 'auto' }} role="img"
          aria-label={`${title ?? 'Chart'}: ${points.length} values, largest ${formatValue(max, unit)}`}>
          {[top, (top + bottom) / 2, bottom].map(v => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={inkFaint} strokeWidth={1} />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" fill={inkSoft} fontSize={LABEL_PX} fontFamily={font}>{compact(v, unit)}</text>
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
            <text key={`x-${i}`} x={padL + i * slot + slot / 2} y={tall - 12} textAnchor="middle" fill={inkSoft} fontSize={LABEL_PX} fontFamily={font}>
              {clip(nameOf(p), slot + 6)}
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
  const isMobile = useIsMobile()
  const live = series.filter(s => s.points.length > 0)
  if (live.length === 0) return <Frame title={title} note={note} table={null}><Empty label={empty} /></Frame>

  const labels = live[0].points.map(p => p.label)
  const all = live.flatMap(s => s.points.map(p => p.value))
  const max = Math.max(0, ...all)
  const min = Math.min(0, ...all)
  const top = niceTop(max)
  const bottom = min < 0 ? -niceTop(-min) : 0
  const span = top - bottom || 1

  const W = chartWidth(isMobile)
  const padL = AXIS_W
  // No room on a phone to write the series name beside its last point: the
  // legend under the chart carries identity there instead.
  const named = live.length > 1 && !isMobile
  const padR = named ? 92 : 14
  const padT = 14
  const padB = 34
  const tall = isMobile ? Math.max(height, 200) : height
  const plotW = W - padL - padR
  const plotH = tall - padT - padB
  const x = (i: number) => padL + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW)
  const y = (v: number) => padT + ((top - v) / span) * plotH
  // Thin the dates to what actually fits, not to a guessed count: eight
  // 'MM-DD' labels do not fit in 300 units however few of them there are.
  const widestLabel = Math.max(...live[0].points.map(p => textWidth(p.short ?? p.label)))
  const every = Math.max(1, Math.ceil(widestLabel / Math.max(1, plotW / Math.max(1, labels.length - 1))))
  // The last date always shows, so any kept label too close to it is dropped
  // rather than drawn over it: '09-13' and '09-14' ran together at the right
  // edge until this. Half a label's width each side is the clearance.
  const last = labels.length - 1
  const shownLabels = labels
    .map((_, i) => i)
    .filter(i => i === last || (i % every === 0 && x(last) - x(i) >= widestLabel))

  return (
    <Frame
      title={title}
      note={note}
      table={<NumbersTable
        head={['', ...live.map(s => s.name)]}
        rows={labels.map((label, i) => [label, ...live.map(s => formatValue(s.points[i]?.value ?? 0, unit))])} />}
    >
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${tall}`} style={{ width: '100%', height: 'auto' }} role="img"
          aria-label={`${title ?? 'Chart'}: ${live.map(s => s.name).join(', ')} over ${labels.length} points`}
          onMouseLeave={() => setHover(null)}>
          {[top, (top + bottom) / 2, bottom].map(v => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={inkFaint} strokeWidth={1} />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" fill={inkSoft} fontSize={LABEL_PX} fontFamily={font}>{compact(v, unit)}</text>
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
                {named && (
                  <text x={W - padR + 6} y={y(s.points[s.points.length - 1]?.value ?? 0) + 4} fill={seriesColour(si)} fontSize={LABEL_PX} fontFamily={font}>
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
          {shownLabels.map(i => (
            <text key={`x-${i}`} x={x(i)} y={tall - 12} textAnchor="middle" fill={inkSoft} fontSize={LABEL_PX} fontFamily={font}>
              {live[0].points[i]?.short ?? labels[i]}
            </text>
          ))}
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
