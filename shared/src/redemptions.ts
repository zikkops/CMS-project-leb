'use client'

import { useEffect, useState } from 'react'
import {
  collection, query, where, orderBy, limit, onSnapshot, doc, getDocs,
  addDoc, updateDoc, serverTimestamp, type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { authedFetch, unwrap } from './apiClient'

// Kept in its own file, separate from app/lib/loyalty.ts — redemptions are a
// distinct flow (spending coins) from transactions (earning them), with
// their own collections. transactionLog is shared between both (a `type`
// discriminator distinguishes redemption entries from transaction ones).

export interface RedemptionItem {
  id: string
  name: string
  description: string
  coinCost: number
  isActive: boolean
  createdAt: Timestamp | null
  updatedAt?: Timestamp | null
  createdBy: string
}

export interface Redemption {
  id: string
  userId: string
  itemId: string
  itemName: string
  itemDescription: string
  coinCost: number
  status: 'pending' | 'redeemed' | 'rejected' | 'cancelled'
  branchId: string
  requestedBy: string
  confirmedBy?: string | null
  createdAt: Timestamp | null
  confirmedAt?: Timestamp | null
  rejectedAt?: Timestamp | null
  rejectionReason?: string | null
}

// The default reward list and seedRedemptionItemsIfEmpty() are gone.
//
// It ran on every mount of /admin/loyalty/redemption-items, read the
// collection to find it non-empty, and did nothing — a wasted query on every
// page load for a branch that could only ever fire on a brand-new project.
//
// It was also a second copy of the starter catalogue: npm run seed:demo
// already writes these five rewards. Worse, on a REAL installation it would
// quietly insert "Free burger" into a café's loyalty programme the first time
// a manager opened the page. An empty catalogue that staff fill in is the
// honest starting state.

// activeOnly=true for the customer redeem page, false for manager item
// management (which needs to see inactive items too).
export function useRedemptionItems(activeOnly: boolean) {
  const [items, setItems] = useState<RedemptionItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const base = collection(db, 'redemptionItems')
    const q = activeOnly
      ? query(base, where('isActive', '==', true), orderBy('coinCost', 'asc'))
      : query(base, orderBy('coinCost', 'asc'))
    const unsub = onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as RedemptionItem)))
      setLoading(false)
    }, err => console.error('[useRedemptionItems] redemptionItems listener failed:', err))
    return unsub
  }, [activeOnly])

  return { items, loading }
}

/**
 * The staff-managed reward catalogue.
 *
 * These all POST/PATCH/DELETE /api/admin/loyalty/catalogue rather than writing
 * Firestore directly. coinCost decides what a free burger costs in points, and
 * a browser that can write it can write 1 — the same reason approvals and
 * confirmations moved server-side in Phase 00. The catalogue those operate on
 * had stayed behind.
 *
 * hasPendingRedemptions() below is kept for the confirmation prompt, so the
 * manager is told BEFORE they press delete rather than after. It is no longer
 * the thing that prevents the delete: the route re-checks and refuses with a
 * 409, so the answer is the same however the delete is reached.
 */
export async function createRedemptionItem(input: {
  name: string
  description: string
  coinCost: number
  isActive: boolean
}): Promise<void> {
  await unwrap(await authedFetch('/api/admin/loyalty/catalogue', 'POST', { kind: 'reward', ...input }))
}

export async function updateRedemptionItem(id: string, input: {
  name: string
  description: string
  coinCost: number
  isActive: boolean
}): Promise<void> {
  await unwrap(await authedFetch('/api/admin/loyalty/catalogue', 'PATCH', { kind: 'reward', id, ...input }))
}

export async function toggleItemActive(id: string, isActive: boolean): Promise<void> {
  await unwrap(await authedFetch('/api/admin/loyalty/catalogue', 'PATCH', {
    kind: 'reward', action: 'toggle', id, isActive,
  }))
}

// Existing redemption requests keep their own snapshot of name/description/
// coinCost, so deleting the source item never affects them — this check is
// purely to stop a manager deleting an item a customer is mid-way through
// claiming in person. The route enforces it; this is for the warning.
export async function hasPendingRedemptions(itemId: string): Promise<boolean> {
  const snap = await getDocs(
    query(collection(db, 'redemptions'), where('itemId', '==', itemId), where('status', '==', 'pending'), limit(1))
  )
  return !snap.empty
}

export async function deleteRedemptionItem(id: string): Promise<void> {
  await unwrap(await authedFetch(`/api/admin/loyalty/catalogue?kind=reward&id=${encodeURIComponent(id)}`, 'DELETE'))
}

export async function createRedemptionRequest(input: {
  userId: string
  item: RedemptionItem
  branchId: string
}): Promise<void> {
  await addDoc(collection(db, 'redemptions'), {
    userId: input.userId,
    itemId: input.item.id,
    itemName: input.item.name,
    itemDescription: input.item.description,
    coinCost: input.item.coinCost,
    status: 'pending',
    branchId: input.branchId,
    requestedBy: input.userId,
    confirmedBy: null,
    createdAt: serverTimestamp(),
    confirmedAt: null,
    rejectedAt: null,
    rejectionReason: null,
  })
}

// Customer's own redemption history, all statuses, newest first.
export function useUserRedemptions(uid: string | null) {
  const [redemptions, setRedemptions] = useState<Redemption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) { setRedemptions([]); setLoading(false); return }
    setLoading(true)
    const q = query(collection(db, 'redemptions'), where('userId', '==', uid), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, snap => {
      setRedemptions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Redemption)))
      setLoading(false)
    })
    return unsub
  }, [uid])

  return { redemptions, loading }
}

// Manager queue — pending redemptions for one or more branches (a manager
// may now be assigned multiple), or 'all' for admin oversight. The caller
// must memoize any array it passes in — a fresh array reference on every
// render would re-subscribe this effect in a loop.
export function usePendingRedemptions(branchFilter: string[] | 'all' | null) {
  const [redemptions, setRedemptions] = useState<Redemption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!branchFilter || (Array.isArray(branchFilter) && branchFilter.length === 0)) {
      setRedemptions([]); setLoading(false); return
    }
    setLoading(true)
    const base = collection(db, 'redemptions')
    const q = branchFilter === 'all'
      ? query(base, where('status', '==', 'pending'), orderBy('createdAt', 'asc'))
      : query(base, where('branchId', 'in', branchFilter), where('status', '==', 'pending'), orderBy('createdAt', 'asc'))
    const unsub = onSnapshot(q, snap => {
      setRedemptions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Redemption)))
      setLoading(false)
    })
    return unsub
  }, [branchFilter])

  return { redemptions, loading }
}

// Confirming and rejecting both run SERVER-SIDE now (Phase 00 standing rule).
//
// The browser used to read the customer's balance, subtract the cost, and
// write the remainder — so the browser supplied the resulting figure, and no
// Firestore rule can check subtraction. The sufficiency check had the same
// race as the credit path in loyalty.ts: two confirmations at once both saw
// enough balance, and one deduction was lost.
//
// app/lib/server/loyalty.ts takes the cost from the stored redemption,
// re-checks the balance INSIDE the transaction, and deducts with an atomic
// increment. `managerUid` is gone — the server reads the actor from the token.
async function resolve(redemption: Redemption, action: 'approve' | 'reject', reason?: string): Promise<void> {
  const res = await authedFetch('/api/admin/loyalty/redemptions', 'PATCH', {
    id: redemption.id, action, reason,
  })
  await unwrap(res)
}

export async function confirmRedemption(redemption: Redemption): Promise<void> {
  await resolve(redemption, 'approve')
}

export async function rejectRedemption(redemption: Redemption, reason: string): Promise<void> {
  await resolve(redemption, 'reject', reason)
}

// Customer-initiated — withdrawing their own request before staff act on
// it. Not logged via logUpdate: activityLog is staff-write-only (see
// firestore.rules), and this isn't a staff action — the redemption's own
// status change is the record.
export async function cancelRedemption(redemption: Redemption): Promise<void> {
  await updateDoc(doc(db, 'redemptions', redemption.id), { status: 'cancelled' })
}
