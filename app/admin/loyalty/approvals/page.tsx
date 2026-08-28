'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import {
  usePendingTransactions, resolveUserProfiles, resolveStaffEmails,
  approveTransaction, rejectTransaction, type Transaction, type ResolvedProfile,
} from '../../../lib/loyalty'
import { resolveBranchName, BRANCHES } from '../../../lib/branches'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faReceipt, faCalendarDay, faInbox, type IconDefinition } from '@fortawesome/free-solid-svg-icons'

const TYPE_INFO: Record<Transaction['type'], { label: string; icon: IconDefinition }> = {
  check: { label: 'Check Submission', icon: faReceipt },
  event: { label: 'Event Attendance', icon: faCalendarDay },
}

// A 'dnd' transaction written before the D&D modules were removed still reads
// back out of Firestore with a type this Record has no entry for. The type says
// that can't happen; the database disagrees, so fall back rather than render
// `undefined.label` and blank the whole approvals queue.
const UNKNOWN_TYPE = { label: 'Attendance', icon: faCalendarDay }

function formatDate(ts: Transaction['createdAt']): string {
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

export default function LoyaltyApprovalsPage() {
  const { checking, role, branchIds, user } = useRequireRole(SECTION_ACCESS.loyalty)
  const isMobile = useIsMobile()

  const [adminBranchFilter, setAdminBranchFilter]     = useState<string | 'all'>('all')
  const [managerBranchFilter, setManagerBranchFilter] = useState<string | 'all'>('all')

  // Memoized — usePendingTransactions re-subscribes its onSnapshot listener
  // whenever this array's reference changes, so it must stay stable across
  // renders where the underlying filter hasn't actually changed.
  const effectiveFilter = useMemo(() => {
    if (checking) return null
    if (role === 'admin') return adminBranchFilter === 'all' ? 'all' : [adminBranchFilter]
    if (managerBranchFilter === 'all') return branchIds
    return [managerBranchFilter]
  }, [checking, role, adminBranchFilter, managerBranchFilter, branchIds])

  const { transactions, loading } = usePendingTransactions(effectiveFilter)
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set())

  const [profiles, setProfiles]       = useState<Map<string, ResolvedProfile>>(new Map())
  const [staffEmails, setStaffEmails] = useState<Map<string, string>>(new Map())
  const [busyId, setBusyId]           = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [viewingImage, setViewingImage] = useState<string | null>(null)

  // Resolve every profile referenced across the whole pending list in one
  // batched pass per change, instead of one read per card.
  useEffect(() => {
    const customerUids = new Set<string>()
    const staffUids = new Set<string>()
    transactions.forEach(tx => {
      tx.userId.forEach(uid => customerUids.add(uid))
      if (tx.type === 'check') customerUids.add(tx.submittedBy)
      else staffUids.add(tx.submittedBy)
    })
    if (customerUids.size > 0) resolveUserProfiles([...customerUids]).then(setProfiles)
    if (staffUids.size > 0) resolveStaffEmails([...staffUids]).then(setStaffEmails)
  }, [transactions])

  async function handleApprove(tx: Transaction) {
    if (!user) return
    setBusyId(tx.id)
    try {
      await approveTransaction(tx)
      setProcessedIds(prev => new Set(prev).add(tx.id))
    } finally {
      setBusyId(null)
    }
  }

  async function handleConfirmReject(tx: Transaction) {
    if (!user || !rejectReason.trim()) return
    setBusyId(tx.id)
    try {
      await rejectTransaction(tx, rejectReason.trim())
      setProcessedIds(prev => new Set(prev).add(tx.id))
      setRejectingId(null)
      setRejectReason('')
    } finally {
      setBusyId(null)
    }
  }

  if (checking) return null

  const visible = transactions.filter(tx => !processedIds.has(tx.id))

  // Same branchId+checkNumber on more than one pending check submission —
  // possibly two different customers, which the customer-side duplicate
  // check (checkNumberAlreadyUsed in app/lib/loyalty.ts) structurally can't
  // see across accounts (Firestore rules only let a customer read another
  // customer's transaction once it's approved). Purely a flag for the
  // reviewer here; nothing is blocked.
  const checkNumberCounts = new Map<string, number>()
  transactions.forEach(tx => {
    if (tx.type !== 'check' || !tx.checkNumber) return
    const key = `${tx.branchId}|${tx.checkNumber.trim().toLowerCase()}`
    checkNumberCounts.set(key, (checkNumberCounts.get(key) ?? 0) + 1)
  })
  function isDuplicateCheckNumber(tx: Transaction): boolean {
    if (tx.type !== 'check' || !tx.checkNumber) return false
    const key = `${tx.branchId}|${tx.checkNumber.trim().toLowerCase()}`
    return (checkNumberCounts.get(key) ?? 0) > 1
  }

  const cardStyle = {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '4px',
    padding: isMobile ? '1.1rem' : '1.5rem',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.9rem',
  }

  const labelChipStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.65rem',
    letterSpacing: '0.15em',
    textTransform: 'uppercase' as const,
    color: 'var(--purple)',
    fontFamily: 'var(--font-inter)',
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

        {/* Header */}
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
              fontSize: '0.7rem',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.3)',
              textDecoration: 'none',
              fontFamily: 'var(--font-inter)',
              marginBottom: '0.5rem',
              display: 'block',
            }}>← Back to Dashboard</a>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)' }}>
              Loyalty Approvals
            </h1>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.4rem' }}>
              {role === 'admin'
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

          {role === 'admin' && (
            <select
              value={adminBranchFilter}
              onChange={e => setAdminBranchFilter(e.target.value)}
              style={{
                backgroundColor: '#1a1a1a',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#F5F2EC',
                padding: '0.6rem 0.9rem',
                borderRadius: '2px',
                fontSize: '0.82rem',
                outline: 'none',
                fontFamily: 'var(--font-inter)',
              }}
            >
              <option value="all">All Branches</option>
              {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}

          {role === 'manager' && branchIds.length > 1 && (
            <select
              value={managerBranchFilter}
              onChange={e => setManagerBranchFilter(e.target.value)}
              style={{
                backgroundColor: '#1a1a1a',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#F5F2EC',
                padding: '0.6rem 0.9rem',
                borderRadius: '2px',
                fontSize: '0.82rem',
                outline: 'none',
                fontFamily: 'var(--font-inter)',
              }}
            >
              <option value="all">All My Branches</option>
              {branchIds.map(b => <option key={b} value={b}>{resolveBranchName(b)}</option>)}
            </select>
          )}
        </div>

        {/* Manager with no branches assigned */}
        {role === 'manager' && branchIds.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(228,51,41,0.3)',
            borderRadius: '4px',
            padding: isMobile ? '2rem 1.25rem' : '3rem',
            textAlign: 'center',
          }}>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--red)' }}>
              Your account isn&apos;t assigned to a branch yet — ask an admin to set one in Manage Users.
            </p>
          </div>
        ) : loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : visible.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)',
            borderRadius: '4px',
            padding: isMobile ? '3rem 1.5rem' : '4rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
          }}>
            <FontAwesomeIcon icon={faInbox} style={{ width: '32px', color: 'rgba(245,242,236,0.15)' }} />
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.3)' }}>
              No pending approvals for your branch
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {visible.map(tx => {
              const info = TYPE_INFO[tx.type] ?? UNKNOWN_TYPE
              const isBusy = busyId === tx.id
              const splitCount = tx.splitCount ?? tx.userId.length

              return (
                <div key={tx.id} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                    <span style={labelChipStyle}>
                      <FontAwesomeIcon icon={info.icon} style={{ width: '13px' }} />
                      {info.label}
                    </span>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.3)', whiteSpace: 'nowrap' }}>
                      {formatDate(tx.createdAt)}
                    </span>
                  </div>

                  {tx.type === 'check' ? (
                    <>
                      <div style={fieldRowStyle}>
                        <span style={fieldLabelStyle}>Submitted by</span>
                        <span style={{ ...fieldValueStyle, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {(() => {
                            const p = profiles.get(tx.submittedBy)
                            return (
                              <>
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
                              </>
                            )
                          })()}
                        </span>
                      </div>
                      <div style={fieldRowStyle}>
                        <span style={fieldLabelStyle}>Check Number</span>
                        <span style={{ ...fieldValueStyle, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {tx.checkNumber || '—'}
                          {isDuplicateCheckNumber(tx) && (
                            <span style={{
                              fontSize: '0.62rem',
                              padding: '0.15rem 0.5rem',
                              borderRadius: '2px',
                              backgroundColor: 'rgba(228,51,41,0.15)',
                              color: 'var(--red)',
                              fontFamily: 'var(--font-inter)',
                              letterSpacing: '0.04em',
                              textTransform: 'uppercase',
                              whiteSpace: 'nowrap',
                            }}>⚠ Duplicate</span>
                          )}
                        </span>
                      </div>
                      <div style={fieldRowStyle}>
                        <span style={fieldLabelStyle}>Total Amount</span>
                        <span style={fieldValueStyle}>${(tx.totalAmount ?? 0).toFixed(2)}</span>
                      </div>
                      {tx.checkPhotoUrl && (
                        <div style={fieldRowStyle}>
                          <span style={fieldLabelStyle}>Check Photo</span>
                          <button
                            onClick={() => setViewingImage(tx.checkPhotoUrl!)}
                            style={{
                              width: isMobile ? '80px' : '60px',
                              height: isMobile ? '80px' : '60px',
                              borderRadius: '4px',
                              overflow: 'hidden',
                              border: '1px solid rgba(255,255,255,0.1)',
                              padding: 0,
                              cursor: 'pointer',
                            }}
                          >
                            <img src={tx.checkPhotoUrl} alt="Check" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </button>
                        </div>
                      )}
                      {splitCount > 1 && (
                        <div style={fieldRowStyle}>
                          <span style={fieldLabelStyle}>Split</span>
                          <span style={fieldValueStyle}>Split between {splitCount} people</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={fieldRowStyle}>
                        <span style={fieldLabelStyle}>Submitted by</span>
                        <span style={fieldValueStyle}>{staffEmails.get(tx.submittedBy) ?? '…'}</span>
                      </div>
                      <div style={fieldRowStyle}>
                        <span style={fieldLabelStyle}>Event</span>
                        <span style={fieldValueStyle}>
                          {tx.eventName || formatDate(tx.createdAt)}
                        </span>
                      </div>
                      <div>
                        <p style={{ ...fieldLabelStyle, fontFamily: 'var(--font-inter)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                          Will receive points ({tx.userId.length})
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          {tx.userId.map(uid => (
                            <span key={uid} style={{
                              fontSize: '0.75rem',
                              padding: '0.25rem 0.7rem',
                              borderRadius: '2px',
                              backgroundColor: 'rgba(255,255,255,0.05)',
                              color: 'var(--offwhite)',
                              fontFamily: 'var(--font-inter)',
                            }}>{profiles.get(uid)?.displayName ?? '…'}</span>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <div style={fieldRowStyle}>
                    <span style={fieldLabelStyle}>Each person receives</span>
                    <span style={{ ...fieldValueStyle, color: 'var(--teal)' }}>
                      +{tx.pointsAmount} points
                    </span>
                  </div>

                  {/* Reject reason input */}
                  {rejectingId === tx.id && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Reason for rejection…"
                        autoFocus
                        style={{
                          width: '100%',
                          backgroundColor: '#1a1a1a',
                          border: '1px solid rgba(228,51,41,0.3)',
                          color: '#F5F2EC',
                          padding: '0.7rem 0.9rem',
                          borderRadius: '2px',
                          fontSize: '0.82rem',
                          outline: 'none',
                          fontFamily: 'var(--font-inter)',
                        }}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleConfirmReject(tx)}
                          disabled={!rejectReason.trim() || isBusy}
                          style={{
                            flex: 1,
                            backgroundColor: 'var(--red)',
                            color: '#fff',
                            border: 'none',
                            padding: '0.7rem',
                            borderRadius: '2px',
                            fontSize: '0.72rem',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            fontFamily: 'var(--font-inter)',
                            cursor: !rejectReason.trim() || isBusy ? 'not-allowed' : 'pointer',
                            opacity: !rejectReason.trim() || isBusy ? 0.6 : 1,
                          }}
                        >Confirm Rejection</button>
                        <button
                          onClick={() => { setRejectingId(null); setRejectReason('') }}
                          style={{
                            background: 'transparent',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: 'rgba(245,242,236,0.5)',
                            padding: '0.7rem 1.2rem',
                            borderRadius: '2px',
                            fontSize: '0.72rem',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            fontFamily: 'var(--font-inter)',
                            cursor: 'pointer',
                          }}
                        >Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Approve / Reject */}
                  {rejectingId !== tx.id && (
                    <div style={{ display: 'flex', gap: '0.6rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <button
                        onClick={() => handleApprove(tx)}
                        disabled={isBusy}
                        style={{
                          flex: isMobile ? 1 : 'initial',
                          backgroundColor: 'var(--teal)',
                          color: '#fff',
                          border: 'none',
                          padding: '0.8rem 1.5rem',
                          borderRadius: '2px',
                          fontSize: '0.75rem',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          fontFamily: 'var(--font-inter)',
                          cursor: isBusy ? 'not-allowed' : 'pointer',
                          opacity: isBusy ? 0.6 : 1,
                        }}
                      >{isBusy ? 'Working…' : 'Approve'}</button>
                      <button
                        onClick={() => { setRejectingId(tx.id); setRejectReason('') }}
                        disabled={isBusy}
                        style={{
                          flex: isMobile ? 1 : 'initial',
                          background: 'transparent',
                          border: '1px solid rgba(228,51,41,0.3)',
                          color: 'var(--red)',
                          padding: '0.8rem 1.5rem',
                          borderRadius: '2px',
                          fontSize: '0.75rem',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          fontFamily: 'var(--font-inter)',
                          cursor: isBusy ? 'not-allowed' : 'pointer',
                          opacity: isBusy ? 0.6 : 1,
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

      {/* Full-screen check photo viewer */}
      {viewingImage && (
        <div
          onClick={() => setViewingImage(null)}
          style={{
            position: 'fixed', inset: 0,
            backgroundColor: 'rgba(0,0,0,0.9)',
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            cursor: 'pointer',
          }}
        >
          <img src={viewingImage} alt="Check" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }} />
        </div>
      )}
    </div>
  )
}
