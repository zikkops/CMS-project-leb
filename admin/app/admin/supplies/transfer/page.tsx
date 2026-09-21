'use client'

// Moving ingredient stock between branches (UPGRADE.md T3.14). Choose from and
// to, type how much of each item goes, and Move: every line or none, checked
// against what the source branch holds when it is moved, never against this
// screen's copy. Managers and admins. Server: shared/src/server/supplyTransfer.ts.

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { faRightLeft } from '@fortawesome/free-solid-svg-icons'
import { db } from '@big-cms/shared/firebase'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { postOnce, unwrap } from '@big-cms/shared/apiClient'
import { STOCKED_BRANCHES } from '@big-cms/shared/branches'
import { startLoad } from '@big-cms/shared/startLoad'
import { Page, PageHeader, Panel, Button, Field, inputStyle, DataTable, EmptyState, ErrorLine, Loading, type Column } from '../../../components/ui'

interface Row { id: string; name: string; unit: string; quantity: Record<string, number> }

export default function SupplyTransferPage() {
  const { checking, role } = useRequireRole(SECTION_ACCESS.supplies)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [from, setFrom] = useState(STOCKED_BRANCHES[0] ?? '')
  const [to, setTo] = useState(STOCKED_BRANCHES[1] ?? '')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function load() {
    try {
      const snap = await getDocs(collection(db, 'supplies'))
      setRows(snap.docs.map(d => {
        const data = d.data()
        return { id: d.id, name: String(data.name ?? ''), unit: String(data.unit ?? ''), quantity: typeof data.quantity === 'object' && data.quantity ? data.quantity as Record<string, number> : {} }
      }).sort((a, b) => a.name.localeCompare(b.name)))
    } catch {
      setError('The supplies could not be read.')
      setRows([])
    }
  }
  useEffect(() => { if (!checking) startLoad(load) }, [checking])

  const chosen = useMemo(() => Object.entries(amounts)
    .map(([supplyId, v]) => ({ supplyId, quantity: Number(v) }))
    .filter(l => Number.isFinite(l.quantity) && l.quantity > 0), [amounts])

  async function move() {
    setBusy(true); setError(''); setDone('')
    try {
      const r = await unwrap(await postOnce('supply-transfer', '/api/admin/supply-transfer', { fromBranch: from, toBranch: to, items: chosen })) as { lines: { name: string; quantity: number; unit: string }[] }
      setDone(`Moved from ${from} to ${to}: ${r.lines.map(l => `${l.name} ${l.quantity} ${l.unit}`.trim()).join(', ')}.`)
      setAmounts({})
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nothing was moved.')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<Row>[] = [
    { key: 'name', label: 'Item', render: r => r.name, sort: (a, b) => a.name.localeCompare(b.name) },
    { key: 'from', label: `At ${from}`, align: 'right', render: r => `${Number(r.quantity[from] ?? 0)} ${r.unit}`, sort: (a, b) => (a.quantity[from] ?? 0) - (b.quantity[from] ?? 0) },
    { key: 'to', label: `At ${to}`, align: 'right', render: r => `${Number(r.quantity[to] ?? 0)} ${r.unit}` },
    {
      key: 'move', label: 'Move', align: 'right', width: '140px',
      render: r => (
        <input type="number" min={0} step="any" value={amounts[r.id] ?? ''} aria-label={`How much ${r.name} to move`}
          onChange={e => setAmounts(a => ({ ...a, [r.id]: e.target.value }))}
          style={{ ...inputStyle, minHeight: '36px', padding: '0.3rem 0.5rem', textAlign: 'right', maxWidth: '120px' }} />
      ),
    },
  ]

  if (checking) return null
  const manager = role === 'manager' || role === 'admin'
  return (
    <Page width="normal">
      <PageHeader title="Move Stock Between Branches"
        lead="Ingredients from one branch to another, in the unit each item is counted in. Every line moves, or none does." />
      {STOCKED_BRANCHES.length < 2 ? (
        <EmptyState title="Only one branch holds stock.">Moving stock needs two branches that keep ingredients.</EmptyState>
      ) : !manager ? (
        <EmptyState title="Only a manager moves stock between branches." />
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
            <div style={{ minWidth: '10rem' }}>
              <Field id="move-from" label="From">
                <select id="move-from" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle}>
                  {STOCKED_BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ minWidth: '10rem' }}>
              <Field id="move-to" label="To">
                <select id="move-to" value={to} onChange={e => setTo(e.target.value)} style={inputStyle}>
                  {STOCKED_BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
            </div>
          </div>
          {from === to && <ErrorLine>Pick two different branches.</ErrorLine>}
          {error && <ErrorLine>{error}</ErrorLine>}
          {done && <p role="status" style={{ fontFamily: 'var(--font-inter)', color: 'var(--teal)', marginBottom: '1rem' }}>{done}</p>}
          <Panel>
            {!rows ? <Loading label="Reading the supplies…" /> : (
              <DataTable columns={columns} rows={rows} rowKey={r => r.id}
                search={(r, q) => r.name.toLowerCase().includes(q)} searchLabel="Find an item"
                empty={<EmptyState title="No supplies yet." />} />
            )}
          </Panel>
          <Button tone="primary" icon={faRightLeft} disabled={busy || from === to || chosen.length === 0} onClick={() => { void move() }}>
            {busy ? 'Moving…' : `Move ${chosen.length} item${chosen.length === 1 ? '' : 's'} from ${from} to ${to}`}
          </Button>
        </>
      )}
    </Page>
  )
}
