'use client'

import { useEffect, useState } from 'react'
import {
  collection, query, where, orderBy, limit, onSnapshot, doc, getDoc, getDocs,
  addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { logCreate, logUpdate, logDelete } from './activityLog'

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

export const DEFAULT_REDEMPTION_ITEMS: { name: string; description: string; coinCost: number }[] = [
  { name: 'Free coffee', description: 'Any hot or cold coffee from our menu', coinCost: 100 },
  { name: 'Free drink (any menu item)', description: 'Any drink from our full menu', coinCost: 150 },
  { name: 'Free burger', description: 'One burger of your choice', coinCost: 300 },
  { name: 'Event ticket (1 person)', description: 'Entry to any upcoming Onboard event', coinCost: 200 },
  { name: 'Reserved table for four', description: 'A table held for you and three guests at any branch', coinCost: 500 },
]

// Idempotent — only seeds if the collection is genuinely empty. Same
// check-then-create pattern as the adminUsers bootstrap in adminAuth.ts;
// same small accepted race window (two clients seeding at the exact same
// instant the collection is first ever empty), which is a one-time,
// low-stakes edge case there too.
export async function seedRedemptionItemsIfEmpty(createdBy: string): Promise<void> {
  const snap = await getDocs(query(collection(db, 'redemptionItems'), limit(1)))
  if (!snap.empty) return

  await Promise.all(DEFAULT_REDEMPTION_ITEMS.map(item =>
    addDoc(collection(db, 'redemptionItems'), {
      ...item,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy,
    })
  ))
}

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

export async function createRedemptionItem(input: {
  name: string
  description: string
  coinCost: number
  isActive: boolean
  createdBy: string
}): Promise<void> {
  await addDoc(collection(db, 'redemptionItems'), {
    name: input.name.trim(),
    description: input.description.trim(),
    coinCost: input.coinCost,
    isActive: input.isActive,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: input.createdBy,
  })
  await logCreate('Loyalty Management', `Redemption item — ${input.name.trim()}`, {
    description: input.description.trim(),
    coinCost: input.coinCost,
    isActive: input.isActive,
  })
}

export async function updateRedemptionItem(id: string, input: {
  name: string
  description: string
  coinCost: number
  isActive: boolean
}): Promise<void> {
  const ref = doc(db, 'redemptionItems', id)
  const before = (await getDoc(ref)).data() as { name?: string; description?: string; coinCost?: number; isActive?: boolean } | undefined

  await updateDoc(ref, {
    name: input.name.trim(),
    description: input.description.trim(),
    coinCost: input.coinCost,
    isActive: input.isActive,
    updatedAt: serverTimestamp(),
  })

  await logUpdate(
    'Loyalty Management',
    `Redemption item — ${input.name.trim()}`,
    before ?? {},
    { name: input.name.trim(), description: input.description.trim(), coinCost: input.coinCost, isActive: input.isActive }
  )
}

export async function toggleItemActive(id: string, isActive: boolean): Promise<void> {
  const ref = doc(db, 'redemptionItems', id)
  const before = (await getDoc(ref)).data() as { name?: string; isActive?: boolean } | undefined

  await updateDoc(ref, { isActive, updatedAt: serverTimestamp() })

  await logUpdate(
    'Loyalty Management',
    `Redemption item — ${before?.name ?? id}`,
    { isActive: before?.isActive ?? null },
    { isActive }
  )
}

// Existing redemption requests keep their own snapshot of name/description/
// coinCost, so deleting the source item never affects them — this check is
// purely to stop a manager from deleting an item that a customer is mid-way
// through claiming in person.
export async function hasPendingRedemptions(itemId: string): Promise<boolean> {
  const snap = await getDocs(
    query(collection(db, 'redemptions'), where('itemId', '==', itemId), where('status', '==', 'pending'), limit(1))
  )
  return !snap.empty
}

export async function deleteRedemptionItem(id: string): Promise<void> {
  const ref = doc(db, 'redemptionItems', id)
  const before = (await getDoc(ref)).data() as { name?: string; description?: string; coinCost?: number } | undefined

  await deleteDoc(ref)

  await logDelete('Loyalty Management', `Redemption item — ${before?.name ?? id}`, before)
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

// Throws if the customer's balance is somehow insufficient by the time this
// runs (e.g. spent elsewhere between request and confirmation) — caller
// shows that as an error rather than silently deducting into the negative.
export async function confirmRedemption(redemption: Redemption, managerUid: string): Promise<void> {
  const userRef = doc(db, 'users', redemption.userId)
  const userSnap = await getDoc(userRef)
  if (!userSnap.exists()) throw new Error('user-not-found')

  const currentCoins = (userSnap.data().obCoins as number) ?? 0
  if (currentCoins < redemption.coinCost) throw new Error('insufficient-coins')

  const batch = writeBatch(db)

  batch.update(userRef, { obCoins: currentCoins - redemption.coinCost })

  batch.update(doc(db, 'redemptions', redemption.id), {
    status: 'redeemed',
    confirmedBy: managerUid,
    confirmedAt: serverTimestamp(),
  })

  batch.set(doc(collection(db, 'transactionLog')), {
    type: 'redemption',
    action: 'confirmed',
    redemptionId: redemption.id,
    userId: redemption.userId,
    itemId: redemption.itemId,
    itemName: redemption.itemName,
    coinCost: redemption.coinCost,
    performedBy: managerUid,
    branchId: redemption.branchId,
    createdAt: serverTimestamp(),
  })

  await batch.commit()
  await logUpdate('Loyalty Management', `Redemption — ${redemption.itemName}`, { status: 'pending' }, { status: 'redeemed' })
}

export async function rejectRedemption(redemption: Redemption, managerUid: string, reason: string): Promise<void> {
  const batch = writeBatch(db)

  batch.update(doc(db, 'redemptions', redemption.id), {
    status: 'rejected',
    rejectedAt: serverTimestamp(),
    rejectionReason: reason || null,
  })

  batch.set(doc(collection(db, 'transactionLog')), {
    type: 'redemption',
    action: 'rejected',
    redemptionId: redemption.id,
    userId: redemption.userId,
    itemId: redemption.itemId,
    itemName: redemption.itemName,
    coinCost: redemption.coinCost,
    performedBy: managerUid,
    branchId: redemption.branchId,
    createdAt: serverTimestamp(),
  })

  await batch.commit()
  await logUpdate('Loyalty Management', `Redemption — ${redemption.itemName}`, { status: 'pending' }, { status: 'rejected', rejectionReason: reason })
}

// Customer-initiated — withdrawing their own request before staff act on
// it. Not logged via logUpdate: activityLog is staff-write-only (see
// firestore.rules), and this isn't a staff action — the redemption's own
// status change is the record.
export async function cancelRedemption(redemption: Redemption): Promise<void> {
  await updateDoc(doc(db, 'redemptions', redemption.id), { status: 'cancelled' })
}
