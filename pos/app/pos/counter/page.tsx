'use client'

// The counter till — Phase 04, slice 7.
//
// One screen: the tables, the menu, what is on the check, and the money. No
// navigation anywhere, and that is the whole design. App Router navigation to
// /pos/check/[id] asks the server for a page, so during an outage every other
// POS screen is a spinner — a till that cannot be walked between screens is a
// till that still works when the wifi does not.
//
// ── Who this is for ────────────────────────────────────────────────────────
// The counter device, and only it (owner's decision, 12 Sep 2026). A waiter's
// phone that loses the connection says so and stops; the order goes to the
// counter, ten steps away. One queue per branch means there is never a
// question of two devices disagreeing about a table.
//
// ── Online, this changes nothing ───────────────────────────────────────────
// With a connection and nothing already waiting for that table, every action
// takes the ordinary route — items land as a normal Send, so the kitchen gets
// its ticket. The queue is for when the device is offline, or when something
// for that check is already in it and going around would put the two out of
// order. A call that gets no answer falls into the queue carrying the same key
// it was sent with, so it is never lost and never applied twice.
//
// ── What it will not do ────────────────────────────────────────────────────
// Close a check offline (owner's decision: close when the connection is back —
// a receipt number is the server's to issue). Modifiers and retail are not
// here either: this is the fast path for a counter, and the full check screen
// is one tap away whenever there is a server to render it.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BRAND } from '@big-cms/shared/brand'
import { checkTotals, type Check } from '@big-cms/shared/checks'
import {
  applyPayment, balance, type PayCurrency, type PaymentRequest, type Tender,
} from '@big-cms/shared/payments'
import { useBusinessSettings } from '@big-cms/shared/useBusinessSettings'
import { useFeature } from '@big-cms/shared/useFeatures'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import {
  useAuthReady, useOpenChecks, usePosMenu, openCheck, addLines, sendCheck, payCheck,
  type DraftLine, type PosMenuItem,
} from '../../lib/usePos'
import { useOutbox, useCounterDevice, newKey } from '../../lib/useOutbox'
import {
  checkDue, draftsUsd, queuedUsd, replayApplied, takeBlocked,
} from '../../lib/counterTotals'
import type { OutboxAction } from '../../lib/outbox'

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

const usd = (n: number) => `$${n.toFixed(2)}`
const lbpFmt = (n: number) => `${Math.round(n).toLocaleString('en-US')} LBP`

const tap: React.CSSProperties = {
  minHeight: '48px', padding: '0.7rem 1rem', borderRadius: '6px',
  fontFamily: 'var(--font-inter)', fontSize: '0.9rem', cursor: 'pointer',
}

const chip: React.CSSProperties = {
  ...tap, minHeight: '40px', padding: '0.45rem 0.8rem', fontSize: '0.82rem',
  backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.14)',
  color: 'rgba(var(--offwhite-rgb),0.75)',
}

/** One item on the counter's view of a check, wherever it came from. */
interface CounterLine {
  key: string
  name: string
  quantity: number
  unitPrice: number
  /** 'live' is on the check already; the rest have not reached the server. */
  where: 'live' | 'queued' | 'draft'
}

/** A table the counter can work on: on the server, queued, or both. */
interface CounterTable {
  checkId: string
  tableNumber: number
  /** The check as the server has it, when it has it. */
  check: Check | null
  waiting: number
}

/**
 * The same item tapped twice is a quantity, not two lines — the check page
 * does the same, and for the same reason: "2× Espresso" is what the person
 * making them reads.
 */
function withDraft(drafts: DraftLine[], item: PosMenuItem): DraftLine[] {
  const at = drafts.findIndex(d => d.refId === item.id)
  if (at >= 0) {
    const next = [...drafts]
    next[at] = { ...next[at], quantity: next[at].quantity + 1 }
    return next
  }
  return [...drafts, {
    source: 'menu', refId: item.id, name: item.name, unitPrice: item.price,
    quantity: 1, modifierOptionIds: [], modifierLabel: '',
    seat: null, course: null, note: '',
  }]
}

export default function CounterPage() {
  const router = useRouter()
  const isMobile = useIsMobile()

  // ── The gate ─────────────────────────────────────────────────────────────
  // Signed in, and that is all this screen checks. useRequireRole() reads the
  // staff document, and a document read needs either the network or a cache
  // that may be empty — a role check that cannot answer offline would blank
  // the one screen whose job is to work offline.
  //
  // Nothing is lost by it: every route this page calls is behind
  // requireSection('pos') on the server, which is where access has always
  // actually been decided. A person who may not take orders gets a refusal
  // from the server, which the queue shows them by name.
  const { ready, signedIn } = useAuthReady()
  useEffect(() => {
    if (ready && !signedIn) router.replace('/pos/login')
  }, [ready, signedIn, router])

  const [branch] = useState(BRAND.branches[0] ?? '')
  const { checks } = useOpenChecks(branch)
  const menu = usePosMenu()
  const { settings } = useBusinessSettings()
  const { on: takesPayment } = useFeature('payments')
  const outbox = useOutbox()
  const device = useCounterDevice()

  const [selected, setSelected] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftLine[]>([])
  const [category, setCategory] = useState('')
  const [opening, setOpening] = useState(false)
  const [tableNumber, setTableNumber] = useState('')
  const [guests, setGuests] = useState('2')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const [tender, setTender] = useState<Tender>('cash')
  const [currency, setCurrency] = useState<PayCurrency>('USD')
  const [amount, setAmount] = useState('')
  const [change, setChange] = useState<{ usd: number; lbp: number; queued: boolean } | null>(null)

  const priceOf = useMemo(() => {
    const byId = new Map(menu.items.map(i => [i.id, i]))
    return (refId: string) => byId.get(refId) ?? null
  }, [menu.items])

  // Tables: what the server says is open, plus anything opened here that has
  // not reached it yet. Both, because during an outage the second list is the
  // only one that grows — and after it, the first catches up on its own.
  const tables = useMemo<CounterTable[]>(() => {
    const live = new Map(checks.map(c => [c.id, c]))
    const rows: CounterTable[] = checks.map(c => ({
      checkId: c.id,
      tableNumber: c.tableNumber,
      check: c,
      waiting: outbox.queue.filter(a => a.checkId === c.id).length,
    }))
    for (const a of outbox.queue) {
      if (a.kind !== 'open' || live.has(a.checkId)) continue
      rows.push({
        checkId: a.checkId,
        tableNumber: a.tableNumber,
        check: null,
        waiting: outbox.queue.filter(q => q.checkId === a.checkId).length,
      })
    }
    return rows.sort((a, b) => a.tableNumber - b.tableNumber)
  }, [checks, outbox.queue])

  const table = tables.find(t => t.checkId === selected) ?? null

  // What is on the check, in the order it happened: what the server has, then
  // what is queued for it, then what has not been rung up yet.
  const lines = useMemo<CounterLine[]>(() => {
    if (!table) return []
    const out: CounterLine[] = []
    for (const l of table.check?.lines ?? []) {
      if (l.status === 'void') continue
      out.push({
        key: l.id, name: l.name, quantity: l.quantity,
        unitPrice: l.unitPrice, where: 'live',
      })
    }
    for (const a of outbox.queue) {
      if (a.kind !== 'lines' || a.checkId !== table.checkId) continue
      for (const raw of a.lines) {
        const refId = String((raw as { refId?: unknown }).refId ?? '')
        const quantity = Number((raw as { quantity?: unknown }).quantity ?? 0)
        const item = priceOf(refId)
        out.push({
          key: `${a.id}-${refId}`,
          name: item?.name ?? 'Item',
          quantity,
          unitPrice: item?.price ?? 0,
          where: 'queued',
        })
      }
    }
    for (const d of drafts) {
      out.push({ key: `draft-${d.refId}`, name: d.name, quantity: d.quantity, unitPrice: d.unitPrice, where: 'draft' })
    }
    return out
  }, [table, outbox.queue, drafts, priceOf])

  // The bill. Priced from the menu for anything the server has not seen —
  // which is display only: the server prices every line from its id when the
  // queue reaches it, exactly as it does for a waiter's phone.
  // The money decisions live in counterTotals.ts, which is pure and asserted
  // by npm run verify:counter. They were inline here, and two bugs that took
  // real money in the wrong direction went through every check this repo has
  // before anybody read them back. Keep them out there.
  const queuedTotal = useMemo(
    () => queuedUsd(outbox.queue, table?.checkId ?? '', refId => priceOf(refId)?.price ?? null),
    [outbox.queue, table, priceOf],
  )

  /** What the check will actually come to. Never the drafts. */
  const due = useMemo(
    () => checkDue(table?.check ? checkTotals(table.check).net : 0, queuedTotal),
    [table, queuedTotal],
  )

  /** Tapped, not yet rung up. Shown on the check, never charged for. */
  const draftTotal = useMemo(() => draftsUsd(drafts), [drafts])

  const rate = table?.check?.billRate ?? settings.exchangeRate

  // Payments already on the check, plus any still queued — replayed through
  // the same function the server uses, so what this screen says is owed is
  // what the server will say when the queue lands.
  // Payments on the check plus the ones still queued, replayed through the
  // same function the server settles with — so what this screen says is owed
  // is what the server will say when the queue lands.
  const applied = useMemo(
    () => replayApplied(
      (table?.check?.payments ?? []).map(p => ({ appliedLbp: p.appliedLbp })),
      outbox.queue,
      table?.checkId ?? '',
      due,
      rate,
      (d, list, r, payment) => {
        const outcome = applyPayment(d, list, r, payment)
        return outcome.ok ? { ok: true, appliedLbp: outcome.appliedLbp } : { ok: false }
      },
    ),
    [table, outbox.queue, due, rate],
  )

  const bill = balance(due, applied, rate)

  // Why this till will not take money right now, in words, or null.
  const blocked = takeBlocked({
    draftCount: drafts.length,
    totalUnknown: queuedTotal.unknown,
    settled: bill.settled,
  })

  const categories = useMemo(
    () => menu.categories.filter(c => menu.items.some(i => i.categoryId === c.id)),
    [menu.categories, menu.items],
  )
  const activeCategory = category || categories[0]?.id || ''
  const shown = useMemo(
    () => menu.items.filter(i => i.categoryId === activeCategory && i.available),
    [menu.items, activeCategory],
  )

  /**
   * Whether this action has to go through the queue.
   *
   * Offline, obviously. But also when something for this check is already
   * waiting: going around the queue would put a payment on the server before
   * the items it paid for, and the check would be settled at the wrong figure
   * for as long as that lasted.
   */
  const mustQueue = (checkId: string | null) =>
    !outbox.online || Boolean(outbox.stuck) || (checkId !== null && outbox.waiting(checkId) > 0)

  function say(err: unknown, fallback: string) {
    setError(isNetworkFailure(err)
      ? 'No connection — it is queued here and will go as soon as the wifi is back.'
      : err instanceof Error ? err.message : fallback)
  }

  async function handleOpen() {
    const n = Number(tableNumber)
    if (!Number.isInteger(n) || n < 1) { setError('Enter a table number.'); return }
    const guestCount = Math.max(1, Number(guests) || 1)
    setBusy('Opening…'); setError('')

    // The device names the check either way, so a queued open and a direct one
    // are the same request — and replaying one the server already has returns
    // that check instead of "table 4 is already open" (7b).
    const checkId = newKey()
    const action: OutboxAction = {
      kind: 'open', id: newKey(), checkId, branch,
      tableNumber: n, guestCount, at: new Date().toISOString(),
    }

    if (mustQueue(null)) {
      outbox.add(action)
      setSelected(checkId)
      setOpening(false); setTableNumber(''); setBusy('')
      return
    }
    try {
      const id = await openCheck(branch, n, guestCount)
      setSelected(id)
      setOpening(false); setTableNumber('')
    } catch (err) {
      if (isNetworkFailure(err)) {
        // No answer: it may or may not have opened. Queued under the id this
        // device chose, so the replay either opens it or finds it already open
        // — never a second check on the same table.
        outbox.add(action)
        setSelected(checkId)
        setOpening(false); setTableNumber('')
      } else {
        say(err, 'Could not open that table.')
      }
    } finally {
      setBusy('')
    }
  }

  async function handleRecord() {
    if (!table || drafts.length === 0) return
    setBusy('Recording…'); setError('')
    const batchKey = newKey()
    const payload = drafts.map(d => ({
      source: d.source, refId: d.refId, quantity: d.quantity,
      modifierOptionIds: d.modifierOptionIds, seat: d.seat, course: d.course, note: d.note,
    }))
    const action: OutboxAction = {
      kind: 'lines', id: newKey(), checkId: table.checkId, batchKey,
      lines: payload,
      // Carried so the total survives a reload with a cold menu cache.
      displayUsd: draftTotal,
      at: new Date().toISOString(),
    }

    if (mustQueue(table.checkId)) {
      outbox.add(action)
      setDrafts([])
      setBusy('')
      return
    }
    try {
      // The ordinary path while there is a connection: the items land and the
      // kitchen gets its ticket, exactly as from a waiter's phone.
      await addLines(table.checkId, drafts, batchKey)
      setDrafts([])
      await sendCheck(table.checkId)
    } catch (err) {
      if (isNetworkFailure(err)) {
        outbox.add(action)
        setDrafts([])
      } else {
        say(err, 'Could not record those items.')
      }
    } finally {
      setBusy('')
    }
  }

  async function handlePay() {
    if (!table) return
    // The button is disabled for every one of these. The guard is here as
    // well because a disabled button is a UI state, and this is money.
    if (blocked) { setError(blocked); return }
    const value = Number(amount)
    const req: PaymentRequest = { tender, currency, amount: value }
    const outcome = applyPayment(due, applied, rate, req)
    if (!outcome.ok) { setError(outcome.reason); return }

    setBusy('Taking…'); setError(''); setChange(null)
    const paymentKey = newKey()
    const action: OutboxAction = {
      kind: 'pay', id: newKey(), checkId: table.checkId, paymentKey,
      payment: { tender, currency, amount: value },
      // What this screen told the counter to hand over. The server works the
      // change out again from the check's own rate; if the two differ, the
      // money has already gone and somebody is told the drawer will be short.
      expected: { changeUsd: outcome.changeUsd, changeLbp: outcome.changeLbp },
      at: new Date().toISOString(),
    }

    if (mustQueue(table.checkId)) {
      outbox.add(action)
      setChange({ usd: outcome.changeUsd, lbp: outcome.changeLbp, queued: true })
      setAmount('')
      setBusy('')
      return
    }
    try {
      const r = await payCheck(table.checkId, req, paymentKey)
      setChange({ usd: r.payment.changeUsd, lbp: r.payment.changeLbp, queued: false })
      setAmount('')
    } catch (err) {
      if (isNetworkFailure(err)) {
        outbox.add(action)
        setChange({ usd: outcome.changeUsd, lbp: outcome.changeLbp, queued: true })
        setAmount('')
      } else {
        say(err, 'Could not take that payment.')
      }
    } finally {
      setBusy('')
    }
  }

  if (!ready || !signedIn) return null

  const banner = outbox.stuck ? 'var(--red)' : outbox.online ? 'var(--teal)' : 'var(--brand-secondary)'

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '1rem 0.9rem 2rem' : '1.5rem 1.5rem 3rem',
      fontFamily: 'var(--font-inter)', color: 'var(--offwhite)',
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        {/* ── Where this device stands ─────────────────────────────────── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          flexWrap: 'wrap', gap: '0.6rem', marginBottom: '1rem',
        }}>
          <div>
            <p style={{
              fontSize: '0.6rem', letterSpacing: '0.25em', textTransform: 'uppercase',
              color: 'var(--teal)', marginBottom: '0.3rem',
            }}>{branch}</p>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.4rem' : '1.8rem' }}>
              Counter
            </h1>
          </div>
          <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '0.72rem', color: banner }}>
              {outbox.online ? 'Online' : 'Offline'}
              {outbox.queued > 0 && ` · ${outbox.queued} waiting`}
              {outbox.syncing && ' · sending…'}
            </span>
            <a href="/pos" style={{
              fontSize: '0.68rem', letterSpacing: '0.14em', textTransform: 'uppercase',
              color: 'rgba(var(--offwhite-rgb),0.35)', textDecoration: 'none',
            }}>Floor →</a>
          </div>
        </div>

        {/* A refusal stops the queue, and only a person can clear it: the
            items after it are usually for the same table. */}
        {outbox.stuck && (
          <div style={{
            border: '1px solid rgba(var(--red-rgb),0.4)', background: 'rgba(var(--red-rgb),0.08)',
            borderRadius: '6px', padding: '0.9rem 1rem', marginBottom: '1rem',
          }}>
            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '0.7rem' }}>
              <strong>Nothing is being sent.</strong> The server would not take one of the
              queued actions: {outbox.stuck.reason}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button onClick={() => outbox.resolve('retry')} style={{
                ...chip, borderColor: 'var(--teal)', color: 'var(--offwhite)',
              }}>Try it again</button>
              <button onClick={() => outbox.resolve('drop')} style={{
                ...chip, borderColor: 'var(--red)', color: 'var(--offwhite)',
              }}>Drop it and carry on</button>
            </div>
          </div>
        )}

        {outbox.notices.length > 0 && (
          <div style={{
            border: '1px solid rgba(var(--brand-secondary-rgb),0.35)',
            background: 'rgba(var(--brand-secondary-rgb),0.08)',
            borderRadius: '6px', padding: '0.9rem 1rem', marginBottom: '1rem',
          }}>
            {outbox.notices.map((n, i) => (
              <p key={i} style={{ fontSize: '0.82rem', lineHeight: 1.6, marginBottom: '0.4rem' }}>{n}</p>
            ))}
            <button onClick={outbox.dismissNotices} style={{ ...chip, marginTop: '0.3rem' }}>
              Noted
            </button>
          </div>
        )}

        {error && (
          <p style={{
            color: 'var(--red)', fontSize: '0.82rem', marginBottom: '1rem', lineHeight: 1.6,
            background: 'rgba(var(--red-rgb),0.08)', border: '1px solid rgba(var(--red-rgb),0.25)',
            borderRadius: '4px', padding: '0.7rem 0.9rem',
          }}>{error}</p>
        )}

        {/* ── The tables ───────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.2rem' }}>
          {tables.map(t => (
            <button
              key={t.checkId}
              onClick={() => { setSelected(t.checkId); setDrafts([]); setChange(null); setError('') }}
              style={{
                ...chip, minHeight: '56px', minWidth: '72px',
                flexDirection: 'column', display: 'flex', gap: '0.1rem',
                borderColor: selected === t.checkId ? 'var(--teal)' : 'rgba(255,255,255,0.14)',
                backgroundColor: selected === t.checkId ? 'rgba(var(--teal-rgb),0.14)' : 'transparent',
                color: 'var(--offwhite)',
              }}
            >
              <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem' }}>{t.tableNumber}</span>
              {t.waiting > 0 && (
                <span style={{ fontSize: '0.6rem', color: 'var(--brand-secondary)' }}>{t.waiting} waiting</span>
              )}
            </button>
          ))}
          <button onClick={() => { setOpening(true); setTableNumber(''); setError('') }} style={{
            ...chip, minHeight: '56px', minWidth: '72px',
            borderColor: 'rgba(var(--teal-rgb),0.5)', color: 'var(--offwhite)',
          }}>+ Table</button>
        </div>

        {opening && (
          <div style={{
            border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px',
            padding: '1rem', marginBottom: '1.2rem',
          }}>
            <label style={{
              display: 'block', fontSize: '0.64rem', letterSpacing: '0.14em',
              textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.4)', marginBottom: '0.4rem',
            }}>Table number</label>
            <input
              value={tableNumber}
              onChange={e => setTableNumber(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              autoFocus
              placeholder="7"
              style={{
                width: '100%', minHeight: '52px', textAlign: 'center',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '4px', color: 'var(--offwhite)',
                fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', margin: '0.8rem 0' }}>
              {[1, 2, 3, 4, 5, 6, 8].map(n => (
                <button key={n} onClick={() => setGuests(String(n))} style={{
                  ...chip, minWidth: '44px',
                  borderColor: guests === String(n) ? 'var(--teal)' : 'rgba(255,255,255,0.12)',
                  color: 'var(--offwhite)',
                }}>{n}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => setOpening(false)} style={{ ...chip, flex: 1 }}>Cancel</button>
              <button disabled={Boolean(busy) || !tableNumber} onClick={handleOpen} style={{
                ...tap, flex: 2, border: 'none',
                backgroundColor: !tableNumber ? 'rgba(var(--teal-rgb),0.25)' : 'var(--teal)',
                color: '#fff', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: '0.8rem',
              }}>{busy || `Open table ${tableNumber || ''}`}</button>
            </div>
          </div>
        )}

        {table && (
          <>
            {/* ── What is on it ────────────────────────────────────────── */}
            <div style={{
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
              padding: '0.9rem 1rem', marginBottom: '1rem',
            }}>
              {lines.length === 0 && (
                <p style={{ fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.3)' }}>
                  Nothing on this table yet.
                </p>
              )}
              {lines.map(l => (
                <div key={l.key} style={{
                  display: 'flex', justifyContent: 'space-between', gap: '0.6rem',
                  fontSize: '0.85rem', padding: '0.25rem 0',
                  color: l.where === 'live' ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.6)',
                }}>
                  <span>
                    {l.quantity}× {l.name}
                    {l.where === 'queued' && (
                      <span style={{ color: 'var(--brand-secondary)', fontSize: '0.7rem' }}> · waiting</span>
                    )}
                    {l.where === 'draft' && (
                      <span style={{ color: 'rgba(var(--offwhite-rgb),0.35)', fontSize: '0.7rem' }}> · not rung up</span>
                    )}
                  </span>
                  <span>{usd(l.unitPrice * l.quantity)}</span>
                </div>
              ))}

              <div style={{
                display: 'flex', justifyContent: 'space-between',
                borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.6rem', paddingTop: '0.6rem',
                fontSize: '0.95rem',
              }}>
                <span>{draftTotal > 0 ? 'Rung up' : 'Total'}</span>
                <span style={{ color: 'var(--teal)' }}>{usd(due)} · {lbpFmt(due * rate)}</span>
              </div>
              {draftTotal > 0 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: '0.82rem', color: 'var(--brand-secondary)', marginTop: '0.3rem',
                }}>
                  <span>Not rung up yet</span>
                  <span>+{usd(draftTotal)}</span>
                </div>
              )}
              {applied.length > 0 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.5)', marginTop: '0.3rem',
                }}>
                  <span>{bill.settled ? 'Paid in full' : 'Still owed'}</span>
                  <span>{bill.settled ? '—' : `${usd(bill.remainingUsd)} · ${lbpFmt(bill.remainingLbp)}`}</span>
                </div>
              )}
            </div>

            {drafts.length > 0 && (
              <button onClick={handleRecord} disabled={Boolean(busy)} style={{
                ...tap, width: '100%', border: 'none', marginBottom: '1rem',
                backgroundColor: 'var(--teal)', color: '#fff',
                letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: '0.8rem',
              }}>
                {busy || (outbox.online ? 'Send to the kitchen' : 'Record — the kitchen is here')}
              </button>
            )}

            {/* ── The menu ─────────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.8rem', overflowX: 'auto', paddingBottom: '0.3rem' }}>
              {categories.map(c => (
                <button key={c.id} onClick={() => setCategory(c.id)} style={{
                  ...chip, whiteSpace: 'nowrap',
                  borderColor: activeCategory === c.id ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
                  backgroundColor: activeCategory === c.id ? 'rgba(255,255,255,0.08)' : 'transparent',
                  color: 'var(--offwhite)',
                }}>{c.name}</button>
              ))}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)',
              gap: '0.5rem', marginBottom: '1.4rem',
            }}>
              {shown.map(i => (
                <button key={i.id} onClick={() => setDrafts(d => withDraft(d, i))} style={{
                  ...tap, minHeight: '64px', textAlign: 'left',
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.1)', color: 'var(--offwhite)',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.2rem',
                }}>
                  <span style={{ fontSize: '0.82rem' }}>{i.name}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--teal)' }}>{usd(i.price)}</span>
                </button>
              ))}
              {shown.length === 0 && (
                <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontSize: '0.82rem', gridColumn: '1 / -1' }}>
                  {menu.loading ? 'Loading the menu…' : 'Nothing available in this category.'}
                </p>
              )}
            </div>

            {/* ── The money ────────────────────────────────────────────── */}
            {takesPayment && (
              <div style={{
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '0.9rem 1rem',
              }}>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
                  {([
                    { t: 'cash', c: 'USD', label: 'Cash $' },
                    { t: 'cash', c: 'LBP', label: 'Cash LBP' },
                    { t: 'card', c: 'USD', label: 'Card $' },
                  ] as const).map(o => (
                    <button
                      key={o.label}
                      onClick={() => { setTender(o.t); setCurrency(o.c); setChange(null) }}
                      style={{
                        ...chip,
                        borderColor: tender === o.t && currency === o.c ? 'var(--teal)' : 'rgba(255,255,255,0.14)',
                        backgroundColor: tender === o.t && currency === o.c ? 'rgba(var(--teal-rgb),0.14)' : 'transparent',
                        color: 'var(--offwhite)',
                      }}
                    >{o.label}</button>
                  ))}
                </div>

                <input
                  value={amount}
                  onChange={e => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); setChange(null) }}
                  inputMode="decimal"
                  placeholder={currency === 'USD' ? usd(bill.remainingUsd) : lbpFmt(bill.remainingLbp)}
                  style={{
                    width: '100%', minHeight: '52px', textAlign: 'center',
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.14)',
                    borderRadius: '4px', color: 'var(--offwhite)',
                    fontFamily: 'var(--font-cinzel)', fontSize: '1.4rem', outline: 'none',
                  }}
                />

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem' }}>
                  <button
                    onClick={() => setAmount(String(currency === 'USD' ? bill.remainingUsd : bill.remainingLbp))}
                    style={{ ...chip, flex: 1 }}
                  >Exact</button>
                  <button
                    disabled={Boolean(busy) || !amount || blocked !== null}
                    onClick={handlePay}
                    style={{
                      ...tap, flex: 2, border: 'none',
                      backgroundColor: !amount || blocked !== null ? 'rgba(var(--teal-rgb),0.25)' : 'var(--teal)',
                      color: '#fff', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: '0.8rem',
                    }}
                  >{busy || 'Take'}</button>
                </div>

                {blocked && (
                  <p style={{
                    fontSize: '0.78rem', color: 'var(--brand-secondary)',
                    marginTop: '0.7rem', lineHeight: 1.6,
                  }}>{blocked}</p>
                )}
                {change && (
                  <p style={{ fontSize: '0.85rem', marginTop: '0.8rem', lineHeight: 1.6 }}>
                    Change: <strong>{usd(change.usd)} + {lbpFmt(change.lbp)}</strong>
                    {change.queued && (
                      <span style={{ color: 'var(--brand-secondary)' }}>
                        {' '}— worked out on this device. If the till makes it different when
                        this is sent, you will be told here.
                      </span>
                    )}
                  </p>
                )}

                {/* Closing issues a receipt number, which is the server's to
                    give (owner's decision: close when the connection is back). */}
                <p style={{
                  fontSize: '0.76rem', color: 'rgba(var(--offwhite-rgb),0.35)',
                  marginTop: '0.9rem', lineHeight: 1.6,
                }}>
                  {bill.settled && outbox.online && table.check
                    ? <>Paid in full. <a href={`/pos/check/${table.checkId}`} style={{ color: 'var(--teal)' }}>Close it and print the receipt →</a></>
                    : 'A check is closed — and its receipt numbered — on the full check screen, once the connection is back.'}
                </p>
              </div>
            )}
          </>
        )}

        {/* ── This device ──────────────────────────────────────────────── */}
        <div style={{
          marginTop: '2rem', paddingTop: '1rem',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          {device.supported ? (
            <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.8rem', lineHeight: 1.6 }}>
              <input
                type="checkbox"
                checked={device.isCounter}
                onChange={e => device.setCounter(e.target.checked)}
                style={{ marginTop: '0.25rem', width: '20px', height: '20px', accentColor: 'var(--teal)' }}
              />
              <span style={{ color: 'rgba(var(--offwhite-rgb),0.5)' }}>
                <strong style={{ color: 'var(--offwhite)' }}>This is the counter device.</strong>{' '}
                Keeps this screen on the device so it opens without a connection. One device per
                branch — a waiter&apos;s phone should not be marked.
              </span>
            </label>
          ) : (
            <p style={{ fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.35)', lineHeight: 1.6 }}>
              This browser cannot keep the screen for offline use. The till still works with a
              connection.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
