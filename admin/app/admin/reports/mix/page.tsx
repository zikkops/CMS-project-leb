'use client'

// Product mix (UPGRADE.md T3.3): best sellers by count and by revenue, and by
// category, over the checks that closed on the days chosen. Refunded checks
// and voided lines are not sales; an item's revenue is after its own
// discount, and whole-check discounts are shown apart because they belong to
// no item.
//
// No figure is worked out here: the server builds it with
// shared/src/salesReports.ts (verify:reports).

import { useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import type { MixCategory, MixItem, ProductMix } from '@big-cms/shared/salesReports'
import type { CutShort } from '@big-cms/shared/salesExport'
import { Page, PageHeader, Panel, DataTable, EmptyState, ErrorLine, Loading, CutShortNote, type Column } from '../../../components/ui'
import { ReportRange, BranchTotals, fetchReport, reportError, usd, type RangeChoice } from '../ReportRange'

type Report = ProductMix & { from: string; to: string; cutShort?: CutShort | null; byBranch?: { branch: string; totals: Record<string, number> }[] }

const pct = (share: number) => `${(share * 100).toFixed(1)}%`

/** A bar for the share, so the eye finds the big sellers without reading every row. */
function ShareBar({ share }: { share: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end', width: '100%' }}>
      <span aria-hidden style={{ width: '80px', height: '6px', borderRadius: '3px', background: 'rgba(var(--offwhite-rgb),0.08)', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.min(100, share * 100)}%`, background: 'var(--teal)' }} />
      </span>
      {pct(share)}
    </span>
  )
}

const itemColumns: Column<MixItem>[] = [
  { key: 'name', label: 'Item', render: i => i.name, sort: (a, b) => a.name.localeCompare(b.name) },
  { key: 'category', label: 'Category', render: i => i.category, sort: (a, b) => a.category.localeCompare(b.category) },
  { key: 'quantity', label: 'Sold', align: 'right', render: i => String(i.quantity), sort: (a, b) => a.quantity - b.quantity },
  { key: 'revenue', label: 'Revenue', align: 'right', render: i => usd(i.revenue), sort: (a, b) => a.revenue - b.revenue },
  { key: 'share', label: 'Share', align: 'right', width: '150px', render: i => <ShareBar share={i.share} />, sort: (a, b) => a.share - b.share },
]

const categoryColumns: Column<MixCategory>[] = [
  { key: 'category', label: 'Category', render: c => c.category, sort: (a, b) => a.category.localeCompare(b.category) },
  { key: 'items', label: 'Items', align: 'right', render: c => String(c.items), sort: (a, b) => a.items - b.items },
  { key: 'quantity', label: 'Sold', align: 'right', render: c => String(c.quantity), sort: (a, b) => a.quantity - b.quantity },
  { key: 'revenue', label: 'Revenue', align: 'right', render: c => usd(c.revenue), sort: (a, b) => a.revenue - b.revenue },
  { key: 'share', label: 'Share', align: 'right', width: '150px', render: c => <ShareBar share={c.share} />, sort: (a, b) => a.share - b.share },
]

export default function ProductMixPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.endOfDay)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(range: RangeChoice) {
    setBusy(true); setError('')
    try { setReport(await fetchReport<Report>('mix', range)) }
    catch (err) { setError(reportError(err)) }
    finally { setBusy(false) }
  }

  if (checking) return null
  return (
    <Page width="wide">
      <PageHeader title="Product Mix"
        lead="What sold, and how much it brought in, by item and by category, over the checks that closed on the days you choose." />
      <ReportRange onRun={run} busy={busy} />
      {error && <ErrorLine>{error}</ErrorLine>}
      <CutShortNote cut={report?.cutShort} />
      {busy && !report && <Loading label="Reading the checks…" />}
      {report && (
        <>
          <BranchTotals rows={report.byBranch ?? []} columns={[
            { key: 'checks', label: 'Checks' }, { key: 'quantity', label: 'Items sold' },
            { key: 'revenue', label: 'Item revenue', money: true }, { key: 'checkDiscounts', label: 'Check discounts', money: true },
          ]} />
          <Panel title={`${report.from === report.to ? report.from : `${report.from} to ${report.to}`} · ${report.totals.checks} closed check${report.totals.checks === 1 ? '' : 's'}`}>
            <p style={{ fontFamily: 'var(--font-inter)', color: 'var(--offwhite)', fontSize: '1.05rem' }}>
              {report.totals.quantity} items sold for {usd(report.totals.revenue)}
              {report.totals.checkDiscounts > 0 && (
                <span style={{ color: 'rgba(var(--offwhite-rgb),0.55)', fontSize: '0.88rem' }}>
                  {' '}· {usd(report.totals.checkDiscounts)} of whole-check discounts came off after that, and belong to no item
                </span>
              )}
            </p>
          </Panel>
          <Panel title="By category">
            <DataTable columns={categoryColumns} rows={report.categories} rowKey={c => c.category}
              empty={<EmptyState title="Nothing sold in this range." />} />
          </Panel>
          <Panel title="By item, best sellers first">
            <DataTable columns={itemColumns} rows={report.items} rowKey={i => i.key}
              search={(i, q) => `${i.name} ${i.category}`.toLowerCase().includes(q)} searchLabel="Find an item"
              empty={<EmptyState title="Nothing sold in this range." />} />
          </Panel>
        </>
      )}
    </Page>
  )
}
