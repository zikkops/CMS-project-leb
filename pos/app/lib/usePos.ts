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
  collection, doc, limit, onSnapshot, orderBy, query, where, Timestamp,
} from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from '@big-cms/shared/firebase'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import type { Check, Station } from '@big-cms/shared/checks'
import type { PaymentRequest } from '@big-cms/shared/payments'
import type { DenomCount, DrawerTotals, Money2 } from '@big-cms/shared/drawer'
import { ACTIVE_TICKET_STATUSES, type Ticket } from '@big-cms/shared/tickets'
import { effectivePrice, saleIsActive } from '@big-cms/shared/productPricing'
import { timestampMs } from '@big-cms/shared/timestamps'
import { nextReceiptBatch, EMPTY_RECEIPT_STATE, type ReceiptDoc } from './printBatch'

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
export function useAuthReady(): { ready: boolean; signedIn: boolean } {
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
    if (!branch || !ready || !signedIn) return
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
    if (!checkId || !ready || !signedIn) return
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
  // Keyed by what the listener is subscribed to, and read back only when the
  // key still matches. Switching station used to leave the previous station's
  // tickets in state — on screen, and handed to the auto-printer as though
  // they were the new pass — until the new snapshot landed, with `loading`
  // false the whole time. A stale list and "not loading" together are how
  // useAutoPrint came to see a bar pass's entire backlog as fresh.
  const [snapshot, setSnapshot] = useState<{ key: string; tickets: Ticket[]; error: string } | null>(null)
  const key = `${branch}|${station ?? '*'}`

  const { ready, signedIn } = useAuthReady()

  useEffect(() => {
    if (!branch || !ready || !signedIn) return
    const k = `${branch}|${station ?? '*'}`
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
        setSnapshot({ key: k, tickets: snap.docs.map(d => ({ id: d.id, ...d.data() }) as Ticket), error: '' })
      },
      err => {
        console.error('[useStationTickets] listener failed:', err)
        // Keep what this same subscription last showed: a dead listener with
        // an error banner over the last good list beats a blank pass. A list
        // from a different subscription is never kept.
        setSnapshot(prev => ({
          key: k,
          tickets: prev?.key === k ? prev.tickets : [],
          error: listenerMessage(err),
        }))
      },
    )
  }, [branch, station, ready, signedIn])

  const current = snapshot?.key === key ? snapshot : null
  return {
    tickets: current?.tickets ?? [],
    loading: !ready || (signedIn && current === null),
    error: current?.error ?? '',
  }
}

/**
 * Tickets the kitchen has marked ready and nobody has taken out — what pops up
 * on the counter and the floor (owner's decision, 14 Sep 2026).
 *
 * Served by the same composite index as the KDS "All stations" query
 * (branch, status, sentAt): an equality on status uses it as well as `in` does.
 */
export function useReadyTickets(branch: string): {
  tickets: Ticket[]; loading: boolean; error: string
} {
  const [snapshot, setSnapshot] = useState<{ branch: string; tickets: Ticket[]; error: string } | null>(null)
  const { ready, signedIn } = useAuthReady()

  useEffect(() => {
    if (!branch || !ready || !signedIn) return
    const q = query(
      collection(db, 'kitchenTickets'),
      where('branch', '==', branch),
      where('status', '==', 'ready'),
      orderBy('sentAt', 'asc'),
    )
    return onSnapshot(q,
      snap => {
        setSnapshot({ branch, tickets: snap.docs.map(d => ({ id: d.id, ...d.data() }) as Ticket), error: '' })
      },
      err => {
        console.error('[useReadyTickets] listener failed:', err)
        setSnapshot(prev => ({ branch, tickets: prev?.branch === branch ? prev.tickets : [], error: listenerMessage(err) }))
      },
    )
  }, [branch, ready, signedIn])

  const current = snapshot?.branch === branch ? snapshot : null
  return {
    tickets: current?.tickets ?? [],
    loading: !ready || (signedIn && current === null),
    error: current?.error ?? '',
  }
}

/** The front took a ready plate out. Clears it from the kitchen display too. */
export async function pickUpTicket(ticketId: string): Promise<{ already: boolean }> {
  const data = await unwrap(await authedFetch('/api/pos/tickets', 'PATCH',
    { ticketId, action: 'pickup' }, { timeoutMs: POS_TIMEOUT_MS }))
  return { already: data.already === true }
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
    if (!branch || !ready || !signedIn) return
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

/**
 * Checks closed (or refunded) at a branch since an instant — for the floor's
 * "closed today" reading.
 *
 * Not useClosedChecks(): that one is capped at 50 for a review screen, and a
 * reading built on a capped list undercounts a busy day without saying so.
 * This is bounded by TIME instead — the caller passes an instant a little
 * over a day back, and the page keeps only the café's today — so it reads a
 * day's checks and no more, on the same (branch, status, closedAt) index. A
 * hard ceiling still stands behind it, and `truncated` says when it was hit
 * rather than letting a figure come out quietly short.
 */
export function useChecksClosedSince(branch: string, sinceMs: number): {
  checks: Check[]; loading: boolean; error: string; truncated: boolean
} {
  const CEILING = 2000
  const [checks, setChecks] = useState<Check[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const { ready, signedIn } = useAuthReady()

  useEffect(() => {
    if (!branch || !ready || !signedIn || !Number.isFinite(sinceMs)) return
    const q = query(
      collection(db, 'checks'),
      where('branch', '==', branch),
      where('status', 'in', ['closed', 'refunded']),
      where('closedAt', '>=', Timestamp.fromMillis(sinceMs)),
      orderBy('closedAt', 'desc'),
      limit(CEILING),
    )
    return onSnapshot(q,
      snap => {
        setChecks(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Check))
        setLoaded(true)
        setError('')
      },
      err => {
        console.error('[useChecksClosedSince] listener failed:', err)
        setError(listenerMessage(err))
        setLoaded(true)
      },
    )
  }, [branch, ready, signedIn, sinceMs])

  return { checks, loading: !ready || (signedIn && !loaded), error, truncated: checks.length >= CEILING }
}

/**
 * Calls `onNew` with each check that closes while this is subscribed.
 *
 * A plain subscriber rather than a hook, on purpose. Render state was the
 * source of two bugs in the ticket printer — a list outliving the listener
 * that produced it, handed on as though it were current. Here the decision
 * state lives inside the subscription itself, so every subscribe starts clean
 * and there is no stale list for a reconnect or a toggle to replay.
 *
 * Firestore's docChanges() does the rest: the first snapshot's changes are
 * everything already closed, which nextReceiptBatch() absorbs as history.
 *
 * Limited to the newest ten — this watches for closings, it does not list
 * them — and served by the existing (branch, status, closedAt desc) index.
 */
export function watchClosedReceipts(
  branch: string,
  onNew: (checks: Check[]) => void,
  onError: (message: string) => void,
): () => void {
  let state = EMPTY_RECEIPT_STATE
  const q = query(
    collection(db, 'checks'),
    where('branch', '==', branch),
    where('status', '==', 'closed'),
    orderBy('closedAt', 'desc'),
    limit(10),
  )
  const toDoc = (id: string, data: Record<string, unknown>): ReceiptDoc => ({
    id,
    status: String(data.status ?? ''),
    // NaN while a server timestamp is unresolved; the decision waits for it.
    closedAtMs: timestampMs(data.closedAt, Number.NaN),
  })
  return onSnapshot(q,
    snap => {
      const docs = snap.docs.map(d => toDoc(d.id, d.data()))
      const changes = snap.docChanges()
        .filter(c => c.type !== 'removed')
        .map(c => toDoc(c.doc.id, c.doc.data()))
      const r = nextReceiptBatch(state, docs, changes)
      state = r.state
      if (r.print.length === 0) return
      const byId = new Map(snap.docs.map(d => [d.id, { id: d.id, ...d.data() } as Check]))
      const out = r.print.map(id => byId.get(id)).filter((c): c is Check => c !== undefined)
      if (out.length > 0) onNew(out)
    },
    err => {
      console.error('[watchClosedReceipts] listener failed:', err)
      onError(listenerMessage(err))
    },
  )
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
export async function addLines(checkId: string, lines: DraftLine[], batchKey: string): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'POST', {
    checkId,
    // The same key on every retry of this batch — the server skips a batch it
    // has already applied. See handleSend on the check page.
    batchKey,
    lines: lines.map(l => ({
      source: l.source,
      refId: l.refId,
      quantity: l.quantity,
      modifierOptionIds: l.modifierOptionIds,
      seat: l.seat,
      course: l.course,
      note: l.note,
    })),
  }, { timeoutMs: POS_TIMEOUT_MS }))
}

export async function sendCheck(checkId: string): Promise<{ station: string; lines: number }[]> {
  const data = await unwrap(await authedFetch('/api/pos/checks', 'PATCH',
    { checkId, action: 'send' }, { timeoutMs: POS_TIMEOUT_MS }))
  return (data.tickets ?? []) as { station: string; lines: number }[]
}

/**
 * How long an order call waits before saying so.
 *
 * Long enough for a slow connection to finish, short enough that a waiter is
 * not left staring at "Sending…" while a table waits. Retrying after it is
 * safe, which is the only reason a timeout is safe at all.
 */
const POS_TIMEOUT_MS = 15_000

export async function voidLine(
  checkId: string, lineId: string, reasonKey: string, note: string,
): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'PATCH',
    { checkId, action: 'void', lineId, reasonKey, note }))
}

export async function moveCheck(checkId: string, tableNumber: number): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'PATCH', { checkId, action: 'move', tableNumber }))
}

export async function setStaffMeal(checkId: string, on: boolean): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'PATCH', { checkId, action: 'staffMeal', on }))
}

/**
 * A refund follows its cause, like a void (owner's decision, 14 Sep 2026): the
 * reason decides what goes back on the shelf. `note` is required for Other.
 */
export async function refundCheck(checkId: string, reasonKey: string, note: string): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'PATCH', { checkId, action: 'refund', reasonKey, note }))
}

export interface PayResult {
  duplicate: boolean
  settled: boolean
  remainingUsd: number
  remainingLbp: number
  payment: { amount: number; currency: string; tender: string; changeUsd: number; changeLbp: number }
}

/**
 * Takes one payment on a check.
 *
 * The key is the caller's, made once per attempt and kept until an answer
 * arrives, exactly like a Send's batchKey: a payment whose reply is lost is
 * resent with the same key and the server returns the one it already took.
 * Timed out for the same reason Send is — "Paying…" forever on the edge of the
 * wifi is worse than an error that says it is safe to try again.
 */
export async function payCheck(
  checkId: string,
  req: PaymentRequest,
  paymentKey: string,
): Promise<PayResult> {
  const data = await unwrap(await authedFetch('/api/pos/checks', 'PATCH',
    { checkId, action: 'pay', paymentKey, ...req }, { timeoutMs: POS_TIMEOUT_MS }))
  return data as unknown as PayResult
}

// ── The branch drawer (slice 4) ────────────────────────────────────────────

export interface OpenShift {
  id: string
  branch: string
  /** 'closing' for the moment between a Z starting and it being written. */
  status: 'open' | 'closing'
  float: Money2
  openedByEmail: string
  openedAt: unknown
}

/**
 * The drawer shift open at a branch, live, or null.
 *
 * Scoped by branch and status, so it reads one document, not every shift the
 * branch has ever had. Waits for a signed-in user like every listener here.
 */
export function useOpenShift(branch: string): { shift: OpenShift | null; loading: boolean; error: string } {
  const [state, setState] = useState<{ key: string; shift: OpenShift | null; error: string } | null>(null)
  const { ready, signedIn } = useAuthReady()

  useEffect(() => {
    if (!branch || !ready || !signedIn) return
    const q = query(
      collection(db, 'drawerShifts'),
      where('branch', '==', branch),
      where('status', 'in', ['open', 'closing']),
    )
    return onSnapshot(q,
      snap => {
        const d = snap.docs[0]
        setState({ key: branch, shift: d ? ({ id: d.id, ...d.data() } as OpenShift) : null, error: '' })
      },
      err => {
        console.error('[useOpenShift] listener failed:', err)
        setState({ key: branch, shift: null, error: listenerMessage(err) })
      },
    )
  }, [branch, ready, signedIn])

  const current = state?.key === branch ? state : null
  return { shift: current?.shift ?? null, loading: !current, error: current?.error ?? '' }
}

export async function openDrawer(branch: string, float: Money2): Promise<{ id: string }> {
  const data = await unwrap(await authedFetch('/api/pos/drawer', 'POST',
    { branch, floatUsd: float.usd, floatLbp: float.lbp }, { timeoutMs: POS_TIMEOUT_MS }))
  return data as unknown as { id: string }
}

/** An X reading: where the drawer stands. Changes nothing. */
export async function readDrawer(shiftId: string): Promise<{ totals: DrawerTotals }> {
  const data = await unwrap(await authedFetch(
    `/api/pos/drawer?shiftId=${encodeURIComponent(shiftId)}`, 'GET', undefined, { timeoutMs: POS_TIMEOUT_MS }))
  return data as unknown as { totals: DrawerTotals }
}

export interface ZResult { totals: DrawerTotals; counted: Money2; difference: Money2 }

export async function closeDrawer(
  shiftId: string, countLbp: DenomCount, countUsd: DenomCount, note: string,
): Promise<ZResult> {
  const data = await unwrap(await authedFetch('/api/pos/drawer', 'PATCH',
    { shiftId, countLbp, countUsd, note }, { timeoutMs: POS_TIMEOUT_MS }))
  return data as unknown as ZResult
}

/**
 * Puts the customer whose member code was scanned or typed on a check, or
 * takes them off with null. Their points are credited when the check closes.
 */
export async function setCheckCustomer(
  checkId: string,
  code: string | null,
): Promise<{ name: string | null; tier: string | null }> {
  const data = await unwrap(await authedFetch('/api/pos/checks', 'PATCH',
    { checkId, action: 'customer', code: code ?? '' }, { timeoutMs: POS_TIMEOUT_MS }))
  return data as unknown as { name: string | null; tier: string | null }
}

/** What a manager asks for. Checked on the server, which also decides who may. */
export interface DiscountRequest {
  kind: 'comp' | 'percent' | 'amount'
  /** A fraction 0–1 for a percentage; dollars for an amount; ignored for a comp. */
  value: number
  reasonKey: string
  note: string
}

/**
 * Comps an item or takes a percentage off it; null takes the discount off.
 * Safe to repeat: it sets a value, so a retry after a lost reply is the same state.
 */
export async function discountLine(checkId: string, lineId: string, d: DiscountRequest | null): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'PATCH',
    { checkId, action: 'lineDiscount', lineId, discount: d }, { timeoutMs: POS_TIMEOUT_MS }))
}

/** A percentage or an amount off the whole check; null takes it off. */
export async function discountCheck(checkId: string, d: DiscountRequest | null): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'PATCH',
    { checkId, action: 'checkDiscount', discount: d }, { timeoutMs: POS_TIMEOUT_MS }))
}

export async function closeCheck(checkId: string): Promise<void> {
  await unwrap(await authedFetch('/api/pos/checks', 'PATCH', { checkId, action: 'close' }))
}

export async function advanceTicket(ticketId: string, status: string): Promise<void> {
  await unwrap(await authedFetch('/api/pos/tickets', 'PATCH', { ticketId, status }))
}
