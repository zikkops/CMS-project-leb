// Firestore read helpers for goods receiving, plus a client-side saver.
//
// The types and every calculation live in ./deliveryMath, which imports
// nothing from Firebase — see the note at the top of that file for why. This
// module re-exports all of it, so `from './deliveries'` keeps working
// everywhere and there's one import path to remember.
//
// WRITES DO NOT HAPPEN HERE. Posting a delivery moves stock and sets purchase
// cost inside one Admin SDK transaction; saveDelivery() below just calls that
// route. firestore.rules denies client writes to `deliveries` outright.

import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit,
} from 'firebase/firestore'
import { db, auth } from './firebase'
import type { Delivery } from './deliveryMath'

export * from './deliveryMath'

// ── Reads ────────────────────────────────────────────────────────────
export async function getDelivery(id: string): Promise<Delivery | null> {
  const snap = await getDoc(doc(db, 'deliveries', id))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Delivery) : null
}

export async function listDeliveries(
  branch: string | 'all',
  limitCount = 50,
): Promise<Delivery[]> {
  const col = collection(db, 'deliveries')
  // Single equality filter plus one orderBy — the same shape
  // listDailyInventories uses, and for the same reason: it avoids needing a
  // composite index for the common case.
  const q = branch === 'all'
    ? query(col, orderBy('deliveredAt', 'desc'), limit(limitCount))
    : query(col, where('branch', '==', branch), orderBy('deliveredAt', 'desc'), limit(limitCount))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Delivery)
}

// Every delivery booked against one weekly order. Suppliers split shipments,
// so an order legitimately has several — which is why this returns a list and
// why the fulfilment bar on an order is a sum, not a boolean.
export async function listDeliveriesForOrder(orderReportId: string): Promise<Delivery[]> {
  const snap = await getDocs(
    query(collection(db, 'deliveries'), where('orderReportId', '==', orderReportId))
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Delivery)
}


// ── Saving ─────────────────────────────────────────────────────────────────
// Calls the server route. Everything that matters — validating the lines,
// recomputing every total, moving stock, maintaining weighted average cost —
// happens there, inside one transaction. This is a transport function.

export interface SaveResult {
  id: string
  // Set when the delivery saved but some lines could not move stock, because
  // the supply behind them no longer exists. Show it — silence here surfaces
  // weeks later as unexplained shrinkage at a count.
  warning?: string
}

export async function saveDelivery(
  payload: Record<string, unknown>,
  existingId?: string,
): Promise<SaveResult> {
  const user = auth.currentUser
  if (!user) throw new Error('Session expired — please sign in again.')
  const token = await user.getIdToken()

  const res = await fetch('/api/admin/deliveries', {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(existingId ? { ...payload, id: existingId } : payload),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'Could not save the delivery. Please try again.'
    )
  }
  return data as SaveResult
}
