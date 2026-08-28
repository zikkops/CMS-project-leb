'use client'

import { useState } from 'react'
import { signInAnonymously } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { useCustomerUser, PHONE_PATTERN } from '../../lib/customerAuth'
import { useIsMobile } from '../../lib/useIsMobile'
import { useAvailableStartTimes, createTableReservationRequest, branchOpeningHours } from '../../lib/tableReservations'

// Structurally mirrors app/components/dnd/ReservationModal.tsx's date/time
// slot grid, but a table reservation only ever names ONE contact for the
// whole party (a headcount + a name + a phone number) — no per-friend
// invite roster, unlike D&D/event bookings.

const inputStyle = {
  width: '100%',
  backgroundColor: '#1a1a1a',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#F5F2EC',
  padding: '0.75rem 1rem',
  borderRadius: '4px',
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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}
function timeLabel(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function TableReservationModal({ branch, tableIds, tableNumbers, capacityMin, capacityMax, onClose, onBack }: {
  branch: string
  tableIds: string[]
  tableNumbers: number[]
  capacityMin: number
  capacityMax: number
  onClose: () => void
  onBack: () => void
}) {
  const isMobile = useIsMobile()
  const { user, loading: userLoading } = useCustomerUser()

  const [date, setDate] = useState(todayStr())
  const [selectedTime, setSelectedTime] = useState<Date | null>(null)
  const hours = branchOpeningHours(branch)
  const { times, loading: loadingTimes } = useAvailableStartTimes(branch, tableIds, date, hours.start, hours.end)

  const [partySize, setPartySize] = useState(Math.min(2, capacityMax))
  const [contactName, setContactName] = useState(user?.displayName || user?.email || '')
  const [contactPhone, setContactPhone] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  function handleDateChange(value: string) {
    setDate(value)
    setSelectedTime(null)
  }

  const overCapacity = partySize > capacityMax
  const phoneValid = PHONE_PATTERN.test(contactPhone.trim())
  const canSubmit = !!selectedTime && !overCapacity && partySize >= 1 && contactName.trim() !== '' && phoneValid

  async function handleConfirm() {
    if (!selectedTime || !canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      let uid = user?.uid
      let userName = user?.displayName || user?.email || contactName.trim()
      if (!uid) {
        const cred = await signInAnonymously(auth)
        uid = cred.user.uid
        userName = contactName.trim()
      }
      await createTableReservationRequest({
        userId: uid,
        userName,
        branch, tableIds, tableNumbers,
        startAt: selectedTime,
        partySize,
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
      })
      setSuccess(true)
    } catch (err) {
      if (err instanceof Error && err.message === 'slot-taken') {
        setError('That time was just booked by someone else — pick another time below.')
        setSelectedTime(null)
      } else {
        console.error('[TableReservationModal] createTableReservationRequest failed:', err)
        setError('Something went wrong submitting your reservation. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? '1rem' : '2rem',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: '#111',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '480px',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          padding: isMobile ? '1.25rem 1.5rem' : '1.5rem 2rem',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem', color: 'var(--offwhite)' }}>
              Reserve {tableNumbers.length > 1 ? 'Tables' : 'a Table'}
            </h2>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--teal)', marginTop: '0.3rem' }}>
              📍 {branch} · Table{tableNumbers.length > 1 ? 's' : ''} {tableNumbers.join(', ')} · seats {capacityMin === capacityMax ? capacityMax : `${capacityMin}-${capacityMax}`}
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none',
            color: 'rgba(245,242,236,0.4)', fontSize: '1.2rem', cursor: 'pointer',
          }}>✕</button>
        </div>

        <div style={{ padding: isMobile ? '1.5rem' : '2rem' }}>
          {success ? (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem', color: 'var(--offwhite)', marginBottom: '0.8rem' }}>
                Request submitted!
              </p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.55)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
                Your table is held — staff will confirm shortly and reach you on the number you provided.
              </p>
              <button onClick={onClose} style={{
                backgroundColor: 'var(--teal)', color: '#fff', border: 'none',
                padding: '0.8rem 2rem', borderRadius: '2px', fontSize: '0.78rem',
                letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'var(--font-inter)',
              }}>Done</button>
            </div>
          ) : userLoading ? null : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <button type="button" onClick={onBack} style={{
                alignSelf: 'flex-start', background: 'transparent', border: 'none',
                color: 'rgba(245,242,236,0.4)', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'var(--font-inter)', padding: 0,
              }}>← Change tables</button>

              <div>
                <label style={labelStyle}>Date</label>
                <input type="date" value={date} min={todayStr()}
                  onChange={e => handleDateChange(e.target.value)}
                  style={{ ...inputStyle, colorScheme: 'dark' }} />
              </div>

              <div>
                <label style={labelStyle}>Available Times</label>
                {loadingTimes ? (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.3)' }}>Checking availability…</p>
                ) : times.length === 0 ? (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.3)' }}>
                    No times available this day — try another date.
                  </p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(4, 1fr)', gap: '0.5rem' }}>
                    {times.map(t => {
                      const active = selectedTime?.getTime() === t.getTime()
                      return (
                        <button key={t.getTime()} type="button"
                          onClick={() => setSelectedTime(t)}
                          style={{
                            backgroundColor: active ? 'var(--teal)' : 'transparent',
                            border: `1px solid ${active ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`,
                            color: active ? '#fff' : 'rgba(245,242,236,0.6)',
                            padding: '0.6rem 0.4rem',
                            borderRadius: '2px',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            fontFamily: 'var(--font-inter)',
                          }}>{timeLabel(t)}</button>
                      )
                    })}
                  </div>
                )}
              </div>

              {selectedTime && (
                <>
                  <div>
                    <label style={labelStyle}>How Many People?</label>
                    <input
                      type="number"
                      min={1}
                      max={capacityMax}
                      value={partySize}
                      onChange={e => setPartySize(Math.max(1, Number(e.target.value)))}
                      style={inputStyle}
                    />
                    {overCapacity && (
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'var(--red)', marginTop: '0.4rem' }}>
                        These tables only seat {capacityMax} — go back and add another adjacent table for a bigger party.
                      </p>
                    )}
                  </div>

                  <div>
                    <label style={labelStyle}>Name</label>
                    <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} style={inputStyle} />
                  </div>

                  <div>
                    <label style={labelStyle}>Phone Number</label>
                    <input type="tel" placeholder="So we can reach you about this reservation"
                      value={contactPhone} onChange={e => setContactPhone(e.target.value)} style={inputStyle} />
                    {contactPhone.trim() !== '' && !phoneValid && (
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'var(--red)', marginTop: '0.4rem' }}>
                        Enter a valid phone number (digits, spaces, +, -, or parentheses, 7-20 characters).
                      </p>
                    )}
                  </div>

                  {error && (
                    <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'var(--red)' }}>{error}</p>
                  )}

                  <button type="button" onClick={handleConfirm} disabled={submitting || !canSubmit} style={{
                    backgroundColor: 'var(--teal)', color: '#fff', border: 'none',
                    padding: '0.9rem', borderRadius: '4px', fontSize: '0.8rem',
                    letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                    cursor: submitting || !canSubmit ? 'not-allowed' : 'pointer', opacity: submitting || !canSubmit ? 0.6 : 1,
                  }}>{submitting ? 'Submitting…' : 'Confirm Reservation'}</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
