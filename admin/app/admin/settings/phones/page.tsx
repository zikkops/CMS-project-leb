'use client'

// Staff phones: the phones registered for fingerprint sign-in at the till.
// POS software, stage 5 (owner's decisions S12–S14).
//
// A staff member registers their own phone in the staff app, once, online. This
// page is where an admin sees them and removes one: a lost phone, or a leaver's.
// A removed phone stops signing its owner in at each café hub's next sync.
// Admin only, like Café Hubs.

import { useEffect, useState } from 'react'
import { faTrashCan } from '@fortawesome/free-solid-svg-icons'
import { useRequireRole, type Role } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { BRAND } from '@big-cms/shared/brand'
import { MAX_KEYS_PER_STAFF } from '@big-cms/shared/staffKeys'
import { startLoad } from '@big-cms/shared/startLoad'
import { Page, PageHeader, Panel, Button, Loading, EmptyState, ErrorLine } from '../../../components/ui'

interface PhoneRow {
  keyId: string
  uid: string
  owner: string
  deviceName: string
  createdAt: number | null
  revoked: boolean
  revokedAt: number | null
}

/** A moment in the café's day, whatever zone this browser is in. */
function when(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: BRAND.locale.timezone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function PhoneCard({
  phone, confirming, busy, onAsk, onCancel, onRemove,
}: {
  phone: PhoneRow
  confirming: boolean
  busy: boolean
  onAsk: () => void
  onCancel: () => void
  onRemove: () => void
}) {
  return (
    <div style={{ padding: '1rem 0', borderTop: '1px solid rgba(var(--offwhite-rgb),0.07)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1rem', color: 'var(--offwhite)' }}>
          {phone.owner}
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.45)', marginLeft: '0.6rem' }}>{phone.deviceName}</span>
        </span>
        <span style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.12em', textTransform: 'uppercase',
          color: phone.revoked ? 'rgba(var(--offwhite-rgb),0.4)' : 'var(--teal)',
        }}>{phone.revoked ? `Removed ${when(phone.revokedAt)}` : 'Signs in'}</span>
      </div>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.5)', lineHeight: 1.7, margin: '0.35rem 0 0' }}>
        Registered {when(phone.createdAt)}
      </p>

      {!phone.revoked && !confirming && (
        <Button icon={faTrashCan} onClick={onAsk} style={{ marginTop: '0.7rem' }}>Remove</Button>
      )}
      {!phone.revoked && confirming && (
        <div style={{ marginTop: '0.8rem' }}>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.75)', lineHeight: 1.6, marginBottom: '0.7rem' }}>
            Remove {phone.owner}&apos;s {phone.deviceName}? It stops signing them in at each café hub&apos;s next sync, and cannot be
            added back: they register the phone again from the staff app.
          </p>
          <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'space-between', maxWidth: '360px' }}>
            <Button onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button tone="danger" icon={faTrashCan} onClick={onRemove} disabled={busy}>{busy ? 'Removing…' : 'Remove'}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function StaffPhonesPage() {
  const { checking } = useRequireRole(['admin'] as Role[])

  const [phones, setPhones] = useState<PhoneRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  async function load() {
    try {
      const data = await unwrap(await authedFetch('/api/admin/staff-phones', 'GET')) as { phones: PhoneRow[] }
      setPhones(data.phones)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the phones.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (checking) return
    startLoad(load)
  }, [checking])

  async function remove(keyId: string) {
    setRemoving(true)
    setError('')
    try {
      await unwrap(await authedFetch('/api/admin/staff-phones', 'PATCH', { keyId, action: 'remove' }))
      setConfirming(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the phone.')
    } finally {
      setRemoving(false)
    }
  }

  if (checking) return <Page width="narrow"><Loading /></Page>

  const active = phones.filter(p => !p.revoked)
  const removed = phones.filter(p => p.revoked)

  return (
    <Page width="narrow">
        <PageHeader
          section="Settings"
          title="Staff Phones"
          lead={<>
            Staff sign in at a café hub with their own phone&apos;s fingerprint or face. Each registers their
            phone once, in the staff app, while the internet is up; up to {MAX_KEYS_PER_STAFF} phones each.
            Remove a lost phone, or a leaver&apos;s, here: it stops signing them in at each hub&apos;s next sync.
          </>}
        />

        {error && <ErrorLine>{error}</ErrorLine>}

        <Panel title="Registered phones" style={{ paddingBottom: '0.6rem' }}>
          {loading && <Loading />}
          {!loading && active.length === 0 && (
            <EmptyState title="No phone is registered yet.">
              Staff sign in at a hub with their email and password until they register one in the staff app.
            </EmptyState>
          )}
          {active.map(phone => (
            <PhoneCard
              key={phone.keyId}
              phone={phone}
              confirming={confirming === phone.keyId}
              busy={removing}
              onAsk={() => setConfirming(phone.keyId)}
              onCancel={() => setConfirming(null)}
              onRemove={() => remove(phone.keyId)}
            />
          ))}
        </Panel>

        {removed.length > 0 && (
          <Panel title="Removed" style={{ paddingBottom: '0.6rem' }}>
            {removed.map(phone => (
              <PhoneCard key={phone.keyId} phone={phone} confirming={false} busy={false} onAsk={() => {}} onCancel={() => {}} onRemove={() => {}} />
            ))}
          </Panel>
        )}
    </Page>
  )
}
