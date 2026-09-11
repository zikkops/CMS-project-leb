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

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import {
  lineTotal, grossLineTotal, lineDiscount, checkTotals, VOID_REASONS, reconcilePendingBatch,
  type CheckLine, type StaffDiscount,
} from '@big-cms/shared/checks'
import { minutesWaiting, urgency } from '@big-cms/shared/tickets'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { useFeature } from '@big-cms/shared/useFeatures'
import { useBusinessSettings } from '@big-cms/shared/useBusinessSettings'
import PaySheet from './PaySheet'
import CustomerSheet from './CustomerSheet'
import {
  validateSelection, selectionLabel, lineUnitPrice, describeSelections,
  type ModifierGroup,
} from '@big-cms/shared/modifiers'
import {
  useCheck, usePosMenu, useRetailProducts,
  addLines, sendCheck, voidLine, moveCheck, closeCheck, setStaffMeal,
  type DraftLine, type PosMenuItem, type PosProduct,
} from '../../../lib/usePos'

// Duplicated per file by convention — see CLAUDE.md. Don't refactor to share.
function useIsMobile(breakpoint = 768) {
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
 * Whether two drafts are the same order and should be one line at a quantity.
 *
 * Three taps on Espresso is "3× Espresso", not three lines — on the check, on
 * the kitchen ticket, and in the head of whoever is making them. Anything that
 * differs keeps them apart: a different seat is a different person, a
 * different note is a different plate, a different modifier is a different
 * drink.
 */
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

const URGENCY_COLOUR = {
  fresh: 'rgba(var(--offwhite-rgb),0.45)',
  aging: '#C9962C',
  late: 'var(--red)',
} as const

const sheet: React.CSSProperties = {
  position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50,
}
const sheetInner: React.CSSProperties = {
  backgroundColor: '#111', width: '100%', maxWidth: '640px',
  maxHeight: '88vh', overflowY: 'auto', borderRadius: '10px 10px 0 0',
  padding: '1.25rem 1rem 2rem', border: '1px solid rgba(255,255,255,0.1)',
}
const tap: React.CSSProperties = {
  // 48px floor everywhere: this is used one-handed, standing up.
  minHeight: '48px', borderRadius: '4px', cursor: 'pointer',
  fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
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
      display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
      padding: '0.7rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
      opacity: voided ? 0.35 : 1,
    }}>
      <span style={{
        fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--teal)',
        minWidth: '1.6rem', fontWeight: 600,
      }}>{line.quantity}×</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.9rem', color: 'var(--offwhite)',
          textDecoration: voided ? 'line-through' : 'none',
        }}>{line.name}</p>

        {line.modifiers.length > 0 && (
          <p style={{ fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.45)', marginTop: '0.15rem' }}>
            {describeSelections(line.modifiers)}
          </p>
        )}
        {line.note && (
          <p style={{ fontSize: '0.72rem', color: 'var(--brand-secondary)', marginTop: '0.15rem' }}>{line.note}</p>
        )}

        <p style={{ fontSize: '0.68rem', color: 'rgba(var(--offwhite-rgb),0.3)', marginTop: '0.25rem' }}>
          {line.seat !== null ? `Seat ${line.seat}` : 'Table'}
          {line.course !== null && ` · Course ${line.course}`}
          {' · '}
          {voided
            ? `Voided — ${line.voidReason}`
            : mins !== null
              ? <>Sent <span style={{ color: URGENCY_COLOUR[urgency(mins)] }}>{mins}m ago</span></>
              : 'Not sent'}
        </p>
      </div>

      <div style={{ textAlign: 'right' }}>
        <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--offwhite)' }}>
          {money(lineTotal(line, discount))}
        </p>
        {off > 0 && (
          <p style={{
            fontSize: '0.65rem', color: 'var(--teal)', marginTop: '0.1rem',
          }}>was {money(grossLineTotal(line))}</p>
        )}
        {/* Not a Void button sitting on every line. Striking an order off is
            one mis-tap away from a plate the kitchen has already started, and
            a phone held one-handed on a moving floor is where mis-taps
            happen. This opens the options; the destructive one is behind it,
            with a reason required after that. */}
        {onMore && (
          <button
            onClick={onMore}
            aria-label="Line options"
            style={{
              marginTop: '0.3rem', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px',
              width: '32px', minHeight: '28px', cursor: 'pointer',
              color: 'rgba(var(--offwhite-rgb),0.45)', fontSize: '0.9rem', lineHeight: 1,
              fontFamily: 'var(--font-inter)',
            }}
          >⋯</button>
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
      display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
      padding: '0.7rem 0', borderBottom: '1px solid rgba(var(--brand-secondary-rgb),0.2)',
      opacity: locked ? 0.7 : 1,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.15rem',
        pointerEvents: locked ? 'none' : 'auto', visibility: locked ? 'hidden' : 'visible',
      }}>
        <button onClick={() => onQuantity(draft.quantity - 1)} style={{
          width: '30px', minHeight: '30px', borderRadius: '3px', cursor: 'pointer',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(var(--offwhite-rgb),0.6)', fontFamily: 'var(--font-inter)', fontSize: '0.9rem',
        }}>−</button>
        <span style={{
          fontSize: '0.85rem', color: 'var(--brand-secondary)', minWidth: '1.7rem',
          fontWeight: 600, textAlign: 'center',
        }}>{draft.quantity}×</span>
        <button onClick={() => onQuantity(draft.quantity + 1)} style={{
          width: '30px', minHeight: '30px', borderRadius: '3px', cursor: 'pointer',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(var(--offwhite-rgb),0.6)', fontFamily: 'var(--font-inter)', fontSize: '0.9rem',
        }}>+</button>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '0.9rem', color: 'var(--offwhite)' }}>{draft.name}</p>
        {draft.modifierLabel && (
          <p style={{ fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.45)' }}>{draft.modifierLabel}</p>
        )}
        {draft.note && (
          <p style={{ fontSize: '0.75rem', color: 'var(--brand-secondary)', marginTop: '0.1rem', fontWeight: 600 }}>
            {draft.note}
          </p>
        )}
        <p style={{ fontSize: '0.68rem', color: 'var(--brand-secondary)', marginTop: '0.25rem' }}>
          {draft.seat !== null ? `Seat ${draft.seat} · ` : ''}
          {draft.course !== null ? `Course ${draft.course} · ` : ''}
          {locked ? 'Sending — waiting to hear back' : 'On this phone — not sent'}
        </p>
        <button onClick={onNote} disabled={locked} style={{
          visibility: locked ? 'hidden' : 'visible',
          background: 'none', border: 'none', padding: '0.25rem 0', cursor: 'pointer',
          color: 'rgba(var(--offwhite-rgb),0.4)', fontSize: '0.68rem',
          fontFamily: 'var(--font-inter)', letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>{draft.note ? 'Edit note' : '+ Note'}</button>
      </div>
      <div style={{ textAlign: 'right' }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--offwhite)' }}>
          {money(lineUnitPrice(draft.unitPrice, []) * draft.quantity)}
        </p>
        <button onClick={onRemove} disabled={locked} style={{
          visibility: locked ? 'hidden' : 'visible',
          marginTop: '0.3rem', background: 'none', border: 'none', padding: '0.25rem 0',
          color: 'rgba(var(--offwhite-rgb),0.4)', fontSize: '0.68rem', cursor: 'pointer',
          fontFamily: 'var(--font-inter)', letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>Remove</button>
      </div>
    </div>
  )
}

/** Choosing modifiers for one item, before it joins the draft. */
function ModifierSheet({
  item, groups, onCancel, onAdd,
}: {
  item: PosMenuItem
  groups: ModifierGroup[]
  onCancel: () => void
  onAdd: (optionIds: string[], label: string) => void
}) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({})

  function toggle(group: ModifierGroup, optionId: string) {
    setChosen(prev => {
      const current = prev[group.id] ?? []
      const has = current.includes(optionId)
      // A max of one behaves like a radio: tapping another replaces it rather
      // than failing validation afterwards and making the waiter work it out.
      if (!has && group.maxSelections === 1) return { ...prev, [group.id]: [optionId] }
      return {
        ...prev,
        [group.id]: has ? current.filter(id => id !== optionId) : [...current, optionId],
      }
    })
  }

  // The same rule the server enforces, so Add is greyed for exactly the
  // reasons a request would be refused.
  const problem = groups
    .map(g => validateSelection(g, chosen[g.id] ?? []))
    .find(Boolean) ?? null

  const allIds = groups.flatMap(g => chosen[g.id] ?? [])
  const label = groups
    .flatMap(g => (chosen[g.id] ?? []).map(id => g.options.find(o => o.id === id)?.name ?? ''))
    .filter(Boolean).join(', ')
  const extra = groups.reduce((sum, g) =>
    sum + (chosen[g.id] ?? []).reduce((s, id) =>
      s + (g.options.find(o => o.id === id)?.priceDelta ?? 0), 0), 0)

  return (
    <div style={sheet} onClick={onCancel}>
      <div style={sheetInner} onClick={e => e.stopPropagation()}>
        <h2 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem', color: 'var(--offwhite)',
          marginBottom: '1rem',
        }}>{item.name}</h2>

        {groups.map(g => (
          <div key={g.id} style={{ marginBottom: '1.25rem' }}>
            <p style={{
              fontSize: '0.66rem', letterSpacing: '0.14em', textTransform: 'uppercase',
              color: 'rgba(var(--offwhite-rgb),0.4)', marginBottom: '0.5rem',
            }}>{g.name} · {selectionLabel(g)}</p>

            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {g.options.map(o => {
                const on = (chosen[g.id] ?? []).includes(o.id)
                return (
                  <button key={o.id} onClick={() => toggle(g, o.id)} style={{
                    ...tap, textAlign: 'left', padding: '0.7rem 0.9rem',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    backgroundColor: on ? 'rgba(var(--teal-rgb),0.18)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${on ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`,
                    color: 'var(--offwhite)',
                  }}>
                    <span>{o.name}</span>
                    {o.priceDelta > 0 && (
                      <span style={{ color: 'rgba(var(--offwhite-rgb),0.45)' }}>+{money(o.priceDelta)}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {problem && (
          <p style={{ color: 'var(--brand-secondary)', fontSize: '0.78rem', marginBottom: '0.8rem' }}>{problem}</p>
        )}

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button onClick={onCancel} style={{
            ...tap, flex: 1, backgroundColor: 'transparent',
            border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(var(--offwhite-rgb),0.6)',
          }}>Cancel</button>
          <button
            disabled={Boolean(problem)}
            onClick={() => onAdd(allIds, label)}
            style={{
              ...tap, flex: 2, border: 'none',
              backgroundColor: problem ? 'rgba(var(--teal-rgb),0.25)' : 'var(--teal)',
              color: '#fff', cursor: problem ? 'default' : 'pointer',
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}
          >Add {money(item.price + extra)}</button>
        </div>
      </div>
    </div>
  )
}

export default function CheckPage() {
  const { checking, blocked } = useRequireRole(SECTION_ACCESS.pos, { login: '/pos/login', home: '/pos' })
  const isMobile = useIsMobile()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const checkId = String(params?.id ?? '')

  const { check, error: liveError } = useCheck(checkId)
  const { products } = useRetailProducts(check?.branch ?? '')
  const now = useNow()
  const menu = usePosMenu()
  // Phase 04: with the payments feature on, Close goes through the payment
  // sheet. Off — the pilot — it is the v1 confirmation, unchanged.
  const { on: takesPayment } = useFeature('payments')
  // Phase 04, slice 5: a loyalty customer can be put on the check, and their
  // points land when it closes. Off, the button is not there.
  const { on: loyaltyOn } = useFeature('loyalty')
  const { settings: business } = useBusinessSettings()

  const [drafts, setDrafts] = useState<DraftLine[]>([])
  const [picking, setPicking] = useState(false)
  // 'retail' is a tab, not a category. Merchandise has no menu category and
  // never will — it is a different catalogue with a different stock model,
  // which is the entire point of it being on the same check.
  const [category, setCategory] = useState<string>('')
  const [course, setCourse] = useState<number | null>(null)
  const [modifierFor, setModifierFor] = useState<PosMenuItem | null>(null)
  const [seat, setSeat] = useState<number | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [moving, setMoving] = useState(false)
  const [actions, setActions] = useState(false)
  const [lineMenu, setLineMenu] = useState<CheckLine | null>(null)
  const [closing, setClosing] = useState(false)
  const [paying, setPaying] = useState(false)
  const [addingCustomer, setAddingCustomer] = useState(false)
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

  const categories = useMemo(
    () => menu.categories.filter(c => menu.items.some(i => i.categoryId === c.id)),
    [menu.categories, menu.items],
  )
  // Derived, not stored with an effect to seed it. Setting state during an
  // effect to supply a default renders once with nothing selected and again
  // with the default — and React flags it, because that is a cascading render
  // for a value that was always computable.
  const activeCategory = category || categories[0]?.id || ''

  const shown = useMemo(
    () => menu.items.filter(i => i.categoryId === activeCategory && i.available),
    [menu.items, activeCategory],
  )

  function addDraft(item: PosMenuItem, optionIds: string[], label: string) {
    if (draftsLocked) return
    setDrafts(d => withDraft(d, {
      source: 'menu', refId: item.id, name: item.name, unitPrice: item.price,
      quantity: 1, modifierOptionIds: optionIds, modifierLabel: label,
      seat, course, note: '',
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
      seat, course: null, note: '',
    }))
  }

  function pick(item: PosMenuItem) {
    const groups = item.modifierGroupIds.map(id => menu.groups[id]).filter(Boolean)
    if (groups.length > 0) { setModifierFor(item); return }
    addDraft(item, [], '')
  }

  async function handleSend() {
    setBusy('Sending…')
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
      const tickets = await sendCheck(checkId)
      setPendingKey(null)
      setBusy(tickets.length > 0
        ? `Sent — ${tickets.map(t => `${t.station} ×${t.lines}`).join(', ')}`
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
          ? 'No connection. The order is still on this phone and may already have reached the server — tap Send again when you are back on the wifi; it will not be sent twice. If the wifi stays down, take it to the till.'
          : 'No connection. The order is on the check but may not have reached the kitchen — tap Send again when you are back on the wifi.')
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
    try { await closeCheck(checkId); router.push('/pos') }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not close.') }
  }

  if (blocked) { router.replace('/pos'); return null }
  if (checking) return null
  if (!check) {
    return (
      <main style={{
        minHeight: '100vh', backgroundColor: 'var(--black)', padding: '3rem 1.25rem',
        fontFamily: 'var(--font-inter)', color: 'rgba(var(--offwhite-rgb),0.4)', textAlign: 'center',
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
  const unsentOnServer = check.lines.filter(l => l.status === 'draft').length
  const canSend = drafts.length > 0 || unsentOnServer > 0

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      fontFamily: 'var(--font-inter)', paddingBottom: '6rem',
    }}>
      <div style={{ maxWidth: '640px', margin: '0 auto', padding: isMobile ? '1.25rem 1rem' : '2rem' }}>

        <button onClick={() => router.push('/pos')} style={{
          background: 'none', border: 'none', padding: '0.3rem 0', cursor: 'pointer',
          color: 'rgba(var(--offwhite-rgb),0.35)', fontSize: '0.7rem', letterSpacing: '0.14em',
          textTransform: 'uppercase', fontFamily: 'var(--font-inter)', marginBottom: '0.6rem',
        }}>← Floor</button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1.25rem' }}>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', color: 'var(--offwhite)' }}>
            Table {check.tableNumber}
          </h1>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '1.1rem', color: 'var(--teal)', fontWeight: 600 }}>
              {money(totals.net + draftTotal)}
            </span>
            {/* Shown as its own figure rather than folded into the total: a
                staff meal that quietly shows a smaller number is one nobody
                can audit. */}
            {totals.discount > 0 && (
              <p style={{ fontSize: '0.7rem', color: 'rgba(var(--offwhite-rgb),0.4)', marginTop: '0.15rem' }}>
                {money(totals.gross)} − {money(totals.discount)} staff
              </p>
            )}
          </div>
        </div>

        {liveError && (
          <p style={{
            color: 'var(--brand-secondary)', fontSize: '0.82rem', marginBottom: '1rem', lineHeight: 1.6,
            background: 'rgba(var(--brand-secondary-rgb),0.08)', border: '1px solid rgba(var(--brand-secondary-rgb),0.25)',
            borderRadius: '3px', padding: '0.7rem 0.9rem',
          }}>{liveError}</p>
        )}

        {error && (
          <p style={{
            color: 'var(--red)', fontSize: '0.82rem', marginBottom: '1rem',
            background: 'rgba(var(--red-rgb),0.08)', border: '1px solid rgba(var(--red-rgb),0.25)',
            borderRadius: '3px', padding: '0.7rem 0.9rem',
          }}>{error}</p>
        )}
        {busy && (
          <p style={{ color: 'var(--teal)', fontSize: '0.82rem', marginBottom: '1rem' }}>{busy}</p>
        )}

        {check.lines.length === 0 && drafts.length === 0 && (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontSize: '0.88rem', padding: '2rem 0' }}>
            Nothing ordered yet.
          </p>
        )}

        {check.lines.map(l => (
          <LineRow key={l.id} line={l} now={now} discount={check.staffDiscount ?? null}
            onMore={l.status === 'void' ? null : () => setLineMenu(l)} />
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
            onNote={() => {
              // A prompt rather than a sheet: this is the rare path, and an
              // allergy typed on a moving floor wants the fewest taps between
              // thinking it and it being on the ticket.
              const next = window.prompt('Note for the kitchen', d.note)
              if (next === null) return
              setDrafts(list => list.map((x, n) =>
                n === i ? { ...x, note: next.trim().slice(0, 200) } : x))
            }}
          />
        ))}

        {/* One button rather than three in a row. Closing a check and moving
            a table sat directly under the order, a thumb's width from it. */}
        <button onClick={() => setActions(true)} style={{
          ...tap, width: '100%', marginTop: '1.5rem', backgroundColor: 'transparent',
          border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(var(--offwhite-rgb),0.55)',
        }}>Check options{check.staffDiscount ? ' · staff meal on' : ''}</button>
      </div>

      {/* Sticky, because a waiter's thumb lives at the bottom of the screen. */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(10,10,10,0.96)', borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: '0.8rem 1rem', display: 'flex', gap: '0.6rem',
        maxWidth: '640px', margin: '0 auto',
      }}>
        <button onClick={() => setPicking(true)} disabled={draftsLocked} style={{
          ...tap, flex: 1, backgroundColor: 'rgba(255,255,255,0.05)',
          opacity: draftsLocked ? 0.4 : 1,
          border: '1px solid rgba(255,255,255,0.14)', color: 'var(--offwhite)',
        }}>Add items</button>
        <button
          disabled={!canSend || Boolean(busy)}
          onClick={handleSend}
          style={{
            ...tap, flex: 1, border: 'none', color: '#fff',
            backgroundColor: canSend && !busy ? 'var(--teal)' : 'rgba(var(--teal-rgb),0.25)',
            cursor: canSend && !busy ? 'pointer' : 'default',
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}
        >Send{drafts.length + unsentOnServer > 0 ? ` ${drafts.length + unsentOnServer}` : ''}</button>
      </div>

      {picking && (
        <div style={sheet} onClick={() => setPicking(false)}>
          <div style={sheetInner} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
              <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem', color: 'var(--offwhite)' }}>
                Add items
              </h2>
              <button onClick={() => setPicking(false)} style={{
                background: 'none', border: 'none', color: 'rgba(var(--offwhite-rgb),0.5)',
                fontSize: '0.8rem', cursor: 'pointer', padding: '0.5rem',
              }}>Done</button>
            </div>

            {/* Seat is chosen once and sticks, because a waiter takes a whole
                seat's order before moving round the table. */}
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
              <button onClick={() => setSeat(null)} style={{
                ...tap, minHeight: '40px', padding: '0 0.8rem',
                backgroundColor: seat === null ? 'rgba(var(--teal-rgb),0.18)' : 'transparent',
                border: `1px solid ${seat === null ? 'var(--teal)' : 'rgba(255,255,255,0.12)'}`,
                color: 'var(--offwhite)', fontSize: '0.75rem',
              }}>Table</button>
              {Array.from({ length: Math.max(check.guestCount, 4) }, (_, n) => n + 1).map(s => (
                <button key={s} onClick={() => setSeat(s)} style={{
                  ...tap, minHeight: '40px', padding: '0 0.8rem',
                  backgroundColor: seat === s ? 'rgba(var(--teal-rgb),0.18)' : 'transparent',
                  border: `1px solid ${seat === s ? 'var(--teal)' : 'rgba(255,255,255,0.12)'}`,
                  color: 'var(--offwhite)', fontSize: '0.75rem',
                }}>{s}</button>
              ))}
            </div>

            {/* Course paces the kitchen: starters fire, mains wait. Sticky
                like seat, and off by default because most orders have one
                course and nobody should have to say so. */}
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.9rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.3)', marginRight: '0.2rem' }}>Course</span>
              <button onClick={() => setCourse(null)} style={{
                ...tap, minHeight: '40px', padding: '0 0.8rem',
                backgroundColor: course === null ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: `1px solid ${course === null ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)'}`,
                color: 'var(--offwhite)', fontSize: '0.75rem',
              }}>Any</button>
              {[1, 2, 3].map(c => (
                <button key={c} onClick={() => setCourse(c)} style={{
                  ...tap, minHeight: '40px', padding: '0 0.8rem',
                  backgroundColor: course === c ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: `1px solid ${course === c ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)'}`,
                  color: 'var(--offwhite)', fontSize: '0.75rem',
                }}>{c}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.9rem', overflowX: 'auto', paddingBottom: '0.3rem' }}>
              {categories.map(c => (
                <button key={c.id} onClick={() => setCategory(c.id)} style={{
                  ...tap, minHeight: '40px', padding: '0 0.9rem', whiteSpace: 'nowrap',
                  backgroundColor: activeCategory === c.id ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: `1px solid ${activeCategory === c.id ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}`,
                  color: 'var(--offwhite)', fontSize: '0.78rem',
                }}>{c.name}</button>
              ))}
              {/* The differentiator, one tab along from the coffee. */}
              <button onClick={() => setCategory('retail')} style={{
                ...tap, minHeight: '40px', padding: '0 0.9rem', whiteSpace: 'nowrap',
                backgroundColor: activeCategory === 'retail' ? 'rgba(var(--brand-secondary-rgb),0.15)' : 'transparent',
                border: `1px solid ${activeCategory === 'retail' ? 'var(--brand-secondary)' : 'rgba(255,255,255,0.1)'}`,
                color: 'var(--offwhite)', fontSize: '0.78rem',
              }}>Retail</button>
            </div>

            {activeCategory === 'retail' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {products.map(p => (
                  <button key={p.id} onClick={() => addProduct(p)} style={{
                    ...tap, minHeight: '64px', padding: '0.6rem 0.7rem', textAlign: 'left',
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.1)', color: 'var(--offwhite)',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.2rem',
                  }}>
                    <span style={{ fontSize: '0.82rem' }}>{p.name}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--teal)' }}>
                      {money(p.price)}{p.onSale && <span style={{ color: 'var(--brand-secondary)' }}> on sale</span>}
                    </span>
                    {/* Shown, never enforced. A till must not refuse a sale
                        because a count is stale — the customer is holding the
                        thing. Negative is a discrepancy to reconcile, not a
                        reason to turn somebody away. */}
                    <span style={{
                      fontSize: '0.65rem',
                      color: p.stock > 0 ? 'rgba(var(--offwhite-rgb),0.3)' : 'var(--red)',
                    }}>{p.stock} in stock</span>
                  </button>
                ))}
                {products.length === 0 && (
                  <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontSize: '0.82rem', gridColumn: '1 / -1' }}>
                    Nothing in the retail catalogue yet.
                  </p>
                )}
              </div>
            ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {shown.map(i => (
                <button key={i.id} onClick={() => pick(i)} style={{
                  ...tap, minHeight: '64px', padding: '0.6rem 0.7rem', textAlign: 'left',
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.1)', color: 'var(--offwhite)',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.2rem',
                }}>
                  <span style={{ fontSize: '0.82rem' }}>{i.name}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--teal)' }}>{money(i.price)}</span>
                </button>
              ))}
              {shown.length === 0 && (
                <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontSize: '0.82rem', gridColumn: '1 / -1' }}>
                  Nothing available in this category.
                </p>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {modifierFor && (
        <ModifierSheet
          item={modifierFor}
          groups={modifierFor.modifierGroupIds.map(id => menu.groups[id]).filter(Boolean)}
          onCancel={() => setModifierFor(null)}
          onAdd={(ids, label) => addDraft(modifierFor, ids, label)}
        />
      )}

      {/* Line options. The void is the only destructive thing here, so it is
          the only one coloured as such, and it still asks for a reason after
          this. Two deliberate taps and a sentence — a mis-tap does not get
          past the first. */}
      {lineMenu && (
        <div style={sheet} onClick={() => setLineMenu(null)}>
          <div style={sheetInner} onClick={e => e.stopPropagation()}>
            <h2 style={{
              fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem',
              color: 'var(--offwhite)', marginBottom: '0.3rem',
            }}>{lineMenu.quantity}× {lineMenu.name}</h2>
            <p style={{
              fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.35)', marginBottom: '1.2rem',
            }}>
              {lineMenu.status === 'sent'
                ? 'Already sent to the kitchen. Voiding it tells the pass.'
                : 'Not sent yet.'}
            </p>

            <p style={{
              fontSize: '0.64rem', letterSpacing: '0.14em', textTransform: 'uppercase',
              color: 'rgba(var(--offwhite-rgb),0.35)', marginBottom: '0.5rem',
            }}>Void — why?</p>

            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {VOID_REASONS.map(r => {
                // Merchandise is the only thing where this changes stock, so
                // it is the only place the consequence is worth spelling out.
                // Saying "goes back on the shelf" under a cappuccino would be
                // noise at best and a lie at worst.
                const showsStock = lineMenu.source === 'product' && lineMenu.status === 'sent'
                return (
                  <button
                    key={r.key}
                    onClick={() => {
                      const note = r.key === 'other'
                        ? (window.prompt('What happened?') ?? '')
                        : ''
                      if (r.key === 'other' && !note.trim()) return
                      handleVoid(lineMenu.id, r.key, note)
                    }}
                    style={{
                      ...tap, width: '100%', textAlign: 'left', padding: '0.6rem 0.9rem',
                      backgroundColor: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.12)', color: 'var(--offwhite)',
                      display: 'flex', flexDirection: 'column', gap: '0.15rem',
                    }}
                  >
                    <span>{r.label}</span>
                    {showsStock && (
                      <span style={{
                        fontSize: '0.68rem',
                        color: r.returnsToStock ? 'var(--teal)' : 'rgba(var(--red-rgb),0.7)',
                      }}>
                        {r.returnsToStock ? 'goes back on the shelf' : 'not returned to stock'}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <button onClick={() => setLineMenu(null)} style={{
              ...tap, width: '100%', marginTop: '0.9rem', backgroundColor: 'transparent',
              border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(var(--offwhite-rgb),0.6)',
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Check options. Staff meal is not destructive and sits first; the two
          that change or end the check are below a divider, so the thumb has to
          travel to reach them. */}
      {actions && (
        <div style={sheet} onClick={() => setActions(false)}>
          <div style={sheetInner} onClick={e => e.stopPropagation()}>
            <h2 style={{
              fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem',
              color: 'var(--offwhite)', marginBottom: '1rem',
            }}>Table {check.tableNumber}</h2>

            <button
              onClick={async () => {
                setActions(false)
                setError('')
                try { await setStaffMeal(checkId, !check.staffDiscount) }
                catch (err) { setError(err instanceof Error ? err.message : 'Could not change that.') }
              }}
              style={{
                ...tap, width: '100%',
                backgroundColor: check.staffDiscount ? 'rgba(var(--teal-rgb),0.18)' : 'transparent',
                border: `1px solid ${check.staffDiscount ? 'var(--teal)' : 'rgba(255,255,255,0.14)'}`,
                color: check.staffDiscount ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.7)',
              }}
            >{check.staffDiscount ? '✓ Staff meal — tap to remove' : 'Mark as a staff meal'}</button>

            <div style={{
              height: '1px', background: 'rgba(255,255,255,0.08)', margin: '1.2rem 0',
            }} />

            {loyaltyOn && (
              <button
                onClick={() => { setActions(false); setAddingCustomer(true) }}
                style={{
                  ...tap, width: '100%', marginBottom: '0.6rem', backgroundColor: 'transparent',
                  border: `1px solid ${check.loyalty ? 'var(--teal)' : 'rgba(255,255,255,0.14)'}`,
                  color: check.loyalty ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.7)',
                }}
              >{check.loyalty ? `Loyalty: ${check.loyalty.name}` : 'Add loyalty customer'}</button>
            )}

            <button
              onClick={() => { setActions(false); setMoving(true) }}
              style={{
                ...tap, width: '100%', backgroundColor: 'transparent',
                border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(var(--offwhite-rgb),0.7)',
              }}
            >Move to another table</button>

            <button
              onClick={() => { setActions(false); if (takesPayment) setPaying(true); else setClosing(true) }}
              style={{
                ...tap, width: '100%', marginTop: '0.6rem', backgroundColor: 'transparent',
                border: '1px solid rgba(var(--red-rgb),0.35)', color: 'var(--red)',
              }}
            >{takesPayment ? 'Take payment and close' : 'Close this check'}</button>

            <button onClick={() => setActions(false)} style={{
              ...tap, width: '100%', marginTop: '1.2rem', backgroundColor: 'transparent',
              border: 'none', color: 'rgba(var(--offwhite-rgb),0.4)',
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Closing had no confirmation at all, and it cannot be undone — the
          table goes free and the check leaves the floor. */}
      {closing && (
        <div style={sheet} onClick={() => setClosing(false)}>
          <div style={sheetInner} onClick={e => e.stopPropagation()}>
            <h2 style={{
              fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem',
              color: 'var(--offwhite)', marginBottom: '0.5rem',
            }}>Close table {check.tableNumber}?</h2>
            <p style={{
              fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.4)',
              lineHeight: 1.7, marginBottom: '1.2rem',
            }}>
              {money(totals.net)} across {check.lines.filter(l => l.status !== 'void').length} items.
              The table goes free and this check leaves the floor. It cannot be reopened.
            </p>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button onClick={() => setClosing(false)} style={{
                ...tap, flex: 1, backgroundColor: 'transparent',
                border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(var(--offwhite-rgb),0.6)',
              }}>Keep it open</button>
              <button
                onClick={() => { setClosing(false); handleClose() }}
                style={{
                  ...tap, flex: 2, border: 'none', backgroundColor: 'var(--red)', color: '#fff',
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                }}
              >Close</button>
            </div>
          </div>
        </div>
      )}

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

      {moving && (
        <div style={sheet} onClick={() => setMoving(false)}>
          <div style={sheetInner} onClick={e => e.stopPropagation()}>
            <h2 style={{
              fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem',
              color: 'var(--offwhite)', marginBottom: '1rem',
            }}>Move to which table?</h2>

            {/* Typed, the same way a table is opened — the floor plan is not
                required for the POS to work, so it cannot be the only way to
                name a table here either. */}
            <input
              value={moveTo}
              onChange={e => setMoveTo(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              autoFocus
              placeholder="Table number"
              style={{
                width: '100%', minHeight: '56px', textAlign: 'center',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '4px', color: 'var(--offwhite)',
                fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', outline: 'none',
              }}
            />

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem' }}>
              <button onClick={() => { setMoving(false); setMoveTo('') }} style={{
                ...tap, flex: 1, backgroundColor: 'transparent',
                border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(var(--offwhite-rgb),0.6)',
              }}>Cancel</button>
              <button
                disabled={!moveTo}
                onClick={handleMove}
                style={{
                  ...tap, flex: 2, border: 'none', color: '#fff',
                  backgroundColor: moveTo ? 'var(--teal)' : 'rgba(var(--teal-rgb),0.25)',
                  cursor: moveTo ? 'pointer' : 'default',
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                }}
              >Move to {moveTo || '…'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
