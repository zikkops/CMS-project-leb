'use client'

import { useEffect, useState } from 'react'
import { useRequireRole, ROLE_LABELS, type Role } from '../../../lib/adminAuth'
import { BRANCHES } from '../../../lib/branches'
import { getBranchStaff, saveBranchStaff, listAllStaff, type StaffUser } from '../../../lib/endOfDay'

const inp: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#F5F2EC',
  padding: '0.6rem 0.8rem',
  borderRadius: '2px',
  fontSize: '0.88rem',
  outline: 'none',
  fontFamily: 'var(--font-inter)',
  width: '100%',
}

const selStyle: React.CSSProperties = { ...inp, backgroundColor: '#1a1a1a', cursor: 'pointer' }

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)',
  marginBottom: '0.4rem', fontFamily: 'var(--font-inter)',
}

export default function EndOfDayStaffPage() {
  const { checking, role, branchIds, user } = useRequireRole(['admin'] as Role[])

  const branchOptions = role === 'admin' ? [...BRANCHES] : branchIds

  const [branch,  setBranch]  = useState('')
  const [staff,   setStaff]   = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [search,  setSearch]  = useState('')
  const [staffList,    setStaffList]    = useState<StaffUser[]>([])
  const [staffListErr, setStaffListErr] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [err,     setErr]     = useState('')

  // Load all staff accounts for the search
  useEffect(() => {
    listAllStaff()
      .then(list => setStaffList(list))
      .catch(() => setStaffListErr(true))
  }, [])

  useEffect(() => {
    if (checking) return
    if (role !== 'admin' && branchIds.length === 1) setBranch(branchIds[0])
  }, [checking, role, branchIds])

  useEffect(() => {
    if (!branch) return
    setLoading(true)
    getBranchStaff(branch).then(doc => {
      setStaff(doc?.staff ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [branch])

  function addName() {
    const name = newName.trim()
    if (!name) return
    if (staff.some(s => s.toLowerCase() === name.toLowerCase())) return
    setStaff(prev => [...prev, name])
    setNewName('')
    setSearch('')
    setSaved(false)
  }

  function removeName(idx: number) {
    setStaff(prev => prev.filter((_, i) => i !== idx))
    setSaved(false)
  }

  function moveName(idx: number, dir: -1 | 1) {
    setStaff(prev => {
      const next = [...prev]
      const target = idx + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
    setSaved(false)
  }

  async function handleSave() {
    if (!branch || !user) return
    setSaving(true); setErr(''); setSaved(false)
    try {
      await saveBranchStaff(branch, staff, user.uid)
      setSaved(true)
    } catch {
      setErr('Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (checking) return null

  // Search results — exclude anyone already on the roster
  const searchMatches = search.trim().length >= 1
    ? staffList.filter(s =>
        s.email.toLowerCase().includes(search.toLowerCase()) &&
        !staff.some(r => r.toLowerCase() === s.email.toLowerCase())
      ).slice(0, 6)
    : []

  const accountHint = staffListErr
    ? 'Could not load staff accounts'
    : staffList.length === 0
      ? 'Loading staff accounts…'
      : `${staffList.length} account${staffList.length !== 1 ? 's' : ''} available`

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: '2rem 1.5rem 4rem' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin/end-of-day" style={{
            fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
            display: 'block', marginBottom: '0.5rem', fontFamily: 'var(--font-inter)',
          }}>← End of Day</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
            Staff Roster
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)' }}>
            Configure the default staff list per branch for EOD attendance
          </p>
        </div>

        {/* Branch selector */}
        <div style={{ marginBottom: '2rem' }}>
          <label style={labelStyle}>Branch</label>
          {branchOptions.length === 1 ? (
            <div style={{ ...inp, display: 'inline-block', width: 'auto' }}>{branch}</div>
          ) : (
            <select value={branch} onChange={e => setBranch(e.target.value)} style={selStyle}>
              <option value="">— Select Branch —</option>
              {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
        </div>

        {loading && (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        )}

        {!loading && branch && (<>

          {/* Current roster */}
          {staff.length > 0 && (
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '4px', overflow: 'hidden',
              marginBottom: '1.5rem',
            }}>
              {staff.map((name, idx) => (
                <div key={`${name}-${idx}`} style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  borderTop: idx > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.9rem', color: 'var(--offwhite)', flex: 1 }}>
                    {name}
                  </span>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button type="button" onClick={() => moveName(idx, -1)} disabled={idx === 0} style={{
                      background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer',
                      color: idx === 0 ? 'rgba(245,242,236,0.1)' : 'rgba(245,242,236,0.35)',
                      fontSize: '0.85rem', padding: '0.15rem 0.4rem',
                    }}>↑</button>
                    <button type="button" onClick={() => moveName(idx, 1)} disabled={idx === staff.length - 1} style={{
                      background: 'none', border: 'none', cursor: idx === staff.length - 1 ? 'default' : 'pointer',
                      color: idx === staff.length - 1 ? 'rgba(245,242,236,0.1)' : 'rgba(245,242,236,0.35)',
                      fontSize: '0.85rem', padding: '0.15rem 0.4rem',
                    }}>↓</button>
                    <button type="button" onClick={() => removeName(idx)} style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'rgba(245,242,236,0.25)', fontSize: '1rem', padding: '0.15rem 0.4rem',
                    }}>×</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {staff.length === 0 && (
            <div style={{
              border: '1px dashed rgba(255,255,255,0.07)', borderRadius: '4px',
              padding: '2rem', textAlign: 'center',
              color: 'rgba(245,242,236,0.2)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
              marginBottom: '1.5rem',
            }}>
              No staff added yet.
            </div>
          )}

          {/* ── Add staff ── */}
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px', padding: '1.25rem',
            marginBottom: '1.5rem',
          }}>
            <p style={{ ...labelStyle, marginBottom: '1rem' }}>Add staff member</p>

            {/* Step 1: search accounts */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Search by account email</label>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Type to search staff accounts…"
                autoComplete="off"
                style={inp}
              />
              <p style={{
                fontFamily: 'var(--font-inter)', fontSize: '0.68rem', marginTop: '0.3rem',
                color: staffListErr ? 'var(--red)' : 'rgba(245,242,236,0.25)',
              }}>{accountHint}</p>

              {/* Search results */}
              {search.trim().length >= 1 && (
                <div style={{
                  marginTop: '0.4rem',
                  backgroundColor: '#1a1a1a',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '4px', overflow: 'hidden',
                }}>
                  {searchMatches.length === 0 ? (
                    <p style={{ padding: '0.65rem 1rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.3)' }}>
                      No matching accounts
                    </p>
                  ) : searchMatches.map(s => (
                    <button
                      key={s.uid}
                      type="button"
                      onClick={() => {
                        // Pre-fill the name field with the email prefix so the admin can
                        // shorten it (e.g. "mark" from "mark@example.com") before adding
                        const prefix = s.email.split('@')[0]
                        setNewName(prefix)
                        setSearch('')
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', padding: '0.7rem 1rem', textAlign: 'left',
                        background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)',
                        cursor: 'pointer', gap: '0.75rem',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <div style={{ textAlign: 'left' }}>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: '#F5F2EC', marginBottom: '0.1rem' }}>
                          {s.email}
                        </p>
                        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.35)' }}>
                          {s.role ? (ROLE_LABELS as Record<string, string>)[s.role] ?? s.role : ''}
                          {s.branchIds.length > 0 ? ` · ${s.branchIds.join(', ')}` : ''}
                        </p>
                      </div>
                      <span style={{
                        fontSize: '0.68rem', color: 'rgba(245,242,236,0.35)',
                        fontFamily: 'var(--font-inter)', flexShrink: 0,
                      }}>select →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Step 2: confirm / edit name */}
            <div>
              <label style={labelStyle}>Name on roster</label>
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <input
                  type="text"
                  placeholder="Name as it appears on the roster…"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addName() } }}
                  style={{ ...inp, flex: 1 }}
                />
                <button
                  type="button" onClick={addName}
                  style={{
                    backgroundColor: newName.trim() ? '#C9962C' : 'rgba(255,255,255,0.06)',
                    border: 'none',
                    color: newName.trim() ? '#000' : 'rgba(245,242,236,0.4)',
                    padding: '0.6rem 1.1rem',
                    borderRadius: '2px', fontSize: '0.78rem', fontWeight: 600,
                    cursor: newName.trim() ? 'pointer' : 'default',
                    fontFamily: 'var(--font-inter)', whiteSpace: 'nowrap',
                    transition: 'background-color 0.15s',
                  }}
                >+ Add to Roster</button>
              </div>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.2)', marginTop: '0.3rem' }}>
                Select an account above to pre-fill, or type any name directly
              </p>
            </div>
          </div>

          {err && (
            <p style={{ color: 'var(--red)', fontSize: '0.82rem', marginBottom: '1rem', fontFamily: 'var(--font-inter)' }}>
              {err}
            </p>
          )}
          {saved && (
            <p style={{ color: 'var(--teal)', fontSize: '0.82rem', marginBottom: '1rem', fontFamily: 'var(--font-inter)' }}>
              ✓ Roster saved.
            </p>
          )}

          <button
            type="button" onClick={handleSave} disabled={saving}
            style={{
              backgroundColor: '#C9962C', color: '#000', border: 'none',
              padding: '0.85rem 2rem', borderRadius: '2px',
              fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-inter)', fontWeight: 600,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save Roster'}
          </button>

        </>)}
      </div>
    </div>
  )
}
