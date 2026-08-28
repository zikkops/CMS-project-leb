'use client'

import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import Navbar from '../components/layout/Navbar'
import Footer from '../components/layout/Footer'
import Skeleton from '../components/Skeleton'
import EventReservationModal from '../components/events/EventReservationModal'

interface GameEvent {
  id: string
  title: string
  type: string
  branch: string
  date: string
  timeStart: string
  timeEnd: string
  description: string
  price: number
  minPlayers: number
  maxPlayers: number
  registrationLink?: string
  image?: string
  contactNumber?: string
}

function truncate(text: string, words: number) {
  const arr = text.split(' ')
  return arr.length > words ? arr.slice(0, words).join(' ') + '…' : text
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

// Top-level (not nested inside EventsPage) so its identity is stable across
// renders — a function declared inside another component's body is recreated
// every render, which makes React treat every <EventCard> as a brand-new
// component type and fully unmount+remount the DOM instead of updating
// styles. That remount was silently killing the CSS hover transition (a
// freshly mounted node has no "previous" state to animate from), which is
// why the lift/shadow/zoom looked chunky no matter how the transition itself
// was tuned.
function EventCard({ ev, dimmed = false, isMobile, hoveredEventId, onHover, onSelect }: {
  ev: GameEvent
  dimmed?: boolean
  isMobile: boolean
  hoveredEventId: string | null
  onHover: (id: string | null) => void
  onSelect: (ev: GameEvent) => void
}) {
  const d = new Date(ev.date)
  const hovered = !dimmed && hoveredEventId === ev.id
  return (
    <div
      onClick={() => onSelect(ev)}
      onMouseEnter={() => onHover(ev.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        // box-shadow lives on this outer, overflow-visible wrapper — a
        // child with `overflow: hidden` clips its own outer box-shadow,
        // which made the glow get cut off at the border instead of
        // rendering smoothly. Only transform/shadow animate here; the
        // border-radius clipping happens one level down.
        borderRadius: '4px',
        cursor: 'pointer',
        opacity: dimmed ? 0.6 : 1,
        transform: hovered ? 'translateY(-6px)' : 'translateY(0)',
        boxShadow: hovered ? '0 16px 28px rgba(0,0,0,0.35)' : '0 0px 0px rgba(0,0,0,0)',
        transition: 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
    <div style={{
      border: `1px solid ${hovered ? 'rgba(106,106,183,0.6)' : dimmed ? 'rgba(255,255,255,0.04)' : 'rgba(106,106,183,0.2)'}`,
      borderRadius: '4px',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      transition: 'border-color 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
    }}>
      {/* Image — landscape 16:9 on both mobile and desktop */}
      <div style={{
        position: 'relative',
        width: '100%',
        paddingTop: '56.25%',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        {ev.image ? (
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `url(${ev.image})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: dimmed ? 'grayscale(60%)' : 'none',
            transform: hovered ? 'scale(1.08)' : 'scale(1)',
            transition: 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
          }}>
            {dimmed && (
              <div style={{
                position: 'absolute',
                top: '0.8rem', right: '0.8rem',
                backgroundColor: 'rgba(0,0,0,0.7)',
                color: 'rgba(245,242,236,0.5)',
                padding: '0.25rem 0.7rem',
                borderRadius: '2px',
                fontSize: '0.65rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-inter)',
              }}>Completed</div>
            )}
          </div>
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            background: dimmed ? 'rgba(255,255,255,0.02)' : 'rgba(50,50,124,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{
              fontFamily: 'var(--font-cinzel)',
              fontSize: isMobile ? '1.8rem' : '3rem',
              color: dimmed ? 'rgba(255,255,255,0.08)' : 'rgba(106,106,183,0.4)',
            }}>{d.getDate()}</span>
            {dimmed && (
              <div style={{
                position: 'absolute',
                top: '0.8rem', right: '0.8rem',
                backgroundColor: 'rgba(0,0,0,0.7)',
                color: 'rgba(245,242,236,0.5)',
                padding: '0.25rem 0.7rem',
                borderRadius: '2px',
                fontSize: '0.65rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-inter)',
              }}>Completed</div>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: isMobile ? '1rem' : '1.5rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: isMobile ? '0.5rem' : '0.8rem',
        }}>
          <div>
            <p style={{
              fontFamily: 'var(--font-cinzel)',
              fontSize: isMobile ? '1.3rem' : '1.8rem',
              color: 'var(--offwhite)',
              lineHeight: 1,
            }}>{d.getDate()}</p>
            <p style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.62rem',
              color: 'rgba(245,242,236,0.35)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginTop: '0.2rem',
            }}>
              {d.toLocaleString('en', { month: 'long', year: 'numeric' })}
            </p>
          </div>
          <span style={{
            fontSize: isMobile ? '0.6rem' : '0.65rem',
            padding: isMobile ? '0.2rem 0.5rem' : '0.25rem 0.7rem',
            borderRadius: '2px',
            backgroundColor: dimmed ? 'rgba(255,255,255,0.05)' : 'rgba(106,106,183,0.15)',
            color: dimmed ? 'rgba(245,242,236,0.3)' : 'var(--purple)',
            fontFamily: 'var(--font-inter)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>{ev.type}</span>
        </div>

        <h3 style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: isMobile ? '0.88rem' : '1rem',
          color: 'var(--offwhite)',
          marginBottom: isMobile ? '0.35rem' : '0.5rem',
        }}>{ev.title}</h3>

        {!isMobile && (
          <p style={{
            fontFamily: 'var(--font-inter)',
            fontSize: '0.78rem',
            color: 'rgba(245,242,236,0.4)',
            lineHeight: 1.6,
            marginBottom: '0.8rem',
          }}>{truncate(ev.description, 10)}</p>
        )}

        <div style={{
          display: 'flex',
          gap: '0.6rem',
          fontSize: isMobile ? '0.66rem' : '0.72rem',
          color: 'rgba(245,242,236,0.4)',
          fontFamily: 'var(--font-inter)',
          marginBottom: '0.4rem',
          flexWrap: 'wrap',
        }}>
          <span style={{ color: 'var(--teal)' }}>{ev.branch}</span>
          <span>{ev.timeStart} – {ev.timeEnd}</span>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: isMobile ? '0.66rem' : '0.72rem',
          fontFamily: 'var(--font-inter)',
          color: 'rgba(245,242,236,0.4)',
          marginTop: 'auto',
          paddingTop: isMobile ? '0.6rem' : '0.8rem',
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}>
          <span>👥 {ev.minPlayers}–{ev.maxPlayers} players</span>
          <span style={{ color: dimmed ? 'rgba(245,242,236,0.3)' : 'var(--teal)' }}>
            {ev.price === 0 ? 'Free' : `$${ev.price}/person`}
          </span>
        </div>

        {!dimmed && (
          <button onClick={() => onSelect(ev)} style={{
            display: 'block',
            width: '100%',
            textAlign: 'center',
            background: 'transparent',
            border: `1px solid ${hovered ? 'var(--purple)' : 'rgba(106,106,183,0.3)'}`,
            color: hovered ? 'var(--purple)' : 'var(--offwhite)',
            padding: '0.6rem',
            borderRadius: '2px',
            fontSize: '0.72rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: 'var(--font-inter)',
            marginTop: '0.8rem',
            transition: 'border-color 0.45s cubic-bezier(0.16, 1, 0.3, 1), color 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
          }}>
            Learn More
          </button>
        )}
      </div>
    </div>
    </div>
  )
}

export default function EventsPage() {
  const [upcoming, setUpcoming]   = useState<GameEvent[]>([])
  const [completed, setCompleted] = useState<GameEvent[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('All')
  const [branches, setBranches]   = useState<string[]>([])
  const [selected, setSelected]   = useState<GameEvent | null>(null)
  const [reserving, setReserving] = useState<GameEvent | null>(null)
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null)
  const [hoveredFilter, setHoveredFilter] = useState<string | null>(null)
  const [closeHovered, setCloseHovered] = useState(false)
  const [reserveHovered, setReserveHovered] = useState(false)
  const [registerHovered, setRegisterHovered] = useState(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    async function load() {
      const snap = await getDocs(collection(db, 'events'))
      const all  = snap.docs.map(d => ({ id: d.id, ...d.data() } as GameEvent))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

      const now = new Date()
      now.setHours(0, 0, 0, 0)

      setUpcoming(all.filter(e => new Date(e.date) >= now))
      setCompleted(all.filter(e => new Date(e.date) < now).reverse())

      const uniqueBranches = [...new Set(all.map(e => e.branch))]
      setBranches(uniqueBranches)
      setLoading(false)
    }
    load()
  }, [])

  const filteredUpcoming  = filter === 'All' ? upcoming  : upcoming.filter(e => e.branch === filter)
  const filteredCompleted = filter === 'All' ? completed : completed.filter(e => e.branch === filter)

  return (
    <>
      <Navbar />
      <main>

        {/* Hero */}
        <section style={{
          position: 'relative',
          height: isMobile ? '32vh' : '40vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'url(https://images.unsplash.com/photo-1605870445919-838d190e8e1b?w=1200&q=80)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to top, rgba(10,10,10,1) 0%, rgba(50,50,124,0.3) 100%)',
          }} />
          <div style={{ position: 'relative', zIndex: 1, paddingTop: '4rem' }}>
            <p style={{
              fontSize: '0.7rem',
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              color: 'var(--purple)',
              marginBottom: '1rem',
              fontFamily: 'var(--font-inter)',
            }}>What's On</p>
            <h1 style={{
              fontFamily: 'var(--font-cinzel)',
              fontSize: isMobile ? '2.2rem' : '3.5rem',
              color: 'var(--offwhite)',
              lineHeight: 1.2,
            }}>Events & Tournaments</h1>
          </div>
        </section>

        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '3rem 1.25rem' : '5rem 3rem' }}>

          {/* Branch Filter */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '4rem' }}>
            {['All', ...branches].map(b => {
              const active = filter === b
              const hov = hoveredFilter === b
              return (
                <button key={b} onClick={() => setFilter(b)}
                  onMouseEnter={() => setHoveredFilter(b)}
                  onMouseLeave={() => setHoveredFilter(null)}
                  style={{
                    backgroundColor: active ? 'var(--purple)' : hov ? 'rgba(106,106,183,0.15)' : 'transparent',
                    border: `1px solid ${active || hov ? 'var(--purple)' : 'rgba(255,255,255,0.1)'}`,
                    color: active ? '#fff' : hov ? 'var(--offwhite)' : 'rgba(245,242,236,0.5)',
                    padding: '0.4rem 1.2rem',
                    borderRadius: '50px',
                    fontSize: '0.75rem',
                    letterSpacing: '0.08em',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-inter)',
                    transition: 'all 0.2s ease',
                  }}>{b}</button>
              )
            })}
          </div>

          {loading ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
              gap: isMobile ? '1.25rem' : '1.5rem',
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ border: '1px solid rgba(106,106,183,0.2)', borderRadius: '4px', overflow: 'hidden' }}>
                  <Skeleton height="160px" borderRadius="0" />
                  <div style={{ padding: '1.5rem' }}>
                    <Skeleton width="40%" height="1.8rem" style={{ marginBottom: '0.8rem' }} />
                    <Skeleton width="75%" height="1rem" style={{ marginBottom: '0.6rem' }} />
                    <Skeleton width="55%" height="0.8rem" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Upcoming */}
              <div style={{ marginBottom: '6rem' }}>
                <p style={{
                  fontSize: '0.7rem',
                  letterSpacing: '0.3em',
                  textTransform: 'uppercase',
                  color: 'var(--purple)',
                  marginBottom: '1rem',
                  fontFamily: 'var(--font-inter)',
                }}>Upcoming</p>
                <h2 style={{
                  fontFamily: 'var(--font-cinzel)',
                  fontSize: isMobile ? '1.5rem' : '2rem',
                  color: 'var(--offwhite)',
                  marginBottom: '1.5rem',
                }}>Don't Miss Out</h2>
                <div style={{
                  width: '60px', height: '2px',
                  backgroundColor: 'var(--purple)',
                  marginBottom: '2.5rem',
                }} />
                {filteredUpcoming.length === 0 ? (
                  <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>
                    No upcoming events. Check back soon!
                  </p>
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
                    gap: isMobile ? '1.25rem' : '1.5rem',
                  }}>
                    {filteredUpcoming.map(ev => (
                      <EventCard key={ev.id} ev={ev} isMobile={isMobile} hoveredEventId={hoveredEventId} onHover={setHoveredEventId} onSelect={setSelected} />
                    ))}
                  </div>
                )}
              </div>

              {/* Completed */}
              {filteredCompleted.length > 0 && (
                <div>
                  <p style={{
                    fontSize: '0.7rem',
                    letterSpacing: '0.3em',
                    textTransform: 'uppercase',
                    color: 'rgba(245,242,236,0.3)',
                    marginBottom: '1rem',
                    fontFamily: 'var(--font-inter)',
                  }}>Past Events</p>
                  <h2 style={{
                    fontFamily: 'var(--font-cinzel)',
                    fontSize: isMobile ? '1.5rem' : '2rem',
                    color: 'rgba(245,242,236,0.4)',
                    marginBottom: '1.5rem',
                  }}>Completed</h2>
                  <div style={{
                    width: '60px', height: '2px',
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    marginBottom: '2.5rem',
                  }} />
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
                    gap: isMobile ? '1.25rem' : '1.5rem',
                  }}>
                    {filteredCompleted.map(ev => (
                      <EventCard key={ev.id} ev={ev} dimmed isMobile={isMobile} hoveredEventId={hoveredEventId} onHover={setHoveredEventId} onSelect={setSelected} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />

      {/* Event Detail Popup */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(8px)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: isMobile ? '1rem' : '2rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: '#111',
              border: '1px solid rgba(106,106,183,0.3)',
              borderRadius: '8px',
              width: '100%',
              maxWidth: '1100px',
              maxHeight: '90vh',
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '1fr 1.2fr',
            }}
          >
            {/* Left — Image */}
            <div style={{
              position: 'relative',
              minHeight: isMobile ? '220px' : '550px',
              borderRadius: isMobile ? '8px 8px 0 0' : '8px 0 0 8px',
              overflow: 'hidden',
            }}>
              {selected.image ? (
                <div style={{
                  position: 'absolute', inset: 0,
                  backgroundImage: `url(${selected.image})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }} />
              ) : (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(50,50,124,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-cinzel)',
                    fontSize: '5rem',
                    color: 'rgba(106,106,183,0.3)',
                  }}>{new Date(selected.date).getDate()}</span>
                </div>
              )}

              {/* Date overlay */}
              <div style={{
                position: 'absolute',
                bottom: 0, left: 0, right: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)',
                padding: '2rem 1.5rem 1.5rem',
              }}>
                <p style={{
                  fontFamily: 'var(--font-cinzel)',
                  fontSize: '3rem',
                  color: '#fff',
                  lineHeight: 1,
                }}>{new Date(selected.date).getDate()}</p>
                <p style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.75rem',
                  color: 'rgba(255,255,255,0.6)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                }}>
                  {new Date(selected.date).toLocaleString('en', { month: 'long', year: 'numeric' })}
                </p>
              </div>
            </div>

            {/* Right — Info */}
            <div style={{ padding: isMobile ? '1.5rem' : '2.5rem' }}>

              {/* Close */}
              <button onClick={() => setSelected(null)}
                onMouseEnter={() => setCloseHovered(true)}
                onMouseLeave={() => setCloseHovered(false)}
                style={{
                  float: 'right',
                  background: 'transparent',
                  border: 'none',
                  color: closeHovered ? 'var(--offwhite)' : 'rgba(245,242,236,0.4)',
                  fontSize: '1.2rem',
                  cursor: 'pointer',
                  marginBottom: '1rem',
                  transform: closeHovered ? 'rotate(90deg)' : 'none',
                  transition: 'all 0.25s ease',
                }}>✕</button>

              {/* Type badge */}
              <span style={{
                display: 'block',
                width: 'fit-content',
                fontSize: '0.65rem',
                padding: '0.25rem 0.8rem',
                borderRadius: '2px',
                backgroundColor: 'rgba(106,106,183,0.15)',
                color: 'var(--purple)',
                fontFamily: 'var(--font-inter)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: '1rem',
                clear: 'both',
              }}>{selected.type}</span>

              <h2 style={{
                fontFamily: 'var(--font-cinzel)',
                fontSize: '1.8rem',
                color: 'var(--offwhite)',
                marginBottom: '1rem',
                lineHeight: 1.3,
              }}>{selected.title}</h2>

              <p style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '0.88rem',
                color: 'rgba(245,242,236,0.55)',
                lineHeight: 1.8,
                marginBottom: '1.5rem',
              }}>{selected.description}</p>

              {/* Details grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: '1rem',
                marginBottom: '1.5rem',
              }}>
                {[
                  { label: 'Branch',  value: selected.branch },
                  { label: 'Date',    value: new Date(selected.date).toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) },
                  { label: 'Time',    value: `${selected.timeStart} – ${selected.timeEnd}` },
                  { label: 'Players', value: `${selected.minPlayers}–${selected.maxPlayers} players` },
                  { label: 'Price',   value: selected.price === 0 ? 'Free entry' : `$${selected.price} per person` },
                  { label: 'Contact', value: selected.contactNumber ?? '+96181950042' },
                ].map(({ label, value }) => (
                  <div key={label} style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '4px',
                    padding: '0.8rem 1rem',
                  }}>
                    <p style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.62rem',
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      color: 'rgba(245,242,236,0.3)',
                      marginBottom: '0.3rem',
                    }}>{label}</p>
                    <p style={{
                      fontFamily: 'var(--font-cinzel)',
                      fontSize: '0.85rem',
                      color: 'var(--offwhite)',
                    }}>{value}</p>
                  </div>
                ))}
              </div>

              {/* CTAs */}
              {(() => {
                const isCompleted = new Date(selected.date) < new Date(new Date().setHours(0, 0, 0, 0))
                return isCompleted ? null : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <button
                  onClick={() => setReserving(selected)}
                  onMouseEnter={() => setReserveHovered(true)}
                  onMouseLeave={() => setReserveHovered(false)}
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
                    display: 'block',
                    width: '100%',
                    textAlign: 'center',
                    backgroundColor: reserveHovered ? 'rgba(106,106,183,0.15)' : 'var(--purple)',
                    color: '#fff',
                    border: '1px solid var(--purple)',
                    padding: '0.9rem',
                    borderRadius: '2px',
                    fontSize: '0.78rem',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    fontFamily: 'var(--font-inter)',
                    cursor: 'pointer',
                    backdropFilter: reserveHovered ? 'blur(10px)' : 'none',
                    transition: 'all 0.3s ease',
                  }}>
                  <span style={{
                    position: 'absolute',
                    top: 0,
                    left: reserveHovered ? '120%' : '-60%',
                    width: '40%',
                    height: '100%',
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
                    transform: 'skewX(-20deg)',
                    transition: 'left 0.5s ease',
                    pointerEvents: 'none',
                  }} />
                  Reserve a Spot
                </button>
                {selected.registrationLink && (
                  <a href={selected.registrationLink} target="_blank" rel="noopener noreferrer"
                    onMouseEnter={() => setRegisterHovered(true)}
                    onMouseLeave={() => setRegisterHovered(false)}
                    style={{
                      display: 'block',
                      textAlign: 'center',
                      backgroundColor: registerHovered ? 'rgba(255,255,255,0.06)' : 'transparent',
                      border: `1px solid ${registerHovered ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)'}`,
                      color: registerHovered ? 'var(--offwhite)' : 'rgba(245,242,236,0.7)',
                      padding: '0.9rem',
                      borderRadius: '2px',
                      fontSize: '0.78rem',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      textDecoration: 'none',
                      fontFamily: 'var(--font-inter)',
                      transition: 'all 0.2s ease',
                    }}>Register Externally</a>
                )}
              </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {reserving && (
        <EventReservationModal
          event={{
            id: reserving.id,
            title: reserving.title,
            date: reserving.date,
            timeStart: reserving.timeStart,
            timeEnd: reserving.timeEnd,
            branch: reserving.branch,
            minPlayers: reserving.minPlayers,
            maxPlayers: reserving.maxPlayers,
          }}
          onClose={() => setReserving(null)}
        />
      )}
    </>
  )
}