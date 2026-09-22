// Every metric the café reports, in one list (UPGRADE.md T7.19). Pure, asserted
// by verify:reports; the read is shared/src/server/metrics.ts and the page is
// /admin/reports/metrics.
//
// The reports each answer one question well. This answers the other kind:
// "show me these eight numbers, for these days, for this branch" — chosen from
// a search box, turned on and off, and drawn as a line over the period.
//
// A metric is declared once, here, with:
//   group   which report it comes from, and so which read the server must run
//   unit    what it is (dollars, lira, a count, a share, hours), which decides
//           how it is written and how its axis is scaled
//   better  which way is good, for a difference that reads as one or the other;
//           null where neither direction is good or bad on its own
//
// Adding a metric is adding a line here and the field that fills it in
// server/metrics.ts. Nothing else knows the list: the page reads it.

export type MetricUnit = 'usd' | 'lbp' | 'count' | 'percent' | 'hours'
export type MetricGroup = 'sales' | 'tenders' | 'menu' | 'exceptions' | 'cash' | 'purchases' | 'inventory' | 'labour' | 'loyalty' | 'receipts'

export interface MetricGroupDef {
  key: MetricGroup
  label: string
  /** What this group of numbers is for, for somebody who has not read the report it comes from. */
  purpose: string
  /** Only an admin may see it: it carries pay. */
  adminOnly?: boolean
}

export const METRIC_GROUPS: readonly MetricGroupDef[] = [
  { key: 'sales', label: 'Sales', purpose: 'What was sold and billed, net of VAT and service.' },
  { key: 'tenders', label: 'Payments', purpose: 'How the money arrived: cash, card, change and tips.' },
  { key: 'menu', label: 'Menu', purpose: 'What sold off the menu, what it cost and what it made.' },
  { key: 'exceptions', label: 'Exceptions', purpose: 'Voids, discounts and refunds: the things somebody approved.' },
  { key: 'cash', label: 'Cash-up', purpose: 'The drawers: what they should have held and what was counted.' },
  { key: 'purchases', label: 'Purchases', purpose: 'What came in from suppliers, and the VAT on it.' },
  { key: 'inventory', label: 'Inventory', purpose: 'Stock value, what sales took, and what nothing explains.' },
  { key: 'labour', label: 'Labour', purpose: 'Hours, pay and tips. Admin only: it carries pay rates.', adminOnly: true },
  { key: 'loyalty', label: 'Loyalty', purpose: 'Points issued, taken back and spent — a liability.' },
  { key: 'receipts', label: 'Receipts', purpose: 'The receipt sequence: what was issued, and what is missing.' },
]

export interface MetricDef {
  key: string
  label: string
  group: MetricGroup
  unit: MetricUnit
  help: string
  /** 'up' when more is better, 'down' when less is, null when it is neither. */
  better: 'up' | 'down' | null
  /** False where only a total makes sense (a stock value is not a day's worth of anything). */
  daily?: boolean
}

const m = (
  key: string, label: string, group: MetricGroup, unit: MetricUnit, better: MetricDef['better'], help: string, daily = true,
): MetricDef => ({ key, label, group, unit, better, help, daily })

export const METRICS: readonly MetricDef[] = [
  // ── Sales ──
  m('checks', 'Checks closed', 'sales', 'count', 'up', 'Closed checks with a receipt number.'),
  m('guests', 'Guests', 'sales', 'count', 'up', 'Guests on those checks, as the till was told.'),
  m('grossSales', 'Gross sales', 'sales', 'usd', 'up', 'Prices before any discount, VAT included.'),
  m('netSales', 'Net sales', 'sales', 'usd', 'up', 'After every discount, without VAT or service: the accountant\'s sales.'),
  m('billed', 'Billed', 'sales', 'usd', 'up', 'What customers were asked for, service and VAT included.'),
  m('billedLbp', 'Billed in lira', 'sales', 'lbp', 'up', 'The same bills in lira, each at its own rate.'),
  m('vatOutput', 'VAT output', 'sales', 'usd', null, 'VAT inside those bills, extracted at each check\'s rate.'),
  m('serviceCharge', 'Service charge', 'sales', 'usd', 'up', 'Service added to bills, VAT included.'),
  m('staffMeals', 'Staff meals', 'sales', 'usd', null, 'What the staff-meal rate took off.'),
  m('itemDiscounts', 'Item discounts', 'sales', 'usd', 'down', 'Comps and % off single items.'),
  m('checkDiscounts', 'Check discounts', 'sales', 'usd', 'down', 'Whole-check discounts.'),
  m('refundsGiven', 'Refunds given', 'sales', 'usd', 'down', 'Refunded in the period, on the day it was given.'),
  m('averageCheck', 'Average check', 'sales', 'usd', 'up', 'Billed ÷ checks.', false),
  m('cardTips', 'Card tips', 'sales', 'usd', 'up', 'Tips added on cards: owed to staff, never a sale.'),

  // ── Payments ──
  m('payments', 'Payments taken', 'tenders', 'count', null, 'Individual payments, split bills included.'),
  m('cashUsdKept', 'Cash kept, dollars', 'tenders', 'usd', null, 'Cash handed over less the change given back.'),
  m('cashLbpKept', 'Cash kept, lira', 'tenders', 'lbp', null, 'The same in lira, counted in lira.'),
  m('cardUsd', 'Card, dollars', 'tenders', 'usd', null, 'Charged to cards in dollars, tips apart.'),
  m('cardLbp', 'Card, lira', 'tenders', 'lbp', null, 'Charged to cards in lira.'),
  m('changeUsd', 'Change given', 'tenders', 'usd', null, 'Change handed back in dollars.'),
  m('appliedUsd', 'Applied to bills', 'tenders', 'usd', null, 'What the payments actually paid off, at each check\'s rate.'),
  m('checksWithoutPayment', 'Checks with no payment', 'tenders', 'count', 'down', 'Closed with nothing recorded: the old till took it, or payments are off.'),

  // ── Menu ──
  m('itemsSold', 'Items sold', 'menu', 'count', 'up', 'Menu and retail lines sold, voids apart.'),
  m('itemRevenue', 'Item revenue', 'menu', 'usd', 'up', 'What those lines came to, before whole-check discounts.'),
  m('menuNetSales', 'Menu net sales', 'menu', 'usd', 'up', 'Their goods share before VAT, after every discount.'),
  m('recipeCost', 'Recipe cost', 'menu', 'usd', 'down', 'What the recipes say the food cost.'),
  m('grossMargin', 'Gross margin', 'menu', 'percent', 'up', 'Margin over the lines that could be costed.', false),
  m('costedShare', 'Costed share', 'menu', 'percent', 'up', 'How much of the sales the margin speaks for.', false),

  // ── Exceptions ──
  m('voids', 'Voids', 'exceptions', 'count', 'down', 'Lines struck off a check.'),
  m('voidValue', 'Voided value', 'exceptions', 'usd', 'down', 'What those lines were rung up at.'),
  m('wasteValue', 'Waste', 'exceptions', 'usd', 'down', 'Voided food that was made and lost.'),
  m('discounts', 'Discounts given', 'exceptions', 'count', null, 'Comps, item and check discounts, and staff meals.'),
  m('discountValue', 'Discounts', 'exceptions', 'usd', 'down', 'What they took off.'),
  m('refunds', 'Refunds', 'exceptions', 'count', 'down', 'Refunds given in the period.'),
  m('unapproved', 'Without approval', 'exceptions', 'count', 'down', 'Voids after sending, and refunds, with no manager recorded.'),
  m('priceRuleValue', 'At a price rule', 'exceptions', 'usd', null, 'Sold at a happy-hour or other time price.'),

  // ── Cash-up ──
  m('shifts', 'Drawer shifts', 'cash', 'count', null, 'Shifts opened on those cash-up days.'),
  m('cashCountedUsd', 'Counted, dollars', 'cash', 'usd', null, 'Counted at the Z close, closed shifts only.'),
  m('cashCountedLbp', 'Counted, lira', 'cash', 'lbp', null, 'The same in lira.'),
  m('cashDifferenceUsd', 'Over / short, dollars', 'cash', 'usd', null, 'Counted less what the drawer should have held.'),
  m('cashDifferenceLbp', 'Over / short, lira', 'cash', 'lbp', null, 'The same in lira, never netted at a rate.'),

  // ── Purchases ──
  m('deliveries', 'Deliveries', 'purchases', 'count', null, 'Received or disputed deliveries.'),
  m('purchasesNet', 'Purchases', 'purchases', 'usd', null, 'Goods received, before VAT.'),
  m('inputVat', 'Input VAT', 'purchases', 'usd', null, 'VAT on them, to set against output VAT.'),
  m('purchasesTotal', 'Purchases with VAT', 'purchases', 'usd', null, 'What the invoices came to.'),

  // ── Inventory ──
  m('stockValueNow', 'Stock value now', 'inventory', 'usd', null, 'On hand today × the average cost.', false),
  m('cogs', 'Cost of goods sold', 'inventory', 'usd', 'down', 'Opening + purchases ± transfers − closing, between counts.', false),
  m('inventoryVariance', 'Unexplained difference', 'inventory', 'usd', null, 'What the counts found and sales, waste and deliveries do not explain.', false),
  m('inventoryWaste', 'Waste at cost', 'inventory', 'usd', 'down', 'Wasted ingredients, at what they cost.', false),

  // ── Labour ──
  m('hours', 'Hours worked', 'labour', 'hours', null, 'Clocked-in hours, open shifts left out.'),
  m('payUsd', 'Pay', 'labour', 'usd', null, 'Hours × each person\'s rate on the day worked.'),
  m('tipsOwed', 'Tips owed', 'labour', 'usd', null, 'The tips pot after its deduction.'),
  m('labourPercent', 'Labour share of sales', 'labour', 'percent', 'down', 'Pay ÷ net sales, lira converted at the business rate.', false),
  m('openShifts', 'Shifts with no clock-out', 'labour', 'count', 'down', 'Still open, or longer than sixteen hours.'),

  // ── Loyalty ──
  m('pointsIssued', 'Points issued', 'loyalty', 'count', null, 'Credited to members, per person on the transaction.'),
  m('pointsReversed', 'Points reversed', 'loyalty', 'count', null, 'Taken back when a check was refunded.'),
  m('pointsSpent', 'Points spent', 'loyalty', 'count', null, 'Redeemed and handed over.'),
  m('pointsOwed', 'Points owed', 'loyalty', 'count', 'down', 'What the scheme owes at the period\'s end.', false),

  // ── Receipts ──
  m('numbersUsed', 'Receipt numbers used', 'receipts', 'count', null, 'Numbers on a check, retail sale or invoice.', false),
  m('numbersMissing', 'Missing numbers', 'receipts', 'count', 'down', 'Never seen, inside the logged span: must be none.', false),
  m('numbersDuplicated', 'Duplicated numbers', 'receipts', 'count', 'down', 'One number on more than one record: must be none.', false),
  m('numbersNoRecord', 'Issued, nothing carries them', 'receipts', 'count', 'down', 'Burnt on a close that failed, or an invoice never saved.', false),
]

const BY_KEY = new Map(METRICS.map(d => [d.key, d]))
export const metric = (key: string): MetricDef | null => BY_KEY.get(key) ?? null

/**
 * How many metrics one request may ask for. Not a screen limit — a request
 * naming every key reads every group, which is every report at once.
 */
export const MAX_METRICS = 40

/** A sensible opening set: what somebody would look at first, across a few groups. */
export const DEFAULT_METRICS: readonly string[] = [
  'netSales', 'billed', 'checks', 'averageCheck', 'vatOutput', 'cashUsdKept', 'cardUsd', 'discountValue', 'purchasesNet',
]

/**
 * The metrics matching a search and a set of groups. An empty search matches
 * everything; the words are matched against the label, the group's name and
 * the help, so "vat" finds VAT output and "tips" finds both tips metrics.
 */
export function searchMetrics(
  query: string,
  groups: readonly MetricGroup[],
  all: readonly MetricDef[] = METRICS,
): MetricDef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const wanted = new Set(groups)
  const groupLabel = new Map(METRIC_GROUPS.map(g => [g.key, g.label.toLowerCase()]))
  return all.filter(d => {
    if (wanted.size > 0 && !wanted.has(d.group)) return false
    if (words.length === 0) return true
    const hay = `${d.label} ${d.help} ${groupLabel.get(d.group) ?? ''} ${d.key}`.toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

/** Which reads the server must run for these metrics: the groups they belong to, and nothing else. */
export function groupsNeeded(keys: readonly string[]): MetricGroup[] {
  const groups = new Set<MetricGroup>()
  for (const key of keys) {
    const def = BY_KEY.get(key)
    if (def) groups.add(def.group)
  }
  return METRIC_GROUPS.filter(g => groups.has(g.key)).map(g => g.key)
}

/** Keys a caller may ask for: an admin may ask for anything, anybody else for everything but pay. */
export function allowedMetrics(isAdmin: boolean, keys: readonly string[]): string[] {
  const adminOnly = new Set(METRIC_GROUPS.filter(g => g.adminOnly).map(g => g.key))
  return keys.filter(key => {
    const def = BY_KEY.get(key)
    return def && (isAdmin || !adminOnly.has(def.group))
  })
}

/** A day's figures for the chosen metrics, as the page draws them. */
export interface MetricDay { day: string; values: Record<string, number> }
export interface MetricReport {
  values: Record<string, number>
  days: MetricDay[]
  byBranch: { branch: string; values: Record<string, number> }[]
  /** Groups asked for and not answered, with why — a metric is never silently 0. */
  refused: { group: MetricGroup; reason: string }[]
}
