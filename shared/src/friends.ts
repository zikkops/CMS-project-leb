'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  collection, addDoc, deleteDoc, updateDoc, doc, getDocs, onSnapshot,
  query, where, serverTimestamp, type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'

// Friend requests live in their own collection rather than as arrays on
// users/{uid} — a customer can only write their own user doc (see
// app/lib/customerAuth.ts), so there's no way to add yourself to someone
// else's "incoming requests" array without a separate, narrowly-scoped
// collection. Each party's display info is denormalized onto the request
// doc at creation time, so showing a request/friend never needs an extra
// read — it's a snapshot of their name/avatar at request time, not live.
export interface FriendRequest {
  id: string
  fromUid: string
  fromName: string
  fromAvatar: string
  toUid: string
  toName: string
  toAvatar: string
  status: 'pending' | 'accepted'
  createdAt: Timestamp | null
}

export interface FriendSummary {
  uid: string
  displayName: string
  avatarUrl: string
  requestId: string
}

export interface DirectoryUser {
  uid: string
  displayName: string
  avatarUrl: string
  email: string
}

// Confirmed friends, merged from both directions a request could have been
// sent in. Two plain equality-filter listeners merged client-side, rather
// than a single OR query — keeps this on the same simple query shape used
// elsewhere in the app.
export function useFriends(uid: string | null): FriendSummary[] {
  const [asSender, setAsSender]       = useState<FriendRequest[]>([])
  const [asRecipient, setAsRecipient] = useState<FriendRequest[]>([])

  useEffect(() => {
    if (!uid) return
    const q = query(collection(db, 'friendRequests'), where('fromUid', '==', uid), where('status', '==', 'accepted'))
    return onSnapshot(q, snap => setAsSender(snap.docs.map(d => ({ id: d.id, ...d.data() } as FriendRequest))),
      err => console.error('[useFriends] friendRequests (asSender) listener failed:', err))
  }, [uid])

  useEffect(() => {
    if (!uid) return
    const q = query(collection(db, 'friendRequests'), where('toUid', '==', uid), where('status', '==', 'accepted'))
    return onSnapshot(q, snap => setAsRecipient(snap.docs.map(d => ({ id: d.id, ...d.data() } as FriendRequest))),
      err => console.error('[useFriends] friendRequests (asRecipient) listener failed:', err))
  }, [uid])

  // Memoized so consumers get a stable reference between renders — without
  // this, every render produced a brand-new array, which broke anything
  // that depended on it inside a useEffect (e.g. the leaderboard's friends
  // tab kept re-fetching in an infinite loop since its effect saw a "new"
  // friends list on every single render).
  return useMemo(() => [
    ...asSender.map(r => ({ uid: r.toUid, displayName: r.toName, avatarUrl: r.toAvatar, requestId: r.id })),
    ...asRecipient.map(r => ({ uid: r.fromUid, displayName: r.fromName, avatarUrl: r.fromAvatar, requestId: r.id })),
  ], [asSender, asRecipient])
}

// Requests sent TO this user, awaiting their accept/decline.
export function useIncomingRequests(uid: string | null): FriendRequest[] {
  const [requests, setRequests] = useState<FriendRequest[]>([])
  useEffect(() => {
    if (!uid) return
    const q = query(collection(db, 'friendRequests'), where('toUid', '==', uid), where('status', '==', 'pending'))
    return onSnapshot(q, snap => setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as FriendRequest))),
      err => console.error('[useIncomingRequests] friendRequests listener failed:', err))
  }, [uid])
  return requests
}

// Requests this user sent, awaiting the other side.
export function useOutgoingRequests(uid: string | null): FriendRequest[] {
  const [requests, setRequests] = useState<FriendRequest[]>([])
  useEffect(() => {
    if (!uid) return
    const q = query(collection(db, 'friendRequests'), where('fromUid', '==', uid), where('status', '==', 'pending'))
    return onSnapshot(q, snap => setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as FriendRequest))),
      err => console.error('[useOutgoingRequests] friendRequests listener failed:', err))
  }, [uid])
  return requests
}

export async function sendFriendRequest(
  from: { uid: string; displayName: string; avatarUrl: string },
  to: { uid: string; displayName: string; avatarUrl: string }
) {
  await addDoc(collection(db, 'friendRequests'), {
    fromUid: from.uid,
    fromName: from.displayName,
    fromAvatar: from.avatarUrl,
    toUid: to.uid,
    toName: to.displayName,
    toAvatar: to.avatarUrl,
    status: 'pending',
    createdAt: serverTimestamp(),
  })
}

// Only the recipient is allowed to do this (enforced by the Firestore rule,
// not just the UI) — that's what makes this a real confirmation step.
export async function acceptFriendRequest(requestId: string) {
  await updateDoc(doc(db, 'friendRequests', requestId), { status: 'accepted' })
}

// Declining a pending request and removing an accepted friend are the same
// operation — just delete the request doc. Either party can do either.
export async function declineFriendRequest(requestId: string) {
  await deleteDoc(doc(db, 'friendRequests', requestId))
}

export async function removeFriend(requestId: string) {
  await deleteDoc(doc(db, 'friendRequests', requestId))
}

// Same "fetch then filter client-side" approach used for admin search and
// the submit-check split picker — Firestore has no substring/text search.
export async function fetchCustomerDirectory(excludeUid: string): Promise<DirectoryUser[]> {
  const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'customer')))
  return snap.docs
    .filter(d => d.id !== excludeUid)
    .map(d => {
      const data = d.data() as { displayName?: string; username?: string; avatarUrl?: string; email?: string }
      return {
        uid: d.id,
        displayName: data.displayName || data.username || 'Unnamed',
        avatarUrl: data.avatarUrl || '',
        email: data.email || '',
      }
    })
}
