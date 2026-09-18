'use client'

import { useEffect } from 'react'
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, doc, updateDoc, serverTimestamp, type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { useKeyed } from './useKeyed'

export interface StatusNotification {
  id: string
  uid: string
  type: 'reservation_approved' | 'reservation_rejected'
  // Was 'dnd' | 'event' | 'table'. D&D notifications went with the module.
  reservationType: 'event' | 'table'
  reservationId: string
  label: string
  dateLabel: string
  rejectionReason?: string | null
  read: boolean
  createdAt: Timestamp | null
}

// Real-time feed of this user's unread status notifications, newest first.
export function useMyNotifications(uid: string | null): StatusNotification[] {
  const answer = useKeyed<StatusNotification[]>(uid, NO_NOTIFICATIONS)
  const { put } = answer

  useEffect(() => {
    if (!uid) return
    const q = query(
      collection(db, 'notifications'),
      where('uid', '==', uid),
      where('read', '==', false),
      orderBy('createdAt', 'desc'),
    )
    return onSnapshot(q, snap => {
      put(uid, snap.docs.map(d => ({ id: d.id, ...d.data() } as StatusNotification)))
    }, err => console.error('[useMyNotifications] notifications listener failed:', err))
  }, [uid, put])

  return answer.value
}

const NO_NOTIFICATIONS: StatusNotification[] = []

// Written by staff-side approve/reject functions — fire-and-forget from the
// caller's perspective since a notification failure must not block the
// actual approval.
export async function createStatusNotification(
  input: Omit<StatusNotification, 'id' | 'read' | 'createdAt'>
): Promise<void> {
  await addDoc(collection(db, 'notifications'), {
    ...input,
    read: false,
    createdAt: serverTimestamp(),
  })
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(db, 'notifications', id), { read: true })
}
