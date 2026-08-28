'use client'

import { useEffect, useState } from 'react'
import {
  collection, query, where, orderBy, onSnapshot, doc, addDoc, updateDoc,
  serverTimestamp, type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { logUpdate } from './activityLog'
import { createParticipantInvites } from './participantInvites'
import { createStatusNotification } from './notifications'

// Unlike D&D reservations, there's no single-person resource to avoid
// double-booking here — multiple people can attend the same event together.
// The only real constraint is the event's own min/max players per team
// (validated below), so this is a much simpler create/approve/reject flow
// with no lock documents or conflict checking.

export interface EventReservation {
  id: string
  eventId: string
  eventTitle: string
  eventDate: string
  eventTimeStart: string
  eventTimeEnd: string
  branch: string
  userId: string
  userName: string
  participants: { uid: string; name: string }[]
  participantPhones: string[]
  partySize: number
  status: 'pending' | 'approved' | 'rejected'
  requestedBy: string
  createdAt: Timestamp | null
  approvedBy?: string | null
  approvedAt?: Timestamp | null
  rejectedBy?: string | null
  rejectedAt?: Timestamp | null
  rejectionReason?: string | null
}

export async function createEventReservationRequest(input: {
  userId: string
  userName: string
  eventId: string
  eventTitle: string
  eventDate: string
  eventTimeStart: string
  eventTimeEnd: string
  branch: string
  minPlayers: number
  maxPlayers: number
  participants: { uid: string; name: string }[]
  participantPhones: string[]
}): Promise<void> {
  const partySize = 1 + input.participants.length + input.participantPhones.length
  if (partySize < input.minPlayers || partySize > input.maxPlayers) {
    throw new Error('party-size-out-of-range')
  }

  const ref = await addDoc(collection(db, 'eventReservations'), {
    eventId: input.eventId,
    eventTitle: input.eventTitle,
    eventDate: input.eventDate,
    eventTimeStart: input.eventTimeStart,
    eventTimeEnd: input.eventTimeEnd,
    branch: input.branch,
    userId: input.userId,
    userName: input.userName,
    participants: input.participants,
    participantPhones: input.participantPhones,
    partySize,
    status: 'pending',
    requestedBy: input.userId,
    createdAt: serverTimestamp(),
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
  })

  if (input.participants.length > 0) {
    await createParticipantInvites({
      reservationType: 'event',
      reservationId: ref.id,
      reservationLabel: input.eventTitle,
      reservationDate: `${input.eventDate} · ${input.eventTimeStart}–${input.eventTimeEnd}`,
      inviterUid: input.userId,
      inviterName: input.userName,
      participants: input.participants,
    })
  }
}

// Customer's own event reservations, newest first.
export function useUserEventReservations(uid: string | null) {
  const [reservations, setReservations] = useState<EventReservation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) { setReservations([]); setLoading(false); return }
    setLoading(true)
    const q = query(collection(db, 'eventReservations'), where('userId', '==', uid), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, snap => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() } as EventReservation)))
      setLoading(false)
    })
    return unsub
  }, [uid])

  return { reservations, loading }
}

// Manager/admin queue — pending reservations for one or more branches (an
// admin's 'all', or a manager's assigned branchIds). Mirrors the same
// branch-array filtering already used for loyalty approvals and redemptions
// — the caller must memoize any array it passes in.
export function usePendingEventReservations(branchFilter: string[] | 'all' | null) {
  const [reservations, setReservations] = useState<EventReservation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!branchFilter || (Array.isArray(branchFilter) && branchFilter.length === 0)) {
      setReservations([]); setLoading(false); return
    }
    setLoading(true)
    const base = collection(db, 'eventReservations')
    const q = branchFilter === 'all'
      ? query(base, where('status', '==', 'pending'), orderBy('createdAt', 'asc'))
      : query(base, where('branch', 'in', branchFilter), where('status', '==', 'pending'), orderBy('createdAt', 'asc'))
    const unsub = onSnapshot(q, snap => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() } as EventReservation)))
      setLoading(false)
    })
    return unsub
  }, [branchFilter])

  return { reservations, loading }
}

export async function approveEventReservation(reservation: EventReservation, staffUid: string): Promise<void> {
  await updateDoc(doc(db, 'eventReservations', reservation.id), {
    status: 'approved',
    approvedBy: staffUid,
    approvedAt: serverTimestamp(),
  })
  createStatusNotification({
    uid: reservation.userId,
    type: 'reservation_approved',
    reservationType: 'event',
    reservationId: reservation.id,
    label: reservation.eventTitle,
    dateLabel: `${reservation.eventDate} · ${reservation.eventTimeStart}`,
  }).catch(err => console.error('[approveEventReservation] notification write failed:', err))

  await logUpdate(
    'Event Reservation',
    `${reservation.eventTitle} — ${reservation.branch}`,
    { status: 'pending' },
    { status: 'approved' }
  )
}

export async function rejectEventReservation(reservation: EventReservation, staffUid: string, reason: string): Promise<void> {
  await updateDoc(doc(db, 'eventReservations', reservation.id), {
    status: 'rejected',
    rejectedBy: staffUid,
    rejectedAt: serverTimestamp(),
    rejectionReason: reason || null,
  })
  createStatusNotification({
    uid: reservation.userId,
    type: 'reservation_rejected',
    reservationType: 'event',
    reservationId: reservation.id,
    label: reservation.eventTitle,
    dateLabel: `${reservation.eventDate} · ${reservation.eventTimeStart}`,
    rejectionReason: reason || null,
  }).catch(err => console.error('[rejectEventReservation] notification write failed:', err))

  await logUpdate(
    'Event Reservation',
    `${reservation.eventTitle} — ${reservation.branch}`,
    { status: 'pending' },
    { status: 'rejected', rejectionReason: reason }
  )
}
