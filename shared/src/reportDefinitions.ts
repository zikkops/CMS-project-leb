// What every reported figure means (UPGRADE.md Tier 7). Pure.
//
// One place for the words and the rules, so two reports cannot call different
// numbers by one name (docs/reporting.md, gap 10). The version travels in every
// download's header block: a file read months later says which definitions
// produced it. Change the version whenever a definition changes.

export const REPORT_DEFINITIONS_VERSION = '2026-09-21.1'

/**
 * The café day (docs/reporting.md, gap 5; decided 21 Sep 2026 under T7.1b).
 *
 * Sales, VAT and every accounting report use the CALENDAR day in the café's
 * zone: a receipt is a tax document dated when it was issued, so a sale at
 * 01:30 is on that date, as on the receipt. Counting cash uses the CASH-UP day
 * (before 10:00 is the night before): a drawer is counted once per night, not
 * cut at midnight. So cash is reconciled per shift, never per calendar day
 * (T7.7, T7.16), and each report says which day it uses.
 */
export type DayRule = 'calendar' | 'cashUp'

export const DAY_RULE_LABEL: Record<DayRule, string> = {
  calendar: 'Calendar days in the café\'s time zone (a sale at 01:30 is on that date, as on its receipt)',
  cashUp: 'Cash-up days (before 10:00 counts as the night before)',
}

/** The figure names every report and download uses; T7.3 adds the rest. */
export const FIGURE_LABELS = {
  grossSales: 'Gross sales',
  netSales: 'Net sales (excl. VAT and service)',
  vatOutput: 'VAT output',
  service: 'Service charge',
  cardTips: 'Card tips (owed to staff)',
  refunds: 'Refunds',
  collected: 'Collected',
} as const
