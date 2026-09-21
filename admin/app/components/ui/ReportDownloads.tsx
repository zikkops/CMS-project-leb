'use client'

// CSV and XLSX downloads for any report (UPGRADE.md Tier 7), each opening with
// the header block from shared/src/reportFile.ts: business, report, branches,
// period, currencies, which days it counts, when, and the definitions version.
// This only arranges rows the server already worked out; no arithmetic here.

import { useState } from 'react'
import { faFileCsv, faFileExcel } from '@fortawesome/free-solid-svg-icons'
import { headerRows, reportCsv, reportFileName, type FileColumn, type ReportHeader } from '@big-cms/shared/reportFile'
import { Button } from './index'

export interface ReportSheet<T = unknown> {
  name: string
  columns: readonly FileColumn<T>[]
  rows: readonly T[]
}

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** The CSV is the first sheet, the one a report is about; the workbook holds every sheet and the header. */
export function ReportDownloads({ header, sheets }: { header: ReportHeader; sheets: readonly ReportSheet<never>[] }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const first = sheets[0] as unknown as ReportSheet<unknown> | undefined

  function csv() {
    if (!first) return
    save(new Blob([reportCsv(header, first.columns, first.rows)], { type: 'text/csv;charset=utf-8' }),
      reportFileName(header.report, header.from, header.to, 'csv'))
  }

  async function xlsx() {
    setBusy(true)
    setError('')
    try {
      // The browser bundle, as workbook.ts explains: the bare specifier reads
      // process.versions and throws in a browser.
      const { default: ExcelJS } = await import('exceljs/dist/exceljs.min.js')
      const book = new ExcelJS.Workbook()
      const about = book.addWorksheet('About')
      about.columns = [{ header: 'Field', key: 'k', width: 16 }, { header: 'Value', key: 'v', width: 70 }]
      about.getRow(1).font = { bold: true }
      for (const [k, v] of headerRows(header)) about.addRow({ k, v })
      for (const s of sheets as unknown as ReportSheet<unknown>[]) {
        const sheet = book.addWorksheet(s.name.slice(0, 31))
        sheet.columns = s.columns.map((c, i) => ({ header: c.label, key: `c${i}`, width: Math.max(10, Math.min(40, c.label.length + 4)) }))
        sheet.getRow(1).font = { bold: true }
        for (const r of s.rows) sheet.addRow(Object.fromEntries(s.columns.map((c, i) => [`c${i}`, c.value(r) ?? ''])))
      }
      const buffer = await book.xlsx.writeBuffer()
      save(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        reportFileName(header.report, header.from, header.to, 'xlsx'))
    } catch {
      setError('The workbook could not be made. The CSV still works.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
      <Button icon={faFileCsv} onClick={csv} disabled={!first}>CSV</Button>
      <Button icon={faFileExcel} onClick={() => { void xlsx() }} disabled={busy || !first}>{busy ? 'Making…' : 'Excel'}</Button>
      {error && <span style={{ color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem' }}>{error}</span>}
    </div>
  )
}
