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
  lineTotal, grossLineTotal, lineDiscount, checkTotals,
  type CheckLine, type StaffDiscount,
} from '@big-cms/shared/checks'
import { minutesWaiting, urgency } from '@big-cms/shared/tickets'
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

const money = (n: number) => `${n.toFixed(2)}`

const URGENCY_COLOUR = {
  fresh: 'rgba(245,242,236,0.45)',
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

function LineRow({ line, now, discount, onVoid }: {
  line: CheckLine
  now: number
  discount: StaffDiscount | null
  onVoid: (() => void) | null
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
          <p style={{ fontSize: '0.75rem', color: 'rgba(245,242,236,0.45)', marginTop: '0.15rem' }}>
            {describeSelections(line.modifiers)}
          </p>
        )}
        {line.note && (
          <p style={{ fontSize: '0.72rem', color: '#C9962C', marginTop: '0.15rem' }}>{line.note}</p>
        )}

        <p style={{ fontSize: '0.68rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.25rem' }}>
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
        {onVoid && (
          <button onClick={onVoid} style={{
            marginTop: '0.3rem', background: 'none', border: 'none', padding: '0.25rem 0',
            color: 'var(--red)', fontSize: '0.68rem', cursor: 'pointer',
            fontFamily: 'var(--font-inter)', letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>Void</button>
        )}
      </div>
    </div>
  )
}

function DraftRow({ draft, onRemove, onNote }: {
  draft: DraftLine
  onRemove: () => void
  onNote: () => void
}) {
  return (
    <div style={{
      display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
      padding: '0.7rem 0', borderBottom: '1px solid rgba(201,150,44,0.2)',
    }}>
      <span style={{ fontSize: '0.85rem', color: '#C9962C', minWidth: '1.6rem', fontWeight: 600 }}>
        {draft.quantity}×
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '0.9rem', color: 'var(--offwhite)' }}>{draft.name}</p>
        {draft.modifierLabel && (
          <p style={{ fontSize: '0.75rem', color: 'rgba(245,242,236,0.45)' }}>{draft.modifierLabel}</p>
        )}
        {draft.note && (
          <p style={{ fontSize: '0.75rem', color: '#C9962C', marginTop: '0.1rem', fontWeight: 600 }}>
            {draft.note}
          </p>
        )}
        <p style={{ fontSize: '0.68rem', color: '#C9962C', marginTop: '0.25rem' }}>
          {draft.seat !== null ? `Seat ${draft.seat} · ` : ''}
          {draft.course !== null ? `Course ${draft.course} · ` : ''}
          On this phone — not sent
        </p>
        <button onClick={onNote} style={{
          background: 'none', border: 'none', padding: '0.25rem 0', cursor: 'pointer',
          color: 'rgba(245,242,236,0.4)', fontSize: '0.68rem',
          fontFamily: 'var(--font-inter)', letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>{draft.note ? 'Edit note' : '+ Note'}</button>
      </div>
      <div style={{ textAlign: 'right' }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--offwhite)' }}>
          {money(lineUnitPrice(draft.unitPrice, []) * draft.quantity)}
        </p>
        <button onClick={onRemove} style={{
          marginTop: '0.3rem', background: 'none', border: 'none', padding: '0.25rem 0',
          color: 'rgba(245,242,236,0.4)', fontSize: '0.68rem', cursor: 'pointer',
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
              color: 'rgba(245,242,236,0.4)', marginBottom: '0.5rem',
            }}>{g.name} · {selectionLabel(g)}</p>

            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {g.options.map(o => {
                const on = (chosen[g.id] ?? []).includes(o.id)
                return (
                  <button key={o.id} onClick={() => toggle(g, o.id)} style={{
                    ...tap, textAlign: 'left', padding: '0.7rem 0.9rem',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    backgroundColor: on ? 'rgba(0,160,152,0.18)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${on ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`,
                    color: 'var(--offwhite)',
                  }}>
                    <span>{o.name}</span>
                    {o.priceDelta > 0 && (
                      <span style={{ color: 'rgba(245,242,236,0.45)' }}>+{money(o.priceDelta)}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {problem && (
          <p style={{ color: '#C9962C', fontSize: '0.78rem', marginBottom: '0.8rem' }}>{problem}</p>
        )}

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button onClick={onCancel} style={{
            ...tap, flex: 1, backgroundColor: 'transparent',
            border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(245,242,236,0.6)',
          }}>Cancel</button>
          <button
            disabled={Boolean(problem)}
            onClick={() => onAdd(allIds, label)}
            style={{
              ...tap, flex: 2, border: 'none',
              backgroundColor: problem ? 'rgba(0,160,152,0.25)' : 'var(--teal)',
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
  const [moveTo, setMoveTo] = useState('')

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
    setDrafts(d => [...d, {
      source: 'menu', refId: item.id, name: item.name, unitPrice: item.price,
      quantity: 1, modifierOptionIds: optionIds, modifierLabel: label,
      seat, course, note: '',
    }])
    setModifierFor(null)
  }

  function addProduct(p: PosProduct) {
    setDrafts(d => [...d, {
      // Merchandise: no modifiers, no course — it is not cooked and does not
      // arrive with anything. The server refuses modifiers on it too.
      source: 'product', refId: p.id, name: p.name, unitPrice: p.price,
      quantity: 1, modifierOptionIds: [], modifierLabel: '',
      seat, course: null, note: '',
    }])
  }

  function pick(item: PosMenuItem) {
    const groups = item.modifierGroupIds.map(id => menu.groups[id]).filter(Boolean)
    if (groups.length > 0) { setModifierFor(item); return }
    addDraft(item, [], '')
  }

  async function handleSend() {
    setBusy('Sending…')
    setError('')
    try {
      // Two calls, one action. If the first succeeds and the second fails the
      // lines are on the check as unsent drafts — visible, recoverable, and
      // the waiter can simply press Send again. The reverse order would risk
      // firing a ticket for lines that never landed.
      if (drafts.length > 0) await addLines(checkId, drafts)
      setDrafts([])
      const tickets = await sendCheck(checkId)
      setBusy(tickets.length > 0
        ? `Sent — ${tickets.map(t => `${t.station} ×${t.lines}`).join(', ')}`
        : 'Sent')
      setTimeout(() => setBusy(''), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send.')
      setBusy('')
    }
  }

  async function handleVoid(lineId: string) {
    const reason = window.prompt('Why is this being voided?')
    if (!reason?.trim()) return
    try { await voidLine(checkId, lineId, reason.trim()) }
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
        fontFamily: 'var(--font-inter)', color: 'rgba(245,242,236,0.4)', textAlign: 'center',
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
          color: 'rgba(245,242,236,0.35)', fontSize: '0.7rem', letterSpacing: '0.14em',
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
              <p style={{ fontSize: '0.7rem', color: 'rgba(245,242,236,0.4)', marginTop: '0.15rem' }}>
                {money(totals.gross)} − {money(totals.discount)} staff
              </p>
            )}
          </div>
        </div>

        {liveError && (
          <p style={{
            color: '#C9962C', fontSize: '0.82rem', marginBottom: '1rem', lineHeight: 1.6,
            background: 'rgba(201,150,44,0.08)', border: '1px solid rgba(201,150,44,0.25)',
            borderRadius: '3px', padding: '0.7rem 0.9rem',
          }}>{liveError}</p>
        )}

        {error && (
          <p style={{
            color: 'var(--red)', fontSize: '0.82rem', marginBottom: '1rem',
            background: 'rgba(228,51,41,0.08)', border: '1px solid rgba(228,51,41,0.25)',
            borderRadius: '3px', padding: '0.7rem 0.9rem',
          }}>{error}</p>
        )}
        {busy && (
          <p style={{ color: 'var(--teal)', fontSize: '0.82rem', marginBottom: '1rem' }}>{busy}</p>
        )}

        {check.lines.length === 0 && drafts.length === 0 && (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontSize: '0.88rem', padding: '2rem 0' }}>
            Nothing ordered yet.
          </p>
        )}

        {check.lines.map(l => (
          <LineRow key={l.id} line={l} now={now} discount={check.staffDiscount ?? null}
            onVoid={l.status === 'void' ? null : () => handleVoid(l.id)} />
        ))}
        {drafts.map((d, i) => (
          <DraftRow
            key={i}
            draft={d}
            onRemove={() => setDrafts(list => list.filter((_, n) => n !== i))}
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

        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              setError('')
              try { await setStaffMeal(checkId, !check.staffDiscount) }
              catch (err) { setError(err instanceof Error ? err.message : 'Could not change that.') }
            }}
            style={{
              ...tap, flex: 1, minWidth: '120px',
              backgroundColor: check.staffDiscount ? 'rgba(0,160,152,0.18)' : 'transparent',
              border: `1px solid ${check.staffDiscount ? 'var(--teal)' : 'rgba(255,255,255,0.14)'}`,
              color: check.staffDiscount ? 'var(--offwhite)' : 'rgba(245,242,236,0.6)',
            }}
          >{check.staffDiscount ? '✓ Staff meal' : 'Staff meal'}</button>
          <button onClick={() => setMoving(true)} style={{
            ...tap, flex: 1, minWidth: '120px', backgroundColor: 'transparent',
            border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(245,242,236,0.6)',
          }}>Move table</button>
          <button onClick={handleClose} style={{
            ...tap, flex: 1, minWidth: '120px', backgroundColor: 'transparent',
            border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(245,242,236,0.6)',
          }}>Close check</button>
        </div>
      </div>

      {/* Sticky, because a waiter's thumb lives at the bottom of the screen. */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(10,10,10,0.96)', borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: '0.8rem 1rem', display: 'flex', gap: '0.6rem',
        maxWidth: '640px', margin: '0 auto',
      }}>
        <button onClick={() => setPicking(true)} style={{
          ...tap, flex: 1, backgroundColor: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.14)', color: 'var(--offwhite)',
        }}>Add items</button>
        <button
          disabled={!canSend || Boolean(busy)}
          onClick={handleSend}
          style={{
            ...tap, flex: 1, border: 'none', color: '#fff',
            backgroundColor: canSend && !busy ? 'var(--teal)' : 'rgba(0,160,152,0.25)',
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
                background: 'none', border: 'none', color: 'rgba(245,242,236,0.5)',
                fontSize: '0.8rem', cursor: 'pointer', padding: '0.5rem',
              }}>Done</button>
            </div>

            {/* Seat is chosen once and sticks, because a waiter takes a whole
                seat's order before moving round the table. */}
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
              <button onClick={() => setSeat(null)} style={{
                ...tap, minHeight: '40px', padding: '0 0.8rem',
                backgroundColor: seat === null ? 'rgba(0,160,152,0.18)' : 'transparent',
                border: `1px solid ${seat === null ? 'var(--teal)' : 'rgba(255,255,255,0.12)'}`,
                color: 'var(--offwhite)', fontSize: '0.75rem',
              }}>Table</button>
              {Array.from({ length: Math.max(check.guestCount, 4) }, (_, n) => n + 1).map(s => (
                <button key={s} onClick={() => setSeat(s)} style={{
                  ...tap, minHeight: '40px', padding: '0 0.8rem',
                  backgroundColor: seat === s ? 'rgba(0,160,152,0.18)' : 'transparent',
                  border: `1px solid ${seat === s ? 'var(--teal)' : 'rgba(255,255,255,0.12)'}`,
                  color: 'var(--offwhite)', fontSize: '0.75rem',
                }}>{s}</button>
              ))}
            </div>

            {/* Course paces the kitchen: starters fire, mains wait. Sticky
                like seat, and off by default because most orders have one
                course and nobody should have to say so. */}
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.9rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', marginRight: '0.2rem' }}>Course</span>
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
                backgroundColor: activeCategory === 'retail' ? 'rgba(201,150,44,0.15)' : 'transparent',
                border: `1px solid ${activeCategory === 'retail' ? '#C9962C' : 'rgba(255,255,255,0.1)'}`,
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
                      {money(p.price)}{p.onSale && <span style={{ color: '#C9962C' }}> on sale</span>}
                    </span>
                    {/* Shown, never enforced. A till must not refuse a sale
                        because a count is stale — the customer is holding the
                        thing. Negative is a discrepancy to reconcile, not a
                        reason to turn somebody away. */}
                    <span style={{
                      fontSize: '0.65rem',
                      color: p.stock > 0 ? 'rgba(245,242,236,0.3)' : 'var(--red)',
                    }}>{p.stock} in stock</span>
                  </button>
                ))}
                {products.length === 0 && (
                  <p style={{ color: 'rgba(245,242,236,0.3)', fontSize: '0.82rem', gridColumn: '1 / -1' }}>
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
                <p style={{ color: 'rgba(245,242,236,0.3)', fontSize: '0.82rem', gridColumn: '1 / -1' }}>
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
                border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(245,242,236,0.6)',
              }}>Cancel</button>
              <button
                disabled={!moveTo}
                onClick={handleMove}
                style={{
                  ...tap, flex: 2, border: 'none', color: '#fff',
                  backgroundColor: moveTo ? 'var(--teal)' : 'rgba(0,160,152,0.25)',
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
