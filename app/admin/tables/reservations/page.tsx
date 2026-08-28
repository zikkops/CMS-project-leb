'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import {
  usePendingTableReservations, useApprovedTableReservations,
  approveTableReservation, rejectTableReservation, type TableReservation,
} from '../../../lib/tableReservations'
import { resolveUserProfiles, awardTableCheckin, type ResolvedProfile } from '../../../lib/loyalty'
import { BRANCHES } from '../../../lib/branches'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChair, faInbox, faCircleCheck } from '@fortawesome/free-solid-svg-icons'

function formatDateTime(ts: TableReservation['startAt']): string {
  return ts.toDate().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
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

export default function TableReservationsPage() {
  const { checking, role, branchIds, user } = useRequireRole(SECTION_ACCESS.tableReservations)
  const isMobile = useIsMobile()

  const [adminBranchFilter, setAdminBranchFilter]     = useState<string | 'all'>('all')
  const [managerBranchFilter, setManagerBranchFilter] = useState<string | 'all'>('all')

  // Memoized — usePendingTableReservations re-subscribes whenever this
  // array's reference changes, so it must stay stable across renders where
  // the underlying filter hasn't actually changed.
  const effectiveFilter = useMemo(() => {
    if (checking) return null
    if (role === 'admin') return adminBranchFilter === 'all' ? 'all' : [adminBranchFilter]
    if (managerBranchFilter === 'all') return branchIds
    return [managerBranchFilter]
  }, [checking, role, adminBranchFilter, managerBranchFilter, branchIds])

  const [tab, setTab] = useState<'pending' | 'approved'>('pending')

  const { reservations: pendingReservations, loading: pendingLoading } = usePendingTableReservations(effectiveFilter)
  const { reservations: approvedReservations, loading: approvedLoading } = useApprovedTableReservations(effectiveFilter)

  const reservations = tab === 'pending' ? pendingReservations : approvedReservations
  const loading = tab === 'pending' ? pendingLoading : approvedLoading
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

  async function handleCheckIn(r: TableReservation) {
    if (!user) return
    setBusyId(r.id)
    try {
      await awardTableCheckin({
        userId: r.userId,
        reservationId: r.id,
        branch: r.branch,
        tableNumbers: r.tableNumbers,
        staffUid: user.uid,
      })
      setProcessedIds(prev => new Set(prev).add(r.id))
    } finally {
      setBusyId(null)
    }
  }

  async function handleApprove(r: TableReservation) {
    if (!user) return
    setBusyId(r.id)
    try {
      await approveTableReservation(r, user.uid)
      setProcessedIds(prev => new Set(prev).add(r.id))
    } finally {
      setBusyId(null)
    }
  }

  async function handleConfirmReject(r: TableReservation) {
    if (!user) return
    setBusyId(r.id)
    try {
      await rejectTableReservation(r, user.uid, rejectReason.trim())
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
              Table Reservations
            </h1>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.4rem' }}>
              {!isManagerBranchScoped
                ? (adminBranchFilter === 'all' ? 'All branches' : adminBranchFilter)
                : branchIds.length === 0
                  ? 'No branch assigned'
                  : branchIds.length === 1
                    ? branchIds[0]
                    : managerBranchFilter === 'all'
                      ? `All my branches (${branchIds.length})`
                      : managerBranchFilter}
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
              {branchIds.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
        </div>

        {/* Pending / Approved tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          {(['pending', 'approved'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setProcessedIds(new Set()) }} style={{
              background: tab === t ? 'var(--teal)' : 'transparent',
              border: `1px solid ${tab === t ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`,
              color: tab === t ? '#fff' : 'rgba(245,242,236,0.5)',
              padding: '0.55rem 1.2rem',
              borderRadius: '2px',
              fontSize: '0.75rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
            }}>
              {t === 'pending' ? `Pending (${pendingReservations.length})` : `Approved (${approvedReservations.length})`}
            </button>
          ))}
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
              No pending table reservations
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
                      color: 'var(--teal)', fontFamily: 'var(--font-inter)',
                    }}>
                      <FontAwesomeIcon icon={faChair} style={{ width: '13px' }} />
                      Table{r.tableNumbers.length > 1 ? 's' : ''} {r.tableNumbers.join(', ')}
                    </span>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.3)', whiteSpace: 'nowrap' }}>
                      {formatDateTime(r.startAt)}
                    </span>
                  </div>

                  <div style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>Branch</span>
                    <span style={fieldValueStyle}>📍 {r.branch}</span>
                  </div>

                  <div style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>Booked by</span>
                    <span style={{ ...fieldValueStyle, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {p ? (
                        <>
                          <span style={{
                            width: '20px', height: '20px', borderRadius: '50%', overflow: 'hidden',
                            backgroundColor: '#1a1a1a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>
                            {p.avatarUrl ? (
                              <img src={p.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <span style={{ fontSize: '0.6rem', color: 'rgba(245,242,236,0.5)' }}>{p.displayName.charAt(0).toUpperCase()}</span>
                            )}
                          </span>
                          {p.displayName}
                        </>
                      ) : (
                        <span style={{ color: 'rgba(245,242,236,0.35)' }}>{r.contactName} (guest)</span>
                      )}
                    </span>
                  </div>

                  <div style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>Party size</span>
                    <span style={fieldValueStyle}>{r.partySize} {r.partySize === 1 ? 'person' : 'people'}</span>
                  </div>

                  <div style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>Contact</span>
                    <span style={fieldValueStyle}>{r.contactName} · {r.contactPhone}</span>
                  </div>

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
                      {tab === 'approved' ? (
                        <button
                          onClick={() => handleCheckIn(r)}
                          disabled={isBusy}
                          style={{
                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                            backgroundColor: 'var(--teal)', color: '#fff', border: 'none',
                            padding: '0.8rem 1.5rem', borderRadius: '2px', fontSize: '0.75rem', letterSpacing: '0.08em',
                            textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                            cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.6 : 1,
                          }}
                        >
                          <FontAwesomeIcon icon={faCircleCheck} style={{ width: '13px' }} />
                          {isBusy ? 'Checking in…' : `Check In (+150 XP)`}
                        </button>
                      ) : (
                        <>
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
                        </>
                      )}
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
