'use client'

// Closed periods (UPGRADE.md T7.17). An admin closes a period once it has been
// handed to the accountant: every day's and branch's figures are stored as
// issued, with the definitions version. Anything that changes a closed day
// later is shown here, and on the Sales Summary and VAT report, as a
// post-close adjustment against what was issued. Rules: shared/src/periodClose.ts.

import { useEffect, useState } from 'react'
import { faLock, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { startLoad } from '@big-cms/shared/startLoad'
import { BRAND } from '@big-cms/shared/brand'
import { todayYmd } from '@big-cms/shared/dates'
import { addDays } from '@big-cms/shared/reportPeriods'
import { CLOSED_FIELD_LABELS, type Adjustment, type PeriodClose } from '@big-cms/shared/periodClose'
import { Page, PageHeader, Panel, Button, Field, inputStyle, DataTable, EmptyState, ErrorLine, Loading, type Column } from '../../../components/ui'
import { ClosedPeriodNote } from '../ClosedPeriodNote'

type Summary = Omit<PeriodClose, 'days'>

const words = (err: unknown, fallback: string) =>
  isNetworkFailure(err) ? 'No connection. Try again when the internet is back.' : err instanceof Error ? err.message : fallback

export default function ClosedPeriodsPage() {
  const { checking, role } = useRequireRole(SECTION_ACCESS.endOfDay)
  const yesterday = addDays(todayYmd(BRAND.locale.timezone), -1)
  const [closes, setCloses] = useState<Summary[] | null>(null)
  const [from, setFrom] = useState(`${yesterday.slice(0, 8)}01`)
  const [to, setTo] = useState(yesterday)
  const [checked, setChecked] = useState<{ id: string; adjustments: Adjustment[] } | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const data = await unwrap(await authedFetch('/api/admin/period-close', 'GET')) as unknown as { closes: Summary[] }
      setCloses(data.closes)
    } catch (err) {
      setError(words(err, 'The closed periods could not be read.'))
    }
  }

  useEffect(() => {
    if (checking) return
    startLoad(load)
  }, [checking])

  async function close() {
    if (!window.confirm(`Close ${from} to ${to}? Its figures are stored as issued to the accountant. Later changes to those days show as adjustments.`)) return
    setBusy(true); setError(''); setDone('')
    try {
      await unwrap(await authedFetch('/api/admin/period-close', 'POST', { from, to }))
      setDone(`Closed ${from} to ${to}.`)
      await load()
    } catch (err) {
      setError(words(err, 'The period was not closed.'))
    } finally {
      setBusy(false)
    }
  }

  async function check(id: string) {
    setBusy(true); setError('')
    try {
      const data = await unwrap(await authedFetch(`/api/admin/period-close?id=${encodeURIComponent(id)}`, 'GET')) as unknown as { adjustments: Adjustment[] }
      setChecked({ id, adjustments: data.adjustments })
    } catch (err) {
      setError(words(err, 'The period could not be checked.'))
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<Summary>[] = [
    { key: 'period', label: 'Period', render: c => `${c.from} to ${c.to}` },
    { key: 'closed', label: 'Closed', render: c => `${c.closedAt.slice(0, 10)} by ${c.closedBy || '—'}` },
    { key: 'billed', label: 'Billed', align: 'right', render: c => `$${(c.totals.billed ?? 0).toFixed(2)}` },
    { key: 'vat', label: 'VAT', align: 'right', render: c => `$${(c.totals.vatOutput ?? 0).toFixed(2)}` },
    { key: 'version', label: 'Definitions', render: c => c.definitionsVersion },
    { key: 'check', label: '', render: c => <Button icon={faMagnifyingGlass} onClick={() => check(c.id)} disabled={busy}>Check for changes</Button> },
  ]

  if (checking) return <Loading />
  const checkedClose = checked && closes?.find(c => c.id === checked.id)
  return (
    <Page>
      <PageHeader title="Closed Periods"
        lead="Close a period once it has been handed to the accountant. Its figures are kept as issued; anything that changes those days later shows as a post-close adjustment, here and on the Sales Summary and VAT report, never as a silent change." />
      {error && <ErrorLine>{error}</ErrorLine>}
      {role === 'admin' && (
        <Panel title="Close a period">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
            <Field id="close-from" label="First day"><input id="close-from" type="date" value={from} max={yesterday} onChange={e => setFrom(e.target.value)} style={inputStyle} /></Field>
            <Field id="close-to" label="Last day"><input id="close-to" type="date" value={to} max={yesterday} onChange={e => setTo(e.target.value)} style={inputStyle} /></Field>
            <Button tone="primary" icon={faLock} onClick={close} disabled={busy}>{busy ? 'Working…' : 'Close this period'}</Button>
          </div>
          {done && <p style={{ fontFamily: 'var(--font-inter)', color: 'var(--teal)', fontSize: '0.9rem', marginTop: '0.6rem' }}>{done}</p>}
        </Panel>
      )}
      <Panel title="Closed">
        {!closes ? <Loading /> : (
          <DataTable columns={columns} rows={closes} rowKey={c => c.id} empty={<EmptyState title="No period has been closed yet." />} />
        )}
      </Panel>
      {checked && checkedClose && (
        <ClosedPeriodNote closed={[{ id: checked.id, from: checkedClose.from, to: checkedClose.to, closedAt: checkedClose.closedAt, adjustments: checked.adjustments }]} />
      )}
      {checked && checked.adjustments.length > 0 && (
        <p style={{ fontFamily: 'var(--font-inter)', color: 'rgba(var(--offwhite-rgb),0.6)', fontSize: '0.85rem' }}>
          Fields: {Object.values(CLOSED_FIELD_LABELS).join(', ')}.
        </p>
      )}
    </Page>
  )
}
