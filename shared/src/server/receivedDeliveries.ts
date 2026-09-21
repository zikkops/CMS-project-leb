// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Received deliveries over a period, for the VAT report's input VAT (T7.6)
// and the purchases report (T7.13). A draft is not a purchase yet, so only
// received and disputed deliveries count, filed by the café day they were
// received (`deliveredAt`). Read in chunks like every report (T7.2).

import { readInChunks, requestedBranches, type ExportRequest } from './salesExport'
import { closedAtParts, type CutShort } from '../salesExport'
import type { DeliveryVatRow } from '../vatReport'
import type { OrderRecord } from '../purchasesReport'
import { adminDb } from './firebaseAdmin'

export async function readReceivedDeliveries(
  range: ExportRequest,
  opts: { timeZone: string; branches: readonly string[] },
): Promise<{ deliveries: DeliveryVatRow[]; cutShort: CutShort | null }> {
  const read = await readInChunks('deliveries', 'deliveredAt', range, opts.timeZone)
  const wanted = new Set(requestedBranches(range, opts.branches))
  const deliveries: DeliveryVatRow[] = []
  for (const { id, data } of read.docs) {
    const d: Record<string, unknown> = { ...data, id }
    if (d.status === 'draft' || !wanted.has(String(d.branch))) continue
    const { day } = closedAtParts(d.deliveredAt, opts.timeZone)
    if (!day || day < range.from || day > range.to) continue
    const t = (d.totals ?? {}) as Record<string, unknown>
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    const lines = (Array.isArray(d.lines) ? d.lines : []) as Record<string, unknown>[]
    deliveries.push({
      id: String(d.id ?? ''),
      department: String(d.department ?? ''),
      invoiceDate: typeof d.invoiceDate === 'string' && d.invoiceDate ? d.invoiceDate : null,
      status: String(d.status ?? ''),
      orderReportId: typeof d.orderReportId === 'string' && d.orderReportId ? d.orderReportId : null,
      lines: lines.map(l => ({
        templateId: typeof l.templateId === 'string' && l.templateId ? l.templateId : null,
        qtyOrdered: num(l.qtyOrdered), qtyReceived: num(l.qtyReceived), qtyRejected: num(l.qtyRejected),
      })),
      branch: String(d.branch),
      day,
      supplier: String(d.providerName ?? ''),
      invoiceNumber: String(d.invoiceNumber ?? ''),
      currency: d.currency === 'LBP' ? 'LBP' : 'USD',
      rateUsed: num(d.rateUsed),
      vatRate: num(d.vatRate),
      taxableSubtotal: num(t.taxableSubtotal ?? t.subtotal),
      subtotal: num(t.subtotal),
      vat: num(t.vat),
      grand: num(t.grand),
    })
  }
  return { deliveries, cutShort: read.cutShort }
}

/**
 * The purchases report's read (UPGRADE.md T7.13): the received deliveries in
 * the period, the weekly orders they were booked against, and EVERY delivery
 * booked against those orders, in the period or not, since a supplier splits
 * shipments across weeks.
 */
export async function readPurchases(
  range: ExportRequest,
  opts: { timeZone: string; branches: readonly string[] },
): Promise<{ deliveries: DeliveryVatRow[]; orderDeliveries: DeliveryVatRow[]; orders: OrderRecord[]; branches: string[]; cutShort: CutShort | null }> {
  const { deliveries, cutShort } = await readReceivedDeliveries(range, opts)
  const ids = [...new Set(deliveries.map(d => d.orderReportId).filter((x): x is string => Boolean(x)))]
  const db = adminDb()
  const orders: OrderRecord[] = []
  const orderDeliveries: DeliveryVatRow[] = []
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30)
    const [orderSnaps, booked] = await Promise.all([
      db.getAll(...chunk.map(id => db.doc(`weeklyOrderReports/${id}`))),
      db.collection('deliveries').where('orderReportId', 'in', chunk).get(),
    ])
    for (const s of orderSnaps) {
      if (!s.exists) continue
      const o = s.data() ?? {}
      orders.push({
        id: s.id, branch: String(o.branch ?? ''), weekStart: String(o.weekStart ?? ''),
        items: (Array.isArray(o.items) ? o.items : []).map((it: Record<string, unknown>) => ({ templateId: String(it.templateId ?? ''), quantity: Number(it.quantity) || 0 })),
      })
    }
    for (const doc of booked.docs) {
      const d = doc.data()
      orderDeliveries.push({
        id: doc.id, status: String(d.status ?? ''), orderReportId: String(d.orderReportId ?? ''),
        lines: (Array.isArray(d.lines) ? d.lines : []).map((l: Record<string, unknown>) => ({
          templateId: typeof l.templateId === 'string' && l.templateId ? l.templateId : null,
          qtyOrdered: Number(l.qtyOrdered) || 0, qtyReceived: Number(l.qtyReceived) || 0, qtyRejected: Number(l.qtyRejected) || 0,
        })),
        branch: String(d.branch ?? ''), day: '', supplier: '', invoiceNumber: '', currency: 'USD', rateUsed: 0, vatRate: 0,
        taxableSubtotal: 0, subtotal: 0, vat: 0, grand: 0,
      })
    }
  }
  return { deliveries, orderDeliveries, orders, branches: requestedBranches(range, opts.branches), cutShort }
}
