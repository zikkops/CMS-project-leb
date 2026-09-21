'use client'

// The kitchen display: what this pass has to make, oldest first.
//
// Written for a screen on a wall that nobody is standing at, read from two
// metres away by somebody holding a pan. That drives every choice here — large
// type, few words, colour that means one thing, and a bump target big enough
// to hit with a knuckle.
//
// A station is chosen once per device and remembered locally. It is a property
// of the screen, not of the person signed in: the same account is a manager on
// their phone and the pass on the wall, and asking them to re-pick every
// morning is how a screen ends up on the wrong station all service.
//
// ── Look (14 Sep 2026) ─────────────────────────────────────────────────────
// A ticket's STATUS is its header — tinted, with an icon and a word — because
// a new ticket and one somebody has started looked identical from across the
// kitchen, told apart only by the label on a button. How LONG it has waited is
// the border and the timer. Back moved from beside the main button (1px away,
// the easiest thing on the screen to hit by mistake) to the top of the card.
// Controls come from pos/app/lib/posUi.tsx.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBell, faFire, faCircleCheck, faCheckDouble, faClock, faRotateLeft, faNoteSticky, faBan, faPause,
  faChair, faLayerGroup, faPrint, faArrowRightArrowLeft, faArrowLeft, faMugHot, faCakeCandles,
  faUtensils, faTriangleExclamation, type IconDefinition,
} from '@fortawesome/free-solid-svg-icons'
import { SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { useTillAccess } from '../../lib/useTillAccess'
import { BRAND } from '@big-cms/shared/brand'
import { STATIONS, type Station } from '@big-cms/shared/checks'
import {
  minutesWaiting, urgency, canTransition, ticketSentAtMs, type Ticket, type TicketStatus,
} from '@big-cms/shared/tickets'
import { useStationTickets, advanceTicket } from '../../lib/usePos'
import { usePrintingSettings } from '../../lib/useTillSettings'
import { activeStations } from '@big-cms/shared/printing'
import { useAutoPrintTickets, useAutoPrintReceipts, usePrintsHere } from '../../lib/useAutoPrint'
import { useBusinessSettings } from '../../lib/useTillSettings'
import { PosButton, Chip, StatusBadge, STATION_COLOUR, PosLoading } from '../../lib/posUi'
import { SignOutButton } from '../../lib/SignOutButton'
import { useHubOnly, HubOnlyBanner } from '../../lib/useHubOnly'

const STORAGE_KEY = 'kds.station'

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
 * A clock, so tickets age without anything being written.
 *
 * Every ten seconds here rather than fifteen as on the floor: this is the
 * screen somebody is judging timing by, and a minute counter that lags by a
 * quarter of a minute is a minute counter nobody trusts.
 */
function useNow(everyMs = 10_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

/** How long it has waited: the border and the timer. */
const URGENCY = {
  fresh: { border: 'rgba(var(--overlay-rgb),0.16)', width: 2, text: 'var(--offwhite)' },
  aging: { border: 'var(--brand-secondary)', width: 3, text: 'var(--brand-secondary)' },
  late: { border: 'var(--red)', width: 4, text: 'var(--red)' },
} as const

/** What state it is in: the header. */
const STATUS_LOOK: Record<string, { label: string; icon: IconDefinition; colour: string }> = {
  // Sent but held until the front fires it (UPGRADE.md T3.11): grey, no timer pressure, nothing to tap.
  held: { label: 'Held', icon: faPause, colour: '#64748B' },
  new: { label: 'New', icon: faBell, colour: '#3B82F6' },
  preparing: { label: 'Preparing', icon: faFire, colour: '#F97316' },
  ready: { label: 'Ready', icon: faCircleCheck, colour: '#22C55E' },
}

/** What tapping the big button does next, and what it should say. */
const NEXT_ACTION: Record<string, { to: TicketStatus; label: string; icon: IconDefinition } | null> = {
  held: null,
  new: { to: 'preparing', label: 'Start', icon: faFire },
  preparing: { to: 'ready', label: 'Ready', icon: faCircleCheck },
  // Ready waits for the front: the counter or the floor taps "Picked up", and
  // that clears it here (owner's decision, 14 Sep 2026). A small Clear stays on
  // the card so a pass is never stuck behind a front screen nobody is watching.
  ready: null,
  bumped: null,
  cancelled: null,
}

const STATION_ICON: Record<string, IconDefinition> = {
  Kitchen: faUtensils,
  Bar: faMugHot,
  Sweets: faCakeCandles,
  All: faLayerGroup,
}

const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

/** One ticket. Module scope — see CONTRIBUTING.md gotcha #2. */
function TicketCard({
  ticket, now, busy, showStation, onAdvance, onBack, isMobile,
}: {
  ticket: Ticket
  now: number
  busy: boolean
  showStation: boolean
  onAdvance: (to: TicketStatus) => void
  onBack: () => void
  isMobile: boolean
}) {
  // sentAt is a server timestamp, and its shape on arrival depends on how the
  // document was read — ticketSentAtMs handles both. A ticket written moments
  // ago can briefly have none at all while the server timestamp resolves, so
  // the fallback is "just now" rather than 1970.
  const held = ticket.status === 'held'
  const mins = minutesWaiting(ticketSentAtMs(ticket, now), now)
  // A held ticket is not late: nobody has asked for it yet. It turns new, with a fresh time, when fired.
  const level = held ? 'fresh' : urgency(mins)
  const next = NEXT_ACTION[ticket.status]
  const look = STATUS_LOOK[ticket.status] ?? { label: ticket.status, icon: faBell, colour: '#64748B' }
  const live = ticket.lines.filter(l => !l.voided)
  const voided = ticket.lines.filter(l => l.voided)
  // A way back, because the commonest mistake on a touchscreen in a kitchen is
  // a tap nobody meant. Absent on 'new', which has no earlier state.
  const canGoBack = !held && (canTransition(ticket.status, 'new') || canTransition(ticket.status, 'preparing'))

  return (
    <div style={{
      border: `${URGENCY[level].width}px solid ${URGENCY[level].border}`,
      borderRadius: '14px', backgroundColor: level === 'late' ? 'rgba(var(--red-rgb),0.06)' : 'rgba(var(--overlay-rgb),0.03)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'var(--font-inter)',
    }}>
      {/* The status IS the header. */}
      <div style={{
        background: tint(look.colour, 22), borderBottom: `1px solid ${tint(look.colour, 45)}`,
        padding: '0.7rem 0.9rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
            fontSize: '0.95rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: look.colour,
          }}>
            <FontAwesomeIcon icon={look.icon} style={{ fontSize: '1.1rem' }} />{look.label}
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
            fontSize: isMobile ? '1.3rem' : '1.55rem', fontWeight: 800, color: URGENCY[level].text,
          }}>
            <FontAwesomeIcon icon={level === 'late' ? faTriangleExclamation : faClock} style={{ fontSize: '0.9em' }} />{mins}m
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginTop: '0.45rem' }}>
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.6rem' : '1.9rem', color: 'var(--offwhite)', lineHeight: 1 }}>
              {ticket.orderLabel ?? `Table ${ticket.tableNumber}`}
            </span>
            {ticket.round > 1 && (
              <span style={{ fontSize: '0.9rem', color: 'rgba(var(--offwhite-rgb),0.65)', fontWeight: 600 }}>round {ticket.round}</span>
            )}
          </span>
          {canGoBack && (
            <PosButton icon={faRotateLeft} label="Back" size="sm" tone="quiet" disabled={busy} onClick={onBack} />
          )}
        </div>

        {showStation && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.45rem',
            padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.82rem', fontWeight: 700,
            background: tint(STATION_COLOUR[ticket.station] ?? '#64748B', 25),
            color: 'var(--offwhite)', border: `1px solid ${STATION_COLOUR[ticket.station] ?? '#64748B'}`,
          }}>
            <FontAwesomeIcon icon={STATION_ICON[ticket.station] ?? faUtensils} />{ticket.station}
          </span>
        )}
      </div>

      <div style={{ padding: '0.8rem 0.95rem', flex: 1 }}>
        {live.map(l => (
          <div key={l.lineId} style={{ marginBottom: '0.8rem' }}>
            <p style={{ fontSize: isMobile ? '1.12rem' : '1.22rem', color: 'var(--offwhite)', lineHeight: 1.3, fontWeight: 600 }}>
              <span style={{ display: 'inline-block', minWidth: '2.3rem', fontWeight: 800 }}>{l.quantity}×</span>
              {l.name}
            </p>
            {l.modifiers && (
              <p style={{ fontSize: '1rem', color: 'rgba(var(--offwhite-rgb),0.72)', marginTop: '0.15rem', paddingLeft: '2.3rem' }}>
                {l.modifiers}
              </p>
            )}
            {l.note && (
              <p style={{
                fontSize: '1rem', color: 'var(--brand-secondary)', marginTop: '0.25rem', fontWeight: 700,
                marginLeft: '2.3rem', padding: '0.25rem 0.55rem', borderRadius: '6px',
                background: 'rgba(var(--brand-secondary-rgb),0.12)', display: 'inline-block',
              }}>
                <FontAwesomeIcon icon={faNoteSticky} style={{ marginRight: '0.4rem' }} />{l.note}
              </p>
            )}
            {(l.seat !== null || l.course !== null) && (
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.35rem', paddingLeft: '2.3rem' }}>
                {l.seat !== null && <StatusBadge icon={faChair} label={`Seat ${l.seat}`} />}
                {l.course !== null && <StatusBadge icon={faLayerGroup} label={`Course ${l.course}`} />}
              </div>
            )}
          </div>
        ))}

        {/* Struck off AFTER this ticket was fired. Shown rather than removed:
            somebody may already be cooking it, and food silently vanishing
            from a pass is how a plate gets made twice or not at all. */}
        {voided.map(l => (
          <p key={l.lineId} style={{
            fontSize: '1.05rem', color: 'var(--red)', marginBottom: '0.5rem', fontWeight: 600,
          }}>
            <FontAwesomeIcon icon={faBan} style={{ marginRight: '0.45rem' }} />
            <span style={{ textDecoration: 'line-through' }}>{l.quantity}× {l.name}</span> — cancelled
          </p>
        ))}
      </div>

      {held && (
        <p style={{ padding: '0 0.95rem 0.9rem', margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#94A3B8', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <FontAwesomeIcon icon={faPause} />Held: do not start until the front fires it
        </p>
      )}

      {ticket.status === 'ready' && (
        <div style={{
          padding: '0 0.75rem 0.75rem', display: 'flex', gap: '0.6rem',
          alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem', fontWeight: 700, color: '#22C55E' }}>
            <FontAwesomeIcon icon={faCircleCheck} />Waiting for the front
          </span>
          <PosButton icon={faCheckDouble} label="Clear" size="sm" tone="quiet" disabled={busy} onClick={() => onAdvance('bumped')} />
        </div>
      )}

      {next && (
        <div style={{ padding: '0 0.75rem 0.75rem' }}>
          <PosButton icon={next.icon} label={next.label} tone="primary" size="lg" full
            disabled={busy} onClick={() => onAdvance(next.to)} style={{ minHeight: '72px', fontSize: '1.25rem' }} />
        </div>
      )}
    </div>
  )
}

export default function KdsPage() {
  const { checking, blocked } = useTillAccess(SECTION_ACCESS.kds, { login: '/pos/login', home: '/pos' })
  const isMobile = useIsMobile()
  const router = useRouter()
  const now = useNow()

  const [branch] = useState(BRAND.branches[0] ?? '')
  // A branch a café hub trades is view-only online (S10): its kitchen is the hub's.
  const hubOnly = useHubOnly(branch)
  // 'All' is a real choice, not the absence of one — so the picker still has
  // to be answered before anything renders. null means "not chosen yet".
  const [station, setStation] = useState<Station | 'All' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Read once on mount rather than during render, because localStorage does
  // not exist on the server and reading it while rendering makes the server
  // and client produce different HTML.
  //
  // The lint rule below is a performance heuristic about cascading renders,
  // and it is right in general. Here the cascade is exactly one render on
  // mount, and it is the price of not mismatching hydration — a lazy
  // useState initialiser would read storage during render and reintroduce
  // exactly that. Disabled knowingly rather than worked around.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved === 'All' || (saved && (STATIONS as string[]).includes(saved))) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStation(saved as Station | 'All')
      }
    } catch { /* private window, storage disabled — the picker just shows */ }
  }, [])

  function choose(s: Station | 'All') {
    setStation(s)
    try { window.localStorage.setItem(STORAGE_KEY, s) } catch { /* not fatal */ }
  }

  // One value feeds both the listener and the printer's notion of scope, so
  // they cannot disagree about when the subscription changed.
  const filter = station === 'All' ? null : station
  const { tickets, loading: ticketsLoading, error: liveError } = useStationTickets(branch, filter)

  // Paper, if this device is the one with a printer on it. Off until somebody
  // says otherwise — see useAutoPrint for why that default is not timidity.
  const { settings: printing, loading: printingLoading } = usePrintingSettings()
  // One switch for this device, shared by tickets and receipts: it is the same
  // machine and the same printer either way.
  const printsHere = usePrintsHere()
  const { settings: business, loading: businessLoading } = useBusinessSettings()
  const receipts = useAutoPrintReceipts({
    on: printsHere.on,
    branch,
    screenStation: filter,
    settings: printing,
    settingsLoading: printingLoading,
    exchangeRate: business.exchangeRate,
    rateLoading: businessLoading,
  })
  const autoPrint = useAutoPrintTickets({
    on: printsHere.on,
    tickets,
    ticketsLoading,
    scope: `${branch}|${filter ?? '*'}`,
    branch,
    settings: printing,
    settingsLoading: printingLoading,
  })
  const printable = activeStations(printing, branch)
  const paperError = autoPrint.lastError ?? receipts.lastError
  const paperCount = autoPrint.printed + receipts.printed

  async function move(ticket: Ticket, to: TicketStatus) {
    setBusy(ticket.id)
    setError('')
    try {
      await advanceTicket(ticket.id, to)
    } catch (err) {
      // The route owns the state machine, so its refusal is the accurate one —
      // "already bumped, fire a new round" rather than anything this screen
      // could invent.
      setError(err instanceof Error ? err.message : 'Could not update that ticket.')
    } finally {
      setBusy(null)
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
            {blocked === 'feature' ? 'Kitchen Display is switched off' : 'You do not have pass access'}
          </h1>
          <p style={{ fontSize: '1rem', color: 'rgba(var(--offwhite-rgb),0.6)', lineHeight: 1.7 }}>
            {blocked === 'feature'
              ? 'A superadmin can switch it on in the admin panel under Settings → Modules. It needs Point of Sale on as well.'
              : 'Ask an admin to give you the Kitchen Display section in the admin panel under Manage Users.'}
          </p>
        </div>
      </main>
    )
  }
  if (checking) return <PosLoading />

  if (!station) {
    return (
      <main style={{
        minHeight: '100vh', backgroundColor: 'var(--black)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '2rem', fontFamily: 'var(--font-inter)',
      }}>
        <div style={{ textAlign: 'center', width: '100%', maxWidth: '520px' }}>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.9rem', color: 'var(--offwhite)', marginBottom: '0.5rem' }}>
            Which pass is this screen?
          </h1>
          <p style={{ fontSize: '1rem', color: 'rgba(var(--offwhite-rgb),0.6)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
            Remembered on this device.
          </p>
          <div style={{ display: 'grid', gap: '0.7rem' }}>
            {([...STATIONS, 'All'] as const).map(s => {
              const colour = STATION_COLOUR[s] ?? '#64748B'
              return (
                <button key={s} type="button" onClick={() => choose(s)} style={{
                  minHeight: '84px', borderRadius: '14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '1rem', padding: '0 1.4rem',
                  backgroundColor: tint(colour, 12), border: `2px solid ${tint(colour, 60)}`, borderLeft: `8px solid ${colour}`,
                  color: 'var(--offwhite)', fontFamily: 'var(--font-cinzel)', fontSize: '1.5rem',
                }}>
                  <FontAwesomeIcon icon={STATION_ICON[s] ?? faUtensils} style={{ color: colour, fontSize: '1.5rem', width: '1.8rem' }} />
                  {s === 'All' ? 'All stations' : s}
                </button>
              )
            })}
          </div>
          <div style={{ marginTop: '1.2rem' }}>
            <PosButton icon={faArrowLeft} label="Back to the floor" tone="quiet" onClick={() => router.push('/pos')} />
          </div>
        </div>
      </main>
    )
  }

  const byStatus = (s: string) => tickets.filter(t => t.status === s).length
  const stationColour = STATION_COLOUR[station] ?? '#64748B'

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '1rem 0.8rem 2rem' : '1.25rem 1.5rem 3rem',
      fontFamily: 'var(--font-inter)',
    }}>
      <HubOnlyBanner hub={hubOnly} branch={branch} isMobile={isMobile} />
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '1.1rem', flexWrap: 'wrap', gap: '0.8rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap' }}>
          <span style={{
            width: '52px', height: '52px', borderRadius: '12px', background: tint(stationColour, 22),
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${stationColour}`,
          }}>
            <FontAwesomeIcon icon={STATION_ICON[station] ?? faUtensils} style={{ color: stationColour, fontSize: '1.4rem' }} />
          </span>
          <div>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.7rem' : '2.2rem', color: 'var(--offwhite)', lineHeight: 1 }}>
              {station === 'All' ? 'All stations' : station}
            </h1>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
              {byStatus('held') > 0 && <StatusBadge icon={faPause} label={`${byStatus('held')} held`} />}
              <StatusBadge icon={faBell} label={`${byStatus('new')} new`} />
              <StatusBadge icon={faFire} label={`${byStatus('preparing')} preparing`} />
              <StatusBadge icon={faCircleCheck} label={`${byStatus('ready')} ready`} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Only offered where a printer is actually configured for this
              branch. A toggle that cannot do anything is a toggle somebody
              turns on and then reports as broken. */}
          {printable.length > 0 && (
            <Chip
              icon={faPrint}
              active={printsHere.on}
              onClick={() => printsHere.setOn(!printsHere.on)}
              label={`Print here${printsHere.on && paperCount > 0 ? ` · ${paperCount}` : ''}${receipts.active ? ' · receipts' : ''}`}
            />
          )}
          <PosButton icon={faArrowRightArrowLeft} label="Change station" tone="neutral" size="sm"
            onClick={() => { setStation(null); try { localStorage.removeItem(STORAGE_KEY) } catch {} }} />
          <SignOutButton />
          <PosButton icon={faArrowLeft} label="Floor" tone="quiet" size="sm" onClick={() => router.push('/pos')} />
        </div>
      </div>

      {(liveError || error) && (
        <p style={{
          color: 'var(--brand-secondary)', fontSize: '1rem', marginBottom: '1rem', lineHeight: 1.6,
          background: 'rgba(var(--brand-secondary-rgb),0.1)', border: '1px solid rgba(var(--brand-secondary-rgb),0.35)',
          borderRadius: '8px', padding: '0.85rem 1rem',
        }}><FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.5rem' }} />{error || liveError}</p>
      )}

      {paperError && (
        <p style={{
          color: 'rgba(var(--offwhite-rgb),0.7)', fontSize: '0.92rem', marginBottom: '1rem',
          lineHeight: 1.6, border: '1px solid rgba(var(--overlay-rgb),0.14)',
          borderRadius: '8px', padding: '0.7rem 1rem',
        }}><FontAwesomeIcon icon={faPrint} style={{ marginRight: '0.5rem' }} />Paper: {paperError} — nothing is lost; the screen is the record.</p>
      )}

      {tickets.length === 0 ? (
        <div style={{ color: 'rgba(var(--offwhite-rgb),0.45)', fontSize: '1.3rem', textAlign: 'center', padding: '5rem 0' }}>
          <FontAwesomeIcon icon={faCircleCheck} style={{ fontSize: '2.4rem', marginBottom: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.3)' }} />
          <p>Nothing on the pass.</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? '270px' : '320px'}, 1fr))`,
          gap: '0.9rem', alignItems: 'start',
        }}>
          {tickets.map(t => (
            <TicketCard
              key={t.id}
              ticket={t}
              now={now}
              busy={busy === t.id}
              showStation={station === 'All'}
              isMobile={isMobile}
              onAdvance={to => move(t, to)}
              onBack={() => move(t, t.status === 'ready' ? 'preparing' : 'new')}
            />
          ))}
        </div>
      )}
    </main>
  )
}
