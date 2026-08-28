'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useCustomerUser } from '../../lib/customerAuth'
import { useIsMobile } from '../../lib/useIsMobile'
import { useFriends, fetchCustomerDirectory, type DirectoryUser } from '../../lib/friends'
import { createEventReservationRequest } from '../../lib/eventReservations'

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

export default function EventReservationModal({ event, onClose }: {
  event: {
    id: string; title: string; date: string; timeStart: string; timeEnd: string
    branch: string; minPlayers: number; maxPlayers: number
  }
  onClose: () => void
}) {
  const isMobile = useIsMobile()
  const { user, loading: userLoading } = useCustomerUser()
  const friends = useFriends(user?.uid ?? null)

  const [participants, setParticipants] = useState<{ uid: string; name: string }[]>([])
  const [participantPhones, setParticipantPhones] = useState<string[]>([])
  const [phoneInput, setPhoneInput] = useState('')
  const [directory, setDirectory] = useState<DirectoryUser[] | null>(null)
  const [search, setSearch] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState(false)

  const partySize = 1 + participants.length + participantPhones.length

  const searchResults = useMemo(() => {
    if (!directory || !search.trim()) return []
    const q = search.trim().toLowerCase()
    const addedUids = new Set(participants.map(p => p.uid))
    return directory
      .filter(u => !addedUids.has(u.uid))
      .filter(u => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 8)
  }, [directory, search, participants])

  async function loadDirectory() {
    if (!user || directory !== null) return
    setDirectory(await fetchCustomerDirectory(user.uid))
  }

  function addParticipant(p: { uid: string; name: string }) {
    if (participants.some(x => x.uid === p.uid)) return
    setParticipants(prev => [...prev, p])
    setSearch('')
  }

  function removeParticipant(uid: string) {
    setParticipants(prev => prev.filter(p => p.uid !== uid))
  }

  function addPhone() {
    const trimmed = phoneInput.trim()
    if (!trimmed || participantPhones.includes(trimmed)) return
    setParticipantPhones(prev => [...prev, trimmed])
    setPhoneInput('')
  }

  function removePhone(phone: string) {
    setParticipantPhones(prev => prev.filter(p => p !== phone))
  }

  async function handleConfirm() {
    if (!user) return
    setError('')
    if (partySize < event.minPlayers || partySize > event.maxPlayers) {
      setError(`This event needs between ${event.minPlayers} and ${event.maxPlayers} players per team — you currently have ${partySize}.`)
      return
    }
    setSubmitting(true)
    try {
      await createEventReservationRequest({
        userId: user.uid,
        userName: user.displayName || user.email || 'Customer',
        eventId: event.id,
        eventTitle: event.title,
        eventDate: event.date,
        eventTimeStart: event.timeStart,
        eventTimeEnd: event.timeEnd,
        branch: event.branch,
        minPlayers: event.minPlayers,
        maxPlayers: event.maxPlayers,
        participants,
        participantPhones,
      })
      setSuccess(true)
    } catch (err) {
      if (err instanceof Error && err.message === 'party-size-out-of-range') {
        setError(`This event needs between ${event.minPlayers} and ${event.maxPlayers} players per team — you currently have ${partySize}.`)
      } else {
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
          maxWidth: '520px',
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
              Reserve a Spot
            </h2>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--purple)', marginTop: '0.3rem' }}>
              {event.title} · 📍 {event.branch}
            </p>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.76rem', color: 'rgba(245,242,236,0.4)', marginTop: '0.2rem' }}>
              {event.date} · {event.timeStart}–{event.timeEnd}
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
                Your spot is requested — a manager will confirm it shortly. You can check the status anytime from your profile.
              </p>
              <button onClick={onClose} style={{
                backgroundColor: 'var(--purple)', color: '#fff', border: 'none',
                padding: '0.8rem 2rem', borderRadius: '2px', fontSize: '0.78rem',
                letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'var(--font-inter)',
              }}>Done</button>
            </div>
          ) : userLoading ? null : !user ? (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.55)', marginBottom: '1.25rem' }}>
                Sign in to reserve a spot for this event.
              </p>
              <Link href="/customer/login" style={{
                display: 'inline-block', backgroundColor: 'var(--teal)', color: '#fff',
                padding: '0.8rem 2rem', borderRadius: '2px', fontSize: '0.78rem',
                letterSpacing: '0.08em', textTransform: 'uppercase', textDecoration: 'none', fontFamily: 'var(--font-inter)',
              }}>Sign In</Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.4)' }}>
                This event needs {event.minPlayers === event.maxPlayers ? `exactly ${event.minPlayers}` : `${event.minPlayers}–${event.maxPlayers}`} players per team.
              </p>

              <div>
                <label style={{ ...labelStyle, marginBottom: '0.4rem' }}>Who's Coming? ({partySize})</label>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.35)', marginBottom: '0.8rem' }}>
                  Friends or members you add will get an invite to accept on their profile — phone numbers don't need one.
                </p>

                {(participants.length > 0 || participantPhones.length > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.8rem' }}>
                    {participants.map(p => (
                      <span key={p.uid} style={{
                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                        backgroundColor: 'rgba(106,106,183,0.12)', border: '1px solid rgba(106,106,183,0.25)',
                        borderRadius: '20px', padding: '0.3rem 0.4rem 0.3rem 0.8rem', fontSize: '0.78rem',
                        color: 'var(--offwhite)', fontFamily: 'var(--font-inter)',
                      }}>
                        {p.name}
                        <button type="button" onClick={() => removeParticipant(p.uid)} style={{
                          background: 'transparent', border: 'none', color: 'rgba(228,51,41,0.7)',
                          cursor: 'pointer', fontSize: '0.85rem', padding: '0 0.3rem', lineHeight: 1,
                        }}>✕</button>
                      </span>
                    ))}
                    {participantPhones.map(phone => (
                      <span key={phone} style={{
                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                        backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '20px', padding: '0.3rem 0.4rem 0.3rem 0.8rem', fontSize: '0.78rem',
                        color: 'var(--offwhite)', fontFamily: 'var(--font-inter)',
                      }}>
                        📞 {phone}
                        <button type="button" onClick={() => removePhone(phone)} style={{
                          background: 'transparent', border: 'none', color: 'rgba(228,51,41,0.7)',
                          cursor: 'pointer', fontSize: '0.85rem', padding: '0 0.3rem', lineHeight: 1,
                        }}>✕</button>
                      </span>
                    ))}
                  </div>
                )}

                {friends.length > 0 && (
                  <div style={{ marginBottom: '0.8rem' }}>
                    <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.4)', marginBottom: '0.5rem' }}>
                      Quick add a friend
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {friends.filter(f => !participants.some(p => p.uid === f.uid)).map(f => (
                        <button key={f.uid} type="button"
                          onClick={() => addParticipant({ uid: f.uid, name: f.displayName })}
                          style={{
                            backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '20px', padding: '0.3rem 0.8rem', fontSize: '0.78rem',
                            color: 'var(--offwhite)', cursor: 'pointer', fontFamily: 'var(--font-inter)',
                          }}>+ {f.displayName}</button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ position: 'relative', marginBottom: '0.8rem' }}>
                  <input
                    type="text"
                    placeholder="Search registered members…"
                    value={search}
                    onFocus={loadDirectory}
                    onChange={e => setSearch(e.target.value)}
                    style={inputStyle}
                  />
                  {search.trim() && searchResults.length > 0 && (
                    <div style={{
                      marginTop: '0.5rem', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px',
                      backgroundColor: '#0d0d0d', maxHeight: '160px', overflowY: 'auto',
                    }}>
                      {searchResults.map(u => (
                        <button key={u.uid} type="button"
                          onClick={() => addParticipant({ uid: u.uid, name: u.displayName })}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 1rem',
                            background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)',
                            cursor: 'pointer', fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--offwhite)',
                          }}>{u.displayName}</button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="tel"
                    placeholder="Phone number"
                    value={phoneInput}
                    onChange={e => setPhoneInput(e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button type="button" onClick={addPhone} style={{
                    backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                    color: 'rgba(245,242,236,0.7)', padding: '0 1rem', borderRadius: '4px',
                    fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'var(--font-inter)',
                  }}>Add</button>
                </div>
              </div>

              {error && (
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'var(--red)' }}>{error}</p>
              )}

              <button type="button" onClick={handleConfirm} disabled={submitting} style={{
                backgroundColor: 'var(--purple)', color: '#fff', border: 'none',
                padding: '0.9rem', borderRadius: '4px', fontSize: '0.8rem',
                letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1,
              }}>{submitting ? 'Submitting…' : 'Confirm Reservation'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
