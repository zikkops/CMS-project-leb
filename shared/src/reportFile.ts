// A report as a file the accountant opens (UPGRADE.md Tier 7). Pure, asserted
// by verify:export; the browser only saves what this writes.
//
// Every download starts with the same header block, so a file read months
// later says what it is: business, report, branches, period, currencies,
// which days it counts, when it was made, and the definitions version. Then
// the table. Numbers are written as plain numbers (no currency signs, a dot
// for decimals), so a spreadsheet adds them up without cleaning.

import { REPORT_DEFINITIONS_VERSION, DAY_RULE_LABEL, type DayRule } from './reportDefinitions'

export interface ReportHeader {
  business: string
  report: string
  branches: readonly string[]
  from: string
  to: string
  dayRule: DayRule
  /** An ISO instant. */
  generatedAt: string
  currencies?: readonly string[]
}

export interface FileColumn<T> {
  label: string
  value: (row: T) => string | number | null | undefined
}

/** The header block as label, value pairs, in the order every file shows them. */
export function headerRows(h: ReportHeader): [string, string][] {
  return [
    ['Business', h.business],
    ['Report', h.report],
    ['Branches', h.branches.join(', ') || 'None'],
    ['Period', h.from === h.to ? h.from : `${h.from} to ${h.to}`],
    ['Currencies', (h.currencies ?? ['USD', 'LBP']).join(', ')],
    ['Days', DAY_RULE_LABEL[h.dayRule]],
    ['Generated', h.generatedAt],
    ['Definitions', REPORT_DEFINITIONS_VERSION],
  ]
}

/** One CSV field: quoted when it must be, a leading =+-@ defused so a spreadsheet never runs it as a formula. */
export function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : ''
  const text = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The whole file: header block, a blank line, then the table. CRLF, as spreadsheets expect. */
export function reportCsv<T>(h: ReportHeader, columns: readonly FileColumn<T>[], rows: readonly T[]): string {
  const lines = [
    ...headerRows(h).map(([k, v]) => `${csvField(k)},${csvField(v)}`),
    '',
    columns.map(c => csvField(c.label)).join(','),
    ...rows.map(r => columns.map(c => csvField(c.value(r))).join(',')),
  ]
  return lines.join('\r\n') + '\r\n'
}

/** A file name that sorts by period: voids-and-discounts_2026-09-01_2026-09-30.csv */
export function reportFileName(report: string, from: string, to: string, ext: 'csv' | 'xlsx'): string {
  const slug = report.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${slug}_${from}_${to}.${ext}`
}
