'use client'

// The waitlist (UPGRADE.md T3.13): walk-ins waiting for a table, first come
// first, with how long each has waited and whether that is past what they
// were told. Today only, the café's today. Rules in shared/src/waitlist.ts.

import { useEffect, useState } from 'react'
import { faUserPlus, faChair, faDoorOpen, faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { authedFetch, postOnce, unwrap } from '@big-cms/shared/apiClient'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { BRAND } from '@big-cms/shared/brand'
import { startLoad } from '@big-cms/shared/startLoad'
import { overQuote, waitView, waitedMinutes, type WaitEntry } from '@big-cms/shared/waitlist'
import { Page, PageHeader, Panel, Button, Field, inputStyle, EmptyState, ErrorLine, Loading } from '../../../components/ui'

const words = (err: unknown, fallback: string) =>
  isNetworkFailure(err) ? 'No connection. Try again when the internet is back.' : err instanceof Error ? err.message : fallback

export default function WaitlistPage() {
  const { checking, branchIds, role } = useRequireRole(SECTION_ACCESS.tableReservations)
  const mine = role === 'admin' || branchIds.length === 0 ? BRAND.branches : branchIds
  const [branch, setBranch] = useState('')
  const at = branch || mine[0] || ''
  const [list, setList] = useState<{ day: string; entries: WaitEntry[] } | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [name, setName] = useState('')
  const [party, setParty] = useState('2')
  const [quoted, setQuoted] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    if (!at) return
    try {
      setList(await unwrap(await authedFetch(`/api/admin/waitlist?branch=${encodeURIComponent(at)}`, 'GET')) as { day: string; entries: WaitEntry[] })
      setError('')
    } catch (err) {
      setError(words(err, 'The waitlist could not be read.'))
    }
  }

  // Every 20 seconds, so a second screen at the door sees what the first added.
  useEffect(() => {
    if (checking || !at) return
    startLoad(load)
    const t = setInterval(() => { setNow(Date.now()); void load() }, 20_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, at])

  async function add() {
    setSaving(true); setError('')
    try {
      await unwrap(await postOnce('waitlist', '/api/admin/waitlist', { branch: at, name, partySize: Number(party), quotedMinutes: quoted, note }))
      setName(''); setParty('2'); setQuoted(''); setNote('')
      await load()
    } catch (err) {
      setError(words(err, 'That party was not added.'))
    } finally {
      setSaving(false)
    }
  }

  async function move(id: string, status: 'seated' | 'left' | 'waiting') {
    setError('')
    try {
      await unwrap(await authedFetch('/api/admin/waitlist', 'PATCH', { id, status }))
      await load()
    } catch (err) {
      setError(words(err, 'That did not change.'))
    }
  }

  if (checking) return null
  const view = list ? waitView(list.entries, list.day) : null
  return (
    <Page width="normal">
      <PageHeader title="Waitlist"
        lead="Walk-ins waiting for a table, first come first. A name to call, how many, and what you told them: no phone number is kept." />
      {mine.length > 1 && (
        <div style={{ maxWidth: '16rem' }}>
          <Field id="wait-branch" label="Branch">
            <select id="wait-branch" value={at} onChange={e => { setBranch(e.target.value); setList(null) }} style={inputStyle}>
              {mine.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
        </div>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}

      <Panel title="Add a party">
        <form onSubmit={e => { e.preventDefault(); void add() }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0 0.8rem', alignItems: 'end' }}>
          <Field id="wait-name" label="Name to call" required>
            <input id="wait-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} required style={inputStyle} />
          </Field>
          <Field id="wait-party" label="How many" required>
            <input id="wait-party" type="number" min={1} max={50} value={party} onChange={e => setParty(e.target.value)} required style={inputStyle} />
          </Field>
          <Field id="wait-quoted" label="Told them (minutes)">
            <input id="wait-quoted" type="number" min={0} max={240} value={quoted} onChange={e => setQuoted(e.target.value)} placeholder="e.g. 20" style={inputStyle} />
          </Field>
          <Field id="wait-note" label="Note">
            <input id="wait-note" value={note} onChange={e => setNote(e.target.value)} maxLength={120} placeholder="Terrace, high chair…" style={inputStyle} />
          </Field>
          <div style={{ marginBottom: '1.1rem' }}>
            <Button type="submit" tone="primary" icon={faUserPlus} disabled={saving || !name.trim()}>{saving ? 'Adding…' : 'Add to the list'}</Button>
          </div>
        </form>
      </Panel>

      {!view ? <Loading label="Reading the waitlist…" /> : (
        <>
          <Panel title={`Waiting · ${view.waiting.length}${view.averageWait !== null ? ` · today's average wait ${view.averageWait} min` : ''}`}>
            {view.waiting.length === 0 ? <EmptyState title="Nobody is waiting." /> : view.waiting.map(e => {
              const late = overQuote(e, now)
              return (
                <div key={e.id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', padding: '0.8rem 0',
                  borderTop: '1px solid rgba(var(--offwhite-rgb),0.08)', fontFamily: 'var(--font-inter)',
                }}>
                  <span style={{ fontSize: '1.4rem', fontWeight: 700, color: 'rgba(var(--offwhite-rgb),0.5)', minWidth: '2rem' }}>{e.place}</span>
                  <span style={{ flex: 1, minWidth: '10rem' }}>
                    <span style={{ display: 'block', color: 'var(--offwhite)', fontSize: '1rem', fontWeight: 600 }}>{e.name} · {e.partySize}</span>
                    <span style={{ fontSize: '0.82rem', color: late ? 'var(--red)' : 'rgba(var(--offwhite-rgb),0.55)' }}>
                      waiting {waitedMinutes(e, now)} min{e.quotedMinutes !== null ? ` · told ${e.quotedMinutes}` : ''}{late ? ' · past what they were told' : ''}{e.note ? ` · ${e.note}` : ''}
                    </span>
                  </span>
                  <Button tone="primary" icon={faChair} onClick={() => { void move(e.id, 'seated') }}>Seated</Button>
                  <Button tone="quiet" icon={faDoorOpen} onClick={() => { void move(e.id, 'left') }}>Left</Button>
                </div>
              )
            })}
          </Panel>
          {view.done.length > 0 && (
            <Panel title="Seated or left today">
              {view.done.map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.5rem 0', fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'rgba(var(--offwhite-rgb),0.65)' }}>
                  <span style={{ flex: 1 }}>{e.name} · {e.partySize} · {e.status === 'seated' ? `seated after ${waitedMinutes(e, now)} min` : 'left'}</span>
                  <Button tone="quiet" icon={faRotateLeft} onClick={() => { void move(e.id, 'waiting') }} ariaLabel={`Put ${e.name} back on the list`}>Back on the list</Button>
                </div>
              ))}
            </Panel>
          )}
        </>
      )}
    </Page>
  )
}
