'use client'

// Turning the export the server built into a file somebody can open.
//
// Admin-only, so it lives in the admin app rather than in shared (CLAUDE.md:
// an app's own code stays in that app). The figures are not computed here —
// shared/src/salesExport.ts did that, on the server, and this only arranges
// them into sheets. Nothing in this file may do arithmetic on money: the
// moment it does, there are two answers to what a day took.

import { SHEETS, type SalesExport } from '@big-cms/shared/salesExport'
import { LOYALTY_SHEETS, type LoyaltyExport } from '@big-cms/shared/loyaltyExport'

type Row = Record<string, unknown>

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Columns wide enough to read without dragging — an accountant opens this once. */
const WIDTH: Record<string, number> = {
  receipt: 12, day: 12, time: 8, branch: 14, table: 8, order: 10, guests: 8, status: 11,
  gross: 12, staffMeal: 12, itemDiscounts: 14, checkDiscount: 14, service: 10, net: 12,
  vatRate: 10, vat: 14, rate: 12, netLbp: 16, cashUsd: 12, cashLbp: 16,
  card: 12, server: 26, tender: 10, currency: 10, amount: 14, appliedLbp: 16,
  changeUsd: 13, changeLbp: 14, checks: 10, discounts: 12, refunds: 14,
  refundedChecks: 16,
  // Loyalty
  // `net` is not repeated here — the sales sheets already set it above, and a
  // duplicate key is a type error rather than a merge.
  type: 10, perPerson: 12, people: 9, issued: 13, reversed: 14, spent: 12,
  transactions: 13, redemptions: 13, item: 24, cost: 10,
  eventName: 22, checkNumber: 14, submittedBy: 26, approvedBy: 26,
  confirmedBy: 26, userId: 26, id: 24,
}

/**
 * Three sheets, because three questions get asked: what did each day take,
 * what was every check, and how was each one paid.
 *
 * exceljs is imported dynamically, and from its browser bundle specifically —
 * the bare specifier resolves to the Node entry point, which reads
 * process.versions at import time and throws in a browser. The same note is
 * on exportCustomersToExcel(); it is the kind of thing that looks like a
 * bundler problem for an hour.
 */
export async function downloadSalesWorkbook(data: SalesExport, from: string, to: string): Promise<void> {
  const { default: ExcelJS } = await import('exceljs/dist/exceljs.min.js')
  const workbook = new ExcelJS.Workbook()

  const sheets: [string, readonly (readonly [string, string])[], readonly Row[]][] = [
    ['By day', SHEETS.days, data.days as unknown as Row[]],
    ['Checks', SHEETS.checks, data.checks as unknown as Row[]],
    ['Payments', SHEETS.payments, data.payments as unknown as Row[]],
  ]
  for (const [name, spec, rows] of sheets) {
    const sheet = workbook.addWorksheet(name)
    sheet.columns = spec.map(([key, header]) => ({ header, key, width: WIDTH[key] ?? 14 }))
    sheet.getRow(1).font = { bold: true }
    for (const row of rows) sheet.addRow(row)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  download(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `sales-${from}-to-${to}.xlsx`,
  )
}

/**
 * The points ledger, in the same three-sheet shape: what the liability did
 * each day, every transaction, every redemption.
 */
export async function downloadLoyaltyWorkbook(data: LoyaltyExport, from: string, to: string): Promise<void> {
  const { default: ExcelJS } = await import('exceljs/dist/exceljs.min.js')
  const workbook = new ExcelJS.Workbook()

  const sheets: [string, readonly (readonly [string, string])[], readonly Row[]][] = [
    ['By day', LOYALTY_SHEETS.days, data.days as unknown as Row[]],
    ['Points', LOYALTY_SHEETS.points, data.points as unknown as Row[]],
    ['Redemptions', LOYALTY_SHEETS.redemptions, data.redemptions as unknown as Row[]],
  ]
  for (const [name, spec, rows] of sheets) {
    const sheet = workbook.addWorksheet(name)
    sheet.columns = spec.map(([key, header]) => ({ header, key, width: WIDTH[key] ?? 14 }))
    sheet.getRow(1).font = { bold: true }
    for (const row of rows) sheet.addRow(row)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  download(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `loyalty-${from}-to-${to}.xlsx`,
  )
}

/**
 * The day summary as CSV, for whoever would rather not open a spreadsheet
 * application to look at twelve rows.
 *
 * The leading BOM is not decoration: without it Excel opens a UTF-8 CSV as
 * the system codepage, and every café name with an accent in it arrives
 * mangled. Same trick as the product library export.
 */
export function downloadDaysCsv(data: SalesExport, from: string, to: string): void {
  const cell = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = [
    SHEETS.days.map(([, header]) => cell(header)).join(','),
    ...data.days.map(day => SHEETS.days.map(([key]) => cell((day as unknown as Row)[key])).join(',')),
  ].join('\r\n')
  download(new Blob(['\uFEFF' + rows], { type: 'text/csv;charset=utf-8;' }), `sales-by-day-${from}-to-${to}.csv`)
}
