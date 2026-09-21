'use client'

// A report of named figures down the side and branches across, with an "All"
// column that is the server's sum of the branches (UPGRADE.md T7.1). Used by
// the sales, payments and VAT reports, and by their downloads, so the screen
// and the file always show the same table.

import type { FileColumn } from '@big-cms/shared/reportFile'
import { DataTable, type Column } from '../../components/ui'
import type { ReportSheet } from '../../components/ui/ReportDownloads'

export type FigureKind = 'count' | 'usd' | 'lbp' | 'percent'

export interface FigureDef<K extends string> { key: K; label: string; kind: FigureKind }

interface Row { key: string; label: string; kind: FigureKind; values: number[] }

export function formatFigure(kind: FigureKind, v: number): string {
  switch (kind) {
    case 'usd': return `$${v.toFixed(2)}`
    case 'lbp': return `${Math.round(v).toLocaleString('en-US')} LBP`
    case 'percent': return `${(v * 100).toFixed(2)}%`
    default: return v.toLocaleString('en-US')
  }
}

function build<K extends string>(defs: readonly FigureDef<K>[], byBranch: readonly { branch: string; figures: Record<K, number> }[], total: Record<K, number>, fallback: string) {
  const several = byBranch.length > 1
  const heads = several ? [...byBranch.map(b => b.branch), 'All'] : [byBranch[0]?.branch ?? fallback]
  const cols = several ? [...byBranch.map(b => b.figures), total] : [total]
  const rows: Row[] = defs.map(d => ({ key: d.key, label: d.label, kind: d.kind, values: cols.map(c => c[d.key]) }))
  return { heads, rows }
}

export function FiguresTable<K extends string>({ defs, byBranch, total }: {
  defs: readonly FigureDef<K>[]
  byBranch: readonly { branch: string; figures: Record<K, number> }[]
  total: Record<K, number>
}) {
  const { heads, rows } = build(defs, byBranch, total, 'All')
  const columns: Column<Row>[] = [
    { key: 'label', label: 'Figure', render: r => r.label },
    ...heads.map((h, i) => ({ key: `c${i}`, label: h, align: 'right' as const, render: (r: Row) => formatFigure(r.kind, r.values[i]) })),
  ]
  return <DataTable columns={columns} rows={rows} rowKey={r => r.key} empty="Nothing to show." />
}

/** The same table as a download sheet: plain numbers, a column per branch and All. */
export function figuresSheet<K extends string>(name: string, defs: readonly FigureDef<K>[], byBranch: readonly { branch: string; figures: Record<K, number> }[], total: Record<K, number>): ReportSheet<never> {
  const { heads, rows } = build(defs, byBranch, total, 'All')
  const columns: FileColumn<Row>[] = [
    { label: 'Figure', value: r => r.label },
    ...heads.map((h, i) => ({ label: h, value: (r: Row) => r.values[i] })),
  ]
  return { name, columns, rows } as unknown as ReportSheet<never>
}
