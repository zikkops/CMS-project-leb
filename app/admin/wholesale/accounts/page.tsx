'use client'

// Wholesale account management. Creation and deactivation go through
// /api/admin/wholesale-accounts (Admin SDK) rather than the client SDK — the
// browser can't mint an Auth user or set the custom claim that the Firestore
// rules read.

import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db, auth } from '../../../lib/firebase'
import { useRequireRole } from '../../../lib/adminAuth'

interface Account {
  uid:         string
  email:       string
  shopName:    string
  contactName: string
  phone:       string
  active:      boolean
}

const EMPTY = { email: '', password: '', shopName: '', contactName: '', phone: '' }

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

export default function WholesaleAccountsPage() {
  const { checking } = useRequireRole(['admin'])
  const isMobile = useIsMobile()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState(EMPTY)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [busyUid, setBusyUid]   = useState<string | null>(null)

  async function load() {
    const snap = await getDocs(query(collection(db, 'users'), where('isWholesale', '==', true)))
    setAccounts(snap.docs.map(d => {
      const x = d.data()
      return {
        uid:         d.id,
        email:       (x.email as string) ?? '',
        shopName:    (x.shopName as string) ?? '',
        contactName: (x.contactName as string) ?? '',
        phone:       (x.phone as string) ?? '',
        active:      x.wholesaleActive !== false,
      }
    }).sort((a, b) => a.shopName.localeCompare(b.shopName)))
    setLoading(false)
  }

  useEffect(() => { if (!checking) load() }, [checking])

  async function call(method: 'POST' | 'PATCH', body: Record<string, unknown>) {
    const idToken = await auth.currentUser?.getIdToken()
    const res = await fetch('/api/admin/wholesale-accounts', {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Request failed.')
    return data
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await call('POST', form)
      setForm(EMPTY); setShowForm(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(acc: Account) {
    setBusyUid(acc.uid)
    try {
      await call('PATCH', { uid: acc.uid, wholesaleActive: !acc.active })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the account.')
    } finally {
      setBusyUid(null)
    }
  }

  if (checking) return null

  const inp: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#F5F2EC', borderRadius: '4px', padding: '0.6rem 0.8rem',
    fontSize: '0.85rem', outline: 'none', fontFamily: 'var(--font-inter)',
  }
  const lbl: React.CSSProperties = {
    display: 'block', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase',
    color: 'rgba(245,242,236,0.35)', marginBottom: '0.3rem', fontFamily: 'var(--font-inter)',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#F5F2EC', fontFamily: 'var(--font-inter)' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: isMobile ? '2rem 1rem' : '3rem 2rem' }}>

        <a href="/admin" style={{ fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', textDecoration: 'none', display: 'block', marginBottom: '0.5rem' }}>
          ← Dashboard
        </a>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', marginBottom: '0.25rem' }}>Wholesale Accounts</h1>
            <p style={{ fontSize: '0.82rem', color: 'rgba(245,242,236,0.35)' }}>
              Shops that buy from us at trade prices. Not the suppliers in Weekly Orders.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <a href="/admin/wholesale/orders" style={{
              background: 'transparent', color: '#9B9BD6', border: '1px solid rgba(106,106,183,0.4)',
              borderRadius: '4px', padding: '0.65rem 1.2rem', fontSize: '0.78rem',
              letterSpacing: '0.08em', textTransform: 'uppercase', textDecoration: 'none',
            }}>Orders</a>
            <button onClick={() => setShowForm(v => !v)} style={{
              background: '#00A098', color: '#000', border: 'none', borderRadius: '4px',
              padding: '0.65rem 1.4rem', fontSize: '0.78rem', fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
            }}>{showForm ? 'Cancel' : '+ New Account'}</button>
          </div>
        </div>

        {error && (
          <p style={{ color: '#E43329', fontSize: '0.82rem', marginBottom: '1rem' }}>{error}</p>
        )}

        {showForm && (
          <form onSubmit={create} style={{
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px', padding: '1.5rem', marginBottom: '2rem',
            display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem',
          }}>
            <div>
              <label style={lbl}>Shop Name *</label>
              <input style={inp} required value={form.shopName} onChange={e => setForm(f => ({ ...f, shopName: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Contact Name</label>
              <input style={inp} value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Email *</label>
              <input style={inp} type="email" required autoComplete="off" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Phone</label>
              <input style={inp} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Password *</label>
              <input style={inp} type="password" required minLength={6} autoComplete="new-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              <p style={{ fontSize: '0.65rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.25rem' }}>
                At least 6 characters — send it to the shop yourself; there&apos;s no invite email.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="submit" disabled={saving} style={{
                background: saving ? 'rgba(255,255,255,0.08)' : '#00A098',
                color: saving ? 'rgba(245,242,236,0.3)' : '#000',
                border: 'none', borderRadius: '4px', padding: '0.7rem 1.5rem',
                fontSize: '0.8rem', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', width: '100%',
              }}>{saving ? 'Creating…' : 'Create Account'}</button>
            </div>
          </form>
        )}

        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)' }}>Loading…</p>
        ) : accounts.length === 0 ? (
          <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '6px', padding: '4rem', textAlign: 'center', color: 'rgba(245,242,236,0.2)', fontSize: '0.88rem' }}>
            No wholesale accounts yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {accounts.map(a => (
              <div key={a.uid} style={{
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${a.active ? 'rgba(255,255,255,0.07)' : 'rgba(228,51,41,0.25)'}`,
                borderRadius: '6px', padding: '1rem 1.2rem',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: '1rem', flexWrap: 'wrap', opacity: a.active ? 1 : 0.6,
              }}>
                <div>
                  <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1rem' }}>
                    {a.shopName}
                    {!a.active && <span style={{ marginLeft: '0.6rem', fontFamily: 'var(--font-inter)', fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#E43329' }}>Deactivated</span>}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'rgba(245,242,236,0.35)', marginTop: '0.2rem' }}>
                    {a.email}{a.contactName && ` · ${a.contactName}`}{a.phone && ` · ${a.phone}`}
                  </p>
                </div>
                <button
                  onClick={() => toggleActive(a)}
                  disabled={busyUid === a.uid}
                  style={{
                    background: a.active ? 'rgba(228,51,41,0.08)' : 'rgba(0,160,152,0.1)',
                    border: `1px solid ${a.active ? 'rgba(228,51,41,0.3)' : 'rgba(0,160,152,0.35)'}`,
                    color: a.active ? '#E43329' : '#00A098',
                    borderRadius: '4px', padding: '0.5rem 1rem', fontSize: '0.72rem',
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    cursor: busyUid === a.uid ? 'not-allowed' : 'pointer',
                  }}
                >{busyUid === a.uid ? '…' : a.active ? 'Deactivate' : 'Reactivate'}</button>
              </div>
            ))}
          </div>
        )}

        <p style={{ marginTop: '2rem', fontSize: '0.72rem', color: 'rgba(245,242,236,0.25)', lineHeight: 1.8 }}>
          Deactivating drops the account&apos;s wholesale claim and revokes its sessions, so trade
          pricing closes immediately rather than lingering on an already-issued token. The login
          itself is kept, so reactivating restores access without a new password.
        </p>
      </div>
    </div>
  )
}
