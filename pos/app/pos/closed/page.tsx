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

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRAND } from '@big-cms/shared/brand'
import { checkTotals, type Check } from '@big-cms/shared/checks'
import { useClosedChecks } from '../../lib/usePos'

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
 * Local calendar day for a closed check, as YYYY-MM-DD.
 *
 * closedAt is a Firestore timestamp, so it arrives with a seconds field.
 * Grouping by the LOCAL day rather than UTC matters here: a café closing at
 * one in the morning would otherwise have its last two hours filed under
 * tomorrow.
 */
function dayOf(check: Check): string {
  const raw = check as unknown as { closedAt?: { seconds?: number } }
  const ms = raw.closedAt?.seconds ? raw.closedAt.seconds * 1000 : Date.now()
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function timeOf(check: Check): string {
  const raw = check as unknown as { closedAt?: { seconds?: number } }
  if (!raw.closedAt?.seconds) return ''
  return new Date(raw.closedAt.seconds * 1000)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** One closed check. Module scope — see CONTRIBUTING.md gotcha #2. */
function ClosedRow({ check, isMobile }: { check: Check; isMobile: boolean }) {
  const [open, setOpen] = useState(false)
  const totals = checkTotals(check)
  const items = check.lines.filter(l => l.status !== 'void')
  const voided = check.lines.filter(l => l.status === 'void')

  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px',
      marginBottom: '0.5rem', overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', minHeight: '64px', display: 'flex', alignItems: 'center',
          gap: '0.9rem', textAlign: 'left', cursor: 'pointer',
          background: 'transparent', border: 'none', color: 'var(--offwhite)',
          fontFamily: 'var(--font-inter)', padding: isMobile ? '0.7rem 0.8rem' : '0.8rem 1rem',
        }}
      >
        <span style={{
          fontFamily: 'var(--font-cinzel)', fontSize: '1.3rem',
          minWidth: '2.2rem', textAlign: 'center',
        }}>{check.tableNumber}</span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: '0.85rem' }}>
            {items.length} {items.length === 1 ? 'item' : 'items'}
            {check.staffDiscount && (
              <span style={{ color: 'var(--teal)' }}> · staff meal</span>
            )}
            {voided.length > 0 && (
              <span style={{ color: 'rgba(228,51,41,0.7)' }}> · {voided.length} voided</span>
            )}
          </p>
          <p style={{ fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)', marginTop: '0.15rem' }}>
            closed {timeOf(check)} · {check.guestCount} {check.guestCount === 1 ? 'guest' : 'guests'}
          </p>
        </div>

        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '0.95rem', color: 'var(--teal)', fontWeight: 600 }}>
            {money(totals.net)}
          </p>
          {totals.discount > 0 && (
            <p style={{ fontSize: '0.65rem', color: 'rgba(245,242,236,0.35)' }}>
              was {money(totals.gross)}
            </p>
          )}
        </div>
      </button>

      {open && (
        <div style={{
          padding: '0 1rem 0.9rem', borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          {check.lines.map(l => (
            <p key={l.id} style={{
              fontFamily: 'var(--font-inter)', fontSize: '0.8rem',
              color: l.status === 'void' ? 'rgba(228,51,41,0.6)' : 'rgba(245,242,236,0.7)',
              textDecoration: l.status === 'void' ? 'line-through' : 'none',
              paddingTop: '0.5rem',
            }}>
              {l.quantity}× {l.name}
              {l.modifiers.length > 0 && (
                <span style={{ color: 'rgba(245,242,236,0.4)' }}>
                  {' '}({l.modifiers.map(m => m.optionName).join(', ')})
                </span>
              )}
              {l.note && <span style={{ color: '#C9962C' }}> — {l.note}</span>}
              {l.status === 'void' && l.voidReason && (
                <span style={{ color: 'rgba(228,51,41,0.5)' }}> — {l.voidReason}</span>
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ClosedChecksPage() {
  const { checking, blocked } = useRequireRole(SECTION_ACCESS.pos, { login: '/pos/login', home: '/pos' })
  const isMobile = useIsMobile()
  const router = useRouter()
  const [branch] = useState(BRAND.branches[0] ?? '')
  const { checks, error } = useClosedChecks(branch)

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
  if (checking) return null

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 2rem 4rem',
      fontFamily: 'var(--font-inter)',
    }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <button onClick={() => router.push('/pos')} style={{
          background: 'none', border: 'none', padding: '0.3rem 0', cursor: 'pointer',
          color: 'rgba(245,242,236,0.35)', fontSize: '0.7rem', letterSpacing: '0.14em',
          textTransform: 'uppercase', fontFamily: 'var(--font-inter)', marginBottom: '0.6rem',
        }}>← Floor</button>

        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.5rem' : '1.9rem',
          color: 'var(--offwhite)', marginBottom: '0.4rem',
        }}>Closed checks</h1>
        <p style={{
          fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)',
          lineHeight: 1.6, marginBottom: '1.5rem', maxWidth: '52ch',
        }}>
          What was ordered and sent. Not a sales report — VAT, service and
          payment are not part of this version.
        </p>

        {error && (
          <p style={{
            color: '#C9962C', fontSize: '0.82rem', marginBottom: '1rem', lineHeight: 1.6,
            background: 'rgba(201,150,44,0.08)', border: '1px solid rgba(201,150,44,0.25)',
            borderRadius: '3px', padding: '0.7rem 0.9rem',
          }}>{error}</p>
        )}

        {days.length === 0 ? (
          <p style={{
            color: 'rgba(245,242,236,0.3)', fontSize: '0.9rem',
            padding: '2.5rem 0', textAlign: 'center',
          }}>Nothing closed yet.</p>
        ) : days.map(([day, list]) => {
          const dayNet = list.reduce((s, c) => s + checkTotals(c).net, 0)
          return (
            <div key={day} style={{ marginBottom: '1.5rem' }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginBottom: '0.5rem',
              }}>
                <p style={{
                  fontSize: '0.64rem', letterSpacing: '0.16em', textTransform: 'uppercase',
                  color: 'var(--teal)',
                }}>{day}</p>
                <p style={{ fontSize: '0.78rem', color: 'rgba(245,242,236,0.4)' }}>
                  {list.length} {list.length === 1 ? 'check' : 'checks'} · {money(dayNet)}
                </p>
              </div>
              {list.map(c => <ClosedRow key={c.id} check={c} isMobile={isMobile} />)}
            </div>
          )
        })}
      </div>
    </main>
  )
}
