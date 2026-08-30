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

import { useEffect, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRAND } from '@big-cms/shared/brand'
import { STATIONS, type Station } from '@big-cms/shared/checks'
import {
  minutesWaiting, urgency, canTransition, type Ticket, type TicketStatus,
} from '@big-cms/shared/tickets'
import { useStationTickets, advanceTicket } from '../../lib/usePos'

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

const URGENCY = {
  fresh: { border: 'rgba(0,160,152,0.45)', text: 'var(--teal)' },
  aging: { border: '#C9962C', text: '#C9962C' },
  late: { border: 'var(--red)', text: 'var(--red)' },
} as const

/** What tapping the big button does next, and what it should say. */
const NEXT_ACTION: Record<string, { to: TicketStatus; label: string } | null> = {
  new: { to: 'preparing', label: 'Start' },
  preparing: { to: 'ready', label: 'Ready' },
  ready: { to: 'bumped', label: 'Bump' },
  bumped: null,
  cancelled: null,
}

/** One ticket. Module scope — see CONTRIBUTING.md gotcha #2. */
function TicketCard({
  ticket, now, busy, onAdvance, onBack, isMobile,
}: {
  ticket: Ticket
  now: number
  busy: boolean
  onAdvance: (to: TicketStatus) => void
  onBack: () => void
  isMobile: boolean
}) {
  // sentAt is a Firestore timestamp on the wire; it arrives as an object with
  // seconds. A ticket written moments ago can briefly have none at all, while
  // the server timestamp resolves — treat that as "just now" rather than 1970.
  const raw = ticket as unknown as { sentAt?: { seconds?: number } }
  const sentMs = raw.sentAt?.seconds ? raw.sentAt.seconds * 1000 : now
  const mins = minutesWaiting(sentMs, now)
  const level = urgency(mins)
  const next = NEXT_ACTION[ticket.status]
  const live = ticket.lines.filter(l => !l.voided)
  const voided = ticket.lines.filter(l => l.voided)

  return (
    <div style={{
      border: `2px solid ${URGENCY[level].border}`,
      borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.02)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        padding: '0.7rem 0.9rem', borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <span style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.4rem' : '1.6rem',
          color: 'var(--offwhite)',
        }}>
          T{ticket.tableNumber}
          {ticket.round > 1 && (
            <span style={{ fontSize: '0.7rem', color: 'rgba(245,242,236,0.4)', marginLeft: '0.4rem' }}>
              round {ticket.round}
            </span>
          )}
        </span>
        <span style={{
          fontFamily: 'var(--font-inter)', fontSize: '1.2rem', fontWeight: 700,
          color: URGENCY[level].text,
        }}>{mins}m</span>
      </div>

      <div style={{ padding: '0.7rem 0.9rem', flex: 1 }}>
        {live.map(l => (
          <div key={l.lineId} style={{ marginBottom: '0.6rem' }}>
            <p style={{
              fontFamily: 'var(--font-inter)', fontSize: isMobile ? '1rem' : '1.05rem',
              color: 'var(--offwhite)', lineHeight: 1.35,
            }}>
              <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{l.quantity}×</span>{' '}
              {l.name}
            </p>
            {l.modifiers && (
              <p style={{
                fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
                color: 'rgba(245,242,236,0.55)', marginTop: '0.1rem',
              }}>{l.modifiers}</p>
            )}
            {l.note && (
              <p style={{
                fontFamily: 'var(--font-inter)', fontSize: '0.85rem',
                color: '#C9962C', marginTop: '0.1rem', fontWeight: 600,
              }}>{l.note}</p>
            )}
            {l.seat !== null && (
              <p style={{
                fontFamily: 'var(--font-inter)', fontSize: '0.7rem',
                color: 'rgba(245,242,236,0.3)', marginTop: '0.1rem',
              }}>seat {l.seat}{l.course !== null ? ` · course ${l.course}` : ''}</p>
            )}
          </div>
        ))}

        {/* Struck off AFTER this ticket was fired. Shown rather than removed:
            somebody may already be cooking it, and food silently vanishing
            from a pass is how a plate gets made twice or not at all. */}
        {voided.map(l => (
          <p key={l.lineId} style={{
            fontFamily: 'var(--font-inter)', fontSize: '0.95rem',
            color: 'rgba(228,51,41,0.65)', textDecoration: 'line-through',
            marginBottom: '0.4rem',
          }}>{l.quantity}× {l.name} — cancelled</p>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '1px', backgroundColor: 'rgba(255,255,255,0.08)' }}>
        {/* A way back, because the commonest mistake on a touchscreen in a
            kitchen is a tap nobody meant. Absent on 'new', which has no
            earlier state to return to. */}
        {canTransition(ticket.status, 'new') || canTransition(ticket.status, 'preparing') ? (
          <button
            disabled={busy}
            onClick={onBack}
            style={{
              minHeight: '58px', width: '78px', border: 'none', cursor: 'pointer',
              backgroundColor: 'rgba(255,255,255,0.04)', color: 'rgba(245,242,236,0.45)',
              fontFamily: 'var(--font-inter)', fontSize: '0.75rem',
            }}
          >Back</button>
        ) : null}

        {next && (
          <button
            disabled={busy}
            onClick={() => onAdvance(next.to)}
            style={{
              flex: 1, minHeight: '58px', border: 'none',
              cursor: busy ? 'default' : 'pointer',
              backgroundColor: ticket.status === 'ready' ? 'var(--teal)' : 'rgba(255,255,255,0.06)',
              color: ticket.status === 'ready' ? '#fff' : 'var(--offwhite)',
              fontFamily: 'var(--font-inter)', fontSize: '0.95rem',
              letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600,
            }}
          >{next.label}</button>
        )}
      </div>
    </div>
  )
}

export default function KdsPage() {
  const { checking, blocked } = useRequireRole(SECTION_ACCESS.kds, { login: '/pos/login', home: '/pos' })
  const isMobile = useIsMobile()
  const now = useNow()

  const [branch] = useState(BRAND.branches[0] ?? '')
  const [station, setStation] = useState<Station | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Read once on mount rather than during render: localStorage does not exist
  // on the server, and reading it while rendering makes the first paint differ
  // between server and client.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved && (STATIONS as string[]).includes(saved)) setStation(saved as Station)
    } catch { /* private window, storage disabled — the picker just shows */ }
  }, [])

  function choose(s: Station) {
    setStation(s)
    try { window.localStorage.setItem(STORAGE_KEY, s) } catch { /* not fatal */ }
  }

  const { tickets, error: liveError } = useStationTickets(branch, station ?? 'Kitchen')

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
        <div style={{ maxWidth: '40ch', textAlign: 'center' }}>
          <h1 style={{
            fontFamily: 'var(--font-cinzel)', fontSize: '1.4rem',
            color: 'var(--offwhite)', marginBottom: '0.8rem',
          }}>{blocked === 'feature' ? 'Kitchen Display is switched off' : 'You do not have pass access'}</h1>
          <p style={{ fontSize: '0.88rem', color: 'rgba(245,242,236,0.4)', lineHeight: 1.7 }}>
            {blocked === 'feature'
              ? 'A superadmin can switch it on under Settings → Features. It needs Point of Sale on as well.'
              : 'Ask a manager to grant you the Kitchen Display section under Staff Accounts.'}
          </p>
        </div>
      </main>
    )
  }
  if (checking) return null

  if (!station) {
    return (
      <main style={{
        minHeight: '100vh', backgroundColor: 'var(--black)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '2rem', fontFamily: 'var(--font-inter)',
      }}>
        <div style={{ textAlign: 'center', maxWidth: '32ch' }}>
          <h1 style={{
            fontFamily: 'var(--font-cinzel)', fontSize: '1.5rem',
            color: 'var(--offwhite)', marginBottom: '0.6rem',
          }}>Which pass is this screen?</h1>
          <p style={{
            fontSize: '0.82rem', color: 'rgba(245,242,236,0.4)',
            lineHeight: 1.7, marginBottom: '1.5rem',
          }}>Remembered on this device.</p>
          <div style={{ display: 'grid', gap: '0.6rem' }}>
            {STATIONS.map(s => (
              <button key={s} onClick={() => choose(s)} style={{
                minHeight: '60px', borderRadius: '5px', cursor: 'pointer',
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.14)', color: 'var(--offwhite)',
                fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem',
              }}>{s}</button>
            ))}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main style={{
      minHeight: '100vh', backgroundColor: 'var(--black)',
      padding: isMobile ? '1rem 0.8rem 2rem' : '1.5rem 1.5rem 3rem',
      fontFamily: 'var(--font-inter)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: '1.1rem', flexWrap: 'wrap', gap: '0.5rem',
      }}>
        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.5rem' : '1.9rem',
          color: 'var(--offwhite)',
        }}>{station}</h1>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'rgba(245,242,236,0.4)' }}>
            {tickets.length} on the pass
          </span>
          <button onClick={() => { setStation(null); try { localStorage.removeItem(STORAGE_KEY) } catch {} }}
            style={{
              background: 'none', border: 'none', padding: '0.3rem 0', cursor: 'pointer',
              color: 'rgba(245,242,236,0.3)', fontSize: '0.68rem',
              letterSpacing: '0.12em', textTransform: 'uppercase',
              fontFamily: 'var(--font-inter)',
            }}>Change</button>
        </div>
      </div>

      {(liveError || error) && (
        <p style={{
          color: '#C9962C', fontSize: '0.85rem', marginBottom: '1rem', lineHeight: 1.6,
          background: 'rgba(201,150,44,0.08)', border: '1px solid rgba(201,150,44,0.25)',
          borderRadius: '3px', padding: '0.8rem 1rem',
        }}>{error || liveError}</p>
      )}

      {tickets.length === 0 ? (
        <p style={{
          color: 'rgba(245,242,236,0.25)', fontSize: '1.1rem',
          textAlign: 'center', padding: '4rem 0',
        }}>Nothing on the pass.</p>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? '260px' : '300px'}, 1fr))`,
          gap: '0.8rem', alignItems: 'start',
        }}>
          {tickets.map(t => (
            <TicketCard
              key={t.id}
              ticket={t}
              now={now}
              busy={busy === t.id}
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
