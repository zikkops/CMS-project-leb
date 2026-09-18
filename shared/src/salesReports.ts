// Reports over closed checks (UPGRADE.md T3.2–T3.4). The arithmetic, and
// nothing else: no React and no Firebase, asserted by `npm run verify:reports`.
//
// Every report here reads the same thing the accountant's export reads: the
// checks that closed in a range of CAFÉ days (closedAtParts() in
// salesExport.ts, never the host clock), fetched by the server with the
// export's own padded closedAt window. A figure on one of these pages and the
// same figure in the export cannot disagree about which day a check was.

import {
  checkTotals, discountReason, grossLineTotal, lineDiscount, lineTotal, voidReason,
  type Check, type CheckLine,
} from './checks'
import { lineUnitPrice } from './modifiers'
import { closedAtParts } from './salesExport'

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
  by: string
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
  byDay: { day: string; voids: number; voidValue: number; discounts: number; discountValue: number }[]
  totals: { voids: number; voidValue: number; wasteValue: number; discounts: number; discountValue: number }
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
 */
export function voidDiscountReport(checks: readonly Check[], opts: { timeZone: string }): VoidDiscountReport {
  const voids: VoidRow[] = []
  const discounts: DiscountRow[] = []

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
        })
        continue
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

  const days = [...new Set([...voids.map(v => v.day), ...discounts.map(d => d.day)])].sort()
  return {
    voids,
    discounts,
    voidsByReason: tally(voids.map(v => ({ key: v.reasonKey || v.reason, label: v.reason, value: v.value }))),
    voidsByStaff: tally(voids.map(v => ({ key: v.by, label: v.by, value: v.value }))),
    discountsByReason: tally(discounts.map(d => ({ key: d.reasonKey, label: d.reason, value: d.amount }))),
    discountsByStaff: tally(discounts.map(d => ({ key: d.by, label: d.by, value: d.amount }))),
    byDay: days.map(day => {
      const v = voids.filter(x => x.day === day)
      const d = discounts.filter(x => x.day === day)
      return {
        day,
        voids: v.length, voidValue: r2(v.reduce((s, x) => s + x.value, 0)),
        discounts: d.length, discountValue: r2(d.reduce((s, x) => s + x.amount, 0)),
      }
    }),
    totals: {
      voids: voids.length,
      voidValue: r2(voids.reduce((s, x) => s + x.value, 0)),
      wasteValue: r2(voids.filter(x => x.waste).reduce((s, x) => s + x.value, 0)),
      discounts: discounts.length,
      discountValue: r2(discounts.reduce((s, x) => s + x.amount, 0)),
    },
  }
}
