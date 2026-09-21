'use client'

// What went through: the checks closed at this branch, newest first.
//
// A closed check used to disappear — the table went free and nothing showed
// what had been on it. Survivable for one table; not for a service, where the
// first question afterwards is "what did we actually send".
//
// Deliberately NOT a sales report. There is no VAT, no service charge, no
// tender breakdown and no shift total, because none of those exist yet — Phase
// 04 owns them. Showing a "total" that quietly means something narrower than
// the word implies is how a number gets quoted at a bank.
//
// ── Look (14 Sep 2026) ─────────────────────────────────────────────────────
// Controls from pos/app/lib/posUi.tsx. A row shows it opens (a chevron); open,
// Receipt and Refund sit at opposite ends rather than stacked on top of each
// other; and the refund panel puts Cancel on the left, where it is on every
// other screen — it was the one place Refund came first.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft, faChevronDown, faChevronUp, faClock, faRotateLeft, faUtensils, faBan, faReceipt,
  faTrashCan, faCheck, faXmark, faNoteSticky, faTriangleExclamation, faUserGroup, faInbox,
} from '@fortawesome/free-solid-svg-icons'
import { SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useTillAccess } from '../../lib/useTillAccess'
import { BRAND } from '@big-cms/shared/brand'
import { checkTotals, VOID_REASONS, reversalRefusal, checkLabel, orderTypeOf, ORDER_TYPES, type Check } from '@big-cms/shared/checks'
import { ymdInZone } from '@big-cms/shared/dates'
import { useClosedChecks, refundCheck } from '../../lib/usePos'
import { PosButton, StatusBadge, PosLoading } from '../../lib/posUi'

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

const money = (n: number) => `$${n.toFixed(2)}`

/**
 * The café's calendar day for a closed check, as YYYY-MM-DD.
 *
 * closedAt is a Firestore timestamp, so it arrives with a seconds field.
 * Grouping by a calendar day rather than UTC was always the point — a café
 * closing at one in the morning would otherwise have its last two hours filed
 * under tomorrow — but "local" meant the DEVICE's day, which is only the
 * café's by luck. /admin/exports groups the very same checks by the café's
 * zone, so the two screens could head the same night differently.
 */
function dayOf(check: Check): string {
  const raw = check as unknown as { closedAt?: { seconds?: number } }
  const ms = raw.closedAt?.seconds ? raw.closedAt.seconds * 1000 : Date.now()
  return ymdInZone(new Date(ms), BRAND.locale.timezone)
}

function timeOf(check: Check): string {
  const raw = check as unknown as { closedAt?: { seconds?: number } }
  if (!raw.closedAt?.seconds) return ''
  // The café's clock, like the day heading above it. A time in one zone
  // under a date in another is the kind of disagreement nobody reads as a
  // bug — they read it as the check being an hour out.
  return new Date(raw.closedAt.seconds * 1000)
    .toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', timeZone: BRAND.locale.timezone,
    })
}

/** Date and time together, for the expanded view and for a refund record. */
function stampOf(seconds: number | undefined): string {
  if (!seconds) return ''
  return new Date(seconds * 1000).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: BRAND.locale.timezone,
  })
}

/** One closed check. Module scope — see CONTRIBUTING.md gotcha #2. */
function ClosedRow({ check, isMobile, canRefund, onRefund, onReceipt }: {
  check: Check
  isMobile: boolean
  /** A manager or an admin (UPGRADE.md T5.1); the server refuses anyone else. */
  canRefund: boolean
  onRefund: () => void
  onReceipt: () => void
}) {
  const [open, setOpen] = useState(false)
  const totals = checkTotals(check)
  const items = check.lines.filter(l => l.status !== 'void')
  const voided = check.lines.filter(l => l.status === 'void')
  const refunded = check.status === 'refunded'
  const meta = check as unknown as {
    closedAt?: { seconds?: number }
    refundedAt?: { seconds?: number }
    refundedBy?: string
    refundReason?: string
    closedByEmail?: string
  }

  return (
    <div style={{
      border: `1px solid ${refunded ? 'rgba(var(--red-rgb),0.35)' : 'rgba(var(--overlay-rgb),0.12)'}`,
      borderRadius: '12px', marginBottom: '0.6rem', overflow: 'hidden',
      background: open ? 'rgba(var(--overlay-rgb),0.035)' : 'rgba(var(--overlay-rgb),0.02)',
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', minHeight: '76px', display: 'flex', alignItems: 'center',
          gap: '0.9rem', textAlign: 'left', cursor: 'pointer',
          background: 'transparent', border: 'none', color: 'var(--offwhite)',
          fontFamily: 'var(--font-inter)', padding: isMobile ? '0.7rem 0.8rem' : '0.8rem 1rem',
        }}
      >
        <span style={{
          minWidth: '3.4rem', height: '3.4rem', borderRadius: '10px', flexShrink: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: refunded ? 'rgba(var(--red-rgb),0.12)' : 'rgba(var(--overlay-rgb),0.06)',
        }}>
          <span style={{ fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.55)' }}>
            {orderTypeOf(check) === 'dine-in' ? 'Table' : ORDER_TYPES.find(t => t.key === orderTypeOf(check))?.label}
          </span>
          <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: orderTypeOf(check) === 'dine-in' ? '1.35rem' : '0.8rem', lineHeight: 1, color: refunded ? 'var(--red)' : 'var(--offwhite)', maxWidth: '5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {orderTypeOf(check) === 'dine-in' ? check.tableNumber : (check.orderName || '—')}
          </span>
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* The receipt number first: it is what somebody is holding when
              they come to ask about a check. */}
          <p style={{ fontSize: '1rem', fontWeight: 600 }}>
            {check.receiptNumber
              ? <span style={{ fontFamily: 'monospace', fontSize: '0.98rem' }}>{check.receiptNumber}</span>
              : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
          </p>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
            {refunded && <StatusBadge icon={faRotateLeft} tone="danger" label="Refunded" />}
            <StatusBadge icon={faClock} label={`closed ${timeOf(check)}`} />
            {check.receiptNumber && <StatusBadge label={`${items.length} ${items.length === 1 ? 'item' : 'items'}`} />}
            {check.staffDiscount && <StatusBadge icon={faUtensils} tone="warn" label="staff meal" />}
            {voided.length > 0 && <StatusBadge icon={faBan} tone="danger" label={`${voided.length} voided`} />}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <p style={{
            fontSize: '1.15rem', fontWeight: 700,
            color: refunded ? 'rgba(var(--offwhite-rgb),0.45)' : 'var(--offwhite)',
            textDecoration: refunded ? 'line-through' : 'none',
          }}>{money(totals.net)}</p>
          {totals.discount > 0 && (
            <p style={{ fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>was {money(totals.gross)}</p>
          )}
        </div>

        <FontAwesomeIcon icon={open ? faChevronUp : faChevronDown} style={{ color: 'rgba(var(--offwhite-rgb),0.55)', fontSize: '1rem' }} />
      </button>

      {open && (
        <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid rgba(var(--overlay-rgb),0.08)' }}>
          <p style={{ fontSize: '0.9rem', color: 'rgba(var(--offwhite-rgb),0.6)', paddingTop: '0.8rem', lineHeight: 1.7 }}>
            <FontAwesomeIcon icon={faUserGroup} style={{ marginRight: '0.4rem' }} />
            {check.guestCount} {check.guestCount === 1 ? 'guest' : 'guests'} · closed {stampOf(meta.closedAt?.seconds)}
            {meta.closedByEmail ? ` by ${meta.closedByEmail}` : ''}
          </p>

          {refunded && (
            <p style={{ fontSize: '0.92rem', color: 'var(--red)', lineHeight: 1.7, marginTop: '0.2rem', fontWeight: 600 }}>
              <FontAwesomeIcon icon={faRotateLeft} style={{ marginRight: '0.4rem' }} />
              Refunded {stampOf(meta.refundedAt?.seconds)}
              {meta.refundedBy ? ` by ${meta.refundedBy}` : ''}
              {meta.refundReason ? ` — ${meta.refundReason}` : ''}
            </p>
          )}

          <div style={{ marginTop: '0.6rem' }}>
            {check.lines.map(l => (
              <p key={l.id} style={{
                fontSize: '0.98rem', padding: '0.35rem 0', borderBottom: '1px solid rgba(var(--overlay-rgb),0.05)',
                color: l.status === 'void' ? 'var(--red)' : 'rgba(var(--offwhite-rgb),0.9)',
              }}>
                <span style={{ textDecoration: l.status === 'void' ? 'line-through' : 'none' }}>
                  <strong>{l.quantity}×</strong> {l.name}
                </span>
                {l.modifiers.length > 0 && (
                  <span style={{ color: 'rgba(var(--offwhite-rgb),0.55)' }}>
                    {' '}({l.modifiers.map(m => m.optionName).join(', ')})
                  </span>
                )}
                {l.note && (
                  <span style={{ color: 'var(--brand-secondary)' }}>
                    {' '}<FontAwesomeIcon icon={faNoteSticky} style={{ margin: '0 0.25rem' }} />{l.note}
                  </span>
                )}
                {l.status === 'void' && l.voidReason && (
                  <span style={{ color: 'rgba(var(--red-rgb),0.75)' }}> — {l.voidReason}</span>
                )}
              </p>
            ))}
          </div>

          {/* Reprinting is safe and often asked for at the counter, so unlike
              the refund it needs no ceremony — but it still lives behind the
              expand. The two sit at opposite ends of the row, not stacked, so
              a thumb aiming for one does not land on the other. A check with
              no receipt number cannot produce one, so it is not offered. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap', marginTop: '1rem' }}>
            {check.receiptNumber
              ? <PosButton icon={faReceipt} label="Receipt" tone="neutral" onClick={onReceipt} />
              : <span />}
            {/* Behind the expand, like every other destructive action in this
                app — a Refund button on a collapsed row would sit under the
                thumb of anybody scrolling the list. */}
            {!refunded && (canRefund
              ? <PosButton icon={faRotateLeft} label="Refund this check" tone="danger" onClick={onRefund} />
              : <span style={{ color: 'rgba(var(--offwhite-rgb),0.6)', fontSize: '0.9rem', alignSelf: 'center' }}>A manager refunds a check, from their own phone.</span>)}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Why a check is being refunded — a choice, not free text.
 *
 * The same reasons a void uses, because the question is the same one: does the
 * thing still exist? Changed their mind before it was made puts merchandise and
 * ingredients back; made, spilled or broken does not, and the ingredients count
 * as waste (owner's decision, 14 Sep 2026). It used to be a window.prompt, and
 * every refund put all the merchandise back whatever had happened to it.
 *
 * Module scope: see CONTRIBUTING.md gotcha #2.
 */
function RefundPanel({ check, busy, error, onConfirm, onCancel }: {
  check: Check
  busy: boolean
  error: string
  onConfirm: (reasonKey: string, note: string) => void
  onCancel: () => void
}) {
  const [reasonKey, setReasonKey] = useState('')
  const [note, setNote] = useState('')
  const reason = VOID_REASONS.find(r => r.key === reasonKey)
  const needsNote = reason?.key === 'other' && !note.trim()

  return (
    <div onClick={e => { if (e.target === e.currentTarget && !busy) onCancel() }} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }}>
      <div style={{
        background: '#121212', border: '1px solid rgba(var(--overlay-rgb),0.12)', borderRadius: '14px',
        width: '100%', maxWidth: '560px', maxHeight: '92vh', overflowY: 'auto', padding: '1.4rem',
        fontFamily: 'var(--font-inter)',
      }}>
        <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.4rem', color: 'var(--offwhite)', marginBottom: '0.2rem' }}>
          Refund {check.receiptNumber ?? checkLabel(check)}
        </p>
        <p style={{ fontSize: '0.95rem', color: 'rgba(var(--offwhite-rgb),0.6)', marginBottom: '1rem' }}>
          {money(checkTotals(check).net)} · Why is it being refunded?
        </p>

        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {VOID_REASONS.map(r => {
            const chosen = r.key === reasonKey
            return (
              <button key={r.key} type="button" onClick={() => setReasonKey(r.key)} disabled={busy} aria-pressed={chosen} style={{
                minHeight: '60px', textAlign: 'left', padding: '0.6rem 0.9rem', borderRadius: '10px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                background: chosen ? 'rgba(var(--red-rgb),0.16)' : 'rgba(var(--overlay-rgb),0.04)',
                border: `2px solid ${chosen ? 'var(--red)' : 'rgba(var(--overlay-rgb),0.14)'}`,
                color: 'var(--offwhite)', fontFamily: 'var(--font-inter)', fontSize: '1rem', fontWeight: chosen ? 700 : 500,
              }}>
                <FontAwesomeIcon icon={r.isWaste ? faTrashCan : faRotateLeft}
                  style={{ width: '1.2rem', color: r.isWaste ? 'var(--red)' : 'rgba(var(--offwhite-rgb),0.65)' }} />
                <span style={{ flex: 1 }}>{r.label}</span>
                {chosen && <FontAwesomeIcon icon={faCheck} style={{ color: 'var(--red)' }} />}
              </button>
            )
          })}
        </div>

        {reason && (
          <p style={{ fontSize: '0.92rem', color: 'rgba(var(--offwhite-rgb),0.7)', lineHeight: 1.6, marginTop: '0.8rem' }}>
            {reason.returnsToStock && !reason.isWaste
              ? 'Merchandise goes back on the shelf, and the ingredients for anything not yet made go back into stock.'
              : 'Nothing goes back on the shelf. Any ingredients are recorded as waste.'}
          </p>
        )}

        <input value={note} onChange={e => setNote(e.target.value)} disabled={busy}
          placeholder={reason?.key === 'other' ? 'Say what happened (required)' : 'A note (optional)'}
          style={{
            width: '100%', boxSizing: 'border-box', marginTop: '0.9rem', minHeight: '54px', padding: '0.6rem 0.9rem',
            background: 'rgba(var(--overlay-rgb),0.05)', border: '2px solid rgba(var(--overlay-rgb),0.16)', borderRadius: '10px',
            color: 'var(--offwhite)', fontFamily: 'var(--font-inter)', fontSize: '1rem', outline: 'none',
          }} />

        {error && (
          <p style={{ color: 'var(--red)', fontSize: '0.95rem', marginTop: '0.8rem', lineHeight: 1.5 }}>
            <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.4rem' }} />{error}
          </p>
        )}

        {/* Cancel on the left and Refund on the right, the order every other
            confirmation in the POS uses. */}
        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.2rem' }}>
          <PosButton icon={faXmark} label="Cancel" tone="quiet" grow={1} disabled={busy} onClick={onCancel} />
          <PosButton icon={faRotateLeft} label={busy ? 'Refunding…' : 'Refund'} tone="danger" size="lg" grow={2}
            disabled={busy || !reason || needsNote} onClick={() => onConfirm(reasonKey, note)}
            style={busy || !reason || needsNote ? undefined : { background: 'var(--red)', color: '#fff', border: '2px solid var(--red)' }} />
        </div>
      </div>
    </div>
  )
}

export default function ClosedChecksPage() {
  const { checking, blocked, role } = useTillAccess(SECTION_ACCESS.pos, { login: '/pos/login', home: '/pos' })
  const canRefund = reversalRefusal(role, 'refund') === null
  const isMobile = useIsMobile()
  const router = useRouter()
  const [branch] = useState(BRAND.branches[0] ?? '')
  const { checks, error } = useClosedChecks(branch)
  const [failed, setFailed] = useState('')
  const [refunding, setRefunding] = useState<Check | null>(null)
  const [refundBusy, setRefundBusy] = useState(false)
  const [refundError, setRefundError] = useState('')

  function handleRefund(check: Check) {
    setFailed('')
    setRefundError('')
    setRefunding(check)
  }

  async function confirmRefund(reasonKey: string, note: string) {
    if (!refunding) return
    setRefundBusy(true)
    setRefundError('')
    try {
      await refundCheck(refunding.id, reasonKey, note.trim())
      setRefunding(null)
    } catch (err) {
      // Shown inside the panel, where the choice that caused it still is.
      setRefundError(err instanceof Error ? err.message : 'Could not refund that check.')
    } finally {
      setRefundBusy(false)
    }
  }

  // Grouped by the day they closed, so a service reads as a service.
  const days = useMemo(() => {
    const map = new Map<string, Check[]>()
    for (const c of checks) {
      const d = dayOf(c)
      map.set(d, [...(map.get(d) ?? []), c])
    }
    return [...map.entries()]
  }, [checks])

  if (blocked) { router.replace('/pos'); return null }
  if (checking) return <PosLoading />

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '1.25rem 1rem 3rem' : '1.75rem 2rem 4rem',
      fontFamily: 'var(--font-inter)',
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <PosButton icon={faArrowLeft} label="Floor" tone="quiet" size="sm" onClick={() => router.push('/pos')} />

        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.8rem' : '2.3rem',
          color: 'var(--offwhite)', margin: '0.9rem 0 0.4rem',
        }}>Closed checks</h1>
        <p style={{ fontSize: '0.98rem', color: 'rgba(var(--offwhite-rgb),0.6)', lineHeight: 1.6, marginBottom: '1.5rem', maxWidth: '62ch' }}>
          Newest first. Tap a check to see its lines, who closed it and when, print its receipt, or refund it.
          A refund records the reversal and returns to stock only what its reason says still exists.
        </p>

        {failed && (
          <p style={{
            color: 'var(--red)', fontSize: '0.95rem', marginBottom: '1rem', lineHeight: 1.6,
            background: 'rgba(var(--red-rgb),0.1)', border: '1px solid rgba(var(--red-rgb),0.35)',
            borderRadius: '8px', padding: '0.8rem 1rem',
          }}><FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.5rem' }} />{failed}</p>
        )}

        {error && (
          <p style={{
            color: 'var(--brand-secondary)', fontSize: '0.95rem', marginBottom: '1rem', lineHeight: 1.6,
            background: 'rgba(var(--brand-secondary-rgb),0.1)', border: '1px solid rgba(var(--brand-secondary-rgb),0.35)',
            borderRadius: '8px', padding: '0.8rem 1rem',
          }}><FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.5rem' }} />{error}</p>
        )}

        {days.length === 0 ? (
          <div style={{ color: 'rgba(var(--offwhite-rgb),0.5)', fontSize: '1.05rem', padding: '3rem 0', textAlign: 'center' }}>
            <FontAwesomeIcon icon={faInbox} style={{ fontSize: '2rem', marginBottom: '0.6rem', color: 'rgba(var(--offwhite-rgb),0.3)' }} />
            <p>Nothing closed yet.</p>
          </div>
        ) : days.map(([day, list]) => {
          const dayNet = list.reduce((s, c) => s + checkTotals(c).net, 0)
          return (
            <div key={day} style={{ marginBottom: '1.6rem' }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: '0.6rem', gap: '0.6rem', flexWrap: 'wrap',
              }}>
                <p style={{ fontSize: '0.95rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--teal)' }}>{day}</p>
                <StatusBadge label={`${list.length} ${list.length === 1 ? 'check' : 'checks'} · ${money(dayNet)}`} />
              </div>
              {list.map(c => (
                <ClosedRow key={c.id} check={c} isMobile={isMobile} canRefund={canRefund}
                  onRefund={() => handleRefund(c)}
                  onReceipt={() => router.push(`/pos/check/${c.id}/receipt`)} />
              ))}
            </div>
          )
        })}
      </div>

      {refunding && (
        <RefundPanel check={refunding} busy={refundBusy} error={refundError}
          onConfirm={confirmRefund} onCancel={() => setRefunding(null)} />
      )}
    </main>
  )
}
