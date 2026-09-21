// The sales summary (UPGRADE.md T7.3): the report an accountant asks for
// first. Pure, asserted by verify:export; built from the export's own rows
// (checkRow / refundRow in salesExport.ts), so the summary and the export
// cannot disagree about a single check.
//
// The definitions (docs/reporting.md, section 1):
//   - Gross sales: menu and shop prices before any discount, VAT included, as
//     the customer sees them.
//   - Discounts: staff meals, item discounts (comps and % off) and check
//     discounts, each on its own line.
//   - Service charge: its own line, VAT included by default (T7.0). Its VAT
//     share is shown apart, so a different ruling is one switch.
//   - Net sales: what the goods sold for after discounts, EXCLUDING VAT and
//     service. This is the "net" an accountant means; the export's old "Net"
//     was the bill (gap 6).
//   - VAT output: extracted from each check's bill at its own rate. A check
//     from before the rate was recorded contributes none and is counted.
//   - Refunds: credited in the period they were given (T7.4), as their own
//     lines, never netted into the day's sales.
//   - Card tips: owed to staff, shown apart and never inside sales or billed.
//
// Every total is the SUM of the branch columns, never a separate calculation
// (T7.1): the consolidated figures are built by adding the branches up.

import type { CheckRow } from './salesExport'
import { vatIncluded } from './money'

export interface SalesFigures {
  checks: number
  guests: number
  grossSales: number
  staffMeals: number
  itemDiscounts: number
  checkDiscounts: number
  /** The bill: goods after discounts, plus service, VAT included. */
  billed: number
  serviceCharge: number
  serviceVat: number
  /** Goods after discounts, excluding VAT and service. */
  netSales: number
  /** VAT on the goods only. */
  goodsVat: number
  /** VAT on goods and service together, as each receipt prints it. */
  vatOutput: number
  refundsGiven: number
  refundsBilled: number
  refundsNetSales: number
  refundsVat: number
  /** Net sales less refunds given in the period. */
  netSalesAfterRefunds: number
  cardTips: number
  /** Billed in lira at each check's own rate. */
  billedLbp: number
  /** Checks with no VAT rate recorded: they contribute no VAT, never a guess. */
  checksWithoutVatRate: number
}

export const SALES_FIGURE_ROWS: readonly { key: keyof SalesFigures; label: string; money: boolean; lbp?: boolean }[] = [
  { key: 'checks', label: 'Checks', money: false },
  { key: 'guests', label: 'Guests', money: false },
  { key: 'grossSales', label: 'Gross sales (incl. VAT)', money: true },
  { key: 'staffMeals', label: 'Staff meals', money: true },
  { key: 'itemDiscounts', label: 'Item discounts and comps', money: true },
  { key: 'checkDiscounts', label: 'Check discounts', money: true },
  { key: 'netSales', label: 'Net sales (excl. VAT and service)', money: true },
  { key: 'goodsVat', label: 'VAT on sales', money: true },
  { key: 'serviceCharge', label: 'Service charge (incl. VAT)', money: true },
  { key: 'serviceVat', label: 'VAT on service charge', money: true },
  { key: 'vatOutput', label: 'VAT output, total', money: true },
  { key: 'billed', label: 'Billed (incl. VAT and service)', money: true },
  { key: 'billedLbp', label: 'Billed, LBP at each check\'s rate', money: false, lbp: true },
  { key: 'refundsGiven', label: 'Refunds given', money: false },
  { key: 'refundsBilled', label: 'Refunded (incl. VAT)', money: true },
  { key: 'refundsNetSales', label: 'Refunded net sales', money: true },
  { key: 'refundsVat', label: 'VAT reversed on refunds', money: true },
  { key: 'netSalesAfterRefunds', label: 'Net sales after refunds', money: true },
  { key: 'cardTips', label: 'Card tips (owed to staff)', money: true },
  { key: 'checksWithoutVatRate', label: 'Checks with no VAT rate recorded', money: false },
]

const r2 = (n: number) => Math.round(n * 100) / 100

export function emptyFigures(): SalesFigures {
  return {
    checks: 0, guests: 0, grossSales: 0, staffMeals: 0, itemDiscounts: 0, checkDiscounts: 0, billed: 0,
    serviceCharge: 0, serviceVat: 0, netSales: 0, goodsVat: 0, vatOutput: 0, refundsGiven: 0, refundsBilled: 0,
    refundsNetSales: 0, refundsVat: 0, netSalesAfterRefunds: 0, cardTips: 0, billedLbp: 0, checksWithoutVatRate: 0,
  }
}

/** One row's contribution. A refund row (negative figures) adds to the refund lines only. */
function rowFigures(row: CheckRow): SalesFigures {
  const f = emptyFigures()
  const rate = row.vatRate
  // Service's share of the VAT, at the same rate, taken out of the same way.
  const serviceVat = rate === null ? 0 : vatIncluded(Math.abs(row.service), rate) * Math.sign(row.service)
  const goodsBilled = row.net - row.service
  const goodsVat = row.vat - serviceVat
  const netSales = goodsBilled - goodsVat
  if (row.kind === 'refund') {
    f.refundsGiven = 1
    f.refundsBilled = -row.net
    f.refundsNetSales = -netSales
    f.refundsVat = -row.vat
    f.netSalesAfterRefunds = netSales
    return f
  }
  f.checks = 1
  f.guests = row.guests
  f.grossSales = row.gross
  f.staffMeals = row.staffMeal
  f.itemDiscounts = row.itemDiscounts
  f.checkDiscounts = row.checkDiscount
  f.billed = row.net
  f.serviceCharge = row.service
  f.serviceVat = serviceVat
  f.netSales = netSales
  f.goodsVat = goodsVat
  f.vatOutput = row.vat
  f.netSalesAfterRefunds = netSales
  f.cardTips = row.cardTips
  f.billedLbp = row.netLbp
  f.checksWithoutVatRate = rate === null ? 1 : 0
  return f
}

/** Adds figures field by field, rounding money to the cent and lira to the pound. */
export function addFigures(list: readonly SalesFigures[]): SalesFigures {
  const out = emptyFigures()
  for (const f of list) for (const k of Object.keys(out) as (keyof SalesFigures)[]) out[k] += f[k]
  for (const row of SALES_FIGURE_ROWS) out[row.key] = row.money ? r2(out[row.key]) : Math.round(out[row.key])
  return out
}

export interface SalesSummary {
  byBranch: { branch: string; figures: SalesFigures }[]
  /** The sum of byBranch, column by column. */
  total: SalesFigures
  /** Billed and net sales by order type (T5.5), sales only. */
  byOrderType: { order: string; checks: number; billed: number; netSales: number }[]
  /** Average check: billed ÷ checks, over the whole period. */
  averageCheck: number
}

export function salesSummary(rows: readonly CheckRow[], branches: readonly string[]): SalesSummary {
  const per = (b: string) => addFigures(rows.filter(r => r.branch === b).map(rowFigures))
  const byBranch = branches.map(branch => ({ branch, figures: per(branch) }))
  const total = addFigures(byBranch.map(b => b.figures))
  const orders = new Map<string, { order: string; checks: number; billed: number; netSales: number }>()
  for (const r of rows) {
    if (r.kind !== 'sale' || !branches.includes(r.branch)) continue
    const f = rowFigures(r)
    const o = orders.get(r.order) ?? { order: r.order, checks: 0, billed: 0, netSales: 0 }
    o.checks += 1
    o.billed = r2(o.billed + f.billed)
    o.netSales = r2(o.netSales + f.netSales)
    orders.set(r.order, o)
  }
  return {
    byBranch,
    total,
    byOrderType: [...orders.values()].sort((a, b) => b.billed - a.billed),
    averageCheck: total.checks > 0 ? r2(total.billed / total.checks) : 0,
  }
}
