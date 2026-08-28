'use client'

import { useEffect, useMemo, useState } from 'react'
import { fetchCustomerDirectory, type DirectoryUser } from '../../lib/friends'

const inputStyle = {
  width: '100%',
  backgroundColor: '#1a1a1a',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#F5F2EC',
  padding: '0.8rem 1rem',
  borderRadius: '4px',
  fontSize: '0.85rem',
  outline: 'none',
  fontFamily: 'var(--font-inter)',
}

// Shared by the D&D Session and Event Attendance submission panels — search
// the customer directory (role: "customer", same data source the customer
// "Split with Friends" search reads from in app/lib/friends.ts) and build a
// list of attendees as removable chips.
export default function AttendeeSearch({
  selected, onAdd, onRemove, currentUid, isMobile,
}: {
  selected: DirectoryUser[]
  onAdd: (user: DirectoryUser) => void
  onRemove: (uid: string) => void
  currentUid: string
  isMobile: boolean
}) {
  const [directory, setDirectory] = useState<DirectoryUser[] | null>(null)
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')

  useEffect(() => {
    fetchCustomerDirectory(currentUid).then(list => {
      setDirectory(list)
      setLoading(false)
    })
  }, [currentUid])

  const results = useMemo(() => {
    if (!directory || !search.trim()) return []
    const q = search.trim().toLowerCase()
    const selectedIds = new Set(selected.map(u => u.uid))
    return directory
      .filter(u => !selectedIds.has(u.uid))
      .filter(u => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 8)
  }, [directory, search, selected])

  return (
    <div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.8rem' }}>
          {selected.map(u => (
            <div key={u.uid} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: 'rgba(106,106,183,0.12)',
              border: '1px solid rgba(106,106,183,0.25)',
              borderRadius: '20px',
              padding: '0.3rem 0.5rem 0.3rem 0.3rem',
            }}>
              <span style={{
                width: '22px', height: '22px', borderRadius: '50%', overflow: 'hidden',
                backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {u.avatarUrl ? (
                  <img src={u.avatarUrl} alt={u.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: '0.6rem', color: 'rgba(245,242,236,0.5)', fontFamily: 'var(--font-cinzel)' }}>
                    {u.displayName.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'var(--offwhite)' }}>{u.displayName}</span>
              <button type="button" onClick={() => onRemove(u.uid)} style={{
                background: 'transparent', border: 'none', color: 'rgba(228,51,41,0.7)',
                cursor: 'pointer', fontSize: '0.85rem', padding: '0 0.2rem', lineHeight: 1,
              }}>✕</button>
            </div>
          ))}
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search attendees by name or email…"
        style={inputStyle}
      />
      {loading && (
        <p style={{ fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)', fontFamily: 'var(--font-inter)', marginTop: '0.4rem' }}>
          Loading members…
        </p>
      )}
      {search.trim() && !loading && (
        results.length === 0 ? (
          <p style={{ fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', marginTop: '0.6rem' }}>
            No matching members found.
          </p>
        ) : (
          <div style={{
            marginTop: '0.5rem',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '4px',
            backgroundColor: '#111',
            maxHeight: isMobile ? '240px' : '280px',
            overflowY: 'auto',
          }}>
            {results.map(u => (
              <button
                key={u.uid}
                type="button"
                onClick={() => { onAdd(u); setSearch('') }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.7rem',
                  width: '100%',
                  padding: '0.7rem 1rem',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{
                  width: '28px', height: '28px', borderRadius: '50%', overflow: 'hidden',
                  backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {u.avatarUrl ? (
                    <img src={u.avatarUrl} alt={u.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: '0.7rem', color: 'rgba(245,242,236,0.5)', fontFamily: 'var(--font-cinzel)' }}>
                      {u.displayName.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                <span style={{ minWidth: 0 }}>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--offwhite)' }}>{u.displayName}</p>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)' }}>{u.email}</p>
                </span>
              </button>
            ))}
          </div>
        )
      )}
    </div>
  )
}
