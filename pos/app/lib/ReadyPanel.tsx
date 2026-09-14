'use client'

// "Ready to go out" — on the counter and the floor (owner's decision, 14 Sep 2026).
//
// The kitchen taps Ready on its display, and until now nothing outside the
// kitchen changed: somebody had to walk over and look. This pops the plate up
// on the counter and the floor with a chime, and the front taps Picked up when
// it goes out. That clears it from the kitchen display too, so the kitchen no
// longer bumps, and the ticket records who took it.
//
// What each card says, and in which order, is pos/app/lib/pickups.ts
// (verify:counter); the chime is useReadyAlerts.ts. Controls from posUi.tsx.
// Module-scope component (CONTRIBUTING.md gotcha #2).

import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBellConcierge, faVolumeHigh, faVolumeXmark, faHandHolding, faTriangleExclamation, faClock,
} from '@fortawesome/free-solid-svg-icons'
import { ticketSentAtMs } from '@big-cms/shared/tickets'
import { timestampMs } from '@big-cms/shared/timestamps'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { useReadyTickets, pickUpTicket } from './usePos'
import { useReadyAlerts } from './useReadyAlerts'
import { pickupCards, pickupUrgency } from './pickups'
import { PosButton, Chip, STATION_COLOUR } from './posUi'

/** The kitchen display's colour for Ready, so a plate reads the same on both screens. */
const READY = '#22C55E'
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`
const WAIT_COLOUR = { fresh: 'rgba(var(--offwhite-rgb),0.75)', aging: 'var(--brand-secondary)', late: 'var(--red)' } as const

function useNow(everyMs = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

export function ReadyPanel({ branch, isMobile }: { branch: string; isMobile: boolean }) {
  const { tickets, loading, error: liveError } = useReadyTickets(branch)
  const now = useNow()
  const alerts = useReadyAlerts(tickets.map(t => t.id), loading)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const cards = pickupCards(tickets.map(t => ({
    id: t.id,
    tableNumber: t.tableNumber,
    station: t.station,
    round: t.round,
    lines: t.lines,
    readyAtMs: timestampMs(t.readyAt, 0) || null,
    sentAtMs: ticketSentAtMs(t, now),
  })), now)

  async function pickUp(id: string) {
    setBusy(id)
    setError('')
    try {
      await pickUpTicket(id)
    } catch (err) {
      // "No answer" and "the answer was no" are different things to tell a
      // person — see netErrors.ts.
      setError(isNetworkFailure(err)
        ? 'No connection, so that was not recorded. Tap Picked up again when it is back.'
        : err instanceof Error ? err.message : 'Could not mark that as picked up.')
    } finally {
      setBusy(null)
    }
  }

  if (cards.length === 0 && !liveError && !error) return null

  return (
    <section aria-live="polite" style={{
      position: 'sticky', top: 0, zIndex: 30, marginBottom: '1.25rem',
      background: 'var(--black)', paddingTop: '0.4rem',
    }}>
      <div style={{ border: `2px solid ${READY}`, background: tint(READY, 10), borderRadius: '14px', padding: '0.8rem 0.9rem' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
          marginBottom: cards.length > 0 ? '0.7rem' : 0,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.55rem', fontFamily: 'var(--font-inter)',
            fontSize: '1.05rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: READY,
          }}>
            <FontAwesomeIcon icon={faBellConcierge} style={{ fontSize: '1.2rem' }} />
            Ready to go out{cards.length > 0 ? ` · ${cards.length}` : ''}
          </span>
          <Chip size="sm" colour={READY}
            icon={alerts.soundOn ? faVolumeHigh : faVolumeXmark}
            label={alerts.soundOn ? 'Sound on' : 'Sound off'}
            active={alerts.soundOn}
            onClick={() => alerts.setSoundOn(!alerts.soundOn)} />
        </div>

        {(error || liveError) && (
          <p style={{ color: 'var(--red)', fontSize: '0.95rem', marginBottom: '0.6rem', fontFamily: 'var(--font-inter)' }}>
            <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.45rem' }} />{error || liveError}
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? '220px' : '250px'}, 1fr))`, gap: '0.6rem' }}>
          {cards.map(c => {
            const level = pickupUrgency(c.waitingMinutes)
            const stationColour = STATION_COLOUR[c.station] ?? '#64748B'
            return (
              <div key={c.id} style={{
                background: 'rgba(0,0,0,0.35)', borderRadius: '12px', padding: '0.7rem 0.8rem',
                border: level === 'late' ? '3px solid var(--red)' : `1px solid ${tint(READY, 55)}`,
                display: 'flex', flexDirection: 'column', gap: '0.45rem', fontFamily: 'var(--font-inter)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.55rem', color: 'var(--offwhite)', lineHeight: 1 }}>
                    Table {c.tableNumber}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, fontSize: '0.95rem', color: WAIT_COLOUR[level] }}>
                    <FontAwesomeIcon icon={level === 'late' ? faTriangleExclamation : faClock} />{c.waitingMinutes}m
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{
                    padding: '0.15rem 0.55rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700,
                    color: 'var(--offwhite)', background: tint(stationColour, 25), border: `1px solid ${stationColour}`,
                  }}>{c.station}</span>
                  {c.round > 1 && <span style={{ fontSize: '0.8rem', color: 'rgba(var(--offwhite-rgb),0.6)' }}>round {c.round}</span>}
                </div>
                <p style={{ fontSize: '0.95rem', color: 'rgba(var(--offwhite-rgb),0.85)', lineHeight: 1.4 }}>{c.summary}</p>
                <PosButton icon={faHandHolding} label={busy === c.id ? 'Recording…' : 'Picked up'} tone="primary" full
                  disabled={busy === c.id} onClick={() => pickUp(c.id)} />
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
