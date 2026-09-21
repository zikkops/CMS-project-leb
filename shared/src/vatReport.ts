// The VAT report, for the VAT return (UPGRADE.md T7.6). Pure, asserted by
// verify:export; built from the export's own rows and the posted deliveries.
//
// Output VAT is extracted from each check's bill at the check's own rate, so a
// rate that changed mid-quarter shows as two lines, one per rate, never one
// line at today's rate. The service charge's share is shown apart (VAT-able by
// default, T7.0). Refunds reverse output VAT in the period they were given
// (T7.4). A check closed before its rate was recorded contributes none and is
// counted on a line of its own, never guessed.
//
// Input VAT comes from received deliveries (drafts are not purchases yet), at
// each delivery's own rate and, for one invoiced in lira, converted at the
// delivery's own exchange rate: the one written on it when it was received.
//
// Net VAT position = output − reversed on refunds − input.

import type { CheckRow } from './salesExport'
import { vatIncluded } from './money'

/** A received delivery, as the VAT report needs it. Totals in the delivery's own currency. */
export interface DeliveryVatRow {
  /** The delivery's id, and what the purchases report shows beside it (T7.13). Optional for callers that build rows by hand. */
  id?: string
  department?: string
  invoiceDate?: string | null
  status?: string
  orderReportId?: string | null
  /** Ordered and received per weekly-order line, for the fulfilment check. */
  lines?: { templateId: string | null; qtyOrdered: number; qtyReceived: number; qtyRejected: number }[]
  branch: string
  day: string
  supplier: string
  invoiceNumber: string
  currency: 'USD' | 'LBP'
  rateUsed: number
  vatRate: number
  taxableSubtotal: number
  subtotal: number
  vat: number
  grand: number
}

export interface VatLine {
  /** The rate as a fraction, or null for "no rate recorded". */
  rate: number | null
  checks: number
  /** Goods after discounts, excluding VAT. */
  netSales: number
  goodsVat: number
  /** Service charge excluding VAT, and its VAT. */
  serviceNet: number
  serviceVat: number
  /** Billed but carrying no VAT: only on the "no rate recorded" line. */
  billedWithoutVat: number
}

export interface RefundVatLine { rate: number | null; refunds: number; netSales: number; vat: number }

export interface InputVatLine { rate: number; deliveries: number; taxableUsd: number; vatUsd: number }

export interface VatFigures {
  output: VatLine[]
  refunds: RefundVatLine[]
  input: InputVatLine[]
  outputVat: number
  refundVat: number
  inputVat: number
  /** Output − reversed on refunds − input. Positive is VAT owed. */
  netVat: number
  checksWithoutVatRate: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

function key(rate: number | null): string {
  return rate === null ? 'none' : String(Math.round(rate * 100000) / 100000)
}

/** A delivery's figure in USD: its own currency, converted at its own rate when in lira. */
export function deliveryUsd(d: Pick<DeliveryVatRow, 'currency' | 'rateUsed'>, amount: number): number {
  if (d.currency === 'USD') return amount
  return d.rateUsed > 0 ? amount / d.rateUsed : 0
}

function forBranch(rows: readonly CheckRow[], deliveries: readonly DeliveryVatRow[]): VatFigures {
  const output = new Map<string, VatLine>()
  const refunds = new Map<string, RefundVatLine>()
  const input = new Map<string, InputVatLine>()
  for (const r of rows) {
    const serviceVat = r.vatRate === null ? 0 : vatIncluded(Math.abs(r.service), r.vatRate) * Math.sign(r.service)
    const goodsVat = r.vat - serviceVat
    const netSales = r.net - r.service - goodsVat
    if (r.kind === 'refund') {
      const l = refunds.get(key(r.vatRate)) ?? { rate: r.vatRate, refunds: 0, netSales: 0, vat: 0 }
      l.refunds += 1
      l.netSales -= netSales + (r.service - serviceVat)
      l.vat -= r.vat
      refunds.set(key(r.vatRate), l)
      continue
    }
    const l = output.get(key(r.vatRate)) ?? { rate: r.vatRate, checks: 0, netSales: 0, goodsVat: 0, serviceNet: 0, serviceVat: 0, billedWithoutVat: 0 }
    l.checks += 1
    if (r.vatRate === null) {
      l.billedWithoutVat += r.net
    } else {
      l.netSales += netSales
      l.goodsVat += goodsVat
      l.serviceNet += r.service - serviceVat
      l.serviceVat += serviceVat
    }
    output.set(key(r.vatRate), l)
  }
  for (const d of deliveries) {
    const l = input.get(key(d.vatRate)) ?? { rate: d.vatRate, deliveries: 0, taxableUsd: 0, vatUsd: 0 }
    l.deliveries += 1
    l.taxableUsd += deliveryUsd(d, d.taxableSubtotal)
    l.vatUsd += deliveryUsd(d, d.vat)
    input.set(key(d.vatRate), l)
  }
  return finish([...output.values()], [...refunds.values()], [...input.values()])
}

function finish(output: VatLine[], refunds: RefundVatLine[], input: InputVatLine[]): VatFigures {
  const byRate = <T extends { rate: number | null }>(a: T, b: T) => (a.rate ?? -1) - (b.rate ?? -1)
  const o = output.map(l => ({ ...l, netSales: r2(l.netSales), goodsVat: r2(l.goodsVat), serviceNet: r2(l.serviceNet), serviceVat: r2(l.serviceVat), billedWithoutVat: r2(l.billedWithoutVat) })).sort(byRate)
  const rf = refunds.map(l => ({ ...l, netSales: r2(l.netSales), vat: r2(l.vat) })).sort(byRate)
  const i = input.map(l => ({ ...l, taxableUsd: r2(l.taxableUsd), vatUsd: r2(l.vatUsd) })).sort(byRate)
  const outputVat = r2(o.reduce((n, l) => n + l.goodsVat + l.serviceVat, 0))
  const refundVat = r2(rf.reduce((n, l) => n + l.vat, 0))
  const inputVat = r2(i.reduce((n, l) => n + l.vatUsd, 0))
  return {
    output: o, refunds: rf, input: i, outputVat, refundVat, inputVat,
    netVat: r2(outputVat - refundVat - inputVat),
    checksWithoutVatRate: o.find(l => l.rate === null)?.checks ?? 0,
  }
}

/** Adds branches' figures line by line (by rate): the consolidated column is their sum. */
export function addVat(list: readonly VatFigures[]): VatFigures {
  const merge = <T extends { rate: number | null }>(lines: T[][], add: (a: T, b: T) => T) => {
    const m = new Map<string, T>()
    for (const l of lines.flat()) m.set(key(l.rate), m.has(key(l.rate)) ? add(m.get(key(l.rate))!, l) : { ...l })
    return [...m.values()]
  }
  return finish(
    merge(list.map(f => f.output), (a, b) => ({ rate: a.rate, checks: a.checks + b.checks, netSales: a.netSales + b.netSales, goodsVat: a.goodsVat + b.goodsVat, serviceNet: a.serviceNet + b.serviceNet, serviceVat: a.serviceVat + b.serviceVat, billedWithoutVat: a.billedWithoutVat + b.billedWithoutVat })),
    merge(list.map(f => f.refunds), (a, b) => ({ rate: a.rate, refunds: a.refunds + b.refunds, netSales: a.netSales + b.netSales, vat: a.vat + b.vat })),
    merge(list.map(f => f.input) as (InputVatLine & { rate: number | null })[][], (a, b) => ({ rate: a.rate, deliveries: a.deliveries + b.deliveries, taxableUsd: a.taxableUsd + b.taxableUsd, vatUsd: a.vatUsd + b.vatUsd })) as InputVatLine[],
  )
}

export interface VatReport { byBranch: { branch: string; figures: VatFigures }[]; total: VatFigures }

export function vatReport(rows: readonly CheckRow[], deliveries: readonly DeliveryVatRow[], branches: readonly string[]): VatReport {
  const byBranch = branches.map(branch => ({
    branch,
    figures: forBranch(rows.filter(r => r.branch === branch), deliveries.filter(d => d.branch === branch)),
  }))
  return { byBranch, total: addVat(byBranch.map(b => b.figures)) }
}

export function rateLabel(rate: number | null): string {
  return rate === null ? 'No rate recorded' : `${+(rate * 100).toFixed(2)}%`
}
