'use client'

import { useEffect, useState } from 'react'
import {
  collection, query, where, orderBy, limit, onSnapshot, doc, getDoc, getDocs, addDoc,
  updateDoc, writeBatch, serverTimestamp, documentId, type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { logCreate, logUpdate } from './activityLog'
import { authedFetch, unwrap } from './apiClient'

// Mirrors the shape created by the customer submit-check flow
// (app/(customer)/customer/submit-check/page.tsx) and read on the profile
// page — pointsAmount is already the per-person share, computed at submission
// time, so approval just adds it directly to each account.
export interface Transaction {
  id: string
  // Was 'check' | 'event' | 'dnd'. The D&D Session Attendance panel went with
  // the D&D modules; historical 'dnd' documents may still exist in Firestore,
  // and the approvals UI falls back to a generic label for anything it doesn't
  // recognise rather than crashing on them.
  type: 'check' | 'event'
  userId: string[]
  // One figure. This was pointsAmount + pointsAmount — two currencies awarded at
  // two different rates for the same purchase. See app/lib/loyaltyTiers.ts.
  pointsAmount: number
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  submittedBy: string
  approvedBy?: string | null
  rejectedBy?: string | null
  rejectionReason?: string | null
  checkPhotoUrl?: string
  checkNumber?: string
  branchId: string
  totalAmount?: number
  splitCount?: number
  // "event" type, written by the Event Attendance submission panel.
  eventName?: string
  eventDate?: string
  createdAt: Timestamp | null
}

// The earn rates live in ./loyaltyTiers, which the server can also import.
// Re-exported so existing call sites keep working.
import { EVENT_POINTS_PER_PERSON } from './loyaltyTiers'
export { POINTS_PER_DOLLAR, EVENT_POINTS_PER_PERSON, TABLE_CHECKIN_POINTS } from './loyaltyTiers'

export interface ResolvedProfile {
  displayName: string
  avatarUrl: string
}

// Live pending queue. Pass an array of branch names to scope to those
// branches (managers, who may now have more than one assigned), or 'all'
// for unfiltered oversight (admins). The caller must memoize any array it
// passes in — a fresh array reference on every render would re-subscribe
// this effect in a loop.
export function usePendingTransactions(branchFilter: string[] | 'all' | null) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!branchFilter || (Array.isArray(branchFilter) && branchFilter.length === 0)) {
      setTransactions([])
      setLoading(false)
      return
    }
    setLoading(true)
    const base = collection(db, 'transactions')
    const q = branchFilter === 'all'
      ? query(base, where('status', '==', 'pending'), orderBy('createdAt', 'asc'))
      : query(base, where('branchId', 'in', branchFilter), where('status', '==', 'pending'), orderBy('createdAt', 'asc'))
    const unsub = onSnapshot(q, snap => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)))
      setLoading(false)
    })
    return unsub
  }, [branchFilter])

  return { transactions, loading }
}

// Resolves customer profiles (users/{uid}) in as few reads as possible —
// Firestore's `in` operator covers up to 30 ids per query, comfortably
// enough for even a full 10-person split.
export async function resolveUserProfiles(uids: string[]): Promise<Map<string, ResolvedProfile>> {
  const unique = Array.from(new Set(uids.filter(Boolean)))
  const map = new Map<string, ResolvedProfile>()
  if (unique.length === 0) return map

  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30)
    const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk)))
    snap.docs.forEach(d => {
      const data = d.data() as { displayName?: string; username?: string; avatarUrl?: string }
      map.set(d.id, { displayName: data.displayName || data.username || 'Unnamed', avatarUrl: data.avatarUrl || '' })
    })
  }
  return map
}

// Blocks re-submitting a check that's already been credited, or
// re-submitting your own still-pending one — the two cases a customer's
// own client can actually see. Firestore rules only let a customer read
// *another* customer's transaction once it's 'approved' (or if they're
// staff), so a different customer's still-pending claim on the same check
// number genuinely can't be checked from here; that gap is covered by the
// duplicate flag on the staff approval queue instead (app/admin/loyalty/
// approvals/page.tsx), which has full read access to every pending one.
export async function checkNumberAlreadyUsed(branchId: string, checkNumber: string, ownUid: string): Promise<boolean> {
  const trimmed = checkNumber.trim()
  if (!trimmed) return false

  const approvedQuery = query(
    collection(db, 'transactions'),
    where('type', '==', 'check'),
    where('branchId', '==', branchId),
    where('checkNumber', '==', trimmed),
    where('status', '==', 'approved'),
    limit(1)
  )
  const ownPendingQuery = query(
    collection(db, 'transactions'),
    where('type', '==', 'check'),
    where('branchId', '==', branchId),
    where('checkNumber', '==', trimmed),
    where('userId', 'array-contains', ownUid),
    where('status', '==', 'pending'),
    limit(1)
  )
  const [approvedSnap, ownPendingSnap] = await Promise.all([getDocs(approvedQuery), getDocs(ownPendingQuery)])
  return !approvedSnap.empty || !ownPendingSnap.empty
}

export async function resolveStaffEmails(uids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(uids.filter(Boolean)))
  const map = new Map<string, string>()
  if (unique.length === 0) return map

  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30)
    const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk)))
    snap.docs.forEach(d => {
      const data = d.data() as { email?: string }
      map.set(d.id, data.email || 'Unknown')
    })
  }
  return map
}

// Approving and rejecting run SERVER-SIDE now — the Phase 00 standing rule
// applied to the highest-stakes mutation in the app.
//
// The browser used to read each account's balance, add the award and write the
// new total back. Three problems, none of which a Firestore rule can catch:
// the browser supplied the resulting figure, a rule cannot check arithmetic,
// and two managers approving for the same customer at the same moment both
// read the same starting balance so one credit vanished.
//
// app/lib/server/loyalty.ts takes the amount from the STORED transaction and
// applies it with an atomic increment, inside one Firestore transaction with
// the status flip. It also enforces branch scoping, which was previously only
// a property of the query that built the queue.
//
// Note what is no longer a parameter: managerUid. The server reads the actor
// from the verified ID token. A caller naming its own actor was always the
// weaker half of the old signature.
async function resolve(tx: Transaction, action: 'approve' | 'reject', reason?: string): Promise<void> {
  const res = await authedFetch('/api/admin/loyalty/transactions', 'PATCH', {
    id: tx.id, action, reason,
  })
  const data = await unwrap(res)

  // The route still resolves the submission when an account named on a split
  // has since been deleted; the rest of the split is credited. Surfacing that
  // beats a silent partial credit nobody reconciles later.
  if (typeof data.warning === 'string') alert(data.warning)
}

export async function approveTransaction(tx: Transaction): Promise<void> {
  await resolve(tx, 'approve')
}

export async function rejectTransaction(tx: Transaction, reason: string): Promise<void> {
  await resolve(tx, 'reject', reason)
}

// Customer-initiated — withdrawing their own submission before staff act on
// it (e.g. they forgot to add a friend to the split, or mistyped something).
// Not logged via logUpdate: activityLog is staff-write-only (see
// firestore.rules), and this isn't a staff action — the transaction's own
// status change is the record. Only the original submitter may cancel, not
// every person tagged in a split.
export async function cancelTransaction(tx: Transaction): Promise<void> {
  await updateDoc(doc(db, 'transactions', tx.id), { status: 'cancelled' })
}

export async function createEventAttendanceTransaction(input: {
  submittedBy: string
  branchId: string
  eventDate: string
  eventName: string
  attendeeUids: string[]
}): Promise<void> {
  await addDoc(collection(db, 'transactions'), {
    type: 'event',
    userId: input.attendeeUids,
    pointsAmount: EVENT_POINTS_PER_PERSON,
    status: 'pending',
    submittedBy: input.submittedBy,
    approvedBy: null,
    branchId: input.branchId,
    eventDate: input.eventDate,
    eventName: input.eventName.trim(),
    splitCount: input.attendeeUids.length,
    createdAt: serverTimestamp(),
  })
  await logCreate('Loyalty Submission', `Event — ${input.eventName.trim()} (${input.attendeeUids.length} attendees)`, {
    branchId: input.branchId,
    eventDate: input.eventDate,
    attendees: input.attendeeUids.length,
    pointsAmount: EVENT_POINTS_PER_PERSON,
  })
}

// Instant check-in award for a table reservation — no pending/approve cycle
// needed since the staff member doing the check-in is already authorized.
// Runs SERVER-SIDE (Phase 00 standing rule).
//
// The client version had a defect the other award paths didn't: nothing
// stopped it running twice. It read the balance, added the award and wrote
// the total, so checking the same reservation in again simply awarded again.
// The route re-reads `checkedIn` inside a Firestore transaction, which is the
// only place that can be checked without a race.
//
// The caller passes a reservation id and nothing else. Branch, table numbers,
// the customer and the award all come from the stored document — a browser
// naming its own award amount was the shape of the old signature.
export async function awardTableCheckin(reservationId: string): Promise<void> {
  const res = await authedFetch('/api/admin/tables/checkin', 'POST', { reservationId })
  const data = await unwrap(res)
  // A booking made by phone number has no account to credit. Staff expect a
  // check-in to award points, so say why it didn't rather than showing zero.
  if (typeof data.note === 'string') alert(data.note)
}
