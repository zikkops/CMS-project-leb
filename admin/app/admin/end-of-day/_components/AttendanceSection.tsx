'use client'

import React from 'react'
import { SHIFT_LABELS, type AttendanceEntry, type StaffUser } from '@big-cms/shared/endOfDay'
import { SectionTitle } from './parts'
import { StaffSearchCombobox } from './StaffSearchCombobox'
import { inp } from './styles'

export function AttendanceSection({
  attendance, setAttendance, staffList, staffListErr,
}: {
  attendance:    AttendanceEntry[]
  setAttendance: React.Dispatch<React.SetStateAction<AttendanceEntry[]>>
  staffList:     StaffUser[]
  staffListErr:  boolean
}) {
  // ── attendance helpers ───────────────────────────────────────────────────
  function setShift(idx: number, shift: AttendanceEntry['shift']) {
    setAttendance(prev => prev.map((a, i) => i === idx ? { ...a, shift } : a))
  }
  function removeAttendee(idx: number) {
    setAttendance(prev => prev.filter((_, i) => i !== idx))
  }

  return (
    <div style={{ marginBottom: '2.5rem' }}>
      <SectionTitle label="ATTENDANCE" color="rgba(var(--offwhite-rgb),0.6)" />

      {attendance.length === 0 && (
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.25)', marginBottom: '1rem' }}>
          No staff roster set.{' '}
          <a href="/admin/end-of-day/staff" style={{ color: 'var(--teal)', textDecoration: 'none' }}>Set up the roster →</a>
        </p>
      )}

      {attendance.length > 0 && (
        <div style={{ background: 'rgba(var(--overlay-rgb),0.02)', border: '1px solid rgba(var(--overlay-rgb),0.06)', borderRadius: '4px', overflow: 'hidden', marginBottom: '1rem' }}>
          {attendance.map((entry, idx) => {
            const present = entry.shift !== 'none'
            return (
              <div key={`${entry.name}-${idx}`} style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderTop: idx > 0 ? '1px solid rgba(var(--overlay-rgb),0.04)' : 'none',
              }}>
                {/* Present checkbox */}
                <button
                  type="button"
                  onClick={() => setShift(idx, present ? 'none' : 'pm')}
                  title={present ? 'Mark absent' : 'Mark present'}
                  style={{
                    width: 22, height: 22, flexShrink: 0,
                    borderRadius: '3px',
                    border: `2px solid ${present ? 'var(--teal)' : 'rgba(var(--overlay-rgb),0.2)'}`,
                    backgroundColor: present ? 'var(--teal)' : 'transparent',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {present && <span style={{ color: '#fff', fontSize: '0.7rem', lineHeight: 1, fontWeight: 700 }}>✓</span>}
                </button>

                {/* Name */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    fontFamily: 'var(--font-inter)', fontSize: '0.88rem',
                    color: present ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.35)',
                    transition: 'color 0.15s',
                  }}>
                    {entry.name}
                  </span>
                  {entry.isGuest && (
                    <span style={{
                      fontSize: '0.6rem', letterSpacing: '0.08em',
                      background: 'rgba(var(--brand-secondary-rgb),0.15)', color: 'var(--brand-secondary)',
                      border: '1px solid rgba(var(--brand-secondary-rgb),0.3)',
                      borderRadius: '3px', padding: '0.15rem 0.4rem',
                      fontFamily: 'var(--font-inter)', textTransform: 'uppercase',
                    }}>Guest</span>
                  )}
                </div>

                {/* Shift selector — only visible when present */}
                <div style={{ display: 'flex', gap: '0.35rem', opacity: present ? 1 : 0.25, pointerEvents: present ? 'auto' : 'none' }}>
                  {(['am', 'pm', 'double'] as const).map(s => (
                    <button
                      key={s} type="button"
                      onClick={() => setShift(idx, s)}
                      style={{
                        padding: '0.3rem 0.65rem',
                        borderRadius: '2px', border: 'none', cursor: 'pointer',
                        fontSize: '0.72rem', fontFamily: 'var(--font-inter)', fontWeight: 600,
                        backgroundColor: entry.shift === s ? 'var(--teal)' : 'rgba(var(--overlay-rgb),0.06)',
                        color: entry.shift === s ? '#fff' : 'rgba(var(--offwhite-rgb),0.4)',
                      }}
                    >
                      {SHIFT_LABELS[s]}
                    </button>
                  ))}
                </div>

                {/* Remove guest */}
                {entry.isGuest ? (
                  <button
                    type="button"
                    onClick={() => removeAttendee(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(var(--offwhite-rgb),0.25)', fontSize: '1rem', padding: '0.2rem 0.4rem', flexShrink: 0 }}
                  >×</button>
                ) : <span style={{ width: 24, flexShrink: 0 }} />}
              </div>
            )
          })}
        </div>
      )}

      {/* Add guest — search existing accounts or type a name */}
      <div>
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.3)', marginBottom: '0.5rem' }}>
          Add guest / cross-branch staff
        </p>
        <StaffSearchCombobox
          staffList={staffList}
          staffListErr={staffListErr}
          attendance={attendance}
          onSelect={name => {
            setAttendance(prev => [...prev, { name, shift: 'none', isGuest: true }])
          }}
          inp={inp}
        />
      </div>
    </div>
  )
}
