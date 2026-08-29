'use client'

// Wholesale accounts — shops that buy from us at wholesale prices, as opposed
// to `orderProviders`, which are the suppliers we buy FROM.
// The two are unrelated despite both being called "providers" in conversation.
//
// A wholesale account is a users/{uid} doc with `isWholesale: true` — the same
// unified collection staff and customers already share. It carries no `role`,
// so nothing in adminAuth.ts's SECTION_ACCESS ever matches it and a wholesale
// account can never reach /admin/**.

import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, type Timestamp,
} from 'firebase/firestore'
import { auth, db } from './firebase'

// Where approved wholesale orders are sent. Set
// NEXT_PUBLIC_WHOLESALE_ORDERS_EMAIL to change it without touching code — the
// fallback is only a starting point, not a permanent address.
export const WHOLESALE_ORDERS_EMAIL =
  process.env.NEXT_PUBLIC_WHOLESALE_ORDERS_EMAIL || 'markzakkak@gmail.com'

export const WHOLESALE_ORDER_STATUSES = ['pending', 'approved', 'rejected', 'fulfilled'] as const
export type WholesaleOrderStatus = typeof WHOLESALE_ORDER_STATUSES[number]

export const STATUS_COLOR: Record<WholesaleOrderStatus, string> = {
  pending:   '#C9962C',
  approved:  '#00A098',
  rejected:  '#E43329',
  fulfilled: '#8B7CF6',
}

export interface WholesaleAccount {
  uid:        string
  email:      string
  shopName:   string
  contactName: string
  phone:      string
  active:     boolean
}

export interface WholesaleOrderItem {
  gameId:    string
  name:      string
  unitPrice: number
  quantity:  number
  // Stamped on the order line at checkout so the invoice can print it without
  // re-reading the game. Optional: orders placed before SKUs existed have none.
  sku?:      string
}

export interface WholesaleOrder {
  id:              string
  accountUid:      string
  accountEmail:    string
  shopName:        string
  items:           WholesaleOrderItem[]
  totalUsd:        number
  itemCount:       number
  status:          WholesaleOrderStatus
  notes:           string
  createdAt:       Timestamp | null
  decidedBy:       string
  decidedByEmail:  string
  decidedAt:       Timestamp | null
  emailedAt:       Timestamp | null
  // Set once an invoice has been generated for this order. invoiceUrl is a
  // durable imgbb link, so the shop can re-download it any time.
  invoiceNumber?:  string
  invoiceUrl?:     string
  invoicedAt?:     Timestamp | null
  // Why a notification didn't go out, when one didn't.
  emailError?:     string
}

export function orderTotal(items: WholesaleOrderItem[]): number {
  // Rounded to cents on the way out — floating-point unit prices otherwise
  // surface as 41.900000000000006 in the order total and the emailed summary.
  const raw = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
  return Math.round(raw * 100) / 100
}

export function orderItemCount(items: WholesaleOrderItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0)
}

// Resolves the signed-in user to a wholesale account, or null if they're a
// customer / staff member / signed out. `loading` stays true until we know,
// so a gated page never flashes its contents before the check completes.
export function useWholesaleAccount() {
  const [user, setUser]       = useState<User | null>(null)
  const [account, setAccount] = useState<WholesaleAccount | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async u => {
      setUser(u)
      if (!u) { setAccount(null); setLoading(false); return }
      try {
        const snap = await getDoc(doc(db, 'users', u.uid))
        const data = snap.exists() ? snap.data() : null
        if (data?.isWholesale === true && data?.wholesaleActive !== false) {
          setAccount({
            uid:         u.uid,
            email:       (data.email as string) ?? u.email ?? '',
            shopName:    (data.shopName as string) ?? '',
            contactName: (data.contactName as string) ?? '',
            phone:       (data.phone as string) ?? '',
            active:      data.wholesaleActive !== false,
          })
        } else {
          setAccount(null)
        }
      } catch {
        // A permission error here means "not a wholesale account" as far as
        // the UI is concerned — fail closed rather than showing prices.
        setAccount(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  return { user, account, loading }
}

// NOTE ON WHERE PRICES LIVE
// wholesalePrice stays on the games/{id} doc, which is `allow read: if true`.
// So the gating below is a UI boundary, not a data boundary: only wholesale
// accounts are SHOWN prices, but anyone who reads the games collection
// directly through the SDK can still see them. Closing that would mean moving
// the field into its own collection — a deliberate decision not to, taken
// 27 Aug 2026. See [[Wholesale]] in the vault.

export interface SubmitResult {
  id: string
  totalUsd: number
  itemCount: number
  // False when the order saved but the notification email didn't go out —
  // the caller should still treat the order as placed.
  emailed: boolean
  emailConfigured: boolean
}

// Goes through /api/wholesale/orders rather than writing with the client SDK.
// The route re-prices every line from Firestore (so the browser can't dictate
// a price) and sends the notification email, which needs a key the browser
// must never hold.
export async function submitWholesaleOrder(
  account: WholesaleAccount,
  items: WholesaleOrderItem[],
  notes: string,
  invoice?: { invoiceNumber: string; invoiceUrl: string },
): Promise<SubmitResult> {
  const clean = items.filter(i => i.quantity > 0)
  if (clean.length === 0) throw new Error('No items in the order.')

  const idToken = await auth.currentUser?.getIdToken()
  const res = await fetch('/api/wholesale/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      // Only ids and quantities are sent — prices come from the server.
      items: clean.map(i => ({ gameId: i.gameId, quantity: i.quantity })),
      notes,
      ...(invoice ?? {}),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Could not submit the order.')
  return data as SubmitResult
}

// A wholesale account may only ever query its own orders — the rule requires
// this exact accountUid filter, so dropping it fails the read rather than
// leaking another shop's orders.
export async function listMyWholesaleOrders(uid: string): Promise<WholesaleOrder[]> {
  const snap = await getDocs(query(
    collection(db, 'wholesaleOrders'),
    where('accountUid', '==', uid),
    orderBy('createdAt', 'desc'),
  ))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as WholesaleOrder)
}
