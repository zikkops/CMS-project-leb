// Reports over closed checks (UPGRADE.md T3.2–T3.4). The arithmetic, and
// nothing else: no React and no Firebase, asserted by `npm run verify:reports`.
//
// Every report here reads the same thing the accountant's export reads: the
// checks that closed in a range of CAFÉ days (closedAtParts() in
// salesExport.ts, never the host clock), fetched by the server with the
// export's own padded closedAt window. A figure on one of these pages and the
// same figure in the export cannot disagree about which day a check was.

import {
  checkTotals, discountReason, grossLineTotal, lineDiscount, lineTotal, voidReason, REVERSAL_ROLES,
  type Check, type CheckLine,
} from './checks'
import { lineUnitPrice } from './modifiers'
import { consumptionCost, foldComboParts, lineTaken } from './recipes'
import { goodsShareForLines } from './splits'
import { closedAtParts, refundedAtParts } from './salesExport'
import { timestampMs } from './timestamps'

const r2 = (n: number) => Math.round(n * 100) / 100

/** A count and a value, under one key: a reason, a person, a day. */
export interface Tally { key: string; label: string; count: number; value: number }

function tally(rows: { key: string; label: string; value: number; count?: number }[]): Tally[] {
  const by = new Map<string, Tally>()
  for (const r of rows) {
    const t = by.get(r.key) ?? { key: r.key, label: r.label, count: 0, value: 0 }
    t.count += r.count ?? 1
    t.value = r2(t.value + r.value)
    by.set(r.key, t)
  }
  return [...by.values()].sort((a, b) => b.value - a.value || b.count - a.count || a.label.localeCompare(b.label))
}

/** Who did it, as a report groups them. A void from before it was recorded is its own row, never a guess. */
export const NOT_RECORDED = 'Not recorded'
const person = (email: string | null | undefined) => {
  const e = (email ?? '').trim()
  return e ? { key: e.toLowerCase(), label: e } : { key: '', label: NOT_RECORDED }
}

// ── T3.2 Voids and discounts ──────────────────────────────────────────────

export interface VoidRow {
  /** check:line, unique in a report. */
  id: string
  day: string
  time: string
  branch: string
  receipt: string
  table: string
  item: string
  quantity: number
  /** What the line was worth before it was struck off: its price with options, times the quantity. */
  value: number
  reasonKey: string
  reason: string
  /** Made and lost, as the reason said when the void happened (voidWasWaste). */
  waste: boolean
  /** Voided after a ticket had gone to the kitchen or bar. */
  afterSending: boolean
  /** Who struck it off. Their own sign-in is the approval (T5.1). */
  by: string
  /** Who rang the item up in the first place (T7.9). */
  rungUpBy: string
  approval: Approval
}

/**
 * Whether a reversal was approved (UPGRADE.md T5.1, T7.9). A void of food
 * already sent, and every refund, needs a manager or an admin, from their own
 * phone: their sign-in is the approval, so the approver is the person who did
 * it, and the role they held is stamped with it. A void before sending needs
 * nobody. One from before the role was stamped says so, never a guess.
 */
export type Approval = 'not needed' | 'manager' | 'not approved' | 'not recorded'

export const APPROVAL_LABELS: Record<Approval, string> = {
  'not needed': 'Not needed',
  'manager': 'By a manager',
  'not approved': 'Not by a manager',
  'not recorded': 'Not recorded',
}

/** How a reversal was approved, from the role stamped with it. */
export function approvalOf(needed: boolean, role: string | null | undefined): Approval {
  if (!needed) return 'not needed'
  if (!role) return 'not recorded'
  return REVERSAL_ROLES.includes(role) ? 'manager' : 'not approved'
}

/** A refund, on the day it was given (T7.4's rule), never the sale's day. */
export interface RefundRow {
  id: string
  day: string
  time: string
  branch: string
  receipt: string
  /** The café day the sale closed on. */
  originalDay: string
  /** What the check came to: what was given back. */
  amount: number
  reasonKey: string
  reason: string
  /** The food was made and lost, as the reason said. */
  waste: boolean
  by: string
  approval: Approval
}

export type DiscountKind = 'comp' | 'item-percent' | 'check-percent' | 'check-amount' | 'staff-meal'

export const DISCOUNT_KIND_LABELS: Record<DiscountKind, string> = {
  'comp': 'Item comped',
  'item-percent': '% off an item',
  'check-percent': '% off the check',
  'check-amount': 'Amount off the check',
  'staff-meal': 'Staff meal',
}

export interface DiscountRow {
  /** check:line, check:whole or check:staff, unique in a report. */
  id: string
  day: string
  time: string
  branch: string
  receipt: string
  kind: DiscountKind
  /** The item, for a discount on one line; null for the whole check. */
  item: string | null
  /** What it took off the bill. */
  amount: number
  reasonKey: string
  reason: string
  by: string
}

export interface VoidDiscountReport {
  voids: VoidRow[]
  discounts: DiscountRow[]
  voidsByReason: Tally[]
  voidsByStaff: Tally[]
  discountsByReason: Tally[]
  discountsByStaff: Tally[]
  refunds: RefundRow[]
  /** Voids by who rang the item up, beside voidsByStaff (who struck it off). */
  voidsByRungUp: Tally[]
  /** Voids after sending and refunds, by how they were approved. */
  byApproval: Tally[]
  refundsByReason: Tally[]
  refundsByStaff: Tally[]
  /** Lines sold at a price rule (T5.12), by rule: count is the quantity, value what they came to. */
  priceRules: Tally[]
  byDay: { day: string; voids: number; voidValue: number; discounts: number; discountValue: number; refunds: number; refundValue: number }[]
  totals: {
    voids: number; voidValue: number; wasteValue: number; discounts: number; discountValue: number
    refunds: number; refundValue: number
    /** Voids after sending plus refunds with no manager's approval recorded, or with none given. */
    unapproved: number
    priceRuleValue: number
  }
}

/** A line's worth before the void: grossLineTotal() is 0 for a void line, which is the point of a void. */
export function voidedValue(line: Pick<CheckLine, 'unitPrice' | 'modifiers' | 'quantity'>): number {
  return r2(lineUnitPrice(line.unitPrice, line.modifiers ?? []) * line.quantity)
}

/** The table a check was for, as a person reads it. */
function tableOf(check: Pick<Check, 'tableNumber'>): string {
  return typeof check.tableNumber === 'number' ? String(check.tableNumber) : ''
}

/**
 * Every void and every discount on the checks given, with totals by reason,
 * by person and by day. Checks still open are left out: their voids and
 * discounts are not final until the check is.
 *
 * The exception report (UPGRADE.md T7.9) adds who rang each voided item up,
 * whether each reversal was approved, the refunds given in the period
 * (`refunded`, read on refundedAt, filed on the refund's day), and what sold at
 * a price rule.
 */
export function voidDiscountReport(
  checks: readonly Check[],
  opts: { timeZone: string; refunded?: readonly Check[] },
): VoidDiscountReport {
  const voids: VoidRow[] = []
  const discounts: DiscountRow[] = []
  const refunds: RefundRow[] = []
  const ruled: { key: string; label: string; value: number; count: number }[] = []

  for (const check of opts.refunded ?? []) {
    if (check.status !== 'refunded') continue
    const { day, time } = refundedAtParts(check as Check & { refundedAt?: unknown }, opts.timeZone)
    if (!day) continue
    const c = check as Check & { refundedBy?: string }
    const reason = voidReason(check.refundReasonKey ?? '')
    refunds.push({
      id: check.id, day, time, branch: check.branch, receipt: check.receiptNumber ?? '',
      originalDay: closedAtParts(check.closedAt, opts.timeZone).day,
      amount: checkTotals(check).net,
      reasonKey: check.refundReasonKey ?? '',
      reason: reason?.label ?? (check.refundReason || 'No reason recorded'),
      waste: check.refundWasWaste === true,
      by: person(c.refundedBy).label,
      approval: approvalOf(true, check.refundedByRole),
    })
  }

  for (const check of checks) {
    if (check.status === 'open') continue
    const { day, time } = closedAtParts(check.closedAt, opts.timeZone)
    if (!day) continue
    const base = { day, time, branch: check.branch, receipt: check.receiptNumber ?? '' }
    const staff = check.staffDiscount ?? null

    for (const line of check.lines ?? []) {
      if (line.status === 'void') {
        const reason = voidReason(line.voidReasonKey ?? '')
        const who = person(line.voidedByEmail)
        voids.push({
          ...base,
          id: `${check.id}:${line.id}`,
          table: tableOf(check),
          item: line.name,
          quantity: line.quantity,
          value: voidedValue(line),
          reasonKey: line.voidReasonKey ?? '',
          // The sentence the line kept, so a void from before the reason list still reads.
          reason: reason?.label ?? (line.voidReason || 'No reason recorded'),
          waste: line.voidWasWaste === true,
          afterSending: Boolean(line.sentAt),
          by: who.label,
          rungUpBy: person(line.addedByEmail).label,
          approval: approvalOf(Boolean(line.sentAt), line.voidedByRole),
        })
        continue
      }
      if (line.priceRule && check.status === 'closed') {
        ruled.push({ key: line.priceRule, label: line.priceRule, value: lineTotal(line, staff), count: line.quantity })
      }
      const d = line.discount
      if (d) {
        const afterStaff = r2(grossLineTotal(line) - lineDiscount(line, staff))
        const amount = r2(afterStaff - lineTotal(line, staff))
        if (amount > 0) {
          discounts.push({
            ...base,
            id: `${check.id}:${line.id}`,
            kind: d.kind === 'comp' ? 'comp' : 'item-percent',
            item: line.name,
            amount,
            reasonKey: d.reasonKey,
            reason: discountReason(d.reasonKey)?.label ?? d.reasonKey,
            by: person(d.byEmail).label,
          })
        }
      }
    }

    const totals = checkTotals(check)
    if (check.discount && totals.checkDiscount > 0) {
      discounts.push({
        ...base,
        id: `${check.id}:whole`,
        kind: check.discount.kind === 'percent' ? 'check-percent' : 'check-amount',
        item: null,
        amount: totals.checkDiscount,
        reasonKey: check.discount.reasonKey,
        reason: discountReason(check.discount.reasonKey)?.label ?? check.discount.reasonKey,
        by: person(check.discount.byEmail).label,
      })
    }
    if (staff && totals.discount > 0) {
      discounts.push({
        ...base,
        id: `${check.id}:staff`,
        kind: 'staff-meal',
        item: null,
        amount: totals.discount,
        reasonKey: 'staff-meal',
        reason: 'Staff meal',
        by: person(staff.appliedByEmail).label,
      })
    }
  }

  const order = (a: { day: string; time: string }, b: { day: string; time: string }) =>
    a.day === b.day ? a.time.localeCompare(b.time) : a.day.localeCompare(b.day)
  voids.sort(order)
  discounts.sort(order)
  refunds.sort(order)

  const days = [...new Set([...voids.map(v => v.day), ...discounts.map(d => d.day), ...refunds.map(r => r.day)])].sort()
  const reversals = [...voids.filter(v => v.afterSending), ...refunds.map(r => ({ approval: r.approval, value: r.amount }))]
  return {
    voids,
    discounts,
    voidsByReason: tally(voids.map(v => ({ key: v.reasonKey || v.reason, label: v.reason, value: v.value }))),
    voidsByStaff: tally(voids.map(v => ({ key: v.by, label: v.by, value: v.value }))),
    discountsByReason: tally(discounts.map(d => ({ key: d.reasonKey, label: d.reason, value: d.amount }))),
    discountsByStaff: tally(discounts.map(d => ({ key: d.by, label: d.by, value: d.amount }))),
    refunds,
    voidsByRungUp: tally(voids.map(v => ({ key: v.rungUpBy, label: v.rungUpBy, value: v.value }))),
    byApproval: tally(reversals.map(x => ({ key: x.approval, label: APPROVAL_LABELS[x.approval], value: x.value }))),
    refundsByReason: tally(refunds.map(r => ({ key: r.reasonKey || r.reason, label: r.reason, value: r.amount }))),
    refundsByStaff: tally(refunds.map(r => ({ key: r.by, label: r.by, value: r.amount }))),
    priceRules: tally(ruled),
    byDay: days.map(day => {
      const v = voids.filter(x => x.day === day)
      const d = discounts.filter(x => x.day === day)
      const f = refunds.filter(x => x.day === day)
      return {
        day,
        voids: v.length, voidValue: r2(v.reduce((s, x) => s + x.value, 0)),
        discounts: d.length, discountValue: r2(d.reduce((s, x) => s + x.amount, 0)),
        refunds: f.length, refundValue: r2(f.reduce((s, x) => s + x.amount, 0)),
      }
    }),
    totals: {
      voids: voids.length,
      voidValue: r2(voids.reduce((s, x) => s + x.value, 0)),
      wasteValue: r2(voids.filter(x => x.waste).reduce((s, x) => s + x.value, 0)),
      discounts: discounts.length,
      discountValue: r2(discounts.reduce((s, x) => s + x.amount, 0)),
      refunds: refunds.length,
      refundValue: r2(refunds.reduce((s, x) => s + x.amount, 0)),
      unapproved: reversals.filter(x => x.approval === 'not approved' || x.approval === 'not recorded').length,
      priceRuleValue: r2(ruled.reduce((s, x) => s + x.value, 0)),
    },
  }
}

// ── T3.3 Product mix ──────────────────────────────────────────────────────

export interface MixItem {
  /** source:refId, so a menu item and a retail product never share a row. */
  key: string
  name: string
  category: string
  quantity: number
  /** What its lines came to, after the staff meal and any discount on the item. */
  revenue: number
  /** Share of all item revenue in the range, 0–1. */
  share: number
  /** Made as a part of a combo, at $0: counted apart, never as sold (T7.8). */
  inCombos: number
  /** Sold for as goods before VAT: after every discount, whole-check ones included, without service (T7.8). */
  netSales: number
  /** The part of netSales whose recipes could be fully costed. */
  costedSales: number
  /** What those lines' ingredients cost, from each line's own snapshot. Null when nothing could be costed. */
  cost: number | null
  /** costedSales − cost. Null when nothing could be costed. */
  margin: number | null
  /** margin ÷ costedSales. Null when nothing could be costed. */
  marginPercent: number | null
  /** costedSales ÷ netSales: how much of the item the margin speaks for. */
  coverage: number | null
  /** Lines with a recipe where an ingredient has no cost or no conversion. */
  uncostedLines: number
  /** Lines with no recipe snapshot at all: retail, a dish with no recipe, or sold while the switch was off. */
  noRecipeLines: number
}

export interface MixCategory {
  category: string; quantity: number; revenue: number; share: number; items: number
  netSales: number; costedSales: number; cost: number | null; margin: number | null; marginPercent: number | null; coverage: number | null
}

export interface ProductMix {
  items: MixItem[]
  categories: MixCategory[]
  totals: {
    checks: number
    quantity: number
    revenue: number
    /** Whole-check discounts, which belong to no item: why item revenue is more than the checks' net. */
    checkDiscounts: number
    netSales: number
    costedSales: number
    cost: number | null
    margin: number | null
    marginPercent: number | null
    coverage: number | null
    /** Lines on checks that recorded no VAT rate: counted at full price, no VAT taken out. */
    linesWithoutVatRate: number
  }
}

/** Where an item sits on the menu. A retail product is "Retail"; one the menu no longer has, "No longer on the menu". */
export const RETAIL = 'Retail'
export const OFF_MENU = 'No longer on the menu'

interface CostSums { netSales: number; costedSales: number; costSum: number; costedAny: boolean }

/** Margin figures from the sums: null, never 0, when nothing could be costed. */
function marginOf(s: CostSums) {
  const cost = s.costedAny ? r2(s.costSum) : null
  const margin = cost === null ? null : r2(s.costedSales - cost)
  return {
    netSales: r2(s.netSales),
    costedSales: r2(s.costedSales),
    cost,
    margin,
    marginPercent: margin !== null && s.costedSales > 0 ? Math.round((margin / s.costedSales) * 10_000) / 10_000 : null,
    coverage: s.netSales > 0 ? Math.round((s.costedSales / s.netSales) * 10_000) / 10_000 : null,
  }
}

const sumCosts = (rows: readonly CostSums[]): CostSums => ({
  netSales: rows.reduce((s, r) => s + r.netSales, 0),
  costedSales: rows.reduce((s, r) => s + r.costedSales, 0),
  costSum: rows.reduce((s, r) => s + r.costSum, 0),
  costedAny: rows.some(r => r.costedAny),
})

/**
 * What sold, by item and by category, over closed checks, with what it cost
 * and the margin it made (UPGRADE.md T7.8). Refunded and cancelled checks are
 * left out: what was given back was not sold. Voided lines are not sales
 * either. An item is grouped by what it is (its menu or product id), and named
 * as it was most recently sold.
 *
 * Cost is the recipe snapshot each line carried when it was sold, never
 * today's recipe, and a combo's $0 parts are costed on the combo line
 * (foldComboParts(), gap 18) and counted as `inCombos`, not as sold. Margin is
 * on sales before VAT, at each check's own rate, and only over the lines that
 * could be fully costed; `coverage` says how much that is. An item nobody
 * could cost reads null, never a cost of $0 and a margin of 100%.
 */
export function productMix(
  checks: readonly Check[],
  opts: { categoryOf: Readonly<Record<string, string>> },
): ProductMix {
  type Row = MixItem & CostSums & { lastSeen: number }
  const items = new Map<string, Row>()
  let checkCount = 0
  let checkDiscounts = 0
  let linesWithoutVatRate = 0

  checks.forEach((check, order) => {
    // A check closed with no receipt number is in no export and no journal, so
    // it is not a sale here either: the reconciliation found one in the demo
    // data counted by the mix alone (T7.16), and lists any such check apart.
    if (check.status !== 'closed' || !check.receiptNumber) return
    checkCount++
    checkDiscounts += checkTotals(check).checkDiscount
    const staff = check.staffDiscount ?? null
    const rate = check.vatRate
    const hasRate = typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate < 1
    const lines = check.lines ?? []
    const rowFor = (line: CheckLine): Row => {
      const key = `${line.source}:${line.refId}`
      const category = line.source === 'product' ? RETAIL : (opts.categoryOf[line.refId] ?? OFF_MENU)
      const row: Row = items.get(key) ?? {
        key, name: line.name, category, quantity: 0, revenue: 0, share: 0, inCombos: 0,
        netSales: 0, costedSales: 0, cost: null, margin: null, marginPercent: null, coverage: null,
        uncostedLines: 0, noRecipeLines: 0, costSum: 0, costedAny: false, lastSeen: -1,
      }
      if (order >= row.lastSeen) { row.name = line.name; row.lastSeen = order }
      items.set(key, row)
      return row
    }
    const ids = new Set(lines.map(l => l.id))
    for (const line of lines) {
      if (line.status === 'void' || !line.comboOf || !ids.has(line.comboOf)) continue
      rowFor(line).inCombos += line.quantity
    }
    for (const line of foldComboParts(lines)) {
      if (line.status === 'void') continue
      const row = rowFor(line)
      row.quantity += line.quantity
      row.revenue = r2(row.revenue + lineTotal(line, staff))
      if (!hasRate) linesWithoutVatRate++
      const goods = goodsShareForLines(check, [line.id])
      // Each line to the cent, so branches and items add up to the total exactly.
      const exVat = r2(hasRate ? goods / (1 + (rate as number)) : goods)
      row.netSales += exVat
      const c = consumptionCost({ consumes: lineTaken(line), unknown: [...(line.consumesUnknown ?? [])] })
      if (c.reason === 'ok') { row.costedAny = true; row.costedSales += exVat; row.costSum += c.costUsd as number }
      else if (c.reason === 'incomplete') row.uncostedLines++
      else row.noRecipeLines++
    }
  })

  const all = [...items.values()]
  const revenue = r2(all.reduce((s, i) => s + i.revenue, 0))
  const shareOf = (v: number) => (revenue > 0 ? Math.round((v / revenue) * 10_000) / 10_000 : 0)
  const outItems: MixItem[] = all
    .map(row => {
      const { lastSeen: _lastSeen, costSum: _costSum, costedAny: _costedAny, ...i } = row
      return { ...i, share: shareOf(i.revenue), ...marginOf(row) }
    })
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.name.localeCompare(b.name))

  const byCategory = new Map<string, Row[]>()
  for (const i of all) byCategory.set(i.category, [...(byCategory.get(i.category) ?? []), i])
  const categories: MixCategory[] = [...byCategory.entries()]
    .map(([category, rows]) => {
      const rev = r2(rows.reduce((s, r) => s + r.revenue, 0))
      return {
        category, quantity: rows.reduce((s, r) => s + r.quantity, 0), revenue: rev, share: shareOf(rev), items: rows.length,
        ...marginOf(sumCosts(rows)),
      }
    })
    .sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category))

  return {
    items: outItems,
    categories,
    totals: {
      checks: checkCount, quantity: outItems.reduce((s, i) => s + i.quantity, 0), revenue, checkDiscounts: r2(checkDiscounts),
      ...marginOf(sumCosts(all)), linesWithoutVatRate,
    },
  }
}

// ── T3.4 Hourly sales, beside the same day last week ──────────────────────

export interface HourRow {
  /** 0–23, the café's own clock. */
  hour: number
  checks: number
  net: number
  compareChecks: number
  compareNet: number
}

export interface HourlySales {
  day: string
  compareDay: string
  hours: HourRow[]
  totals: { checks: number; net: number; compareChecks: number; compareNet: number }
  /** The busiest hour of the day asked about, by takings; null on a day with none. */
  peakHour: number | null
}

/** A café day n days before another, both YYYY-MM-DD, by calendar arithmetic (no zone can move it). */
export function dayBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)
}

/**
 * What the till took in each hour of one café day, beside the same weekday a
 * week before. The day and the hour are the café's (closedAtParts() and the
 * zone's own clock), never the host's: a sale at 01:30 is 01:00 on the day it
 * fell on in Beirut, which is the export's rule too. A check counts at the
 * hour it closed, for its net, as the export counts it: a refunded check was
 * still a sale that day, and its refund is the export's own column.
 */
export function hourlySales(checks: readonly Check[], opts: { timeZone: string; day: string }): HourlySales {
  const compareDay = dayBefore(opts.day, 7)
  const hours: HourRow[] = Array.from({ length: 24 }, (_, hour) => ({ hour, checks: 0, net: 0, compareChecks: 0, compareNet: 0 }))
  const hourOf = new Intl.DateTimeFormat('en-US', { timeZone: opts.timeZone, hour: 'numeric', hourCycle: 'h23' })

  for (const check of checks) {
    if (!check.receiptNumber || (check.status !== 'closed' && check.status !== 'refunded')) continue
    const { day } = closedAtParts(check.closedAt, opts.timeZone)
    if (day !== opts.day && day !== compareDay) continue
    const ms = timestampMs(check.closedAt, 0)
    const hour = Number(hourOf.formatToParts(new Date(ms)).find(p => p.type === 'hour')?.value ?? NaN) % 24
    if (!Number.isInteger(hour)) continue
    const net = checkTotals(check).net
    const row = hours[hour]
    if (day === opts.day) { row.checks++; row.net = r2(row.net + net) }
    else { row.compareChecks++; row.compareNet = r2(row.compareNet + net) }
  }

  const totals = hours.reduce((t, h) => ({
    checks: t.checks + h.checks, net: r2(t.net + h.net),
    compareChecks: t.compareChecks + h.compareChecks, compareNet: r2(t.compareNet + h.compareNet),
  }), { checks: 0, net: 0, compareChecks: 0, compareNet: 0 })
  const peak = hours.reduce<HourRow | null>((best, h) => (h.net > 0 && (!best || h.net > best.net) ? h : best), null)
  return { day: opts.day, compareDay, hours, totals, peakHour: peak ? peak.hour : null }
}
