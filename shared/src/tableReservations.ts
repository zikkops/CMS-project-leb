'use client'

import { useEffect, useState } from 'react'
import {
  collection, query, where, orderBy, onSnapshot, doc, getDocs,
  runTransaction, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { createStatusNotification } from './notifications'
import { authedFetch, unwrap } from './apiClient'

// Mirrors shared/src/dndReservations.ts's conflict-locking pattern exactly,
// generalized from one locked resource (a DM) to N (every table in a
// joint booking) — this predates the Admin SDK layer, so a
// runTransaction reading deterministic per-bucket lock documents is the
// only race-safe option available client-side (see ARCHITECTURE.md).
// Self-contained on purpose, not importing the date-math helpers from
// dndReservations.ts — each lib/*.ts file in this codebase is independent
// (compare eventReservations.ts, which doesn't import from it either).
//
// Unlike D&D/event bookings, a table reservation only ever names ONE
// contact (name + phone) for the whole party, not a per-person invite
// roster — there's no participantInvites involvement here at all.

export const RESERVATION_DURATION_MINUTES = 90   // placeholder — tune to the café's real seating policy
export const TABLE_RESET_BUFFER_MINUTES = 15     // table turnover/bussing time; set to 0 to disable
import { BUCKET_MINUTES, dateKey, lockDocId, bucketStartTimesInRange } from './tableLocks'
export const DEFAULT_OPENING_START = '16:30'
export const DEFAULT_OPENING_END = '01:30'

/**
 * Opening hours for a branch.
 *
 * There was a BRANCH_HOURS table here keyed on the original café's three
 * branch names — and all three entries held exactly the values the fallback
 * already returned, so it never once changed an answer. What it did do is
 * make every branch outside those three look like a special case.
 *
 * Hours are the same everywhere until there is somewhere to configure them
 * per branch, which is the /admin/settings gap this phase exists to close.
 * When that lands, this reads from it. Until then it is honest about being
 * one pair of times for the whole business.
 */
export function branchOpeningHours(_branch: string): { start: string; end: string } {
  return { start: DEFAULT_OPENING_START, end: DEFAULT_OPENING_END }
}

export interface TableReservation {
  id: string
  branch: string
  tableIds: string[]
  tableNumbers: number[]
  startAt: Timestamp
  endAt: Timestamp
  blockedUntil: Timestamp
  userId: string
  userName: string
  partySize: number
  contactName: string
  contactPhone: string
  status: 'pending' | 'approved' | 'rejected'
  requestedBy: string
  createdAt: Timestamp | null
  approvedBy?: string | null
  approvedAt?: Timestamp | null
  rejectedBy?: string | null
  rejectedAt?: Timestamp | null
  rejectionReason?: string | null
}

// dateKey, bucketIndex, lockDocId and bucketStartTimesInRange moved to
// shared/src/tableLocks.ts. Releasing a lock happens server-side now, and both
// sides have to compute byte-identical ids or a rejection orphans the locks
// it meant to free.
function allStartTimesForDate(dateStr: string, openingStart: string, openingEnd: string): Date[] {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [startH, startM] = openingStart.split(':').map(Number)
  const [endH, endM] = openingEnd.split(':').map(Number)
  // An end clock-time that's earlier than (or equal to) the start
  // clock-time means the window crosses midnight (e.g. 16:30 -> 01:30) —
  // the latest start is on the *next* calendar day, not the same one.
  // Date's constructor normalizes day+1 past a month/year boundary on its
  // own, so this needs no extra rollover handling.
  const crossesMidnight = endH * 60 + endM <= startH * 60 + startM
  const latestStart = new Date(y, m - 1, d + (crossesMidnight ? 1 : 0), endH, endM, 0, 0)
  const times: Date[] = []
  let cur = new Date(y, m - 1, d, startH, startM, 0, 0)
  while (cur <= latestStart) {
    times.push(new Date(cur))
    cur = new Date(cur.getTime() + BUCKET_MINUTES * 60000)
  }
  return times
}

// Re-runs whenever the selected table set changes — a start time is only
// available if EVERY currently-selected table is free for the whole span,
// so picking a 2nd table for a joint booking immediately narrows the grid.
export function useAvailableStartTimes(
  branch: string | null,
  tableIds: string[],
  dateStr: string | null,
  openingStart: string = DEFAULT_OPENING_START,
  openingEnd: string = DEFAULT_OPENING_END
) {
  const [times, setTimes] = useState<Date[]>([])
  const [loading, setLoading] = useState(false)
  const idsKey = tableIds.join(',')

  useEffect(() => {
    if (!branch || !idsKey || !dateStr) { setTimes([]); return }
    setLoading(true)
    const ids = idsKey.split(',')
    const candidates = allStartTimesForDate(dateStr, openingStart, openingEnd)
    // The opening window can cross midnight (e.g. 16:30 -> 01:30), so a
    // late candidate's own bucket span — and an early candidate's full
    // session+buffer span — can each fall on either of two calendar dates.
    // Query every dateKey actually touched by ANY candidate's full span,
    // not just dateStr itself, or a lock sitting on the "other" day would
    // silently never be found here (the booking transaction itself reads
    // exact doc refs regardless of day, so it's never wrong — only this
    // display query needs the fix).
    const dayKeys = Array.from(new Set(candidates.flatMap(c => {
      const fullEnd = new Date(c.getTime() + (RESERVATION_DURATION_MINUTES + TABLE_RESET_BUFFER_MINUTES) * 60000)
      return bucketStartTimesInRange(c, fullEnd).map(dateKey)
    })))

    Promise.all(ids.map(id =>
      getDocs(query(collection(db, 'tableLocks'), where('tableId', '==', id), where('dateKey', 'in', dayKeys)))
    )).then(snaps => {
      const takenBuckets = new Set(snaps.flatMap(s => s.docs.map(d => d.id)))
      const available = candidates.filter(start => {
        const end = new Date(start.getTime() + RESERVATION_DURATION_MINUTES * 60000)
        return bucketStartTimesInRange(start, end).every(b => ids.every(id => !takenBuckets.has(lockDocId(id, b))))
      })
      setTimes(available)
      setLoading(false)
    }).catch(err => {
      console.error('[useAvailableStartTimes] tableLocks query failed:', err)
      setTimes([])
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, idsKey, dateStr, openingStart, openingEnd])

  return { times, loading }
}

export async function createTableReservationRequest(input: {
  userId: string
  userName: string
  branch: string
  tableIds: string[]
  tableNumbers: number[]
  startAt: Date
  partySize: number
  contactName: string
  contactPhone: string
}): Promise<void> {
  const endAt = new Date(input.startAt.getTime() + RESERVATION_DURATION_MINUTES * 60000)
  const blockedUntil = new Date(endAt.getTime() + TABLE_RESET_BUFFER_MINUTES * 60000)
  const lockBuckets = bucketStartTimesInRange(input.startAt, blockedUntil)
  const reservationRef = doc(collection(db, 'tableReservations'))

  await runTransaction(db, async tx => {
    // Every (tableId × bucket) lock ref, read up front — the direct
    // generalization of dndReservations' single-resource check to an
    // outer loop over every table in this (possibly joint) booking.
    const lockRefs = input.tableIds.flatMap(tableId => lockBuckets.map(b => doc(db, 'tableLocks', lockDocId(tableId, b))))
    const snaps = await Promise.all(lockRefs.map(ref => tx.get(ref)))
    if (snaps.some(s => s.exists())) throw new Error('slot-taken')

    tx.set(reservationRef, {
      branch: input.branch,
      tableIds: input.tableIds,
      tableNumbers: input.tableNumbers,
      startAt: Timestamp.fromDate(input.startAt),
      endAt: Timestamp.fromDate(endAt),
      blockedUntil: Timestamp.fromDate(blockedUntil),
      userId: input.userId,
      userName: input.userName,
      partySize: input.partySize,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      status: 'pending',
      requestedBy: input.userId,
      createdAt: serverTimestamp(),
      approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null,
    })

    // requestedBy is denormalized directly onto each lock doc (not just
    // read back from the reservation) so the lock's own create rule can
    // validate ownership from its own fields alone — no get() back to a
    // sibling document being written in this same transaction, which
    // would depend on a same-commit-sees-its-own-earlier-writes guarantee
    // for *rules-triggered* reads that isn't safe to assume (unlike the
    // client's own tx.get() calls above, which definitely have that
    // guarantee — this is rules evaluation, a separate mechanism).
    let i = 0
    for (const tableId of input.tableIds) {
      for (const b of lockBuckets) {
        tx.set(lockRefs[i++], {
          tableId, branch: input.branch, dateKey: dateKey(b),
          bucketStart: Timestamp.fromDate(b), reservationId: reservationRef.id,
          requestedBy: input.userId, createdAt: serverTimestamp(),
        })
      }
    }
  })
}

// Customer's own table reservations, newest first.
export function useUserTableReservations(uid: string | null) {
  const [reservations, setReservations] = useState<TableReservation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) { setReservations([]); setLoading(false); return }
    setLoading(true)
    const q = query(collection(db, 'tableReservations'), where('userId', '==', uid), orderBy('startAt', 'desc'))
    const unsub = onSnapshot(q, snap => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() } as TableReservation)))
      setLoading(false)
    }, err => console.error('[useUserTableReservations] listener failed:', err))
    return unsub
  }, [uid])

  return { reservations, loading }
}

// Approved reservations that haven't been checked in yet — shown in the
// admin "Approved" tab so staff can check customers in when they arrive.
export function useApprovedTableReservations(branchFilter: 'all' | string[] | null) {
  const [reservations, setReservations] = useState<TableReservation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!branchFilter || (Array.isArray(branchFilter) && branchFilter.length === 0)) {
      setReservations([]); setLoading(false); return
    }
    setLoading(true)
    const base = collection(db, 'tableReservations')
    const q = branchFilter === 'all'
      ? query(base, where('status', '==', 'approved'), where('checkedIn', '!=', true), orderBy('startAt', 'asc'))
      : query(base, where('branch', 'in', branchFilter.slice(0, 30)), where('status', '==', 'approved'), where('checkedIn', '!=', true), orderBy('startAt', 'asc'))
    const unsub = onSnapshot(q, snap => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() } as TableReservation)))
      setLoading(false)
    }, err => console.error('[useApprovedTableReservations] listener failed:', err))
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter === 'all' ? 'all' : branchFilter?.join(',')])

  return { reservations, loading }
}

// Admin/manager queue — 'all' sees every pending reservation, or a branch
// array scopes it to a manager's own branches (same pattern as
// usePendingEventReservations).
export function usePendingTableReservations(branchFilter: 'all' | string[] | null) {
  const [reservations, setReservations] = useState<TableReservation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!branchFilter || (Array.isArray(branchFilter) && branchFilter.length === 0)) {
      setReservations([]); setLoading(false); return
    }
    setLoading(true)
    const base = collection(db, 'tableReservations')
    const q = branchFilter === 'all'
      ? query(base, where('status', '==', 'pending'), orderBy('startAt', 'asc'))
      : query(base, where('branch', 'in', branchFilter.slice(0, 30)), where('status', '==', 'pending'), orderBy('startAt', 'asc'))
    const unsub = onSnapshot(q, snap => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() } as TableReservation)))
      setLoading(false)
    }, err => console.error('[usePendingTableReservations] listener failed:', err))
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter === 'all' ? 'all' : branchFilter?.join(',')])

  return { reservations, loading }
}

/**
 * Approve or reject a table booking.
 *
 * `staffUid` is accepted and ignored — see the note on the event twin. The
 * route reads the approver from the verified token and refuses anything no
 * longer pending.
 *
 * Rejecting releases the table's half-hour locks, and the route recomputes
 * which ones from the STORED start and end rather than trusting the request.
 * A browser able to name the lock documents to delete could free somebody
 * else's table.
 */
export async function approveTableReservation(reservation: TableReservation, _staffUid: string): Promise<void> {
  await unwrap(await authedFetch('/api/admin/reservations', 'PATCH', {
    kind: 'table', id: reservation.id, action: 'approve',
  }))
  createStatusNotification({
    uid: reservation.userId,
    type: 'reservation_approved',
    reservationType: 'table',
    reservationId: reservation.id,
    label: `Table${reservation.tableNumbers.length > 1 ? 's' : ''} ${reservation.tableNumbers.join(', ')} · ${reservation.branch}`,
    dateLabel: reservation.startAt.toDate().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
  }).catch(err => console.error('[approveTableReservation] notification write failed:', err))
}

export async function rejectTableReservation(reservation: TableReservation, _staffUid: string, reason: string): Promise<void> {
  await unwrap(await authedFetch('/api/admin/reservations', 'PATCH', {
    kind: 'table', id: reservation.id, action: 'reject', reason,
  }))
  createStatusNotification({
    uid: reservation.userId,
    type: 'reservation_rejected',
    reservationType: 'table',
    reservationId: reservation.id,
    label: `Table${reservation.tableNumbers.length > 1 ? 's' : ''} ${reservation.tableNumbers.join(', ')} · ${reservation.branch}`,
    dateLabel: reservation.startAt.toDate().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
    rejectionReason: reason || null,
  }).catch(err => console.error('[rejectTableReservation] notification write failed:', err))
}
