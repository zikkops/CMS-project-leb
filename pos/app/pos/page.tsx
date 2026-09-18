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
//
// ── Readings (owner's request, 14 Sep 2026) ────────────────────────────────
// A square Readings button opens a panel where each device chooses what to
// see: what the open bills add up to, what today's closed tables took, and a
// few more. The adding-up is pos/app/lib/floorReadings.ts (verify:counter);
// the choice is kept per device in localStorage, because the counter screen
// and a waiter's phone want different things.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faPlus, faCashRegister, faReceipt, faFire, faChartColumn, faPen, faClock, faXmark, faCheck,
  faDoorOpen, faStore, faMoneyBillWave, faCircleCheck, faTableCells, faScaleBalanced, faRotateLeft,
  faTriangleExclamation, faUserGroup, faWheatAwnCircleExclamation, faRightFromBracket, type IconDefinition,
} from '@fortawesome/free-solid-svg-icons'
import { SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useTillAccess } from '../lib/useTillAccess'
import { useFeature } from '../lib/useTillSettings'
import { BRAND } from '@big-cms/shared/brand'
import { orderedTotal, checkTotals, type Check, type CheckLine } from '@big-cms/shared/checks'
import { minutesWaiting, urgency } from '@big-cms/shared/tickets'
import { todayYmd } from '@big-cms/shared/dates'
import { closedAtParts } from '@big-cms/shared/salesExport'
import { useOpenChecks, useChecksClosedSince, openCheck } from '../lib/usePos'
import { PosButton, Chip, StatusBadge, PosLoading, Stepper, Sheet } from '../lib/posUi'
import { floorReadings, readReadingChoice, READINGS, type ReadingKey } from '../lib/floorReadings'
import { ReadyPanel } from '../lib/ReadyPanel'
import { useHubOnly, HubOnlyBanner } from '../lib/useHubOnly'
import { backend } from '../lib/backend'

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
const READINGS_KEY = 'pos-floor-readings'

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

const LEVEL_BORDER = {
  fresh: 'rgba(255,255,255,0.18)',
  aging: 'var(--brand-secondary)',
  late: 'var(--red)',
} as const

/**
 * One open table, as a square.
 *
 * A grid rather than a list because a floor is a set of places, not a
 * sequence — a waiter looks for "table 7", and finding it among tiles is a
 * glance where finding it down a list is a read.
 *
 * Four things, in the order somebody actually wants them: which table, what it
 * has run to, how long since it fired, and whether anything is still sitting
 * unsent on somebody's device. A table getting long has an amber border and
 * a late one a red border and tint — the border as well as the timer, so it
 * shows from across the room.
 *
 * Module scope — see CONTRIBUTING.md gotcha #2.
 */
function CheckCard({ check, now, onOpen, isMobile }: {
  check: Check
  now: number
  onOpen: () => void
  isMobile: boolean
}) {
  const total = orderedTotal(check.lines)
  const unsent = check.lines.filter(l => l.status === 'draft').length
  const sentAt = lastSentAt(check.lines)
  const mins = sentAt === null ? null : minutesWaiting(sentAt, now)
  const level = mins === null ? 'fresh' : urgency(mins)

  // Said in words as well as shown, for a screen reader (UPGRADE.md T1.13).
  const spoken = [
    `Table ${check.tableNumber}`, money(total),
    mins === null ? 'nothing sent yet' : `sent ${mins} minutes ago${level === 'late' ? ', late' : ''}`,
    unsent > 0 ? `${unsent} not sent` : '',
  ].filter(Boolean).join(', ')

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={spoken}
      style={{
        // Square. aspectRatio rather than a fixed height so the tiles grow
        // with the column width instead of going letterbox on a wide screen.
        aspectRatio: '1',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
        width: '100%', cursor: 'pointer', position: 'relative',
        backgroundColor: level === 'late' ? 'rgba(var(--red-rgb),0.14)' : 'rgba(255,255,255,0.05)',
        border: `${level === 'fresh' ? 1 : 3}px solid ${LEVEL_BORDER[level]}`,
        borderRadius: '14px', color: 'var(--offwhite)',
        fontFamily: 'var(--font-inter)', padding: '0.6rem',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span style={{
        fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase',
        color: 'rgba(var(--offwhite-rgb),0.55)',
      }}>Table</span>
      <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '2.2rem' : '2.8rem', lineHeight: 1 }}>
        {check.tableNumber}
      </span>
      <span style={{ fontSize: isMobile ? '1rem' : '1.15rem', fontWeight: 700 }}>{money(total)}</span>
      <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* A warning is a badge with an icon, not a 0.6rem corner number. */}
        {unsent > 0 && <StatusBadge icon={faPen} tone="warn" label={`${unsent} not sent`} />}
        {mins !== null
          ? <StatusBadge icon={faClock} tone={level === 'late' ? 'danger' : level === 'aging' ? 'warn' : 'neutral'} label={`${mins}m`} />
          : unsent === 0 && <StatusBadge icon={faClock} label="nothing sent" />}
      </span>
    </button>
  )
}

/** One reading. The main one is bigger — it is what somebody glances up for. */
function ReadingCard({ icon, label, value, sub, main, colour }: {
  icon: IconDefinition
  label: string
  value: string
  sub?: string
  main?: boolean
  colour: string
}) {
  return (
    <div style={{
      flex: main ? '2 1 280px' : '1 1 190px', minHeight: '150px',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '0.4rem',
      padding: '1rem 1.1rem', borderRadius: '14px',
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
      borderTop: `5px solid ${colour}`, fontFamily: 'var(--font-inter)',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
        fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'rgba(var(--offwhite-rgb),0.7)',
      }}>
        <FontAwesomeIcon icon={icon} style={{ color: colour }} />{label}
      </span>
      <span style={{ fontSize: main ? '2.6rem' : '1.9rem', fontWeight: 700, color: 'var(--offwhite)', lineHeight: 1.05 }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: '0.88rem', color: 'rgba(var(--offwhite-rgb),0.55)' }}>{sub}</span>}
    </div>
  )
}

const READING_LOOK: Record<ReadingKey, { icon: IconDefinition; colour: string }> = {
  closedToday: { icon: faCircleCheck, colour: '#22C55E' },
  openTotal: { icon: faMoneyBillWave, colour: '#3B82F6' },
  openCount: { icon: faTableCells, colour: '#A855F7' },
  averageToday: { icon: faScaleBalanced, colour: '#06B6D4' },
  refundsToday: { icon: faRotateLeft, colour: '#EF7A9B' },
}

/**
 * A screen to go to, as a big box. Owner's request (14 Sep 2026): the floor's
 * way to the counter, the closed checks and the kitchen display was a row at
 * the top while the side of the screen sat empty, so they live there now, as
 * targets a finger finds without looking. A hue per destination (posUi's
 * "kind of thing"), never teal, which is the main action.
 *
 * Module scope — CONTRIBUTING.md gotcha #2.
 */
function NavTile({ icon, label, sub, colour, onClick, isMobile }: {
  icon: IconDefinition
  label: string
  sub: string
  colour: string
  onClick: () => void
  isMobile: boolean
}) {
  return (
    <button type="button" onClick={onClick} style={{
      width: '100%', minHeight: isMobile ? '104px' : '150px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
      padding: '0.8rem', borderRadius: '14px', cursor: 'pointer', textAlign: 'center',
      background: `color-mix(in srgb, ${colour} 12%, transparent)`,
      border: `2px solid color-mix(in srgb, ${colour} 55%, transparent)`,
      color: 'var(--offwhite)', fontFamily: 'var(--font-inter)', WebkitTapHighlightColor: 'transparent',
    }}>
      <FontAwesomeIcon icon={icon} style={{ fontSize: isMobile ? '1.7rem' : '2.2rem', color: colour }} />
      <span style={{ fontSize: isMobile ? '0.98rem' : '1.08rem', fontWeight: 700, lineHeight: 1.2 }}>{label}</span>
      {!isMobile && <span style={{ fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.6)', lineHeight: 1.3 }}>{sub}</span>}
    </button>
  )
}

export default function FloorPage() {
  const { checking, blocked } = useTillAccess(SECTION_ACCESS.pos, { login: '/pos/login', home: '/pos' })
  const { on: allergensOn } = useFeature('foodSafety')
  // What the kitchen has ready, for whoever is nearest to run it.
  const { on: kdsOn } = useFeature('kds')
  const isMobile = useIsMobile()
  const router = useRouter()
  const now = useNow()

  // One branch for now. v1 ships on one section of one branch, with the old
  // till still taking payment, precisely so a waiter who cannot send an order
  // walks ten steps to it.
  const [branch] = useState(BRAND.branches[0] ?? '')
  // The drawer only matters once the till takes money (Phase 04). During the
  // pilot the old till has the cash, and a Drawer link would be a screen with
  // nothing to do on it.
  const { on: takesPayment } = useFeature('payments')
  const { checks, error: liveError } = useOpenChecks(branch)
  // A branch a café hub trades is view-only online (S10); the routes refuse, this says so.
  const hubOnly = useHubOnly(branch)

  // A little over a day back, fixed when the page opens: always wide enough to
  // hold the café's whole today, whatever the zone, and no wider.
  const [sinceMs] = useState(() => Date.now() - 30 * 3600_000)
  const { checks: closedRecent, loading: closedLoading, error: closedError, truncated } = useChecksClosedSince(branch, sinceMs)

  const [chosen, setChosen] = useState<ReadingKey[]>(() => {
    try { return readReadingChoice(typeof window === 'undefined' ? null : window.localStorage.getItem(READINGS_KEY)) }
    catch { return readReadingChoice(null) }
  })
  const [choosing, setChoosing] = useState(false)

  const [adding, setAdding] = useState(false)
  const [tableNumber, setTableNumber] = useState('')
  const [guests, setGuests] = useState('2')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const open = useMemo(
    () => [...checks].sort((a, b) => a.tableNumber - b.tableNumber),
    [checks],
  )

  const timeZone = BRAND.locale.timezone
  const today = todayYmd(timeZone, new Date(now))
  const readings = useMemo(() => floorReadings(
    open.map(c => orderedTotal(c.lines)),
    closedRecent.map(c => ({
      status: c.status,
      day: closedAtParts(c.closedAt, timeZone).day,
      // What the check came to, after staff meal and discounts — the same
      // figure its receipt and the sales export use.
      totalUsd: checkTotals(c).net,
    })),
    today,
  ), [open, closedRecent, today, timeZone])

  function toggleReading(key: ReadingKey) {
    setChosen(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : READINGS.map(r => r.key).filter(k => k === key || prev.includes(k))
      try { window.localStorage.setItem(READINGS_KEY, JSON.stringify(next)) } catch { /* private mode: the choice lasts the visit */ }
      return next
    })
  }

  async function handleOpen() {
    const n = Number(tableNumber)
    if (!Number.isInteger(n) || n < 1) { setError('Enter a table number.'); return }
    // Already open: go to it, rather than an error saying so (UPGRADE.md T1.3).
    const existing = open.find(c => c.tableNumber === n)
    if (existing) { router.push(`/pos/check/${existing.id}`); return }
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
        <div style={{ maxWidth: '44ch', textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', color: 'var(--offwhite)', marginBottom: '0.8rem' }}>
            {blocked === 'feature' ? 'Point of Sale is switched off' : 'You do not have till access'}
          </h1>
          <p style={{ fontSize: '1rem', color: 'rgba(var(--offwhite-rgb),0.6)', lineHeight: 1.7 }}>
            {blocked === 'feature'
              ? 'A superadmin can switch it on in the admin panel under Settings → Modules. It needs the Menu module on as well.'
              : 'Ask an admin to give you the Point of Sale section in the admin panel under Manage Users.'}
          </p>
        </div>
      </main>
    )
  }
  if (checking) return <PosLoading />

  const closedValue = closedLoading ? '…' : money(readings.closedTodayUsd)
  const readingValue: Record<ReadingKey, { value: string; sub?: string }> = {
    closedToday: {
      value: closedValue,
      sub: closedLoading ? 'Loading…' : `${readings.closedTodayCount} ${readings.closedTodayCount === 1 ? 'table' : 'tables'} closed`,
    },
    openTotal: { value: money(readings.openTotalUsd), sub: `across ${readings.openCount} open ${readings.openCount === 1 ? 'table' : 'tables'}` },
    openCount: { value: String(readings.openCount), sub: 'with a bill open' },
    averageToday: {
      value: closedLoading ? '…' : readings.averageTodayUsd === null ? '—' : money(readings.averageTodayUsd),
      sub: readings.averageTodayUsd === null && !closedLoading ? 'nothing closed yet today' : 'per closed table',
    },
    refundsToday: {
      value: closedLoading ? '…' : money(readings.refundsTodayUsd),
      sub: `${readings.refundsTodayCount} refunded — not taken off sales`,
    },
  }
  const shownReadings = READINGS.filter(r => chosen.includes(r.key))

  // The other screens, in the order staff reach for them. The counter is the
  // one that keeps working through an outage; the kitchen display is gated on
  // its own section, and a waiter without it lands on its own explanation.
  const navTiles = (
    <>
      <NavTile icon={faStore} label="Counter" sub="The till, even offline" colour="#06B6D4" isMobile={isMobile} onClick={() => router.push('/pos/counter')} />
      <NavTile icon={faReceipt} label="Closed" sub="Checks closed today" colour="#A855F7" isMobile={isMobile} onClick={() => router.push('/pos/closed')} />
      {kdsOn && <NavTile icon={faFire} label="Kitchen display" sub="The pass" colour="#F97316" isMobile={isMobile} onClick={() => router.push('/pos/kds')} />}
      {takesPayment && <NavTile icon={faCashRegister} label="Drawer" sub="Float, X and Z" colour="#EAB308" isMobile={isMobile} onClick={() => router.push('/pos/drawer')} />}
      {allergensOn && <NavTile icon={faWheatAwnCircleExclamation} label="Allergens" sub="What is in each dish" colour="#EC4899" isMobile={isMobile} onClick={() => router.push('/pos/allergens')} />}
    </>
  )

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '1.25rem 1rem 7rem' : '1.75rem 2rem 7.5rem',
      fontFamily: 'var(--font-inter)',
    }}>
      {/* On a wide screen the other screens are big boxes down the right, in
          the space the tables do not use; on a phone, a grid under the title. */}
      <div style={{
        maxWidth: '1400px', margin: '0 auto',
        display: isMobile ? 'block' : 'grid',
        gridTemplateColumns: isMobile ? undefined : 'minmax(0, 1fr) 190px',
        gap: '1.5rem', alignItems: 'start',
      }}>
        <div>

        <div style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div>
            <p style={{
              fontSize: '0.85rem', letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'rgba(var(--offwhite-rgb),0.55)', marginBottom: '0.3rem', fontWeight: 700,
            }}>{branch}</p>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.8rem' : '2.4rem', color: 'var(--offwhite)', lineHeight: 1 }}>
              Open tables
            </h1>
          </div>
          {/* The till had no way to sign out (UPGRADE.md T1.11). */}
          <PosButton icon={faRightFromBracket} label="Sign out" tone="quiet" size="sm"
            onClick={() => { void backend().signOut().then(() => router.replace('/pos/login')) }} />
        </div>

        {isMobile && (
          <nav aria-label="Other screens" style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.6rem', marginBottom: '1.25rem',
          }}>
            {navTiles}
          </nav>
        )}

        <HubOnlyBanner hub={hubOnly} branch={branch} isMobile={isMobile} />
        {kdsOn && <ReadyPanel branch={branch} isMobile={isMobile} />}

        {/* ── Readings ──────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <button
            type="button"
            onClick={() => setChoosing(true)}
            aria-label="Choose readings"
            style={{
              width: '150px', height: '150px', flex: '0 0 auto',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
              borderRadius: '14px', cursor: 'pointer',
              background: 'rgba(255,255,255,0.06)', border: '2px solid rgba(255,255,255,0.22)',
              color: 'var(--offwhite)', fontFamily: 'var(--font-inter)',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <FontAwesomeIcon icon={faChartColumn} style={{ fontSize: '2.2rem', color: 'rgba(var(--offwhite-rgb),0.85)' }} />
            <span style={{ fontSize: '1rem', fontWeight: 700 }}>Readings</span>
            <span style={{ fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.6)' }}>{shownReadings.length} shown · change</span>
          </button>

          {shownReadings.map(r => (
            <ReadingCard key={r.key} icon={READING_LOOK[r.key].icon} colour={READING_LOOK[r.key].colour}
              label={r.label} value={readingValue[r.key].value} sub={readingValue[r.key].sub} main={r.key === 'closedToday'} />
          ))}
          {shownReadings.length === 0 && (
            <p style={{ alignSelf: 'center', fontSize: '0.95rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>
              No readings shown — tap Readings to choose some.
            </p>
          )}
        </div>

        {(closedError || truncated) && (
          <p style={{
            color: 'var(--brand-secondary)', fontSize: '0.95rem', marginBottom: '1rem', lineHeight: 1.6,
            background: 'rgba(var(--brand-secondary-rgb),0.1)', border: '1px solid rgba(var(--brand-secondary-rgb),0.35)',
            borderRadius: '8px', padding: '0.8rem 1rem',
          }}>
            <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.5rem' }} />
            {closedError
              ? `Today's closed figures could not be read: ${closedError}`
              : 'More checks closed since yesterday than this screen reads — today\'s closed figures may be short. Use the sales export for the full day.'}
          </p>
        )}

        {liveError && (
          <p style={{
            color: 'var(--brand-secondary)', fontSize: '0.95rem', marginBottom: '1rem', lineHeight: 1.6,
            background: 'rgba(var(--brand-secondary-rgb),0.1)', border: '1px solid rgba(var(--brand-secondary-rgb),0.35)',
            borderRadius: '8px', padding: '0.8rem 1rem',
          }}><FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.5rem' }} />{liveError}</p>
        )}

        {error && !adding && (
          <p style={{
            color: 'var(--red)', fontSize: '0.95rem', marginBottom: '1rem',
            background: 'rgba(var(--red-rgb),0.1)', border: '1px solid rgba(var(--red-rgb),0.35)',
            borderRadius: '8px', padding: '0.8rem 1rem',
          }}><FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.5rem' }} />{error}</p>
        )}

        {open.length === 0 ? (
          <div style={{
            color: 'rgba(var(--offwhite-rgb),0.55)', fontSize: '1.05rem',
            lineHeight: 1.8, padding: '3rem 0', textAlign: 'center',
          }}>
            <FontAwesomeIcon icon={faDoorOpen} style={{ fontSize: '2rem', marginBottom: '0.6rem', color: 'rgba(var(--offwhite-rgb),0.35)' }} />
            <p>No tables open.</p>
            <p>Tap <strong style={{ color: 'var(--offwhite)' }}>Add table</strong> to start one.</p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            // Bigger squares on a touch screen: a table is the thing tapped most.
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? '120px' : '170px'}, 1fr))`,
            gap: '0.8rem',
          }}>
            {open.map(c => (
              <CheckCard key={c.id} check={c} now={now} onOpen={() => router.push(`/pos/check/${c.id}`)} isMobile={isMobile} />
            ))}
          </div>
        )}
        </div>

        {!isMobile && (
          <nav aria-label="Other screens" style={{
            position: 'sticky', top: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem',
          }}>
            {navTiles}
          </nav>
        )}
      </div>

      {/* Sticky: a waiter's thumb lives at the bottom of the screen. */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
        backgroundColor: 'rgba(10,10,10,0.97)', borderTop: '1px solid rgba(255,255,255,0.12)',
        padding: '0.8rem 1rem',
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <PosButton icon={faPlus} label="Add table" tone="primary" size="lg" full
            onClick={() => { setAdding(true); setTableNumber(''); setError('') }} />
        </div>
      </div>

      {/* ── Choosing readings ───────────────────────────────────────────── */}
      {choosing && (
        <div onClick={() => setChoosing(false)} style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            backgroundColor: '#111', width: '100%', maxWidth: '560px',
            borderRadius: isMobile ? '14px 14px 0 0' : '14px', padding: '1.4rem 1.2rem 1.6rem',
            border: '1px solid rgba(255,255,255,0.12)',
          }}>
            <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.4rem', color: 'var(--offwhite)', marginBottom: '0.3rem' }}>
              What to show
            </h2>
            <p style={{ fontSize: '0.92rem', color: 'rgba(var(--offwhite-rgb),0.55)', marginBottom: '1rem' }}>
              Remembered on this device.
            </p>
            <div style={{ display: 'grid', gap: '0.55rem' }}>
              {READINGS.map(r => {
                const on = chosen.includes(r.key)
                const look = READING_LOOK[r.key]
                return (
                  <button key={r.key} type="button" onClick={() => toggleReading(r.key)} aria-pressed={on} style={{
                    minHeight: '68px', borderRadius: '12px', cursor: 'pointer', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: '0.9rem', padding: '0.6rem 1rem',
                    fontFamily: 'var(--font-inter)', color: 'var(--offwhite)',
                    background: on ? 'rgba(var(--teal-rgb),0.14)' : 'rgba(255,255,255,0.04)',
                    border: `2px solid ${on ? 'var(--teal)' : 'rgba(255,255,255,0.14)'}`,
                  }}>
                    <FontAwesomeIcon icon={look.icon} style={{ color: look.colour, fontSize: '1.35rem', width: '1.5rem' }} />
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: '1.02rem', fontWeight: 700 }}>{r.label}</span>
                      <span style={{ display: 'block', fontSize: '0.85rem', color: 'rgba(var(--offwhite-rgb),0.55)' }}>{r.hint}</span>
                    </span>
                    <span style={{
                      width: '1.9rem', height: '1.9rem', borderRadius: '6px', flexShrink: 0,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: on ? 'var(--teal)' : 'transparent', border: `2px solid ${on ? 'var(--teal)' : 'rgba(255,255,255,0.3)'}`,
                    }}>{on && <FontAwesomeIcon icon={faCheck} style={{ color: '#fff' }} />}</span>
                  </button>
                )
              })}
            </div>
            <div style={{ marginTop: '1.1rem' }}>
              <PosButton icon={faCheck} label="Done" tone="primary" full onClick={() => setChoosing(false)} />
            </div>
          </div>
        </div>
      )}

      {adding && (
        // A form, so Enter on a PC opens the table (UPGRADE.md T1.2), and a proper
        // dialog: Escape closes it, focus goes in and comes back (T2.3).
        <Sheet label="Open a table" onClose={() => setAdding(false)} onSubmit={() => { void handleOpen() }} center={!isMobile}>
          <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.4rem', color: 'var(--offwhite)', marginBottom: '1rem' }}>
            Open a table
          </h2>

          <label htmlFor="open-table-number" style={{
            display: 'block', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.6)', marginBottom: '0.45rem',
          }}>Table number</label>
          <input
            id="open-table-number"
            value={tableNumber}
            onChange={e => setTableNumber(e.target.value.replace(/[^0-9]/g, ''))}
            // A numeric keypad, not a full keyboard: this is the one field a
            // waiter fills on every single table.
            inputMode="numeric"
            autoFocus
            placeholder="7"
            style={{
              width: '100%', minHeight: '72px', textAlign: 'center',
              background: 'rgba(255,255,255,0.05)', border: '2px solid rgba(255,255,255,0.18)',
              borderRadius: '10px', color: 'var(--offwhite)',
              fontFamily: 'var(--font-cinzel)', fontSize: '2.2rem', outline: 'none',
            }}
          />

          <p id="open-table-guests" style={{
            display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.6)', margin: '1.1rem 0 0.5rem',
          }}><FontAwesomeIcon icon={faUserGroup} />Guests</p>
          <div role="group" aria-labelledby="open-table-guests" style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
              <Chip key={n} label={String(n)} active={guests === String(n)} onClick={() => setGuests(String(n))} />
            ))}
            {/* A bigger party: the stepper goes past 8 (UPGRADE.md T1.4). */}
            <Stepper label="Guests" value={Math.max(1, Number(guests) || 1)} onChange={n => setGuests(String(n))} max={60} />
          </div>

          {error && (
            <p style={{ color: 'var(--red)', fontSize: '0.95rem', marginTop: '0.9rem' }}>
              <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.4rem' }} />{error}
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.3rem' }}>
            <PosButton icon={faXmark} label="Cancel" tone="quiet" grow={1} onClick={() => setAdding(false)} />
            <PosButton icon={faPlus} label={busy ? 'Opening…' : `Open table ${tableNumber || ''}`} tone="primary" size="lg" grow={2}
              type="submit" disabled={busy || !tableNumber} />
          </div>
        </Sheet>
      )}
    </main>
  )
}
