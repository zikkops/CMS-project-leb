'use client'

// One check: what the table has ordered, and how a waiter adds to it.
//
// ── The draft lives on the phone until Send ───────────────────────────────
// Tapping an item does not write to Firestore. The order accumulates in local
// state and goes up in one call when the waiter sends it.
//
// Writing per tap would cost a write per line AND deliver each one to every
// other listening device — about 216 writes and 800 delivered reads a day at
// one branch, for something nobody sees until Send anyway. It is also what the
// Phase 04 note asks for: "check state lives in IndexedDB while the check is
// open. A tablet that loses wifi mid-service must not lose an open table."
//
// The cost is that a draft is on one phone. That is the right trade: an order
// half-typed on a device somebody put down is not something the kitchen or
// another waiter should be able to see or act on.
//
// ── Layout (14 Sep 2026) ───────────────────────────────────────────────────
// On a wide screen — the counter's touch screen or a PC — the menu stays open
// beside the check, because on a desktop "Add items" was a sheet covering the
// order you were adding to. On a phone it is still a sheet: there is no room
// for both, and a thumb reaches the bottom bar. Controls come from
// pos/app/lib/posUi.tsx, where each colour has one meaning.

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft, faPaperPlane, faPlus, faMinus, faEllipsisVertical, faTrashCan, faNoteSticky, faChair,
  faLayerGroup, faSliders, faBan, faRotateLeft, faPercent, faUserTag, faArrowRightArrowLeft,
  faCashRegister, faReceipt, faXmark, faUtensils, faCheck, faPen, faHourglassHalf, faUserGroup,
  faCircleCheck, faTriangleExclamation, faWheatAwnCircleExclamation, faFire, faPause,
} from '@fortawesome/free-solid-svg-icons'
import { SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useTillAccess } from '../../../lib/useTillAccess'
import {
  lineTotal, grossLineTotal, lineDiscount, checkTotals, serviceRate, stationForSection, VOID_REASONS, reversalRefusal, reconcilePendingBatch,
  type CheckLine, type StaffDiscount,
} from '@big-cms/shared/checks'
import { minutesWaiting, urgency } from '@big-cms/shared/tickets'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { useFeature, useBusinessSettings } from '../../../lib/useTillSettings'
import PaySheet from './PaySheet'
import CustomerSheet from './CustomerSheet'
import DiscountSheet from './DiscountSheet'
import { MenuPicker, ModifierSheet } from './MenuPicker'
import { lineUnitPrice, describeSelections } from '@big-cms/shared/modifiers'
import {
  useCheck, usePosMenu, useRetailProducts,
  addLines, sendCheck, voidLine, moveCheck, closeCheck, setStaffMeal, markSoldOut, reprintKitchenTickets, removeServiceCharge, fireHeld,
  type DraftLine, type PosMenuItem, type PosProduct,
} from '../../../lib/usePos'
import { isSoldOut, soldOutDay } from '@big-cms/shared/soldOut'
import { BRAND } from '@big-cms/shared/brand'
import {
  PosButton, Chip, StatusBadge, SectionLabel, type Tone, PosLoading, ErrorNote, Sheet,
} from '../../../lib/posUi'
import { useHubOnly, HubOnlyBanner } from '../../../lib/useHubOnly'
import { useAllergenChart } from '../../../lib/useAllergens'
import { startLoad } from '@big-cms/shared/startLoad'

/** Whether this device shows allergens on the menu. Per device, like the floor's readings. */
const ALLERGENS_KEY = 'pos-show-allergens'

// Duplicated per file by convention — see CLAUDE.md. Don't refactor to share.
function useIsMobile(breakpoint = 900) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return isMobile
}

function useNow(everyMs = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

const money = (n: number) => `$${n.toFixed(2)}`

/**
 * A key for one batch of drafts. randomUUID where the browser has it (every
 * secure page does); otherwise enough randomness that two phones sending in
 * the same instant do not collide.
 */
function newBatchKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * Whether two drafts are the same order and should be one line at a quantity.
 *
 * Three taps on Espresso is "3× Espresso", not three lines — on the check, on
 * the kitchen ticket, and in the head of whoever is making them. Anything that
 * differs keeps them apart: a different seat is a different person, a
 * different note is a different plate, a different modifier is a different
 * drink.
 */
function sameOrder(a: DraftLine, b: DraftLine): boolean {
  return a.source === b.source
    && a.refId === b.refId
    && a.seat === b.seat
    && a.course === b.course
    && a.note === b.note
    && [...a.modifierOptionIds].sort().join('|') === [...b.modifierOptionIds].sort().join('|')
}

/** Adds a draft, merging it into an identical one if there is one. */
function withDraft(drafts: DraftLine[], next: DraftLine): DraftLine[] {
  const i = drafts.findIndex(d => sameOrder(d, next))
  if (i === -1) return [...drafts, next]
  return drafts.map((d, n) => n === i ? { ...d, quantity: d.quantity + next.quantity } : d)
}

/** How long a sent line has waited, as a badge tone: fine, getting long, late. */
const URGENCY_TONE: Record<ReturnType<typeof urgency>, Tone> = {
  fresh: 'neutral',
  aging: 'warn',
  late: 'danger',
}

const sheetTitle: React.CSSProperties = {
  fontFamily: 'var(--font-cinzel)', fontSize: '1.35rem', color: 'var(--offwhite)',
}
const meta: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.45rem',
}

// ── Module scope, all of them ─────────────────────────────────────────────
// A component declared inside a render body is a new type on every keystroke,
// so React remounts it and any open sheet closes itself. (CONTRIBUTING.md #2.)

function LineRow({ line, now, discount, onMore }: {
  line: CheckLine
  now: number
  discount: StaffDiscount | null
  onMore: (() => void) | null
}) {
  const off = lineDiscount(line, discount)
  const voided = line.status === 'void'
  const sentMs = line.status === 'sent' && line.sentAt ? Date.parse(line.sentAt) : NaN
  const mins = Number.isFinite(sentMs) ? minutesWaiting(sentMs, now) : null
  return (
    <div style={{
      display: 'flex', gap: '0.8rem', alignItems: 'flex-start',
      padding: '0.85rem 0.2rem', borderBottom: '1px solid rgba(var(--overlay-rgb),0.07)',
      opacity: voided ? 0.5 : 1,
    }}>
      <span style={{
        fontFamily: 'var(--font-inter)', fontSize: '1.05rem', color: 'var(--offwhite)',
        minWidth: '2.2rem', fontWeight: 700,
      }}>{line.quantity}×</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '1.02rem', fontWeight: 600, color: 'var(--offwhite)',
          textDecoration: voided ? 'line-through' : 'none',
        }}>{line.name}</p>

        {line.modifiers.length > 0 && (
          <p style={{ fontSize: '0.88rem', color: 'rgba(var(--offwhite-rgb),0.6)', marginTop: '0.2rem' }}>
            {describeSelections(line.modifiers)}
          </p>
        )}
        {line.note && (
          <p style={{ fontSize: '0.88rem', color: 'var(--brand-secondary)', marginTop: '0.2rem', fontWeight: 600 }}>
            <FontAwesomeIcon icon={faNoteSticky} style={{ marginRight: '0.35rem' }} />{line.note}
          </p>
        )}

        <div style={meta}>
          {voided
            ? <StatusBadge icon={faBan} tone="danger" label={`Voided — ${line.voidReason}`} />
            : mins !== null
              ? <StatusBadge icon={faPaperPlane} tone={URGENCY_TONE[urgency(mins)]} label={`Sent ${mins}m ago`} />
              : <StatusBadge icon={faPen} tone="warn" label="Not sent" />}
          {line.seat !== null && <StatusBadge icon={faChair} label={`Seat ${line.seat}`} />}
          {line.course !== null && <StatusBadge icon={faLayerGroup} label={`Course ${line.course}`} />}
        </div>
      </div>

      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '1.02rem', fontWeight: 600, color: 'var(--offwhite)' }}>
          {money(lineTotal(line, discount))}
        </p>
        {off > 0 && (
          <p style={{ fontSize: '0.78rem', color: 'var(--teal)' }}>was {money(grossLineTotal(line))}</p>
        )}
        {/* Not a Void button sitting on every line. Striking an order off is
            one mis-tap away from a plate the kitchen has already started, and
            a phone held one-handed on a moving floor is where mis-taps
            happen. This opens the options; the destructive one is behind it,
            with a reason required after that. */}
        {onMore && (
          <PosButton icon={faEllipsisVertical} label="Line options" iconOnly size="sm" tone="neutral" onClick={onMore} />
        )}
      </div>
    </div>
  )
}

function DraftRow({ draft, locked, onRemove, onNote, onQuantity }: {
  draft: DraftLine
  /** A send of these is unsettled; changing them would make the retry a different order. */
  locked: boolean
  onRemove: () => void
  onNote: () => void
  onQuantity: (next: number) => void
}) {
  return (
    <div style={{
      display: 'flex', gap: '0.8rem', alignItems: 'flex-start',
      padding: '0.85rem 0.7rem', marginBottom: '0.5rem', borderRadius: '10px',
      background: 'rgba(var(--brand-secondary-rgb),0.06)',
      border: '1px solid rgba(var(--brand-secondary-rgb),0.3)',
      borderLeft: '5px solid var(--brand-secondary)',
      opacity: locked ? 0.75 : 1,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.3rem',
        pointerEvents: locked ? 'none' : 'auto', visibility: locked ? 'hidden' : 'visible',
      }}>
        <PosButton icon={faMinus} label="One fewer" iconOnly size="sm" onClick={() => onQuantity(draft.quantity - 1)} />
        <span style={{
          fontSize: '1.1rem', color: 'var(--offwhite)', minWidth: '2.1rem',
          fontWeight: 700, textAlign: 'center',
        }}>{draft.quantity}×</span>
        <PosButton icon={faPlus} label="One more" iconOnly size="sm" onClick={() => onQuantity(draft.quantity + 1)} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '1.02rem', fontWeight: 600, color: 'var(--offwhite)' }}>{draft.name}</p>
        {draft.modifierLabel && (
          <p style={{ fontSize: '0.88rem', color: 'rgba(var(--offwhite-rgb),0.6)', marginTop: '0.15rem' }}>{draft.modifierLabel}</p>
        )}
        {draft.note && (
          <p style={{ fontSize: '0.88rem', color: 'var(--brand-secondary)', marginTop: '0.2rem', fontWeight: 600 }}>
            <FontAwesomeIcon icon={faNoteSticky} style={{ marginRight: '0.35rem' }} />{draft.note}
          </p>
        )}
        <div style={meta}>
          {locked
            ? <StatusBadge icon={faHourglassHalf} tone="warn" label="Sending — waiting to hear back" />
            : <StatusBadge icon={faPen} tone="warn" label="On this device — not sent" />}
        </div>
        {!locked && (
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.55rem', flexWrap: 'wrap' }}>
            <PosButton icon={faNoteSticky} label={draft.note ? 'Edit note' : 'Note'} size="sm" tone="quiet" onClick={onNote} />
            <PosButton icon={faTrashCan} label="Remove" size="sm" tone="danger" onClick={onRemove} />
          </div>
        )}
      </div>
      <p style={{ fontSize: '1.02rem', fontWeight: 600, color: 'var(--offwhite)', whiteSpace: 'nowrap' }}>
        {money(lineUnitPrice(draft.unitPrice, []) * draft.quantity)}
      </p>
    </div>
  )
}

/** Choosing modifiers for one item, before it joins the draft. */
/**
 * A line of text for the kitchen or for the record, in a sheet (UPGRADE.md
 * T2.5). It used to be window.prompt: tiny on a touch screen, and blocked
 * outright by some kiosk browsers. Enter saves; Escape or Cancel leaves it.
 * Module scope.
 */
function TextSheet({ title, initial = '', placeholder, required = false, submitLabel, danger = false, onSubmit, onCancel }: {
  title: string
  initial?: string
  placeholder?: string
  required?: boolean
  submitLabel: string
  danger?: boolean
  onSubmit: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const ready = !required || text.trim() !== ''
  return (
    <Sheet label={title} onClose={onCancel} onSubmit={() => { if (ready) onSubmit(text.trim().slice(0, 200)) }}>
      <h2 style={{ ...sheetTitle, marginBottom: '0.9rem' }}>{title}</h2>
      <textarea
        aria-label={title}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit() } }}
        autoFocus
        rows={3}
        maxLength={200}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '0.8rem 0.9rem', borderRadius: '10px',
          background: 'rgba(var(--overlay-rgb),0.05)', border: '2px solid rgba(var(--overlay-rgb),0.18)', color: 'var(--offwhite)',
          fontFamily: 'var(--font-inter)', fontSize: '1.05rem', lineHeight: 1.5, outline: 'none', resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
        <PosButton icon={faXmark} label="Cancel" tone="quiet" grow={1} onClick={onCancel} />
        <PosButton icon={danger ? faBan : faCheck} label={submitLabel} tone={danger ? 'danger' : 'primary'} size="lg" grow={2} type="submit" disabled={!ready} />
      </div>
    </Sheet>
  )
}

export default function CheckPage() {
  const { checking, blocked, role } = useTillAccess(SECTION_ACCESS.pos, { login: '/pos/login', home: '/pos' })
  // Discounts are a manager's or an admin's (owner's decision, 12 Sep 2026).
  // Hiding the buttons is courtesy; the server refuses anyone else regardless.
  const canDiscount = role === 'admin' || role === 'manager'
  const isMobile = useIsMobile()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const checkId = String(params?.id ?? '')

  const { check, error: liveError } = useCheck(checkId)
  const { products } = useRetailProducts(check?.branch ?? '')
  // A branch a café hub trades is view-only online (S10).
  const hubOnly = useHubOnly(check?.branch ?? '')
  const now = useNow()
  const menu = usePosMenu()
  // Phase 04: with the payments feature on, Close goes through the payment
  // sheet. Off — the pilot — it is the v1 confirmation, unchanged.
  const { on: takesPayment } = useFeature('payments')
  // Phase 04, slice 5: a loyalty customer can be put on the check, and their
  // points land when it closes. Off, the button is not there.
  const { on: loyaltyOn } = useFeature('loyalty')
  const { settings: business } = useBusinessSettings()
  // Food safety, slice 7: allergens on the menu, for when a customer asks. Off
  // with the module, and a toggle per device on top — most orders are not an
  // allergen question, and chips on every tile are noise until one is.
  const { on: allergensOn } = useFeature('foodSafety')
  const [showAllergens, setShowAllergens] = useState<boolean>(() => {
    try { return typeof window !== 'undefined' && window.localStorage.getItem(ALLERGENS_KEY) === '1' }
    catch { return false }
  })
  const allergensShown = allergensOn && showAllergens
  const allergenChart = useAllergenChart(allergensShown)
  const allergenMap = useMemo(
    () => (allergensShown && allergenChart.dishes ? new Map(allergenChart.dishes.map(d => [d.menuItemId, d])) : null),
    [allergensShown, allergenChart.dishes],
  )
  // 86 from the till (UPGRADE.md T3.5): a manager switches "Mark sold out" on,
  // and a tap on a dish marks it sold out at this branch for today, or back on.
  const { on: soldOutOn } = useFeature('soldOut')
  const canMarkSoldOut = soldOutOn && canDiscount
  const [markingSoldOut, setMarkingSoldOut] = useState(false)
  const [marking, setMarking] = useState<string | null>(null)
  async function toggleSoldOut(item: PosMenuItem) {
    if (!check || marking) return
    setMarking(item.id)
    setError('')
    try {
      await markSoldOut(check.branch, item.id, !isSoldOut(item.soldOut, check.branch, soldOutDay(BRAND.locale.timezone)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That dish was not changed.')
    } finally {
      setMarking(null)
    }
  }

  function toggleAllergens() {
    setShowAllergens(prev => {
      const next = !prev
      try { window.localStorage.setItem(ALLERGENS_KEY, next ? '1' : '0') } catch { /* private mode: lasts the visit */ }
      return next
    })
  }

  const [drafts, setDrafts] = useState<DraftLine[]>([])
  const [picking, setPicking] = useState(false)
  // 'retail' is a tab, not a category. Merchandise has no menu category and
  // never will — it is a different catalogue with a different stock model,
  // which is the entire point of it being on the same check.
  const [category, setCategory] = useState<string>('')
  const [modifierFor, setModifierFor] = useState<PosMenuItem | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [printedAgain, setPrintedAgain] = useState('')
  const [moving, setMoving] = useState(false)
  const [actions, setActions] = useState(false)
  const [lineMenu, setLineMenu] = useState<CheckLine | null>(null)
  // The draft whose kitchen note is being written, and the line being voided for "Other".
  const [noteFor, setNoteFor] = useState<number | null>(null)
  const [otherVoid, setOtherVoid] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [paying, setPaying] = useState(false)
  const [addingCustomer, setAddingCustomer] = useState(false)
  const [discounting, setDiscounting] = useState<null | { mode: 'check' } | { mode: 'line'; lineId: string }>(null)
  const [moveTo, setMoveTo] = useState('')

  // ── An unsettled send ────────────────────────────────────────────────────
  // Set from the moment a batch of drafts goes to the server until the server
  // has confirmed it. If the connection drops in between, whether the lines
  // landed is unknown — and resending them blind is how a kitchen makes the
  // same order twice. So the batch keeps its key: a retry sends the same key,
  // and the server skips a batch it has already applied. Meanwhile the drafts
  // are frozen, because an edit would make the retry a different batch.
  //
  // The live check settles it without anyone tapping anything: once lines
  // carrying the key appear, the batch landed and the phone's copy can go.
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  useEffect(() => {
    if (!pendingKey || !check) return
    if (reconcilePendingBatch(check.lines, pendingKey) === 'absent') return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts([])
    setPendingKey(null)
    setError('')
  }, [check, pendingKey])
  const draftsLocked = pendingKey !== null && drafts.length > 0

  // ── Unsent items survive leaving the screen (UPGRADE.md T2.8) ─────────────
  // They lived only in this page's memory: Floor, a reload or the phone
  // putting the tab to sleep threw them away without a word. Now they are kept
  // on this device per check, with the key of a send in progress, so coming
  // back to the table finds them, and a retry still cannot send twice.
  const draftStore = `pos-drafts-${checkId}`
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    startLoad(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(draftStore) ?? 'null') as { drafts?: unknown; pendingKey?: unknown } | null
        if (saved && Array.isArray(saved.drafts) && saved.drafts.length > 0) {
          setDrafts(saved.drafts as DraftLine[])
          setPendingKey(typeof saved.pendingKey === 'string' ? saved.pendingKey : null)
        }
      } catch { /* unreadable or private mode: nothing kept */ }
      setRestored(true)
    })
  }, [draftStore])
  useEffect(() => {
    if (!restored) return
    try {
      if (drafts.length > 0) localStorage.setItem(draftStore, JSON.stringify({ drafts, pendingKey }))
      else localStorage.removeItem(draftStore)
    } catch { /* private mode: kept for this visit only */ }
  }, [restored, drafts, pendingKey, draftStore])
  const [leaving, setLeaving] = useState(false)

  const categories = useMemo(
    () => menu.categories.filter(c => menu.items.some(i => i.categoryId === c.id)),
    [menu.categories, menu.items],
  )
  // '' is the category screen; a category (or 'retail') is its items. Derived
  // rather than trusted: a category deleted while its screen is open falls
  // back to the categories instead of an empty screen.
  const activeCategory = category === 'retail' || categories.some(c => c.id === category) ? category : ''

  const shown = useMemo(
    () => menu.items.filter(i => i.categoryId === activeCategory && i.available),
    [menu.items, activeCategory],
  )
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of menu.items) if (i.available) m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + 1)
    return m
  }, [menu.items])

  // unitPrice is display only, the base price plus the options chosen; the
  // server prices the line itself from the ids (usePos.ts, DraftLine).
  function addDraft(item: PosMenuItem, optionIds: string[], label: string, unitPrice = item.price) {
    if (draftsLocked) return
    setDrafts(d => withDraft(d, {
      source: 'menu', refId: item.id, name: item.name, unitPrice,
      quantity: 1, modifierOptionIds: optionIds, modifierLabel: label,
      // Seats and courses are no longer taken (owner's request, 14 Sep 2026):
      // every line is for the table.
      seat: null, course: null, note: '',
    }))
    setModifierFor(null)
  }

  function addProduct(p: PosProduct) {
    if (draftsLocked) return
    setDrafts(d => withDraft(d, {
      // Merchandise: no modifiers, no course — it is not cooked and does not
      // arrive with anything. The server refuses modifiers on it too.
      source: 'product', refId: p.id, name: p.name, unitPrice: p.price,
      quantity: 1, modifierOptionIds: [], modifierLabel: '',
      seat: null, course: null, note: '',
    }))
  }

  const groupsOf = (item: PosMenuItem) => item.modifierGroupIds.map(id => menu.groups[id]).filter(Boolean)

  const { on: holdOn } = useFeature('holdAndFire')
  async function handleFire() {
    setBusy('Firing…')
    setError('')
    try {
      const r = await fireHeld(checkId)
      setBusy(`Fired — ${r.stations.join(', ')}`)
      setTimeout(() => setBusy(''), 2500)
    } catch (err) {
      setBusy('')
      setError(err instanceof Error ? err.message : 'Could not fire it.')
    }
  }

  function pick(item: PosMenuItem) {
    if (groupsOf(item).length > 0) { setModifierFor(item); return }
    addDraft(item, [], '')
  }

  async function handleSend(hold: string[] = []) {
    setBusy(hold.length > 0 ? 'Sending the drinks…' : 'Sending…')
    setError('')
    // One key per batch, and the SAME key on every retry of that batch — see
    // the note on pendingKey. A fresh key only for a new batch with no earlier
    // one still unsettled.
    const key = pendingKey ?? (drafts.length > 0 ? newBatchKey() : null)
    let landed = false
    try {
      // Two calls, one action. If the first succeeds and the second fails the
      // lines are on the check as unsent drafts — visible, recoverable, and
      // the waiter can simply press Send again. The reverse order would risk
      // firing a ticket for lines that never landed.
      //
      // What the first version missed is the first call succeeding with its
      // REPLY lost. The drafts stayed on the phone, the lines were already on
      // the check, and a second Send added them again. The key is what makes
      // that second Send safe.
      if (drafts.length > 0 && key) {
        setPendingKey(key)
        await addLines(checkId, drafts, key)
        setDrafts([])
      }
      landed = true
      const tickets = await sendCheck(checkId, hold)
      setPendingKey(null)
      setBusy(tickets.length > 0
        ? `Sent — ${tickets.map(t => `${t.station} ×${t.lines}${t.held ? ' (held)' : ''}`).join(', ')}`
        : 'Sent')
      setTimeout(() => setBusy(''), 2500)
    } catch (err) {
      setBusy('')
      // An earlier attempt of this batch may already have been fired, and the
      // live check knows. If it says so, that is a success, whatever this call
      // said — "Nothing new to send" is the server confirming the first try.
      if (key && check && reconcilePendingBatch(check.lines, key) === 'sent') {
        setPendingKey(null)
        setDrafts([])
        setBusy('Sent')
        setTimeout(() => setBusy(''), 2500)
        return
      }
      if (isNetworkFailure(err)) {
        // No answer: unknown whether anything arrived. Say what is true, and
        // that trying again is safe — because now it is.
        setError(!landed && drafts.length > 0
          ? 'No connection. Tap Send again once the wifi is back; it will not be sent twice. The order is still on this phone and may already have reached the till. If the wifi stays down, take it to the counter.'
          : 'No connection. Tap Send again once the wifi is back. The order is on the check but may not have reached the kitchen.')
      } else {
        // An answer, and it was no: nothing was written. The drafts are the
        // waiter's to change again.
        setPendingKey(null)
        setError(err instanceof Error ? err.message : 'Could not send.')
      }
    }
  }

  async function handleVoid(lineId: string, reasonKey: string, note: string) {
    setLineMenu(null)
    setError('')
    try { await voidLine(checkId, lineId, reasonKey, note) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not void.') }
  }

  async function handleMove() {
    const n = Number(moveTo)
    if (!Number.isInteger(n) || n < 1) { setError('Enter a table number.'); return }
    setMoving(false)
    setMoveTo('')
    try { await moveCheck(checkId, n) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not move.') }
  }

  async function handleClose() {
    setError('')
    // The receipt next, to print or hand over (UPGRADE.md T2.7); it links back to the floor.
    try { await closeCheck(checkId); router.push(`/pos/check/${checkId}/receipt`) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not close.') }
  }

  if (blocked) { router.replace('/pos'); return null }
  if (checking) return <PosLoading />
  if (!check) {
    return (
      <main style={{
        minHeight: '100vh', backgroundColor: 'var(--black)', padding: '3rem 1.25rem',
        fontFamily: 'var(--font-inter)', color: 'rgba(var(--offwhite-rgb),0.55)', textAlign: 'center', fontSize: '1rem',
      }}>
        {/* Without this branch a refused read reads as "Loading…" forever,
            which is the same silent failure wearing a spinner. */}
        {liveError || 'Loading the check…'}
      </main>
    )
  }

  const totals = checkTotals(check)
  // Drafts are shown at full price: the discount is applied server-side when
  // the lines land, and guessing it here would show one number before Send
  // and another after.
  const draftTotal = drafts.reduce((s, d) => s + d.unitPrice * d.quantity, 0)
  const onCheck = check.lines.filter(l => l.status !== 'draft')
  const unsentLines = check.lines.filter(l => l.status === 'draft')
  // Hold and fire (UPGRADE.md T3.11): offered when what is about to go mixes
  // drinks and food, so the drinks go now and the food waits for "Fire".
  const sendingStations = new Set<string>([
    ...unsentLines.map(l => l.station ?? ''),
    ...drafts.map(d => d.source === 'menu' ? stationForSection(menu.items.find(i => i.id === d.refId)?.section) ?? '' : ''),
  ])
  const canHoldFood = holdOn && sendingStations.has('Bar') && (sendingStations.has('Kitchen') || sendingStations.has('Sweets'))
  const heldNow = check.heldStations ?? []
  const unsentOnServer = unsentLines.length
  const canSend = drafts.length > 0 || unsentOnServer > 0
  // Something on the check, all of it sent, nothing in progress: time to pay.
  const readyToSettle = !canSend && !busy && check.status === 'open' && check.lines.some(l => l.status !== 'void')
  const sendCount = drafts.length + unsentOnServer

  const picker = (columns: number) => (
    <MenuPicker
      categories={categories}
      counts={counts}
      activeCategory={activeCategory}
      onCategory={setCategory}
      items={shown}
      products={products}
      hasOptions={i => groupsOf(i).length > 0}
      onPick={pick}
      onProduct={addProduct}
      isSoldOut={i => isSoldOut(i.soldOut, check.branch, soldOutDay(BRAND.locale.timezone))}
      marking={canMarkSoldOut && markingSoldOut}
      onMark={canMarkSoldOut ? item => { void toggleSoldOut(item) } : undefined}
      locked={draftsLocked}
      columns={columns}
      allergenMap={allergenMap}
      allergenControl={allergensOn || canMarkSoldOut ? (
        <span style={{ display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {canMarkSoldOut && (
            <Chip label={markingSoldOut ? 'Done marking' : 'Mark sold out'} icon={faBan} size="sm" colour="var(--red)"
              active={markingSoldOut} onClick={() => setMarkingSoldOut(m => !m)} />
          )}
          {allergensOn && (
            <Chip label="Allergens" icon={faWheatAwnCircleExclamation} size="sm" colour="var(--brand-secondary)"
              active={showAllergens} onClick={toggleAllergens} />
          )}
        </span>
      ) : null}
      allergenNote={!allergensShown ? null : allergenChart.error ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', margin: '-0.3rem 0 0.9rem' }}>
          <span style={{ fontSize: '0.92rem', color: 'var(--red)' }}>
            <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.4rem' }} />
            {allergenChart.error} Ask the kitchen — do not guess.
          </span>
          <PosButton icon={faRotateLeft} label="Try again" size="sm" onClick={allergenChart.retry} />
        </div>
      ) : allergenChart.loading ? (
        <p style={{ fontSize: '0.92rem', color: 'rgba(var(--offwhite-rgb),0.55)', margin: '-0.3rem 0 0.9rem' }}>Loading allergens…</p>
      ) : (
        <p style={{ fontSize: '0.88rem', color: 'rgba(var(--offwhite-rgb),0.65)', margin: '-0.3rem 0 0.9rem', lineHeight: 1.5 }}>
          Allergens as the dish comes, without options. <strong style={{ color: 'var(--red)' }}>Not verified</strong> means
          there may be more than is listed — check with the kitchen.
        </p>
      )}
    />
  )

  const header = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <PosButton icon={faArrowLeft} label="Floor" tone="quiet" size="sm" onClick={() => { if (drafts.length > 0) setLeaving(true); else router.push('/pos') }} />
        <StatusBadge icon={faUserGroup} label={`${check.guestCount} ${check.guestCount === 1 ? 'guest' : 'guests'}`} />
      </div>

      <HubOnlyBanner hub={hubOnly} branch={check.branch} isMobile={isMobile} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', marginBottom: '1rem' }}>
        <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.8rem' : '2.2rem', color: 'var(--offwhite)', lineHeight: 1 }}>
          Table {check.tableNumber}
        </h1>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.5)' }}>Total</p>
          <span style={{ fontSize: isMobile ? '1.5rem' : '1.9rem', color: 'var(--offwhite)', fontWeight: 700 }}>
            {money(totals.net + draftTotal)}
          </span>
          {/* Shown as its own figure rather than folded into the total: a
              staff meal that quietly shows a smaller number is one nobody
              can audit. */}
          {totals.discount > 0 && (
            <p style={{ fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.55)', marginTop: '0.15rem' }}>
              {money(totals.gross)} − {money(totals.discount)} staff
            </p>
          )}
          {/* Its own figure too (UPGRADE.md T3.8): a charge nobody can see is one nobody can question. */}
          {serviceRate(check.serviceCharge) > 0 && (
            <p style={{ fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.55)', marginTop: '0.15rem' }}>
              incl. {money(totals.service)} service ({+(serviceRate(check.serviceCharge) * 100).toFixed(2)}%)
            </p>
          )}
        </div>
      </div>

      {liveError && <ErrorNote message={liveError} tone="warn" />}

      {error && <ErrorNote message={error} />}
      {printedAgain && !error && (
        <p role="status" style={{ color: 'rgba(var(--offwhite-rgb),0.8)', fontSize: '0.95rem', margin: '0 0 1rem' }}>
          <FontAwesomeIcon icon={faReceipt} style={{ marginRight: '0.5rem' }} />{printedAgain}
        </p>
      )}
      {busy && (
        <p style={{
          color: 'var(--teal)', fontSize: '0.95rem', marginBottom: '1rem', fontWeight: 600,
          background: 'rgba(var(--teal-rgb),0.1)', border: '1px solid rgba(var(--teal-rgb),0.35)',
          borderRadius: '8px', padding: '0.8rem 1rem',
        }}><FontAwesomeIcon icon={busy.startsWith('Sent') ? faCircleCheck : faHourglassHalf} style={{ marginRight: '0.5rem' }} />{busy}</p>
      )}
    </>
  )

  const lines = (
    <>
      {check.lines.length === 0 && drafts.length === 0 && (
        <p style={{ color: 'rgba(var(--offwhite-rgb),0.45)', fontSize: '1rem', padding: '2rem 0', textAlign: 'center' }}>
          Nothing ordered yet{isMobile ? ' — tap Add items.' : ' — pick from the menu.'}
        </p>
      )}

      {onCheck.length > 0 && (
        <>
          <SectionLabel icon={faPaperPlane}>On the check</SectionLabel>
          {onCheck.map(l => (
            <LineRow key={l.id} line={l} now={now} discount={check.staffDiscount ?? null}
              onMore={l.status === 'void' ? null : () => setLineMenu(l)} />
          ))}
        </>
      )}

      {(unsentLines.length > 0 || drafts.length > 0) && (
        <>
          {/* Its own section, in amber, because this is the part the kitchen
              has not seen: the one thing on the screen that still needs Send. */}
          <SectionLabel icon={faPen} colour="var(--brand-secondary)"
            right={<StatusBadge tone="warn" label={`${sendCount} not sent`} />}>
            Not sent yet
          </SectionLabel>
          {unsentLines.map(l => (
            <LineRow key={l.id} line={l} now={now} discount={check.staffDiscount ?? null} onMore={() => setLineMenu(l)} />
          ))}
          {drafts.map((d, i) => (
            <DraftRow
              key={i}
              draft={d}
              locked={draftsLocked}
              onRemove={() => setDrafts(list => list.filter((_, n) => n !== i))}
              onQuantity={next => {
                // Down to zero removes it, which is what tapping minus on a
                // single item means — not "zero of these please".
                if (next < 1) { setDrafts(list => list.filter((_, n) => n !== i)); return }
                setDrafts(list => list.map((x, n) =>
                  n === i ? { ...x, quantity: Math.min(next, 99) } : x))
              }}
              onNote={() => setNoteFor(i)}
            />
          ))}
        </>
      )}
    </>
  )

  // One Check options button rather than three in a row: closing a check and
  // moving a table sat directly under the order, a thumb's width from it.
  // Send is the widest thing in the bar because it is the thing to press.
  // On a phone the two secondary buttons put their icon above the word, so all
  // three fit a 360px screen with Send still the widest.
  const compact: React.CSSProperties | undefined = isMobile
    ? { flexDirection: 'column', gap: '0.2rem', padding: '0.35rem 0.4rem', fontSize: '0.9rem' }
    : undefined
  const actionBar = (
    <>
    {heldNow.length > 0 && (
      <div style={{ marginBottom: '0.6rem' }}>
        <PosButton icon={faFire} label={`Fire the food now (${heldNow.join(', ')})`} tone="warn" size="lg" full
          disabled={Boolean(busy)} onClick={() => { void handleFire() }} />
      </div>
    )}
    {canHoldFood && !readyToSettle && (
      <div style={{ marginBottom: '0.6rem' }}>
        <PosButton icon={faPause} label="Send the drinks, hold the food" tone="neutral" full
          disabled={!canSend || Boolean(busy)} onClick={() => { void handleSend(['Kitchen', 'Sweets']) }} />
      </div>
    )}
    <div style={{ display: 'flex', gap: isMobile ? '0.5rem' : '0.6rem' }}>
      <PosButton icon={faSliders} label="Check options" tone="neutral" grow={1} style={compact}
        badge={check.staffDiscount ? 'staff' : null} onClick={() => setActions(true)} />
      {isMobile && (
        <PosButton icon={faPlus} label="Add items" tone="neutral" grow={1} style={compact} disabled={draftsLocked} onClick={() => setPicking(true)} />
      )}
      {readyToSettle ? (
        // Nothing waiting to send: the main slot is the next thing a table
        // needs, taking the money (UPGRADE.md T2.6). It was Check options →
        // "Take payment and close", in red, about ten taps from table to closed.
        <PosButton icon={takesPayment ? faCashRegister : faReceipt} label={takesPayment ? 'Pay' : 'Close'} tone="primary" size="lg" grow={2}
          onClick={() => { if (takesPayment) setPaying(true); else setClosing(true) }} />
      ) : (
        <PosButton icon={faPaperPlane} label="Send" tone="primary" size="lg" grow={2}
          badge={sendCount > 0 ? sendCount : null}
          disabled={!canSend || Boolean(busy)} onClick={() => { void handleSend() }} />
      )}
    </div>
    </>
  )

  return (
    <main style={{ minHeight: '100vh', backgroundColor: 'var(--black)', fontFamily: 'var(--font-inter)' }}>
      {isMobile ? (
        <>
          <div style={{ maxWidth: '720px', margin: '0 auto', padding: '1.25rem 1rem 8rem' }}>
            {header}
            {lines}
          </div>
          {/* Sticky, because a waiter's thumb lives at the bottom of the screen. */}
          <div style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
            backgroundColor: 'rgba(10,10,10,0.97)', borderTop: '1px solid rgba(var(--overlay-rgb),0.12)',
            padding: '0.8rem 1rem',
          }}>
            <div style={{ maxWidth: '720px', margin: '0 auto' }}>{actionBar}</div>
          </div>
        </>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(400px, 0.9fr) minmax(0, 1.35fr)', gap: '1.25rem',
          maxWidth: '1500px', margin: '0 auto', padding: '1.25rem', alignItems: 'start',
        }}>
          {/* The check: its own column, scrolling on its own, with the actions
              pinned under it so Send never scrolls out of reach. */}
          <section style={{
            position: 'sticky', top: '1rem', height: 'calc(100vh - 4.5rem)',
            display: 'flex', flexDirection: 'column',
            background: 'rgba(var(--overlay-rgb),0.025)', border: '1px solid rgba(var(--overlay-rgb),0.1)',
            borderRadius: '14px', padding: '1.1rem 1.1rem 0',
          }}>
            {header}
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.2rem' }}>{lines}</div>
            <div style={{ borderTop: '1px solid rgba(var(--overlay-rgb),0.1)', padding: '0.9rem 0 1rem' }}>{actionBar}</div>
          </section>

          {/* The menu, always open. */}
          <section style={{
            background: 'rgba(var(--overlay-rgb),0.025)', border: '1px solid rgba(var(--overlay-rgb),0.1)',
            borderRadius: '14px', padding: '0.4rem 1.1rem 1.2rem',
          }}>
            {draftsLocked && (
              <p style={{ fontSize: '0.92rem', color: 'var(--brand-secondary)', marginTop: '0.8rem' }}>
                <FontAwesomeIcon icon={faHourglassHalf} style={{ marginRight: '0.4rem' }} />
                Waiting to hear back about the last Send — adding is paused so a retry cannot become a different order.
              </p>
            )}
            {picker(3)}
          </section>
        </div>
      )}

      {picking && isMobile && (
        <Sheet label="Add items" onClose={() => setPicking(false)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <h2 style={sheetTitle}>Add items</h2>
            <PosButton icon={faCheck} label="Done" tone="neutral" size="sm" onClick={() => setPicking(false)} />
          </div>
          {picker(2)}
        </Sheet>
      )}

      {modifierFor && (
        <ModifierSheet
          item={modifierFor}
          groups={groupsOf(modifierFor)}
          allergens={allergensShown}
          onCancel={() => setModifierFor(null)}
          onAdd={(ids, label, unitPrice) => addDraft(modifierFor, ids, label, unitPrice)}
        />
      )}

      {/* Line options. The void is the only destructive thing here, so it is
          the only one coloured as such, and it still asks for a reason after
          this. Two deliberate taps and a sentence — a mis-tap does not get
          past the first. */}
      {lineMenu && (
        <Sheet label="Line options" onClose={() => setLineMenu(null)}>
          <h2 style={{ ...sheetTitle, marginBottom: '0.3rem' }}>{lineMenu.quantity}× {lineMenu.name}</h2>
          <p style={{ fontSize: '0.95rem', color: 'rgba(var(--offwhite-rgb),0.55)', marginBottom: '1rem' }}>
            {lineMenu.status === 'sent'
              ? 'Already sent to the kitchen. Voiding it tells the pass.'
              : 'Not sent yet.'}
          </p>

          {/* A manager's comp or item discount — before any payment only. */}
          {canDiscount && (check.payments ?? []).length === 0 && (
            <PosButton
              icon={faPercent} full tone={lineMenu.discount ? 'warn' : 'neutral'}
              onClick={() => { const id = lineMenu.id; setLineMenu(null); setDiscounting({ mode: 'line', lineId: id }) }}
              label={lineMenu.discount
                ? `${lineMenu.discount.kind === 'comp' ? 'On the house' : `${Math.round(lineMenu.discount.percent * 100)}% off`} — change`
                : 'Comp or discount this item'}
            />
          )}

          <SectionLabel icon={faBan} colour="var(--red)">Void — why?</SectionLabel>

          {/* Food already sent is a manager's to void (UPGRADE.md T5.1). The
              server refuses it anyway; this says so before anybody tries. */}
          {reversalRefusal(role, lineMenu.status === 'sent' ? 'void-sent' : 'void-unsent') ? (
            <p style={{ color: 'rgba(var(--offwhite-rgb),0.75)', fontSize: '0.95rem', lineHeight: 1.6, margin: '0.2rem 0 0.4rem' }}>
              {reversalRefusal(role, 'void-sent')}
            </p>
          ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.5rem' }}>
            {VOID_REASONS.map(r => {
              // The consequence is spelled out only where stock actually
              // moves: merchandise, and — with the `recipes` switch on — a
              // dish whose ingredients were snapshotted when it was added.
              // "Goes back into stock" under a cappuccino with no recipe
              // would be noise at best and a lie at worst.
              const sent = lineMenu.status === 'sent'
              const showsStock = lineMenu.source === 'product' && sent
              const showsIngredients = lineMenu.source === 'menu' && sent
                && ((lineMenu.consumesPerServing?.length ?? 0) > 0 || (lineMenu.consumesUnknown?.length ?? 0) > 0)
              // Waste first, the same precedence as ingredientOutcome() in
              // recipes.ts, so the hint cannot promise what the server won't do.
              const ingredientHint = r.isWaste
                ? 'ingredients recorded as waste'
                : r.returnsToStock ? 'ingredients go back into stock' : 'ingredients used'
              const hint = showsStock
                ? (r.returnsToStock ? 'goes back on the shelf' : 'not returned to stock')
                : showsIngredients ? ingredientHint : null
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => {
                    // "Other" needs a few words on what happened, in its own sheet.
                    if (r.key === 'other') { setOtherVoid(lineMenu.id); setLineMenu(null); return }
                    handleVoid(lineMenu.id, r.key, '')
                  }}
                  style={{
                    minHeight: '64px', borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
                    padding: '0.6rem 0.9rem', fontFamily: 'var(--font-inter)',
                    // Waste reasons in red: the food is gone. The others are
                    // still a void, so still outlined red, but quieter.
                    backgroundColor: r.isWaste ? 'rgba(var(--red-rgb),0.12)' : 'rgba(var(--overlay-rgb),0.04)',
                    border: `1px solid ${r.isWaste ? 'rgba(var(--red-rgb),0.6)' : 'rgba(var(--red-rgb),0.3)'}`,
                    color: 'var(--offwhite)',
                    display: 'flex', alignItems: 'center', gap: '0.7rem',
                  }}
                >
                  <FontAwesomeIcon icon={r.isWaste ? faTrashCan : faRotateLeft}
                    style={{ color: r.isWaste ? 'var(--red)' : 'rgba(var(--offwhite-rgb),0.6)', fontSize: '1.1rem', width: '1.2rem' }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 600 }}>{r.label}</span>
                    {hint && (
                      <span style={{
                        fontSize: '0.82rem',
                        color: hint === 'goes back on the shelf' || hint === 'ingredients go back into stock' ? 'var(--teal)' : 'rgba(var(--red-rgb),0.85)',
                      }}>{hint}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
          )}

          <div style={{ marginTop: '1rem' }}>
            <PosButton icon={faXmark} label="Cancel" tone="quiet" full onClick={() => setLineMenu(null)} />
          </div>
        </Sheet>
      )}

      {/* Check options. Staff meal is not destructive and sits first; the two
          that change or end the check are below a divider, so the thumb has to
          travel to reach them. */}
      {actions && (
        <Sheet label="Check options" onClose={() => setActions(false)}>
          <h2 style={{ ...sheetTitle, marginBottom: '1rem' }}>Table {check.tableNumber}</h2>

          <PosButton
            icon={check.staffDiscount ? faCheck : faUtensils} full
            tone={check.staffDiscount ? 'warn' : 'neutral'}
            onClick={async () => {
              setActions(false)
              setError('')
              try { await setStaffMeal(checkId, !check.staffDiscount) }
              catch (err) { setError(err instanceof Error ? err.message : 'Could not change that.') }
            }}
            label={check.staffDiscount ? 'Staff meal — tap to remove' : 'Mark as a staff meal'}
          />

          {/* A ticket lost, spilled on or printed badly (UPGRADE.md T3.6): marked REPRINT on the paper. */}
          {check.lines.some(l => l.status === 'sent' && !l.madeOffline) && (
            <div style={{ marginTop: '0.6rem' }}>
              <PosButton icon={faReceipt} full tone="neutral"
                label="Print the kitchen tickets again"
                onClick={async () => {
                  setActions(false)
                  setError('')
                  try {
                    const done = await reprintKitchenTickets(checkId)
                    setPrintedAgain(`${done.count === 1 ? 'The ticket is' : `${done.count} tickets are`} printing again (${done.stations.join(', ')}), marked as a reprint.`)
                  } catch (err) { setError(err instanceof Error ? err.message : 'Could not print them again.') }
                }}
              />
            </div>
          )}

          <div style={{ height: '1px', background: 'rgba(var(--overlay-rgb),0.1)', margin: '1.1rem 0' }} />

          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {canDiscount && (check.payments ?? []).length === 0 && (
              <PosButton
                icon={faPercent} full tone={check.discount ? 'warn' : 'neutral'}
                onClick={() => { setActions(false); setDiscounting({ mode: 'check' }) }}
                label={check.discount
                  ? `${check.discount.kind === 'percent'
                      ? `${Math.round(check.discount.value * 100)}% off the check`
                      : `$${check.discount.value.toFixed(2)} off the check`} — change`
                  : 'Discount the check'}
              />
            )}

            {loyaltyOn && (
              <PosButton
                icon={faUserTag} full tone={check.loyalty ? 'warn' : 'neutral'}
                onClick={() => { setActions(false); setAddingCustomer(true) }}
                label={check.loyalty ? `Loyalty: ${check.loyalty.name}` : 'Add loyalty customer'}
              />
            )}

            {canDiscount && serviceRate(check.serviceCharge) > 0 && (check.payments ?? []).length === 0 && (
              <PosButton icon={faPercent} full tone="neutral"
                label={`Take off the ${+(serviceRate(check.serviceCharge) * 100).toFixed(2)}% service charge`}
                onClick={async () => {
                  setActions(false)
                  setError('')
                  try { await removeServiceCharge(checkId) }
                  catch (err) { setError(err instanceof Error ? err.message : 'Could not take it off.') }
                }} />
            )}

            <PosButton icon={faArrowRightArrowLeft} label="Move to another table" full tone="neutral"
              onClick={() => { setActions(false); setMoving(true) }} />

            <PosButton
              icon={takesPayment ? faCashRegister : faReceipt} full tone="primary" size="lg"
              onClick={() => { setActions(false); if (takesPayment) setPaying(true); else setClosing(true) }}
              label={takesPayment ? 'Take payment and close' : 'Close this check'}
            />
          </div>

          <div style={{ marginTop: '1.1rem' }}>
            <PosButton icon={faXmark} label="Cancel" tone="quiet" full onClick={() => setActions(false)} />
          </div>
        </Sheet>
      )}

      {/* Closing had no confirmation at all, and it cannot be undone — the
          table goes free and the check leaves the floor. */}
      {closing && (
        <Sheet label="Close the check" onClose={() => setClosing(false)}>
          <h2 style={{ ...sheetTitle, marginBottom: '0.5rem' }}>Close table {check.tableNumber}?</h2>
          <p style={{ fontSize: '1rem', color: 'rgba(var(--offwhite-rgb),0.6)', lineHeight: 1.7, marginBottom: '1.2rem' }}>
            {money(totals.net)} across {check.lines.filter(l => l.status !== 'void').length} items.
            The table goes free and this check leaves the floor. It cannot be reopened.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <PosButton icon={faArrowLeft} label="Keep it open" tone="quiet" grow={1} onClick={() => setClosing(false)} />
            <PosButton icon={faXmark} label="Close" tone="danger" size="lg" grow={2}
              style={{ background: 'var(--red)', color: '#fff', border: '2px solid var(--red)' }}
              onClick={() => { setClosing(false); handleClose() }} />
          </div>
        </Sheet>
      )}

      {discounting && (() => {
        // Read from the live check, so the sheet shows the discount as it is
        // now — another manager may have changed it a moment ago.
        const line = discounting.mode === 'line' ? check.lines.find(l => l.id === discounting.lineId) : undefined
        if (discounting.mode === 'line' && !line) return null
        return (
          <DiscountSheet
            target={line
              ? { mode: 'line', checkId, line }
              : { mode: 'check', checkId, current: check.discount ?? null }}
            onDone={() => setDiscounting(null)}
          />
        )
      })()}

      {addingCustomer && (
        <CustomerSheet check={check} onDone={() => setAddingCustomer(false)} />
      )}

      {paying && (
        <PaySheet
          check={check}
          liveRate={business.exchangeRate}
          onDismiss={() => setPaying(false)}
          onPaid={() => { setPaying(false); handleClose() }}
        />
      )}

      {leaving && (
        <Sheet label="Items not sent" onClose={() => setLeaving(false)}>
          <h2 style={{ ...sheetTitle, marginBottom: '0.5rem' }}>
            {drafts.length === 1 ? 'One item is' : `${drafts.length} items are`} not sent yet
          </h2>
          <p style={{ fontSize: '1rem', lineHeight: 1.6, color: 'rgba(var(--offwhite-rgb),0.7)', marginBottom: '1.1rem' }}>
            The kitchen has not seen {drafts.length === 1 ? 'it' : 'them'}. {drafts.length === 1 ? 'It stays' : 'They stay'} on this device, waiting on table {check.tableNumber} until you send.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <PosButton icon={faArrowLeft} label="Leave for the floor" tone="quiet" grow={1} onClick={() => router.push('/pos')} />
            <PosButton icon={faPaperPlane} label="Stay and send" tone="primary" size="lg" grow={2} onClick={() => setLeaving(false)} />
          </div>
        </Sheet>
      )}

      {noteFor !== null && drafts[noteFor] && (
        <TextSheet
          title="Note for the kitchen"
          initial={drafts[noteFor].note}
          placeholder="e.g. no onions, nut allergy"
          submitLabel="Save note"
          onCancel={() => setNoteFor(null)}
          onSubmit={text => {
            const at = noteFor
            setDrafts(list => list.map((x, n) => (n === at ? { ...x, note: text } : x)))
            setNoteFor(null)
          }}
        />
      )}

      {otherVoid && (
        <TextSheet
          title="What happened?"
          placeholder="A few words for the record"
          required
          danger
          submitLabel="Void it"
          onCancel={() => setOtherVoid(null)}
          onSubmit={text => { const lineId = otherVoid; setOtherVoid(null); void handleVoid(lineId, 'other', text) }}
        />
      )}

      {moving && (
        <Sheet label="Move to another table" onClose={() => setMoving(false)} onSubmit={() => { if (moveTo) void handleMove() }}>
          <h2 style={{ ...sheetTitle, marginBottom: '1rem' }}>Move to which table?</h2>

          {/* Typed, the same way a table is opened — the floor plan is not
              required for the POS to work, so it cannot be the only way to
              name a table here either. */}
          <input
            aria-label="Table number to move to"
            value={moveTo}
            onChange={e => setMoveTo(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            autoFocus
            placeholder="Table number"
            style={{
              width: '100%', minHeight: '68px', textAlign: 'center',
              background: 'rgba(var(--overlay-rgb),0.05)', border: '2px solid rgba(var(--overlay-rgb),0.18)',
              borderRadius: '10px', color: 'var(--offwhite)',
              fontFamily: 'var(--font-cinzel)', fontSize: '2rem', outline: 'none',
            }}
          />

          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
            <PosButton icon={faXmark} label="Cancel" tone="quiet" grow={1} onClick={() => { setMoving(false); setMoveTo('') }} />
            <PosButton icon={faArrowRightArrowLeft} label={`Move to ${moveTo || '…'}`} tone="primary" size="lg" grow={2}
              type="submit" disabled={!moveTo} />
          </div>
        </Sheet>
      )}
    </main>
  )
}
