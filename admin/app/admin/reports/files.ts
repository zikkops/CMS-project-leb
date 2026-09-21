// What each report's download holds (UPGRADE.md T7.1b): the sheets, their
// columns as plain values, and the header block. The figures come from the
// server's answer as they are; nothing here adds anything up.

import { BRAND } from '@big-cms/shared/brand'
import type { FileColumn, ReportHeader } from '@big-cms/shared/reportFile'
import type { DayRule } from '@big-cms/shared/reportDefinitions'
import {
  DISCOUNT_KIND_LABELS, type DiscountRow, type HourRow, type MixCategory, type MixItem, type Tally, type VoidRow,
} from '@big-cms/shared/salesReports'
import type { PersonHours, Shift } from '@big-cms/shared/timeClock'
import type { ReportSheet } from '../../components/ui/ReportDownloads'

export function reportHeader(report: string, from: string, to: string, branches: readonly string[], dayRule: DayRule = 'calendar'): ReportHeader {
  return { business: BRAND.name, report, from, to, branches, dayRule, generatedAt: new Date().toISOString(), currencies: ['USD'] }
}

const sheet = <T,>(name: string, columns: FileColumn<T>[], rows: readonly T[]) => ({ name, columns, rows }) as unknown as ReportSheet<never>

export function voidSheets(r: { voids: VoidRow[]; discounts: DiscountRow[]; voidsByReason: Tally[]; discountsByReason: Tally[] }): ReportSheet<never>[] {
  return [
    sheet<VoidRow>('Voids', [
      { label: 'Day', value: v => v.day }, { label: 'Time', value: v => v.time }, { label: 'Branch', value: v => v.branch },
      { label: 'Receipt', value: v => v.receipt }, { label: 'Table or order', value: v => v.table }, { label: 'Item', value: v => v.item },
      { label: 'Quantity', value: v => v.quantity }, { label: 'Value USD (incl. VAT)', value: v => v.value },
      { label: 'Reason', value: v => v.reason }, { label: 'Waste', value: v => (v.waste ? 'yes' : 'no') },
      { label: 'After sending', value: v => (v.afterSending ? 'yes' : 'no') }, { label: 'By', value: v => v.by },
    ], r.voids),
    sheet<DiscountRow>('Discounts', [
      { label: 'Day', value: d => d.day }, { label: 'Time', value: d => d.time }, { label: 'Branch', value: d => d.branch },
      { label: 'Receipt', value: d => d.receipt }, { label: 'Kind', value: d => DISCOUNT_KIND_LABELS[d.kind] },
      { label: 'Item', value: d => d.item ?? '' }, { label: 'Took off USD (incl. VAT)', value: d => d.amount },
      { label: 'Reason', value: d => d.reason }, { label: 'By', value: d => d.by },
    ], r.discounts),
    sheet<Tally>('Voids by reason', [{ label: 'Reason', value: t => t.label }, { label: 'Count', value: t => t.count }, { label: 'Value USD', value: t => t.value }], r.voidsByReason),
    sheet<Tally>('Discounts by reason', [{ label: 'Reason', value: t => t.label }, { label: 'Count', value: t => t.count }, { label: 'Value USD', value: t => t.value }], r.discountsByReason),
  ]
}

type Costed = { netSales: number; costedSales: number; cost: number | null; margin: number | null; marginPercent: number | null; coverage: number | null }

/** Cost and margin (T7.8): blank, never 0, where nothing could be costed. */
function costColumns<T extends Costed>(): FileColumn<T>[] {
  const p = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 100)
  return [
    { label: 'Net sales USD (excl. VAT and service, after all discounts)', value: r => r.netSales },
    { label: 'Costed sales USD', value: r => r.costedSales },
    { label: 'Recipe cost USD', value: r => r.cost },
    { label: 'Gross margin USD', value: r => r.margin },
    { label: 'Gross margin %', value: r => p(r.marginPercent) },
    { label: 'Costed share of net sales %', value: r => p(r.coverage) },
  ]
}

export function mixSheets(r: { items: MixItem[]; categories: MixCategory[] }): ReportSheet<never>[] {
  return [
    sheet<MixItem>('Items', [
      { label: 'Item', value: i => i.name }, { label: 'Category', value: i => i.category }, { label: 'Quantity', value: i => i.quantity },
      { label: 'Revenue USD (incl. VAT, before check discounts)', value: i => i.revenue }, { label: 'Share %', value: i => Math.round(i.share * 10000) / 100 },
      { label: 'Made in combos', value: i => i.inCombos },
      ...costColumns<MixItem>(),
      { label: 'Lines with an uncosted ingredient', value: i => i.uncostedLines }, { label: 'Lines with no recipe', value: i => i.noRecipeLines },
    ], r.items),
    sheet<MixCategory>('Categories', [
      { label: 'Category', value: c => c.category }, { label: 'Items', value: c => c.items }, { label: 'Quantity', value: c => c.quantity },
      { label: 'Revenue USD', value: c => c.revenue }, { label: 'Share %', value: c => Math.round(c.share * 10000) / 100 },
      ...costColumns<MixCategory>(),
    ], r.categories),
  ]
}

export function hourlySheets(r: { hours: HourRow[] }): ReportSheet<never>[] {
  return [sheet<HourRow>('Hours', [
    { label: 'Hour', value: h => `${String(h.hour).padStart(2, '0')}:00` }, { label: 'Checks', value: h => h.checks },
    { label: 'Takings USD (incl. VAT)', value: h => h.net }, { label: 'Week before, checks', value: h => h.compareChecks },
    { label: 'Week before, takings USD', value: h => h.compareNet },
  ], r.hours)]
}

export function timesheetSheets(r: { people: PersonHours[]; shifts: Shift[] }): ReportSheet<never>[] {
  const at = (ms: number | null) => (ms === null ? '' : new Date(ms).toLocaleString('en-GB', { timeZone: BRAND.locale.timezone }))
  return [
    sheet<Shift>('Shifts', [
      { label: 'Day', value: s => s.day }, { label: 'Name', value: s => s.name }, { label: 'Branch', value: s => s.branch },
      { label: 'In', value: s => at(s.inAt) }, { label: 'Out', value: s => at(s.outAt) },
      { label: 'Minutes', value: s => s.minutes }, { label: 'Over 16 hours', value: s => (s.long ? 'yes' : 'no') },
    ], r.shifts),
    sheet<PersonHours>('By person', [
      { label: 'Name', value: p => p.name }, { label: 'Shifts', value: p => p.shifts }, { label: 'Minutes', value: p => p.minutes },
      { label: 'Still clocked in', value: p => (p.open ? 'yes' : 'no') },
    ], r.people),
  ]
}
