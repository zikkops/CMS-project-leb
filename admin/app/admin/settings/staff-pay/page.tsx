'use client'

// Staff pay: each person's hourly rate and tip weight (UPGRADE.md T7.18).
//
// Every change takes effect from a day and keeps the old values, so a period
// already worked out keeps its numbers. The labour report reads the rate, and
// the tips split reads the weight: one shift at weight 1.25 counts as 1.25.
// Admin only, like Staff Phones: pay is not handed out for a shift.

import { useEffect, useState } from 'react'
import { faFloppyDisk, faPen, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useRequireRole, type Role } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { BRAND } from '@big-cms/shared/brand'
import { todayYmd } from '@big-cms/shared/dates'
import { startLoad } from '@big-cms/shared/startLoad'
import { DEFAULT_TIP_WEIGHT, MAX_TIP_WEIGHT, type PayEntry, type PayCurrency } from '@big-cms/shared/staffPay'
import { Page, PageHeader, Panel, Button, Field, inputStyle, DataTable, Loading, ErrorLine, type Column } from '../../../components/ui'

interface Row {
  uid: string
  email: string
  role: string
  firstName: string
  history: PayEntry[]
  current: PayEntry | null
}

const words = (err: unknown, fallback: string) =>
  isNetworkFailure(err) ? 'No connection. Try again when the internet is back.' : err instanceof Error ? err.message : fallback

function rateText(e: PayEntry | null): string {
  if (!e || e.hourlyRate === null) return 'Rate not set'
  return e.currency === 'LBP' ? `${e.hourlyRate.toLocaleString('en-US')} LBP / h` : `$${e.hourlyRate.toFixed(2)} / h`
}

/** The form for one person: a new rate and weight from a day. Module scope, so it keeps its state. */
function PayForm({ row, busy, onCancel, onSave }: {
  row: Row
  busy: boolean
  onCancel: () => void
  onSave: (entry: { from: string; hourlyRate: string; currency: PayCurrency; tipWeight: string }) => void
}) {
  const [from, setFrom] = useState(() => todayYmd(BRAND.locale.timezone))
  const [rate, setRate] = useState(row.current?.hourlyRate === null || !row.current ? '' : String(row.current.hourlyRate))
  const [currency, setCurrency] = useState<PayCurrency>(row.current?.currency ?? 'USD')
  const [weight, setWeight] = useState(String(row.current?.tipWeight ?? DEFAULT_TIP_WEIGHT))
  return (
    <Panel>
      <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem', color: 'var(--offwhite)', marginBottom: '0.8rem' }}>
        {row.firstName || row.email}
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.8rem' }}>
        <Field id="pay-from" label="Takes effect from" hint="Earlier days keep what they had.">
          <input id="pay-from" type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
        </Field>
        <Field id="pay-rate" label="Hourly rate" hint="Leave empty for not set.">
          <input id="pay-rate" type="number" min={0} step={currency === 'LBP' ? 1000 : 0.25} value={rate}
            onChange={e => setRate(e.target.value)} style={inputStyle} />
        </Field>
        <Field id="pay-currency" label="Currency">
          <select id="pay-currency" value={currency} onChange={e => setCurrency(e.target.value as PayCurrency)} style={inputStyle}>
            <option value="USD">USD</option>
            <option value="LBP">LBP</option>
          </select>
        </Field>
        <Field id="pay-weight" label="Tip weight" hint={`1 is a normal share, 0 takes them out, at most ${MAX_TIP_WEIGHT}.`}>
          <input id="pay-weight" type="number" min={0} max={MAX_TIP_WEIGHT} step={0.05} value={weight}
            onChange={e => setWeight(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      {row.history.length > 0 && (
        <div style={{ marginTop: '0.9rem', fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.7)' }}>
          <p style={{ fontWeight: 700, marginBottom: '0.3rem' }}>History</p>
          {[...row.history].reverse().map(e => (
            <p key={e.from}>From {e.from}: {rateText(e)}, tip weight {e.tipWeight}{e.setBy ? `, set by ${e.setBy}` : ''}</p>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
        <Button icon={faXmark} onClick={onCancel}>Cancel</Button>
        <Button tone="primary" icon={faFloppyDisk} disabled={busy}
          onClick={() => onSave({ from, hourlyRate: rate, currency, tipWeight: weight })}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Panel>
  )
}

export default function StaffPayPage() {
  const { checking } = useRequireRole(['admin'] as Role[])
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const data = await unwrap(await authedFetch('/api/admin/staff-pay', 'GET')) as { staff: Row[] }
      setRows(data.staff)
      setError('')
    } catch (err) {
      setError(words(err, 'Staff pay could not be read.'))
    }
  }

  useEffect(() => {
    if (checking) return
    startLoad(load)
  }, [checking])

  async function save(uid: string, entry: { from: string; hourlyRate: string; currency: PayCurrency; tipWeight: string }) {
    setBusy(true)
    setError('')
    try {
      await unwrap(await authedFetch('/api/admin/staff-pay', 'POST', { uid, entry }))
      setEditing(null)
      await load()
    } catch (err) {
      setError(words(err, 'That was not saved.'))
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<Row>[] = [
    { key: 'name', label: 'Name', render: r => r.firstName || '(no first name)', sort: (a, b) => (a.firstName || a.email).localeCompare(b.firstName || b.email) },
    { key: 'email', label: 'Email', render: r => r.email },
    { key: 'role', label: 'Role', render: r => r.role },
    { key: 'rate', label: 'Hourly rate', render: r => rateText(r.current) },
    { key: 'weight', label: 'Tip weight', align: 'right', render: r => String(r.current?.tipWeight ?? DEFAULT_TIP_WEIGHT) },
    { key: 'edit', label: '', render: r => <Button icon={faPen} onClick={() => setEditing(r.uid)}>Change</Button> },
  ]

  if (checking) return <Loading />
  const current = rows?.find(r => r.uid === editing) ?? null
  return (
    <Page>
      <PageHeader title="Staff Pay"
        lead="Each person's hourly rate, for labour cost, and tip weight, for the tips split. A change takes effect from the day you choose; earlier days keep what they had." />
      {error && <ErrorLine>{error}</ErrorLine>}
      {current && <PayForm key={current.uid} row={current} busy={busy} onCancel={() => setEditing(null)} onSave={e => { void save(current.uid, e) }} />}
      <Panel>
        {rows === null ? <Loading /> : (
          <DataTable columns={columns} rows={rows} rowKey={r => r.uid} empty="No staff accounts yet."
            search={(r, q) => `${r.firstName} ${r.email} ${r.role}`.toLowerCase().includes(q)} />
        )}
      </Panel>
    </Page>
  )
}
