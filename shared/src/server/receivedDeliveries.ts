// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Received deliveries over a period, for the VAT report's input VAT (T7.6)
// and the purchases report (T7.13). A draft is not a purchase yet, so only
// received and disputed deliveries count, filed by the café day they were
// received (`deliveredAt`). Read in chunks like every report (T7.2).

import { readInChunks, requestedBranches, type ExportRequest } from './salesExport'
import { closedAtParts, type CutShort } from '../salesExport'
import type { DeliveryVatRow } from '../vatReport'

export async function readReceivedDeliveries(
  range: ExportRequest,
  opts: { timeZone: string; branches: readonly string[] },
): Promise<{ deliveries: DeliveryVatRow[]; cutShort: CutShort | null }> {
  const read = await readInChunks('deliveries', 'deliveredAt', range, opts.timeZone)
  const wanted = new Set(requestedBranches(range, opts.branches))
  const deliveries: DeliveryVatRow[] = []
  for (const { data: d } of read.docs) {
    if (d.status === 'draft' || !wanted.has(String(d.branch))) continue
    const { day } = closedAtParts(d.deliveredAt, opts.timeZone)
    if (!day || day < range.from || day > range.to) continue
    const t = (d.totals ?? {}) as Record<string, unknown>
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    deliveries.push({
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
