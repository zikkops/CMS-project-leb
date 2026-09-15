'use client'

// Staff phones: the phones registered for fingerprint sign-in at the till.
// POS software, stage 5 (owner's decisions S12–S14).
//
// A staff member registers their own phone in the staff app, once, online. This
// page is where an admin sees them and removes one: a lost phone, or a leaver's.
// A removed phone stops signing its owner in at each café hub's next sync.
// Admin only, like Café Hubs.

import { useEffect, useState } from 'react'
import { useRequireRole, type Role } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { BRAND } from '@big-cms/shared/brand'
import { MAX_KEYS_PER_STAFF } from '@big-cms/shared/staffKeys'

// Duplicated per file by convention — see CLAUDE.md. Don't refactor to share.
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return isMobile
}

interface PhoneRow {
  keyId: string
  uid: string
  owner: string
  deviceName: string
  createdAt: number | null
  revoked: boolean
  revokedAt: number | null
}

const panel: React.CSSProperties = {
  marginBottom: '2rem',
  padding: '1.4rem 1.5rem',
  backgroundColor: 'rgba(var(--offwhite-rgb),0.02)',
  border: '1px solid rgba(var(--offwhite-rgb),0.07)',
  borderRadius: '4px',
}

const panelTitle: React.CSSProperties = {
  fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.2em',
  textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.55)',
  marginBottom: '0.2rem',
}

const button = (tone: 'danger' | 'quiet', busy = false): React.CSSProperties => ({
  minHeight: '44px', padding: '0 1.4rem', borderRadius: '4px',
  fontFamily: 'var(--font-inter)', fontSize: '0.75rem', fontWeight: 600,
  letterSpacing: '0.08em', textTransform: 'uppercase',
  cursor: busy ? 'default' : 'pointer',
  border: tone === 'quiet' ? '1px solid rgba(var(--offwhite-rgb),0.2)' : 'none',
  backgroundColor: tone === 'danger' ? 'var(--red)' : 'transparent',
  color: tone === 'quiet' ? 'rgba(var(--offwhite-rgb),0.75)' : '#fff',
})

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
        <button type="button" onClick={onAsk} style={{ ...button('quiet'), marginTop: '0.7rem' }}>Remove</button>
      )}
      {!phone.revoked && confirming && (
        <div style={{ marginTop: '0.8rem' }}>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.75)', lineHeight: 1.6, marginBottom: '0.7rem' }}>
            Remove {phone.owner}&apos;s {phone.deviceName}? It stops signing them in at each café hub&apos;s next sync, and cannot be
            added back: they register the phone again from the staff app.
          </p>
          <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'space-between', maxWidth: '360px' }}>
            <button type="button" onClick={onCancel} disabled={busy} style={button('quiet', busy)}>Cancel</button>
            <button type="button" onClick={onRemove} disabled={busy} style={button('danger', busy)}>{busy ? 'Removing…' : 'Remove'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function StaffPhonesPage() {
  const { checking } = useRequireRole(['admin'] as Role[])
  const isMobile = useIsMobile()

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
    void load()
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

  if (checking) return null

  const active = phones.filter(p => !p.revoked)
  const removed = phones.filter(p => p.revoked)

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '2rem 1.25rem 4rem' : '3rem 2.5rem 5rem',
    }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.25em',
          textTransform: 'uppercase', color: 'var(--teal)', marginBottom: '0.6rem',
        }}>Settings</p>
        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.7rem' : '2.2rem',
          color: 'var(--offwhite)', marginBottom: '0.6rem',
        }}>Staff Phones</h1>
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
          color: 'rgba(var(--offwhite-rgb),0.4)', lineHeight: 1.7,
          marginBottom: '2.5rem', maxWidth: '56ch',
        }}>
          Staff sign in at a café hub with their own phone&apos;s fingerprint or face. Each registers their
          phone once, in the staff app, while the internet is up; up to {MAX_KEYS_PER_STAFF} phones each.
          Remove a lost phone, or a leaver&apos;s, here: it stops signing them in at each hub&apos;s next sync.
        </p>

        {error && (
          <p style={{ color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', marginBottom: '1rem', lineHeight: 1.6 }}>{error}</p>
        )}

        <section style={{ ...panel, paddingBottom: '0.6rem' }}>
          <h2 style={panelTitle}>Registered phones</h2>
          {loading && <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)', padding: '1rem 0' }}>Loading…</p>}
          {!loading && active.length === 0 && (
            <p style={{ color: 'rgba(var(--offwhite-rgb),0.4)', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', padding: '1rem 0' }}>
              No phone is registered. Staff sign in at a hub with their email and password until they register one.
            </p>
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
        </section>

        {removed.length > 0 && (
          <section style={{ ...panel, paddingBottom: '0.6rem' }}>
            <h2 style={panelTitle}>Removed</h2>
            {removed.map(phone => (
              <PhoneCard key={phone.keyId} phone={phone} confirming={false} busy={false} onAsk={() => {}} onCancel={() => {}} onRemove={() => {}} />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
