// Pure invoice-number formatting. Deliberately NOT 'use client' and with no
// Firebase import, so both the browser and route handlers can use it — the
// sequence is issued server-side (the counter document is admin-only in the
// rules) while the string is rendered in both places.
//
// Format: OB-Q1-012026-0001
//   OB      fixed prefix
//   Q1      calendar quarter — Q1 = Jan–Mar … Q4 = Oct–Dec
//   01      month, two digits
//   2026    year
//   0001    sequence, four digits, resets each calendar year

// 1 = January (calendar quarters). Set to 7 for a July–June fiscal year.
export const FISCAL_YEAR_START_MONTH = 1

export function quarterOf(date: Date): number {
  const offset = (date.getMonth() - (FISCAL_YEAR_START_MONTH - 1) + 12) % 12
  return Math.floor(offset / 3) + 1
}

export function formatInvoiceNumber(sequence: number, issuedAt: Date = new Date()): string {
  const q = quarterOf(issuedAt)
  const mm = String(issuedAt.getMonth() + 1).padStart(2, '0')
  return `OB-Q${q}-${mm}${issuedAt.getFullYear()}-${String(sequence).padStart(4, '0')}`
}

// One regex, used by the route to validate a number that arrived from a
// browser before it goes anywhere near an outgoing email.
export const INVOICE_NUMBER_PATTERN = /^OB-Q[1-4]-\d{6}-\d{4,}$/
