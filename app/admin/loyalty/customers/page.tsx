'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireRole } from '../../../lib/adminAuth'
import {
  useAllCustomers, useLoyaltyResetSettings, saveLoyaltyResetDate,
  updateCustomerXP, updateCustomerCoins, deleteCustomerAccount, resendCustomerPasswordReset,
  exportCustomersToExcel, type CustomerAccount,
} from '../../../lib/customerManagement'
import { TIER_COLORS, getTierFromLevel } from '../../../lib/levelConfig'

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

function formatResetDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

const inputStyle = {
  width: '100%',
  backgroundColor: '#1a1a1a',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#F5F2EC',
  padding: '0.75rem 1rem',
  borderRadius: '2px',
  fontSize: '0.85rem',
  outline: 'none',
  fontFamily: 'var(--font-inter)',
}

const labelStyle = {
  display: 'block',
  fontSize: '0.68rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase' as const,
  color: 'rgba(245,242,236,0.35)',
  marginBottom: '0.5rem',
  fontFamily: 'var(--font-inter)',
}

export default function ManageCustomersPage() {
  const { checking } = useRequireRole(['admin'])
  const isMobile = useIsMobile()
  const { customers, loading } = useAllCustomers()
  const { settings, loading: loadingSettings, defaultDate } = useLoyaltyResetSettings()

  const [search, setSearch] = useState('')
  const [resetDateInput, setResetDateInput] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [dateSaved, setDateSaved] = useState(false)

  const [editing, setEditing] = useState<CustomerAccount | null>(null)
  const [xpInput, setXpInput] = useState('0')
  const [coinsInput, setCoinsInput] = useState('0')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [sentEmailId, setSentEmailId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    if (!loadingSettings) setResetDateInput(settings?.nextResetDate ?? defaultDate)
  }, [loadingSettings, settings, defaultDate])

  const filtered = useMemo(() => {
    if (!search.trim()) return customers
    const q = search.trim().toLowerCase()
    return customers.filter(c =>
      c.displayName.toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.firstName.toLowerCase().includes(q) ||
      c.lastName.toLowerCase().includes(q)
    )
  }, [customers, search])

  async function handleSaveResetDate() {
    setSavingDate(true)
    try {
      await saveLoyaltyResetDate(resetDateInput, settings?.nextResetDate ?? null)
      setDateSaved(true)
      setTimeout(() => setDateSaved(false), 2500)
    } finally {
      setSavingDate(false)
    }
  }

  function openEdit(customer: CustomerAccount) {
    setEditing(customer)
    setXpInput(String(customer.xp))
    setCoinsInput(String(customer.obCoins))
    setError('')
  }

  async function handleSavePoints() {
    if (!editing) return
    const xp = Number(xpInput)
    const coins = Number(coinsInput)
    if (!Number.isFinite(xp) || !Number.isFinite(coins) || xp < 0 || coins < 0) {
      setError('Enter valid, non-negative numbers.')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (xp !== editing.xp) await updateCustomerXP(editing, xp)
      if (coins !== editing.obCoins) await updateCustomerCoins(editing, coins)
      setEditing(null)
    } catch {
      setError('Something went wrong saving — please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleResendPassword(customer: CustomerAccount) {
    if (!customer.email) return
    await resendCustomerPasswordReset(customer.email)
    setSentEmailId(customer.id)
    setTimeout(() => setSentEmailId(null), 2500)
  }

  async function handleExport() {
    setExporting(true)
    setExportError('')
    try {
      await exportCustomersToExcel(filtered)
    } catch (err) {
      console.warn('[export-customers]', err)
      setExportError(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed — please try again.')
    } finally {
      setExporting(false)
    }
  }

  async function handleDelete(customer: CustomerAccount) {
    if (!confirm(
      `Delete ${customer.displayName}'s account? This permanently removes their XP, OB Coins, and profile data — it cannot be undone. ` +
      `Their login isn't deleted (that requires server access this app doesn't have); if they sign in again afterward, they'd get a brand-new blank profile.`
    )) return
    await deleteCustomerAccount(customer)
  }

  if (checking) return null

  const cardStyle = {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '4px',
    padding: isMobile ? '1rem 1.2rem' : '1.2rem 1.5rem',
  }

  const actionBtnStyle = {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(245,242,236,0.6)',
    padding: '0.4rem 0.8rem',
    borderRadius: '2px',
    fontSize: '0.7rem',
    cursor: 'pointer',
    fontFamily: 'var(--font-inter)',
    whiteSpace: 'nowrap' as const,
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <a href="/admin" style={{
              fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.3)', textDecoration: 'none', fontFamily: 'var(--font-inter)',
              marginBottom: '0.5rem', display: 'block',
            }}>← Back to Dashboard</a>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)' }}>
              Manage Customers
            </h1>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.4rem' }}>
              {customers.length} customer{customers.length === 1 ? '' : 's'}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <button onClick={handleExport} disabled={exporting || filtered.length === 0} style={{
              backgroundColor: 'var(--teal)', color: '#fff', border: 'none',
              padding: '0.75rem 1.5rem', borderRadius: '2px', fontSize: '0.78rem',
              letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
              cursor: exporting || filtered.length === 0 ? 'not-allowed' : 'pointer',
              opacity: exporting || filtered.length === 0 ? 0.6 : 1,
            }}>{exporting ? 'Exporting…' : 'Export to Excel'}</button>
            {exportError && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--red)', fontFamily: 'var(--font-inter)' }}>{exportError}</p>
            )}
          </div>
        </div>

        {/* Annual Points Reset */}
        <div style={{ ...cardStyle, marginBottom: '2rem' }}>
          <p style={{
            fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'var(--navy)', fontFamily: 'var(--font-inter)', marginBottom: '0.6rem',
          }}>Annual Points Reset</p>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.45)', lineHeight: 1.6, marginBottom: '1.2rem' }}>
            On this date, every customer&apos;s XP and OB Coins reset to 0 (level resets to 1 too). There's no background
            server job in this app, so the reset fires automatically the next time any admin opens the dashboard on or
            after this date — then reschedules itself a year out.
            {!loadingSettings && !settings && ' Defaulted to one year from today — save to confirm it.'}
          </p>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '0.8rem', alignItems: isMobile ? 'stretch' : 'flex-end' }}>
            <div style={{ flex: isMobile ? undefined : '0 0 220px' }}>
              <label style={labelStyle}>Next Reset Date</label>
              <input type="date" value={resetDateInput} min={new Date().toISOString().slice(0, 10)}
                onChange={e => setResetDateInput(e.target.value)}
                style={{ ...inputStyle, colorScheme: 'dark' }} />
            </div>
            <button onClick={handleSaveResetDate} disabled={savingDate || loadingSettings} style={{
              backgroundColor: 'var(--navy)', color: '#fff', border: 'none',
              padding: '0.75rem 1.5rem', borderRadius: '2px', fontSize: '0.78rem',
              letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
              cursor: savingDate ? 'not-allowed' : 'pointer', opacity: savingDate ? 0.6 : 1,
            }}>{savingDate ? 'Saving…' : 'Save Date'}</button>
            {dateSaved && (
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'var(--teal)', alignSelf: 'center' }}>Saved.</span>
            )}
          </div>
          {!loadingSettings && settings && (
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.8rem' }}>
              Currently scheduled for {formatResetDate(settings.nextResetDate)}.
            </p>
          )}
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, username, or email…"
          style={{ ...inputStyle, marginBottom: '1.5rem' }}
        />

        {/* List */}
        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
          }}>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.3)' }}>
              {customers.length === 0 ? 'No customers yet.' : 'No matching customers.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {filtered.map(customer => {
              const tierColor = TIER_COLORS[getTierFromLevel(customer.level)]
              return (
                <div key={customer.id} style={{
                  ...cardStyle,
                  display: 'flex',
                  flexDirection: isMobile ? 'column' : 'row',
                  alignItems: isMobile ? 'stretch' : 'center',
                  gap: isMobile ? '0.8rem' : '1.2rem',
                }}>
                  {/* Avatar + identity */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flex: isMobile ? undefined : 1, minWidth: 0 }}>
                    <div style={{
                      width: '40px', height: '40px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                      backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {customer.avatarUrl ? (
                        <img src={customer.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontSize: '0.85rem', color: 'rgba(245,242,236,0.5)', fontFamily: 'var(--font-cinzel)' }}>
                          {customer.displayName.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'var(--offwhite)', wordBreak: 'break-word' }}>
                        {customer.displayName}
                      </p>
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.35)', wordBreak: 'break-word' }}>
                        {customer.email || customer.username}
                      </p>
                      {(customer.firstName || customer.lastName || customer.phoneNumber) && (
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.3)', wordBreak: 'break-word' }}>
                          {[customer.firstName, customer.lastName].filter(Boolean).join(' ')}
                          {customer.phoneNumber ? ` · ${customer.phoneNumber}` : ''}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Level / XP / Coins */}
                  <div style={{ display: 'flex', gap: '1.5rem', flexShrink: 0 }}>
                    <div>
                      <p style={{ fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Level</p>
                      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: tierColor ?? 'var(--offwhite)' }}>{customer.level}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>XP</p>
                      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--teal)' }}>{customer.xp.toLocaleString()}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>OB Coins</p>
                      <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--purple)' }}>{customer.obCoins.toLocaleString()}</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button onClick={() => openEdit(customer)} style={actionBtnStyle}>Edit Points</button>
                    <button onClick={() => handleResendPassword(customer)} disabled={!customer.email} style={{
                      ...actionBtnStyle,
                      color: sentEmailId === customer.id ? 'var(--teal)' : 'rgba(245,242,236,0.6)',
                      borderColor: sentEmailId === customer.id ? 'var(--teal)' : 'rgba(255,255,255,0.1)',
                      cursor: customer.email ? 'pointer' : 'not-allowed',
                      opacity: customer.email ? 1 : 0.4,
                    }}>{sentEmailId === customer.id ? '✓ Sent' : 'Reset Password'}</button>
                    <button onClick={() => handleDelete(customer)} style={{
                      ...actionBtnStyle, border: '1px solid rgba(228,51,41,0.3)', color: 'var(--red)',
                    }}>Delete</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Edit Points Modal */}
      {editing && (
        <div onClick={() => setEditing(null)} style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100, padding: isMobile ? '1rem' : '2rem',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
            width: '100%', maxWidth: '420px', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: isMobile ? '1.25rem 1.5rem' : '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem', color: 'var(--offwhite)' }}>
                Edit Points
              </h2>
              <button onClick={() => setEditing(null)} style={{
                background: 'transparent', border: 'none', color: 'rgba(245,242,236,0.4)', fontSize: '1.2rem', cursor: 'pointer',
              }}>✕</button>
            </div>

            <div style={{ padding: isMobile ? '1.5rem' : '2rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.5)' }}>
                {editing.displayName}
              </p>

              <div>
                <label style={labelStyle}>XP</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="number" min={0} value={xpInput} onChange={e => setXpInput(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <button type="button" onClick={() => setXpInput('0')} style={{ ...actionBtnStyle, flexShrink: 0 }}>Reset to 0</button>
                </div>
              </div>

              <div>
                <label style={labelStyle}>OB Coins</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="number" min={0} value={coinsInput} onChange={e => setCoinsInput(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <button type="button" onClick={() => setCoinsInput('0')} style={{ ...actionBtnStyle, flexShrink: 0 }}>Reset to 0</button>
                </div>
              </div>

              {error && <p style={{ color: 'var(--red)', fontSize: '0.78rem', fontFamily: 'var(--font-inter)' }}>{error}</p>}

              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setEditing(null)} style={{
                  flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(245,242,236,0.5)', padding: '0.8rem', borderRadius: '2px', fontSize: '0.75rem',
                  cursor: 'pointer', fontFamily: 'var(--font-inter)',
                }}>Cancel</button>
                <button type="button" onClick={handleSavePoints} disabled={saving} style={{
                  flex: 1, backgroundColor: 'var(--purple)', border: 'none', color: '#fff', padding: '0.8rem',
                  borderRadius: '2px', fontSize: '0.75rem', cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1, fontFamily: 'var(--font-inter)',
                }}>{saving ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
