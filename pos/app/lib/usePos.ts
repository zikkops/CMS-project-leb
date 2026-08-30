'use client'

// Live data for the POS, and the calls that change it.
//
// Lives in the POS app rather than in shared because only the POS reads it.
// shared/ is for what more than one app needs; putting POS-only hooks there
// would make every other app compile them for nothing.
//
// ── Every listener is scoped, and that is load-bearing ─────────────────────
// Firestore bills one read per document delivered to a listener. A phone
// watching ALL checks rather than the open ones at its branch reads every
// check ever written on first load — about ten thousand documents after a
// year — and six devices reloading one morning is sixty thousand reads before
// anybody takes an order.
//
// So: branch AND status on every check query, station AND active-status on
// every ticket query. Never a bare collection(). If a query here ever loses
// its where() clauses, the bill is the symptom and it will not look like a
// code change caused it.

import { useEffect, useState } from 'react'
import {
  collection, doc, limit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from '@big-cms/shared/firebase'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import type { Check, Station } from '@big-cms/shared/checks'
import { ACTIVE_TICKET_STATUSES, type Ticket } from '@big-cms/shared/tickets'
import { effectivePrice, saleIsActive } from '@big-cms/shared/productPricing'

// ── Listener failures are surfaced, not swallowed ─────────────────────────
// These used to end in `() => setLoading(false)`, which turned a
// permission-denied into an empty list. A waiter then saw "no tables open" on
// a floor with six tables open, and there was nothing anywhere — no toast, no
// console line they would look at — to say the read had been refused rather
// than returning nothing.
//
// The commonest cause is the rules for a new collection not being deployed
// yet, which produces exactly that: a working app, a correct query, and
// silence. So the message names it.
/**
 * Whether Firebase has finished working out who is signed in.
 *
 * Every listener below waits for this. Without it they subscribe on the first
 * render, before auth has resolved, and Firestore correctly refuses an
 * anonymous read — which then surfaced as "the rules may not be live yet" to
 * somebody whose only problem was that the page had not finished loading.
 * Alarming, and wrong.
 *
 * onAuthStateChanged fires once with the restored user (or null), which is the
 * only reliable "auth has settled" signal the SDK gives. Reading
 * auth.currentUser directly does not work: it is null during that first tick
 * whether or not anybody is signed in.
 */
function useAuthReady(): { ready: boolean; signedIn: boolean } {
  const [state, setState] = useState({ ready: false, signedIn: false })
  useEffect(() => onAuthStateChanged(auth, user => {
    setState({ ready: true, signedIn: Boolean(user) })
  }), [])
  return state
}

function listenerMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? ''
  if (code === 'permission-denied') {
    return 'Not allowed to read this. If the POS was deployed recently, the Firestore rules for it may not be live yet.'
  }
  if (code === 'failed-precondition') {
    return 'This query needs a Firestore index that does not exist yet — the console link is in the browser log.'
  }
  return 'Lost connection to the live data. Showing the last known state.'
}

// ── Reads ─────────────────────────────────────────────────────────────────

/** Open checks at one branch. Scoped — see the note above. */
export function useOpenChecks(branch: string): {
  checks: Check[]; loading: boolean; error: string
} {
  const [checks, setChecks] = useState<Check[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const { ready, signedIn } = useAuthReady()

  useEffect(() => {
    if (!branch || !ready) return
    // Signed out is not an error, it is a redirect already in flight.
    const q = query(
      collection(db, 'checks'),
      where('branch', '==', branch),
      where('status', '==', 'open'),
    )
    return onSnapshot(q,
      snap => {
        setChecks(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Check))
        setLoaded(true)
        setError('')
      },
      err => {
        // A dropped listener must not blank the floor mid-service — offline
        // persistence keeps serving the last known state — but it must say so.
        console.error('[useOpenChecks] listener failed:', err)
        setError(listenerMessage(err))
        setLoaded(true)
      },
    )
  }, [branch, ready, signedIn])

  return { checks, loading: !ready || (signedIn && !loaded), error }
}

/** One check, live — a second waiter adding to the same table shows up here. */
export function useCheck(checkId: string): {
  check: Check | null; loading: boolean; error: string
} {
  const [check, setCheck] = useState<Check | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const { ready, signedIn } = useAuthReady()

  useEffect(() => {
    if (!checkId || !ready) return
    return onSnapshot(doc(db, 'checks', checkId),
      snap => {
        setCheck(snap.exists() ? ({ id: snap.id, ...snap.data() } as Check) : null)
        setLoaded(true)
        setError('')
      },
      err => {
        console.error('[useCheck] listener failed:', err)
        setError(listenerMessage(err))
        setLoaded(true)
      },
    )
  }, [checkId, ready, signedIn])

  return { check, loading: !ready || (signedIn && !loaded), error }
}

/**
 * Tickets still on a pass. Bumped ones are gone, which is the point.
 *
 * A null station means every pass on one screen. Small cafés have one monitor
 * for the whole kitchen, and making them choose a station they do not have is
 * how a screen ends up showing a third of the orders.
 */
export function useStationTickets(branch: string, station: Station | null): {
  tickets: Ticket[]; loading: boolean; error: string
} {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const { ready, signedIn } = useAuthReady()

  useEffect(() => {
    if (!branch || !ready) return
    const q = station
      ? query(
          collection(db, 'kitchenTickets'),
          where('branch', '==', branch),
          where('station', '==', station),
          where('status', 'in', ACTIVE_TICKET_STATUSES),
          orderBy('sentAt', 'asc'),
        )
      : query(
          collection(db, 'kitchenTickets'),
          where('branch', '==', branch),
          where('status', 'in', ACTIVE_TICKET_STATUSES),
          orderBy('sentAt', 'asc'),
        )
    return onSnapshot(q,
      snap => {
        setTickets(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Ticket))
        setLoaded(true)
        setError('')
      },
      err => {
        console.error('[useStationTickets] listener failed:', err)
        setError(listenerMessage(err))
        setLoaded(true)
      },
    )
  }, [branch, station, ready, signedIn])

  return { tickets, loading: !ready || (signedIn && !loaded), error }
}

/**
 * Checks closed at this branch, newest first.
 *
 * A closed check used to vanish — the table went free and nothing anywhere
 * showed what had gone through it. That is survivable for one table and not
 * survivable for a service: the first question after a busy Friday is "what
 * did we actually send", and the answer was nowhere.
 *
 * Capped rather than open-ended. This is a review screen, not an accounting
 * export, and a query that grows all year is one that eventually costs a
 * thousand reads to open.
 */
export function useClosedChecks(branch: string, max = 50): {
  checks: Check[]; loading: boolean; error: string
} {
  const [checks, setChecks] = useState<Check[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const { ready, signedIn } = useAuthReady()

  useEffect(() => {
    if (!branch || !ready) return
    const q = query(
      collection(db, 'checks'),
      where('branch', '==', branch),
      // Refunded checks stay in the list. A refund that disappears from the
      // review screen is a refund nobody can find afterwards, which defeats
      // the point of recording one.
      where('status', 'in', ['closed', 'refunded']),
      orderBy('closedAt', 'desc'),
      limit(max),
    )
    return onSnapshot(q,
      snap => {
        setChecks(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Check))
        setLoaded(true)
        setError('')
      },
      err => {
        console.error('[useClosedChecks] listener failed:', err)
        setError(listenerMessage(err))
        setLoaded(true)
      },
    )
  }, [branch, ready, signedIn, max])

  return { checks, loading: !ready || (signedIn && !loaded), error }
}

// ── The menu a waiter orders from ─────────────────────────────────────────

export interface PosMenuItem {
  id: string
  name: string
  price: number
  categoryId: string
  categoryName: string
  section: string
  available: boolean
  modifierGroupIds: string[]
}

export interface PosMenu {
  items: PosMenuItem[]
  categories: { id: string; name: string; section: string }[]
  groups: Record<string, import('@big-cms/shared/modifiers').ModifierGroup>
  loading: boolean
}

/**
 * The whole menu, once.
 *
 * Read in full rather than per category: a café menu is a few hundred
 * documents, a waiter needs all of it within two taps, and offline
 * persistence serves it from cache after the first load. Fetching per
 * category would be a network round trip between every tap.
 */
export function usePosMenu(): PosMenu {
  const { ready } = useAuthReady()
  const [items, setItems] = useState<PosMenuItem[]>([])
  const [categories, setCategories] = useState<PosMenu['categories']>([])
  const [groups, setGroups] = useState<PosMenu['groups']>({})
  const [loaded, setLoaded] = useState({ items: false, cats: false, groups: false })

  useEffect(() => {
    if (!ready) return
    const unsubs = [
      onSnapshot(collection(db, 'menuCategories'), snap => {
        setCategories(snap.docs.map(d => ({
          id: d.id,
          name: String(d.data().name ?? ''),
          section: String(d.data().section ?? ''),
        })))
        setLoaded(l => ({ ...l, cats: true }))
      }, () => setLoaded(l => ({ ...l, cats: true }))),

      onSnapshot(collection(db, 'menuItems'), snap => {
        setItems(snap.docs.map(d => {
          const data = d.data()
          return {
            id: d.id,
            name: String(data.name ?? ''),
            price: Number(data.price ?? 0),
            categoryId: String(data.categoryId ?? ''),
            categoryName: '',
            section: '',
            available: data.available !== false,
            modifierGroupIds: Array.isArray(data.modifierGroupIds)
              ? data.modifierGroupIds as string[] : [],
          }
        }))
        setLoaded(l => ({ ...l, items: true }))
      }, () => setLoaded(l => ({ ...l, items: true }))),

      onSnapshot(collection(db, 'modifierGroups'), snap => {
        const next: PosMenu['groups'] = {}
        snap.docs.forEach(d => { next[d.id] = { id: d.id, ...d.data() } as PosMenu['groups'][string] })
        setGroups(next)
        setLoaded(l => ({ ...l, groups: true }))
      }, () => setLoaded(l => ({ ...l, groups: true }))),
    ]
    return () => unsubs.forEach(u => u())
  }, [ready])

  // Joined here rather than stored on the item: the category is what decides
  // the station, and denormalising it onto every item would mean rewriting
  // every item when a category moves section.
  const byCategory = new Map(categories.map(c => [c.id, c]))
  const joined = items.map(i => ({
    ...i,
    categoryName: byCategory.get(i.categoryId)?.name ?? '',
    section: byCategory.get(i.categoryId)?.section ?? '',
  }))

  return {
    items: joined,
    categories,
    groups,
    loading: !(loaded.items && loaded.cats && loaded.groups),
  }
}

// ── Merchandise ───────────────────────────────────────────────────────────

export interface PosProduct {
  id: string
  name: string
  /** Sale price when one is running — what the shelf says. */
  price: number
  onSale: boolean
  /** At this branch. May be negative if a count is behind. */
  stock: number
}

/**
 * The retail catalogue, priced and stocked for one branch.
 *
 * The differentiator: a cappuccino and a board game on one check. This is the
 * half the POS needs — the other half is source: 'product' on the line, which
 * tells the server to take it off product stock rather than treat it as food.
 *
 * effectivePrice, not price: a product on sale rings up at the sale price, and
 * a till showing more than the shelf is the kind of thing a customer notices
 * at the counter.
 */
export function useRetailProducts(branch: string): { products: PosProduct[]; loading: boolean } {
  const [products, setProducts] = useState<PosProduct[]>([])
  const [loaded, setLoaded] = useState(false)
  const { ready } = useAuthReady()

  useEffect(() => {
    if (!ready) return
    return onSnapshot(collection(db, 'products'),
      snap => {
        setProducts(snap.docs.map(d => {
          const data = d.data()
          const priced = {
            price: Number(data.price ?? 0),
            salePrice: data.salePrice == null ? null : Number(data.salePrice),
            saleEndsAt: data.saleEndsAt == null ? null : String(data.saleEndsAt),
          }
          const stock = data.stock && typeof data.stock === 'object'
            ? Number((data.stock as Record<string, unknown>)[branch] ?? 0)
            : 0
          return {
            id: d.id,
            name: String(data.name ?? ''),
            price: effectivePrice(priced),
            onSale: saleIsActive(priced),
            stock: Number.isFinite(stock) ? stock : 0,
          }
        }).sort((a, b) => a.name.localeCompare(b.name)))
        setLoaded(true)
      },
      err => { console.error('[useRetailProducts] listener failed:', err); setLoaded(true) },
    )
  }, [ready, branch])

  return { products, loading: !ready || !loaded }
}

// ── Writes — all through the route, none direct ───────────────────────────

export interface DraftLine {
  source: 'menu' | 'product'
  refId: string
  /** Display only. The server prices from refId; this never leaves the phone
   *  as anything the server trusts. */
  name: string
  unitPrice: number
  quantity: number
  modifierOptionIds: string[]
  modifierLabel: string
  seat: number | null
  course: number | null
  note: string
}

export async function openCheck(
  branch: string, tableNumber: number, guestCount: number,
): Promise<string> {
  const data = await unwrap(await authedFetch('/api/pos/checks', 'POST',
    { branch, tableNumber, guestCount }))
  return String(data.id ?? '')
}

/**
 * Commits the local draft.
 *
 * Called once per Send, not once per tap. Writing each line as the waiter
 * types it costs a write per line AND pushes every one of them to every
 * listening device — about 216 writes and eight hundred delivered reads a day
 * at one branch, for nothing anybody sees. The draft lives in local state
 * until Send, which offline persistence keeps across a reload.
 */
export async function addLines(checkId: string, lines: DraftLine[]): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'POST', {
    checkId,
    lines: lines.map(l => ({
      source: l.source,
      refId: l.refId,
      quantity: l.quantity,
      modifierOptionIds: l.modifierOptionIds,
      seat: l.seat,
      course: l.course,
      note: l.note,
    })),
  }))
}

export async function sendCheck(checkId: string): Promise<{ station: string; lines: number }[]> {
  const data = await unwrap(await authedFetch('/api/pos/checks', 'PATCH', { checkId, action: 'send' }))
  return (data.tickets ?? []) as { station: string; lines: number }[]
}

export async function voidLine(checkId: string, lineId: string, reason: string): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'PATCH',
    { checkId, action: 'void', lineId, reason }))
}

export async function moveCheck(checkId: string, tableNumber: number): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'PATCH', { checkId, action: 'move', tableNumber }))
}

export async function setStaffMeal(checkId: string, on: boolean): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'PATCH', { checkId, action: 'staffMeal', on }))
}

export async function refundCheck(checkId: string, reason: string): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'PATCH', { checkId, action: 'refund', reason }))
}

export async function closeCheck(checkId: string): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'PATCH', { checkId, action: 'close' }))
}

export async function advanceTicket(ticketId: string, status: string): Promise<void> {
  await unwrap(await authedFetch('/api/pos/tickets', 'PATCH', { ticketId, status }))
}
