// The purchases report (UPGRADE.md T7.13). Pure, asserted by verify:export;
// the reads are readReceivedDeliveries() (shared with the VAT report, so the
// two can never disagree about what was bought) and the weekly orders.
//
// Every received or disputed delivery in the period, filed by the café day it
// was received, with the supplier's invoice number and date, net before VAT,
// input VAT and total. Each figure is in the invoice's own currency and in the
// other one: an LBP invoice at the rate it was received at, a USD invoice in
// lira at the business rate (said, since the invoice carries no rate).
// Totals are per supplier and per branch, each currency added on its own.
//
// It reconciles with the weekly orders: for every order a delivery in the
// period was booked against, how many of its lines have arrived in full, in
// part or not at all, across every delivery booked against it (a supplier
// splits shipments). A delivery booked against no order is counted apart.

import { deliveryUsd, type DeliveryVatRow } from './vatReport'

export interface PurchaseRow {
  id: string
  branch: string
  department: string
  day: string
  invoiceDate: string | null
  supplier: string
  invoiceNumber: string
  currency: 'USD' | 'LBP'
  rateUsed: number
  status: string
  orderReportId: string | null
  /** In the invoice's own currency. */
  net: number
  vat: number
  total: number
  netUsd: number
  vatUsd: number
  totalUsd: number
  netLbp: number
  vatLbp: number
  totalLbp: number
  /** The lira figures are at the business rate: a USD invoice carries none. */
  lbpAtBusinessRate: boolean
}

export interface PurchaseTotals {
  deliveries: number
  netUsd: number
  vatUsd: number
  totalUsd: number
  netLbp: number
  vatLbp: number
  totalLbp: number
  /** Invoices with no supplier invoice date recorded. */
  withoutInvoiceDate: number
  /** Delivered against no weekly order. */
  unplanned: number
}

export interface OrderRecord { id: string; branch: string; weekStart: string; items: readonly { templateId: string; quantity: number }[] }

export interface OrderFulfilment {
  id: string
  branch: string
  weekStart: string
  lines: number
  full: number
  part: number
  none: number
  deliveries: number
}

export interface PurchasesReport {
  rows: PurchaseRow[]
  bySupplier: { supplier: string; totals: PurchaseTotals }[]
  byBranch: { branch: string; totals: PurchaseTotals }[]
  total: PurchaseTotals
  orders: OrderFulfilment[]
  businessRate: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function purchaseRow(d: DeliveryVatRow, businessRate: number): PurchaseRow {
  const net = d.subtotal
  const lbpRate = d.currency === 'LBP' ? d.rateUsed : businessRate
  const toLbp = (amount: number) => (d.currency === 'LBP' ? Math.round(amount) : lbpRate > 0 ? Math.round(amount * lbpRate) : 0)
  return {
    id: d.id ?? '', branch: d.branch, department: d.department ?? '', day: d.day, invoiceDate: d.invoiceDate ?? null,
    supplier: d.supplier || 'No supplier named', invoiceNumber: d.invoiceNumber, currency: d.currency, rateUsed: d.rateUsed,
    status: d.status ?? '', orderReportId: d.orderReportId ?? null,
    net, vat: d.vat, total: d.grand,
    netUsd: r2(deliveryUsd(d, net)), vatUsd: r2(deliveryUsd(d, d.vat)), totalUsd: r2(deliveryUsd(d, d.grand)),
    netLbp: toLbp(net), vatLbp: toLbp(d.vat), totalLbp: toLbp(d.grand),
    lbpAtBusinessRate: d.currency === 'USD',
  }
}

function totalsOf(rows: readonly PurchaseRow[]): PurchaseTotals {
  return {
    deliveries: rows.length,
    netUsd: r2(rows.reduce((n, r) => n + r.netUsd, 0)),
    vatUsd: r2(rows.reduce((n, r) => n + r.vatUsd, 0)),
    totalUsd: r2(rows.reduce((n, r) => n + r.totalUsd, 0)),
    netLbp: rows.reduce((n, r) => n + r.netLbp, 0),
    vatLbp: rows.reduce((n, r) => n + r.vatLbp, 0),
    totalLbp: rows.reduce((n, r) => n + r.totalLbp, 0),
    withoutInvoiceDate: rows.filter(r => !r.invoiceDate).length,
    unplanned: rows.filter(r => !r.orderReportId).length,
  }
}

/** How much of each order has arrived, across EVERY delivery booked against it, drafts left out. */
export function orderFulfilment(order: OrderRecord, deliveries: readonly DeliveryVatRow[]): OrderFulfilment {
  const booked = deliveries.filter(d => d.orderReportId === order.id && d.status !== 'draft')
  const received = new Map<string, number>()
  for (const d of booked) {
    for (const l of d.lines ?? []) {
      if (!l.templateId) continue
      // What came, as the weekly order's own fulfilment bar counts it (fulfilmentByTemplateId()).
      received.set(l.templateId, (received.get(l.templateId) ?? 0) + l.qtyReceived)
    }
  }
  let full = 0, part = 0, none = 0
  const ordered = order.items.filter(i => i.quantity > 0)
  for (const i of ordered) {
    const got = received.get(i.templateId) ?? 0
    if (got >= i.quantity - 1e-9) full++
    else if (got > 0) part++
    else none++
  }
  return { id: order.id, branch: order.branch, weekStart: order.weekStart, lines: ordered.length, full, part, none, deliveries: booked.length }
}

export function purchasesReport(input: {
  deliveries: readonly DeliveryVatRow[]
  /** Every delivery booked against the orders below, in the period or not. */
  orderDeliveries: readonly DeliveryVatRow[]
  orders: readonly OrderRecord[]
  branches: readonly string[]
  businessRate: number
}): PurchasesReport {
  const rows = input.deliveries.filter(d => input.branches.includes(d.branch)).map(d => purchaseRow(d, input.businessRate))
    .sort((a, b) => (a.day === b.day ? a.supplier.localeCompare(b.supplier) : a.day.localeCompare(b.day)))
  const suppliers = [...new Set(rows.map(r => r.supplier))].sort()
  return {
    rows,
    bySupplier: suppliers.map(supplier => ({ supplier, totals: totalsOf(rows.filter(r => r.supplier === supplier)) }))
      .sort((a, b) => b.totals.totalUsd - a.totals.totalUsd),
    byBranch: input.branches.map(branch => ({ branch, totals: totalsOf(rows.filter(r => r.branch === branch)) })),
    total: totalsOf(rows),
    orders: input.orders.filter(o => input.branches.includes(o.branch)).map(o => orderFulfilment(o, input.orderDeliveries))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.branch.localeCompare(b.branch)),
    businessRate: input.businessRate,
  }
}
