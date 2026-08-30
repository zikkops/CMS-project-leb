'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, query, where, orderBy, getDocs, Timestamp } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import type { TableReservation } from '@big-cms/shared/tableReservations'
import type { EventReservation } from '@big-cms/shared/eventReservations'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCalendarDay, faChessRook, faCalendarCheck } from '@fortawesome/free-solid-svg-icons'

type ScheduleEntry =
  | { type: 'table'; data: TableReservation; startMs: number }
  | { type: 'event'; data: EventReservation;  startMs: number }

function todayBounds() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return { start: Timestamp.fromDate(start), end: Timestamp.fromDate(end), dateStr, todayDate: start }
}

function fmtTime(ts: Timestamp): string {
  return ts.toDate().toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })
}

function fmtEventTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })
}

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

const TYPE_CONFIG = {
  table: { label: 'Table',     color: 'var(--navy)',   icon: faChessRook },
  event: { label: 'Event',     color: 'var(--teal)',   icon: faCalendarCheck },
}

export default function TodaySchedulePage() {
  const { checking, role, branchIds } = useRequireRole(SECTION_ACCESS.tableReservations)
  const isMobile = useIsMobile()

  const branchFilter = useMemo<'all' | string[]>(() => {
    if (!role) return []
    return role === 'admin' ? 'all' : branchIds
  }, [role, branchIds])

  const [entries, setEntries]   = useState<ScheduleEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [todayLabel, setTodayLabel] = useState('')

  useEffect(() => {
    const now = new Date()
    setTodayLabel(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
  }, [])

  useEffect(() => {
    if (checking || (Array.isArray(branchFilter) && branchFilter.length === 0 && role !== 'admin')) return
    const { start, end, dateStr, todayDate } = todayBounds()

    async function fetchAll() {
      setLoading(true)
      const results: ScheduleEntry[] = []

      // Table reservations — query by startAt range, filter status + branch client-side
      try {
        const snap = await getDocs(query(
          collection(db, 'tableReservations'),
          where('startAt', '>=', start),
          where('startAt', '<', end),
          orderBy('startAt', 'asc'),
        ))
        snap.docs.forEach(d => {
          const data = { id: d.id, ...d.data() } as TableReservation
          if (data.status !== 'approved') return
          if (branchFilter !== 'all' && !branchFilter.includes(data.branch)) return
          results.push({ type: 'table', data, startMs: data.startAt.toMillis() })
        })
      } catch (e) {
        console.error('[schedule] tableReservations fetch failed:', e)
      }

      // Event reservations — query by eventDate string, no Timestamp needed
      try {
        const snap = await getDocs(query(
          collection(db, 'eventReservations'),
          where('eventDate', '==', dateStr),
        ))
        snap.docs.forEach(d => {
          const data = { id: d.id, ...d.data() } as EventReservation
          if (data.status !== 'approved') return
          if (branchFilter !== 'all' && !branchFilter.includes(data.branch)) return
          const [h, m] = data.eventTimeStart.split(':').map(Number)
          const anchor = new Date(todayDate)
          anchor.setHours(h, m, 0, 0)
          results.push({ type: 'event', data, startMs: anchor.getTime() })
        })
      } catch (e) {
        console.error('[schedule] eventReservations fetch failed:', e)
      }

      results.sort((a, b) => a.startMs - b.startMs)
      setEntries(results)
      setLoading(false)
    }

    fetchAll()
  }, [checking, branchFilter, role])

  if (checking) return null

  const cardBase: React.CSSProperties = {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '4px',
    padding: isMobile ? '1.1rem' : '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '1rem',
    fontFamily: 'var(--font-inter)',
    fontSize: '0.82rem',
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin" style={{
            fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)', textDecoration: 'none', fontFamily: 'var(--font-inter)',
            marginBottom: '0.5rem', display: 'block',
          }}>← Back to Dashboard</a>
          <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)' }}>
            Today&apos;s Schedule
          </h1>
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.4rem' }}>
            {todayLabel}{!loading && ` · ${entries.length} reservation${entries.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : entries.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: isMobile ? '3rem 1.5rem' : '4rem', textAlign: 'center',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem',
          }}>
            <FontAwesomeIcon icon={faCalendarDay} style={{ width: '32px', color: 'rgba(245,242,236,0.15)' }} />
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.3)' }}>
              No approved reservations for today
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {entries.map((entry, i) => {
              const cfg = TYPE_CONFIG[entry.type]
              return (
                <div key={`${entry.type}-${i}`} style={{ ...cardBase, borderLeft: `3px solid ${cfg.color}` }}>

                  {/* Header row: type badge + branch */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: '0.45rem',
                      fontSize: '0.62rem', letterSpacing: '0.15em', textTransform: 'uppercase',
                      color: cfg.color, fontFamily: 'var(--font-inter)', fontWeight: 600,
                      background: `${cfg.color}18`, padding: '0.2rem 0.65rem', borderRadius: '2px',
                    }}>
                      <FontAwesomeIcon icon={cfg.icon} style={{ width: '11px' }} />
                      {cfg.label}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-inter)', fontSize: '0.72rem',
                      color: 'rgba(245,242,236,0.45)',
                    }}>
                      {entry.data.branch}
                    </span>
                  </div>

                  {/* Title + time */}
                  {entry.type === 'table' && (
                    <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.05rem', color: 'var(--offwhite)' }}>
                      Table{(entry.data as TableReservation).tableNumbers.length > 1 ? 's' : ''}{' '}
                      {(entry.data as TableReservation).tableNumbers.join(', ')}
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)', marginLeft: '0.75rem' }}>
                        {fmtTime((entry.data as TableReservation).startAt)} – {fmtTime((entry.data as TableReservation).endAt)}
                      </span>
                    </p>
                  )}
                  {entry.type === 'event' && (
                    <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.05rem', color: 'var(--offwhite)' }}>
                      {(entry.data as EventReservation).eventTitle}
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.4)', marginLeft: '0.75rem' }}>
                        {fmtEventTime((entry.data as EventReservation).eventTimeStart)}
                        {(entry.data as EventReservation).eventTimeEnd
                          ? ` – ${fmtEventTime((entry.data as EventReservation).eventTimeEnd!)}`
                          : ''}
                      </span>
                    </p>
                  )}

                  {/* Detail rows */}
                  {entry.type === 'table' && (
                    <>
                      <div style={rowStyle}>
                        <span style={{ color: 'rgba(245,242,236,0.4)' }}>Contact</span>
                        <span style={{ color: 'var(--offwhite)', textAlign: 'right' }}>
                          {(entry.data as TableReservation).contactName}
                          {(entry.data as TableReservation).contactPhone
                            ? ` · ${(entry.data as TableReservation).contactPhone}`
                            : ''}
                        </span>
                      </div>
                      <div style={rowStyle}>
                        <span style={{ color: 'rgba(245,242,236,0.4)' }}>Party size</span>
                        <span style={{ color: 'var(--offwhite)', textAlign: 'right' }}>
                          {(entry.data as TableReservation).partySize} {(entry.data as TableReservation).partySize === 1 ? 'person' : 'people'}
                        </span>
                      </div>
                      {(entry.data as TableReservation & { checkedIn?: boolean }).checkedIn && (
                        <div style={{ fontSize: '0.7rem', color: '#2ECC71', fontFamily: 'var(--font-inter)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                          ✓ Checked in
                        </div>
                      )}
                    </>
                  )}


                  {entry.type === 'event' && (
                    <>
                      <div style={rowStyle}>
                        <span style={{ color: 'rgba(245,242,236,0.4)' }}>Booked by</span>
                        <span style={{ color: 'var(--offwhite)', textAlign: 'right' }}>{(entry.data as EventReservation).userName}</span>
                      </div>
                      <div style={rowStyle}>
                        <span style={{ color: 'rgba(245,242,236,0.4)' }}>Party size</span>
                        <span style={{ color: 'var(--offwhite)', textAlign: 'right' }}>
                          {(entry.data as EventReservation).partySize} {(entry.data as EventReservation).partySize === 1 ? 'person' : 'people'}
                        </span>
                      </div>
                      {((entry.data as EventReservation).participants.length > 0 || (entry.data as EventReservation).participantPhones.length > 0) && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          {(entry.data as EventReservation).participants.map(p => (
                            <span key={p.uid} style={{
                              fontSize: '0.72rem', padding: '0.25rem 0.7rem', borderRadius: '2px',
                              backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--offwhite)', fontFamily: 'var(--font-inter)',
                            }}>{p.name}</span>
                          ))}
                          {(entry.data as EventReservation).participantPhones.map(phone => (
                            <span key={phone} style={{
                              fontSize: '0.72rem', padding: '0.25rem 0.7rem', borderRadius: '2px',
                              backgroundColor: 'rgba(255,255,255,0.05)', color: 'rgba(245,242,236,0.6)', fontFamily: 'var(--font-inter)',
                            }}>📞 {phone}</span>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
