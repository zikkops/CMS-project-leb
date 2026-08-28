'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import {
  usePendingEventReservations, approveEventReservation, rejectEventReservation, type EventReservation,
} from '../../../lib/eventReservations'
import { resolveUserProfiles, type ResolvedProfile } from '../../../lib/loyalty'
import { resolveBranchName, BRANCHES } from '../../../lib/branches'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCalendarDay, faInbox } from '@fortawesome/free-solid-svg-icons'

// Events can be set to the literal branch "All Branches" in Manage Events —
// that's not one of the real branches managers are assigned to, so it has
// to be added explicitly to any branch filter, or those events would never
// show up for a branch-scoped manager.
const ALL_BRANCHES_LABEL = 'All Branches'

function formatDate(ts: EventReservation['createdAt']): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

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

export default function EventReservationsPage() {
  const { checking, role, branchIds, user } = useRequireRole(SECTION_ACCESS.events)
  const isMobile = useIsMobile()

  const [adminBranchFilter, setAdminBranchFilter]     = useState<string | 'all'>('all')
  const [managerBranchFilter, setManagerBranchFilter] = useState<string | 'all'>('all')

  // Memoized — usePendingEventReservations re-subscribes whenever this
  // array's reference changes, so it must stay stable across renders where
  // the underlying filter hasn't actually changed.
  const effectiveFilter = useMemo(() => {
    if (checking) return null
    if (role === 'admin' || role === 'social') {
      return adminBranchFilter === 'all' ? 'all' : [adminBranchFilter, ALL_BRANCHES_LABEL]
    }
    if (managerBranchFilter === 'all') return [...branchIds, ALL_BRANCHES_LABEL]
    return [managerBranchFilter, ALL_BRANCHES_LABEL]
  }, [checking, role, adminBranchFilter, managerBranchFilter, branchIds])

  const { reservations, loading } = usePendingEventReservations(effectiveFilter)
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set())

  const [profiles, setProfiles]       = useState<Map<string, ResolvedProfile>>(new Map())
  const [busyId, setBusyId]           = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    const uids = new Set<string>()
    reservations.forEach(r => uids.add(r.userId))
    if (uids.size > 0) resolveUserProfiles([...uids]).then(setProfiles)
  }, [reservations])

  async function handleApprove(r: EventReservation) {
    if (!user) return
    setBusyId(r.id)
    try {
      await approveEventReservation(r, user.uid)
      setProcessedIds(prev => new Set(prev).add(r.id))
    } finally {
      setBusyId(null)
    }
  }

  async function handleConfirmReject(r: EventReservation) {
    if (!user) return
    setBusyId(r.id)
    try {
      await rejectEventReservation(r, user.uid, rejectReason.trim())
      setProcessedIds(prev => new Set(prev).add(r.id))
      setRejectingId(null)
      setRejectReason('')
    } finally {
      setBusyId(null)
    }
  }

  if (checking) return null

  const visible = reservations.filter(r => !processedIds.has(r.id))
  const isManagerBranchScoped = role === 'manager'

  const cardStyle = {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '4px',
    padding: isMobile ? '1.1rem' : '1.5rem',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.9rem',
  }

  const fieldRowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '1rem',
    fontFamily: 'var(--font-inter)',
    fontSize: '0.82rem',
  }

  const fieldLabelStyle = { color: 'rgba(245,242,236,0.4)' }
  const fieldValueStyle = { color: 'var(--offwhite)', textAlign: 'right' as const }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'flex-start' : 'center',
          gap: isMobile ? '1.25rem' : '0',
          marginBottom: '2rem',
        }}>
          <div>
            <a href="/admin" style={{
              fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.3)', textDecoration: 'none', fontFamily: 'var(--font-inter)',
              marginBottom: '0.5rem', display: 'block',
            }}>← Back to Dashboard</a>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)' }}>
              Event Reservations
            </h1>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.4rem' }}>
              {!isManagerBranchScoped
                ? (adminBranchFilter === 'all' ? 'All branches' : resolveBranchName(adminBranchFilter))
                : branchIds.length === 0
                  ? 'No branch assigned'
                  : branchIds.length === 1
                    ? resolveBranchName(branchIds[0])
                    : managerBranchFilter === 'all'
                      ? `All my branches (${branchIds.length})`
                      : resolveBranchName(managerBranchFilter)}
              {' · '}{visible.length} pending
            </p>
          </div>

          {!isManagerBranchScoped && (
            <select
              value={adminBranchFilter}
              onChange={e => setAdminBranchFilter(e.target.value)}
              style={{
                backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', color: '#F5F2EC',
                padding: '0.6rem 0.9rem', borderRadius: '2px', fontSize: '0.82rem', outline: 'none', fontFamily: 'var(--font-inter)',
              }}
            >
              <option value="all">All Branches</option>
              {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}

          {isManagerBranchScoped && branchIds.length > 1 && (
            <select
              value={managerBranchFilter}
              onChange={e => setManagerBranchFilter(e.target.value)}
              style={{
                backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', color: '#F5F2EC',
                padding: '0.6rem 0.9rem', borderRadius: '2px', fontSize: '0.82rem', outline: 'none', fontFamily: 'var(--font-inter)',
              }}
            >
              <option value="all">All My Branches</option>
              {branchIds.map(b => <option key={b} value={b}>{resolveBranchName(b)}</option>)}
            </select>
          )}
        </div>

        {isManagerBranchScoped && branchIds.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(228,51,41,0.3)', borderRadius: '4px',
            padding: isMobile ? '2rem 1.25rem' : '3rem', textAlign: 'center',
          }}>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--red)' }}>
              Your account isn&apos;t assigned to a branch yet — ask an admin to set one in Manage Users.
            </p>
          </div>
        ) : loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : visible.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: isMobile ? '3rem 1.5rem' : '4rem', textAlign: 'center',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem',
          }}>
            <FontAwesomeIcon icon={faInbox} style={{ width: '32px', color: 'rgba(245,242,236,0.15)' }} />
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.3)' }}>
              No pending event reservations for your branch
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {visible.map(r => {
              const isBusy = busyId === r.id
              const p = profiles.get(r.userId)

              return (
                <div key={r.id} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase',
                      color: 'var(--purple)', fontFamily: 'var(--font-inter)',
                    }}>
                      <FontAwesomeIcon icon={faCalendarDay} style={{ width: '13px' }} />
                      {r.eventTitle}
                    </span>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.3)', whiteSpace: 'nowrap' }}>
                      Requested {formatDate(r.createdAt)}
                    </span>
                  </div>

                  <div style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>Event Date</span>
                    <span style={fieldValueStyle}>{r.eventDate} · {r.eventTimeStart}–{r.eventTimeEnd}</span>
                  </div>

                  <div style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>Branch</span>
                    <span style={fieldValueStyle}>📍 {r.branch}</span>
                  </div>

                  <div style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>Booked by</span>
                    <span style={{ ...fieldValueStyle, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{
                        width: '20px', height: '20px', borderRadius: '50%', overflow: 'hidden',
                        backgroundColor: '#1a1a1a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {p?.avatarUrl ? (
                          <img src={p.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <span style={{ fontSize: '0.6rem', color: 'rgba(245,242,236,0.5)' }}>{(p?.displayName ?? '?').charAt(0).toUpperCase()}</span>
                        )}
                      </span>
                      {p?.displayName ?? '…'}
                    </span>
                  </div>

                  <div style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>Party size</span>
                    <span style={fieldValueStyle}>{r.partySize} {r.partySize === 1 ? 'person' : 'people'}</span>
                  </div>

                  {(r.participants.length > 0 || r.participantPhones.length > 0) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {r.participants.map(part => (
                        <span key={part.uid} style={{
                          fontSize: '0.72rem', padding: '0.25rem 0.7rem', borderRadius: '2px',
                          backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--offwhite)', fontFamily: 'var(--font-inter)',
                        }}>{part.name}</span>
                      ))}
                      {r.participantPhones.map(phone => (
                        <span key={phone} style={{
                          fontSize: '0.72rem', padding: '0.25rem 0.7rem', borderRadius: '2px',
                          backgroundColor: 'rgba(255,255,255,0.05)', color: 'rgba(245,242,236,0.6)', fontFamily: 'var(--font-inter)',
                        }}>📞 {phone}</span>
                      ))}
                    </div>
                  )}

                  {rejectingId === r.id && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Reason for rejection (optional)…"
                        autoFocus
                        style={{
                          width: '100%', backgroundColor: '#1a1a1a', border: '1px solid rgba(228,51,41,0.3)',
                          color: '#F5F2EC', padding: '0.7rem 0.9rem', borderRadius: '2px', fontSize: '0.82rem',
                          outline: 'none', fontFamily: 'var(--font-inter)',
                        }}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleConfirmReject(r)}
                          disabled={isBusy}
                          style={{
                            flex: 1, backgroundColor: 'var(--red)', color: '#fff', border: 'none',
                            padding: '0.7rem', borderRadius: '2px', fontSize: '0.72rem', letterSpacing: '0.06em',
                            textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                            cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.6 : 1,
                          }}
                        >Confirm Rejection</button>
                        <button
                          onClick={() => { setRejectingId(null); setRejectReason('') }}
                          style={{
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(245,242,236,0.5)',
                            padding: '0.7rem 1.2rem', borderRadius: '2px', fontSize: '0.72rem', letterSpacing: '0.06em',
                            textTransform: 'uppercase', fontFamily: 'var(--font-inter)', cursor: 'pointer',
                          }}
                        >Cancel</button>
                      </div>
                    </div>
                  )}

                  {rejectingId !== r.id && (
                    <div style={{ display: 'flex', gap: '0.6rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <button
                        onClick={() => handleApprove(r)}
                        disabled={isBusy}
                        style={{
                          flex: isMobile ? 1 : 'initial', backgroundColor: 'var(--teal)', color: '#fff', border: 'none',
                          padding: '0.8rem 1.5rem', borderRadius: '2px', fontSize: '0.75rem', letterSpacing: '0.08em',
                          textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                          cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.6 : 1,
                        }}
                      >{isBusy ? 'Working…' : 'Approve'}</button>
                      <button
                        onClick={() => { setRejectingId(r.id); setRejectReason('') }}
                        disabled={isBusy}
                        style={{
                          flex: isMobile ? 1 : 'initial', background: 'transparent', border: '1px solid rgba(228,51,41,0.3)',
                          color: 'var(--red)', padding: '0.8rem 1.5rem', borderRadius: '2px', fontSize: '0.75rem',
                          letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                          cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.6 : 1,
                        }}
                      >Reject</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
