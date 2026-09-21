'use client'

import React, { useState } from 'react'
import { ROLE_LABELS } from '@big-cms/shared/adminAuth'
import type { AttendanceEntry, StaffUser } from '@big-cms/shared/endOfDay'

// ─── Staff search combobox ───────────────────────────────────────────────────

export function StaffSearchCombobox({
  staffList, staffListErr, attendance, onSelect, inp,
}: {
  staffList:    StaffUser[]
  staffListErr: boolean
  attendance:   AttendanceEntry[]
  onSelect:     (name: string) => void
  inp:          React.CSSProperties
}) {
  const [searchText, setSearchText] = useState('')
  const [freeText,   setFreeText]   = useState('')

  const alreadyAdded = new Set(attendance.map(a => a.name))

  const matches = searchText.trim().length >= 1
    ? staffList.filter(s =>
        s.email.toLowerCase().includes(searchText.toLowerCase()) &&
        !alreadyAdded.has(s.email)
      ).slice(0, 8)
    : []

  const showResults = searchText.trim().length >= 1

  function addFreeText() {
    const name = freeText.trim()
    if (!name || alreadyAdded.has(name)) return
    onSelect(name)
    setFreeText('')
  }

  const hintText = staffListErr
    ? 'Could not load staff accounts'
    : staffList.length === 0
      ? 'Loading staff accounts…'
      : `${staffList.length} staff account${staffList.length !== 1 ? 's' : ''} · type to search`

  const hintColor = staffListErr ? 'var(--red)' : 'rgba(var(--offwhite-rgb),0.25)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>

      {/* Account search */}
      <div>
        <input
          type="text"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Search by email…"
          autoComplete="off"
          style={inp}
        />
        {/* Hint / count */}
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: hintColor, marginTop: '0.3rem' }}>
          {hintText}
        </p>

        {/* Results list — inline (no absolute positioning) */}
        {showResults && (
          <div style={{
            marginTop: '0.4rem',
            backgroundColor: '#1a1a1a',
            border: '1px solid rgba(var(--overlay-rgb),0.12)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            {matches.length === 0 ? (
              <p style={{ padding: '0.65rem 1rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.3)' }}>
                No matching accounts found
              </p>
            ) : matches.map(s => (
              <button
                key={s.uid}
                type="button"
                onClick={() => { onSelect(s.email); setSearchText('') }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '0.7rem 1rem', textAlign: 'left',
                  background: 'none', border: 'none', borderBottom: '1px solid rgba(var(--overlay-rgb),0.05)',
                  cursor: 'pointer', gap: '0.75rem',
                }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(var(--overlay-rgb),0.07)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)' }}>
                  {s.email}
                </span>
                <span style={{
                  fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.08em',
                  color: 'rgba(var(--offwhite-rgb),0.35)', textTransform: 'uppercase', flexShrink: 0,
                }}>
                  {s.role ? (ROLE_LABELS as Record<string, string>)[s.role] ?? s.role : ''}
                  {s.branchIds.length > 0 ? ` · ${s.branchIds.join(', ')}` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Free-form fallback for staff without accounts */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Or type a name (no account yet)…"
          value={freeText}
          onChange={e => setFreeText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFreeText() } }}
          style={{ ...inp, fontSize: '0.82rem' }}
        />
        <button
          type="button" onClick={addFreeText}
          style={{
            backgroundColor: 'rgba(var(--overlay-rgb),0.06)',
            border: '1px solid rgba(var(--overlay-rgb),0.1)',
            color: 'rgba(var(--offwhite-rgb),0.5)',
            padding: '0.6rem 0.9rem',
            borderRadius: '2px', fontSize: '0.75rem',
            cursor: 'pointer', fontFamily: 'var(--font-inter)',
            whiteSpace: 'nowrap',
          }}
        >+ Add</button>
      </div>
    </div>
  )
}
