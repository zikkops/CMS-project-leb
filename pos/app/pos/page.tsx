'use client'

// The floor: the tables that are actually open, and a way to open another.
//
// Only ACTIVE tables are listed. A grid of every table on the floor plan is
// mostly empty squares during a service, and a waiter scanning it reads past
// the free ones to find theirs. This is a working list, not a map — the
// customer-facing page is the thing that draws the room.
//
// Opening a table is a typed number rather than a pick from the plan, because
// the number is what a waiter already knows. A number that IS on the plan
// links to that marker; one that is not still works, so the POS does not
// require a floor plan to have been drawn before anybody can take an order.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRAND } from '@big-cms/shared/brand'
import { orderedTotal, type Check, type CheckLine } from '@big-cms/shared/checks'
import { minutesWaiting, urgency } from '@big-cms/shared/tickets'
import { useOpenChecks, openCheck } from '../lib/usePos'

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

/**
 * A clock that ticks, so the timers move without anything being written.
 *
 * One interval for the whole page rather than one per card: every card shows
 * an offset from the same instant, and thirty intervals would be thirty
 * renders a second for a number that changes once a minute.
 */
function useNow(everyMs = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

const money = (n: number) => `$${n.toFixed(2)}`

const URGENCY_COLOUR = {
  fresh: 'rgba(245,242,236,0.45)',
  aging: '#C9962C',
  late: 'var(--red)',
} as const

/**
 * When this check last fired, in epoch ms, or null if nothing has been sent.
 *
 * The LAST send, not the first: a waiter wants to know how long the round they
 * just fired has been out. Timing from the first would leave a table that has
 * been eating happily for an hour glowing red all night, and a light that is
 * always on is a light nobody looks at.
 */
function lastSentAt(lines: CheckLine[]): number | null {
  let latest: number | null = null
  for (const l of lines) {
    if (l.status !== 'sent' || !l.sentAt) continue
    const ms = Date.parse(l.sentAt)
    if (Number.isFinite(ms) && (latest === null || ms > latest)) latest = ms
  }
  return latest
}

/** One open table. Module scope — see CONTRIBUTING.md gotcha #2. */
function CheckCard({
  check, now, onOpen, isMobile,
}: {
  check: Check
  now: number
  onOpen: () => void
  isMobile: boolean
}) {
  const total = orderedTotal(check.lines)
  const unsent = check.lines.filter(l => l.status === 'draft').length
  const items = check.lines.filter(l => l.status !== 'void').length
  const sentAt = lastSentAt(check.lines)
  const mins = sentAt === null ? null : minutesWaiting(sentAt, now)
  const level = mins === null ? 'fresh' : urgency(mins)

  return (
    <button
      onClick={onOpen}
      style={{
        minHeight: '92px', display: 'flex', alignItems: 'center', gap: '0.9rem',
        textAlign: 'left', width: '100%',
        backgroundColor: 'rgba(0,160,152,0.08)',
        border: `1px solid ${level === 'late' ? 'var(--red)' : 'rgba(0,160,152,0.4)'}`,
        borderRadius: '5px', cursor: 'pointer', color: 'var(--offwhite)',
        fontFamily: 'var(--font-inter)', padding: isMobile ? '0.8rem' : '1rem',
      }}
    >
      <span style={{
        fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', lineHeight: 1,
        minWidth: '2.4rem', textAlign: 'center',
      }}>{check.tableNumber}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '1rem', color: 'var(--teal)', fontWeight: 600 }}>{money(total)}</p>
        <p style={{ fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)', marginTop: '0.2rem' }}>
          {check.guestCount} {check.guestCount === 1 ? 'guest' : 'guests'}
          {items > 0 && ` · ${items} ${items === 1 ? 'item' : 'items'}`}
        </p>
      </div>

      <div style={{ textAlign: 'right' }}>
        {mins === null ? (
          <p style={{ fontSize: '0.7rem', color: 'rgba(245,242,236,0.3)' }}>Nothing sent</p>
        ) : (
          <>
            <p style={{ fontSize: '1rem', color: URGENCY_COLOUR[level], fontWeight: 600 }}>
              {mins}m
            </p>
            <p style={{ fontSize: '0.6rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.1rem' }}>
              since sent
            </p>
          </>
        )}
        {unsent > 0 && (
          <p style={{
            fontSize: '0.6rem', color: '#C9962C', marginTop: '0.25rem',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>{unsent} unsent</p>
        )}
      </div>
    </button>
  )
}

export default function FloorPage() {
  const { checking, blocked } = useRequireRole(SECTION_ACCESS.pos, { login: '/pos/login', home: '/pos' })
  const isMobile = useIsMobile()
  const router = useRouter()
  const now = useNow()

  // One branch for now. v1 ships on one section of one branch, with the old
  // till still taking payment, precisely so a waiter who cannot send an order
  // walks ten steps to it.
  const [branch] = useState(BRAND.branches[0] ?? '')
  const { checks } = useOpenChecks(branch)

  const [adding, setAdding] = useState(false)
  const [tableNumber, setTableNumber] = useState('')
  const [guests, setGuests] = useState('2')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const open = useMemo(
    () => [...checks].sort((a, b) => a.tableNumber - b.tableNumber),
    [checks],
  )

  async function handleOpen() {
    const n = Number(tableNumber)
    if (!Number.isInteger(n) || n < 1) { setError('Enter a table number.'); return }
    setBusy(true)
    setError('')
    try {
      const id = await openCheck(branch, n, Math.max(1, Number(guests) || 1))
      router.push(`/pos/check/${id}`)
    } catch (err) {
      // Most likely that table is already open, and the route says so
      // precisely. Show its message rather than replacing it with a vaguer one.
      setError(err instanceof Error ? err.message : 'Could not open that table.')
      setBusy(false)
    }
  }

  if (blocked) {
    return (
      <main style={{
        minHeight: '100vh', backgroundColor: 'var(--black)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '2rem', fontFamily: 'var(--font-inter)',
      }}>
        <div style={{ maxWidth: '40ch', textAlign: 'center' }}>
          <h1 style={{
            fontFamily: 'var(--font-cinzel)', fontSize: '1.4rem',
            color: 'var(--offwhite)', marginBottom: '0.8rem',
          }}>{blocked === 'feature' ? 'Point of Sale is switched off' : 'You do not have till access'}</h1>
          <p style={{ fontSize: '0.88rem', color: 'rgba(245,242,236,0.4)', lineHeight: 1.7 }}>
            {blocked === 'feature'
              ? 'A superadmin can switch it on in the admin panel under Settings → Features. It needs the Menu module on as well.'
              : 'Ask a manager to grant you the Point of Sale section in the admin panel under Staff Accounts.'}
          </p>
        </div>
      </main>
    )
  }
  if (checking) return null

  const floorTotal = open.reduce((sum, c) => sum + orderedTotal(c.lines), 0)

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '1.25rem 1rem 6rem' : '2rem 2rem 6rem',
      fontFamily: 'var(--font-inter)',
    }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.4rem',
        }}>
          <div>
            <p style={{
              fontSize: '0.6rem', letterSpacing: '0.25em', textTransform: 'uppercase',
              color: 'var(--teal)', marginBottom: '0.3rem',
            }}>{branch}</p>
            <h1 style={{
              fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.5rem' : '1.9rem',
              color: 'var(--offwhite)',
            }}>Open tables</h1>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'rgba(245,242,236,0.4)' }}>
            {open.length} open · {money(floorTotal)}
          </p>
        </div>

        {error && !adding && (
          <p style={{
            color: 'var(--red)', fontSize: '0.82rem', marginBottom: '1rem',
            background: 'rgba(228,51,41,0.08)', border: '1px solid rgba(228,51,41,0.25)',
            borderRadius: '3px', padding: '0.7rem 0.9rem',
          }}>{error}</p>
        )}

        {open.length === 0 ? (
          <p style={{
            color: 'rgba(245,242,236,0.3)', fontSize: '0.9rem',
            lineHeight: 1.8, padding: '2.5rem 0', textAlign: 'center',
          }}>
            No tables open.<br />
            Tap <strong style={{ color: 'rgba(245,242,236,0.5)' }}>Add table</strong> to start one.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {open.map(c => (
              <CheckCard
                key={c.id}
                check={c}
                now={now}
                onOpen={() => router.push(`/pos/check/${c.id}`)}
                isMobile={isMobile}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sticky: a waiter's thumb lives at the bottom of the screen. */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(10,10,10,0.96)', borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: '0.8rem 1rem',
      }}>
        <div style={{ maxWidth: '640px', margin: '0 auto' }}>
          <button onClick={() => { setAdding(true); setTableNumber(''); setError('') }} style={{
            width: '100%', minHeight: '52px', border: 'none', borderRadius: '4px',
            backgroundColor: 'var(--teal)', color: '#fff', cursor: 'pointer',
            fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>Add table</button>
        </div>
      </div>

      {adding && (
        <div
          onClick={() => setAdding(false)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: '#111', width: '100%', maxWidth: '640px',
              borderRadius: '10px 10px 0 0', padding: '1.25rem 1rem 2rem',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <h2 style={{
              fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem',
              color: 'var(--offwhite)', marginBottom: '1rem',
            }}>Open a table</h2>

            <label style={{
              display: 'block', fontSize: '0.64rem', letterSpacing: '0.14em',
              textTransform: 'uppercase', color: 'rgba(245,242,236,0.4)', marginBottom: '0.4rem',
            }}>Table number</label>
            <input
              value={tableNumber}
              onChange={e => setTableNumber(e.target.value.replace(/[^0-9]/g, ''))}
              // A numeric keypad, not a full keyboard: this is the one field a
              // waiter fills on every single table.
              inputMode="numeric"
              autoFocus
              placeholder="7"
              style={{
                width: '100%', minHeight: '56px', textAlign: 'center',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '4px', color: 'var(--offwhite)',
                fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', outline: 'none',
              }}
            />

            <label style={{
              display: 'block', fontSize: '0.64rem', letterSpacing: '0.14em',
              textTransform: 'uppercase', color: 'rgba(245,242,236,0.4)',
              margin: '1rem 0 0.4rem',
            }}>Guests</label>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {[1, 2, 3, 4, 5, 6, 8].map(n => (
                <button key={n} onClick={() => setGuests(String(n))} style={{
                  minHeight: '44px', minWidth: '44px', borderRadius: '4px', cursor: 'pointer',
                  backgroundColor: guests === String(n) ? 'rgba(0,160,152,0.18)' : 'transparent',
                  border: `1px solid ${guests === String(n) ? 'var(--teal)' : 'rgba(255,255,255,0.12)'}`,
                  color: 'var(--offwhite)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
                }}>{n}</button>
              ))}
            </div>

            {error && (
              <p style={{ color: 'var(--red)', fontSize: '0.82rem', marginTop: '0.9rem' }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.2rem' }}>
              <button onClick={() => setAdding(false)} style={{
                flex: 1, minHeight: '48px', borderRadius: '4px', cursor: 'pointer',
                backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.14)',
                color: 'rgba(245,242,236,0.6)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
              }}>Cancel</button>
              <button
                disabled={busy || !tableNumber}
                onClick={handleOpen}
                style={{
                  flex: 2, minHeight: '48px', borderRadius: '4px', border: 'none',
                  backgroundColor: busy || !tableNumber ? 'rgba(0,160,152,0.25)' : 'var(--teal)',
                  color: '#fff', cursor: busy || !tableNumber ? 'default' : 'pointer',
                  fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                }}
              >{busy ? 'Opening…' : `Open table ${tableNumber || ''}`}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
