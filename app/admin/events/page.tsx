'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  collection, getDocs, addDoc, deleteDoc,
  doc, updateDoc, serverTimestamp
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useRequireRole, SECTION_ACCESS } from '../../lib/adminAuth'
import { logActivity, logCreate, logUpdate, logDelete } from '../../lib/activityLog'
import { recordMediaUpload, uploadImage } from '../../lib/media'
import MediaPickerModal from '../../components/admin/MediaPickerModal'

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

interface EventType {
  id: string
  name: string
}

const EMPTY = {
  title: '',
  type: '',
  branch: 'Beirut',
  date: '',
  timeStart: '',
  timeEnd: '',
  description: '',
  price: 0,
  minPlayers: 2,
  maxPlayers: 6,
  registrationLink: '',
  image: '',
  contactNumber: '+96181950042',
}

const BRANCHES = ['Beirut', 'Zouk', 'Broummana', 'All Branches']

const BRANCH_NUMBERS = [
  { label: 'Hamra',     number: '+96181950042' },
  { label: 'Zouk',      number: '+96170973242' },
  { label: 'Broummana', number: '+96176648054' },
]

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

export default function AdminEventsPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.events)
  const isMobile = useIsMobile()
  const [events, setEvents]                   = useState<GameEvent[]>([])
  const [eventTypes, setEventTypes]           = useState<EventType[]>([])
  const [loading, setLoading]                 = useState(true)
  const [open, setOpen]                       = useState(false)
  const [editing, setEditing]                 = useState<GameEvent | null>(null)
  const [form, setForm]                       = useState({ ...EMPTY })
  const [saving, setSaving]                   = useState(false)
  const [uploading, setUploading]             = useState(false)
  const [newType, setNewType]                 = useState('')
  const [addingType, setAddingType]           = useState(false)
  const [showTypeManager, setShowTypeManager] = useState(false)
  const [showPicker, setShowPicker]           = useState(false)
  const [filterBranch, setFilterBranch]       = useState<string>('all')
  const [filterStatus, setFilterStatus]       = useState<'upcoming' | 'done'>('upcoming')

  const filteredEvents = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    return events
      .filter(ev => filterBranch === 'all' || ev.branch === filterBranch)
      .filter(ev => filterStatus === 'upcoming' ? ev.date >= today : ev.date < today)
      .sort((a, b) => filterStatus === 'upcoming'
        ? new Date(a.date).getTime() - new Date(b.date).getTime()
        : new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [events, filterBranch, filterStatus])

  async function loadData() {
    const [evSnap, typeSnap] = await Promise.all([
      getDocs(collection(db, 'events')),
      getDocs(collection(db, 'eventTypes')),
    ])
    const evs = evSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as GameEvent))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    const types = typeSnap.docs.map(d => ({ id: d.id, ...d.data() } as EventType))
    setEvents(evs)
    setEventTypes(types)
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function addEventType() {
    if (!newType.trim()) return
    setAddingType(true)
    await addDoc(collection(db, 'eventTypes'), {
      name: newType.trim(),
      createdAt: serverTimestamp(),
    })
    await logActivity('create', 'Event Type', newType.trim())
    setNewType('')
    setAddingType(false)
    loadData()
  }

  async function deleteEventType(id: string) {
    if (!confirm('Delete this event type?')) return
    const name = eventTypes.find(t => t.id === id)?.name ?? id
    await deleteDoc(doc(db, 'eventTypes', id))
    await logActivity('delete', 'Event Type', name)
    loadData()
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { url, deleteUrl, fileName } = await uploadImage(file)
      setForm(f => ({ ...f, image: url }))
      await recordMediaUpload({ url, deleteUrl, fileName })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed.')
      e.target.value = ''
    } finally {
      setUploading(false)
    }
  }

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY, type: eventTypes[0]?.name ?? '' })
    setOpen(true)
  }

  function openEdit(ev: GameEvent) {
    setEditing(ev)
    setForm({
      title:            ev.title,
      type:             ev.type,
      branch:           ev.branch,
      date:             ev.date,
      timeStart:        ev.timeStart,
      timeEnd:          ev.timeEnd,
      description:      ev.description,
      price:            ev.price,
      minPlayers:       ev.minPlayers,
      maxPlayers:       ev.maxPlayers,
      registrationLink: ev.registrationLink ?? '',
      image:            ev.image ?? '',
      contactNumber:    ev.contactNumber ?? '+96181950042',
    })
    setOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    if (editing) {
      await updateDoc(doc(db, 'events', editing.id), {
        ...form,
        updatedAt: serverTimestamp(),
      })
      await logUpdate('Event', form.title, editing, form)
    } else {
      await addDoc(collection(db, 'events'), {
        ...form,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      await logCreate('Event', form.title, form)
    }
    setSaving(false)
    setOpen(false)
    loadData()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this event?')) return
    const ev = events.find(e => e.id === id)
    await deleteDoc(doc(db, 'events', id))
    await logDelete('Event', ev?.title ?? id, ev)
    loadData()
  }

  const inputStyle = {
    width: '100%',
    backgroundColor: '#1a1a1a',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#F5F2EC',
    padding: '0.75rem 1rem',
    borderRadius: '2px',
    fontSize: '0.85rem',
    outline: 'none',
    fontFamily: 'var(--font-inter)',
  }

  const labelStyle = {
    display: 'block',
    fontSize: '0.68rem',
    letterSpacing: '0.2em',
    textTransform: 'uppercase' as const,
    color: 'rgba(245,242,236,0.35)',
    marginBottom: '0.5rem',
    fontFamily: 'var(--font-inter)',
  }

  if (checking) return null

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'flex-start' : 'center',
          gap: isMobile ? '1.25rem' : '0',
          marginBottom: '2rem',
        }}>
          <div>
            <a href="/admin" style={{
              fontSize: '0.7rem',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.3)',
              textDecoration: 'none',
              fontFamily: 'var(--font-inter)',
              marginBottom: '0.5rem',
              display: 'block',
            }}>← Back to Dashboard</a>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)' }}>
              Events Manager
            </h1>
          </div>
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
            <button onClick={() => setShowTypeManager(!showTypeManager)} style={{
              backgroundColor: 'transparent',
              color: 'rgba(245,242,236,0.5)',
              padding: '0.7rem 1.5rem',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '2px',
              fontSize: '0.75rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
            }}>Manage Types</button>
            <button onClick={openNew} style={{
              backgroundColor: 'var(--red)',
              color: '#fff',
              padding: '0.7rem 1.5rem',
              border: 'none',
              borderRadius: '2px',
              fontSize: '0.75rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
            }}>+ Add Event</button>
          </div>
        </div>

        {/* Type Manager Panel */}
        {showTypeManager && (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '4px',
            padding: '1.5rem',
            marginBottom: '2rem',
          }}>
            <p style={{ ...labelStyle, marginBottom: '1rem' }}>Event Types</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
              {eventTypes.map(t => (
                <div key={t.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  backgroundColor: 'rgba(228,51,41,0.1)',
                  border: '1px solid rgba(228,51,41,0.2)',
                  borderRadius: '2px',
                  padding: '0.35rem 0.8rem',
                }}>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--offwhite)' }}>
                    {t.name}
                  </span>
                  <button onClick={() => deleteEventType(t.id)} style={{
                    background: 'transparent', border: 'none',
                    color: 'rgba(228,51,41,0.6)', cursor: 'pointer',
                    fontSize: '0.75rem', padding: '0', lineHeight: 1,
                  }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', maxWidth: '400px' }}>
              <input
                type="text"
                placeholder="New type name…"
                value={newType}
                onChange={e => setNewType(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addEventType()}
                style={{
                  flex: 1,
                  backgroundColor: '#1a1a1a',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#F5F2EC',
                  padding: '0.6rem 0.8rem',
                  borderRadius: '2px',
                  fontSize: '0.82rem',
                  outline: 'none',
                  fontFamily: 'var(--font-inter)',
                }}
              />
              <button onClick={addEventType} disabled={addingType} style={{
                backgroundColor: 'var(--red)', border: 'none',
                color: '#fff', padding: '0.6rem 1rem',
                borderRadius: '2px', fontSize: '0.82rem',
                cursor: 'pointer', fontFamily: 'var(--font-inter)',
              }}>+ Add</button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={{ marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Upcoming / Done tabs */}
          <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0' }}>
            {(['upcoming', 'done'] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: filterStatus === s ? '2px solid var(--red)' : '2px solid transparent',
                  color: filterStatus === s ? 'var(--offwhite)' : 'rgba(245,242,236,0.35)',
                  padding: '0.6rem 1.2rem',
                  marginBottom: '-1px',
                  fontSize: '0.75rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-inter)',
                  transition: 'color 0.15s',
                }}
              >
                {s === 'upcoming' ? 'Upcoming' : 'Done'}
              </button>
            ))}
          </div>

          {/* Branch pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {[['all', 'All'], ['Beirut', 'Beirut'], ['Zouk', 'Zouk'], ['Broummana', 'Broummana'], ['All Branches', 'All Branches']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFilterBranch(val)}
                style={{
                  background: filterBranch === val ? 'rgba(0,160,152,0.15)' : 'transparent',
                  border: `1px solid ${filterBranch === val ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`,
                  color: filterBranch === val ? 'var(--teal)' : 'rgba(245,242,236,0.4)',
                  padding: '0.35rem 0.9rem',
                  borderRadius: '2px',
                  fontSize: '0.72rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-inter)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Events Grid */}
        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : filteredEvents.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)',
            borderRadius: '4px',
            padding: '4rem',
            textAlign: 'center',
            color: 'rgba(245,242,236,0.2)',
            fontFamily: 'var(--font-inter)',
          }}>
            {events.length === 0
              ? 'No events yet — click + Add Event to get started'
              : `No ${filterStatus} events${filterBranch !== 'all' ? ` for ${filterBranch}` : ''}`}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: '1.5rem',
          }}>
            {filteredEvents.map(ev => {
              const d = new Date(ev.date)
              return (
                <div key={ev.id} style={{
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}>
                  {ev.image ? (
                    <div style={{
                      height: '140px',
                      backgroundImage: `url(${ev.image})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }} />
                  ) : (
                    <div style={{
                      height: '140px',
                      backgroundColor: 'rgba(255,255,255,0.02)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'rgba(255,255,255,0.1)',
                      fontSize: '0.75rem',
                      fontFamily: 'var(--font-inter)',
                    }}>No image</div>
                  )}

                  <div style={{ padding: '1.5rem' }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '0.8rem',
                    }}>
                      <div>
                        <p style={{
                          fontFamily: 'var(--font-cinzel)',
                          fontSize: '1.8rem',
                          color: 'var(--offwhite)',
                          lineHeight: 1,
                        }}>{d.getDate()}</p>
                        <p style={{
                          fontFamily: 'var(--font-inter)',
                          fontSize: '0.7rem',
                          color: 'rgba(245,242,236,0.4)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                        }}>
                          {d.toLocaleString('en', { month: 'long', year: 'numeric' })}
                        </p>
                      </div>
                      <span style={{
                        fontSize: '0.65rem',
                        padding: '0.25rem 0.7rem',
                        borderRadius: '2px',
                        backgroundColor: 'rgba(228,51,41,0.15)',
                        color: 'var(--red)',
                        fontFamily: 'var(--font-inter)',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}>{ev.type}</span>
                    </div>

                    <h3 style={{
                      fontFamily: 'var(--font-cinzel)',
                      fontSize: '1rem',
                      color: 'var(--offwhite)',
                      marginBottom: '0.5rem',
                    }}>{ev.title}</h3>

                    <div style={{
                      display: 'flex',
                      gap: '0.8rem',
                      fontSize: '0.72rem',
                      color: 'rgba(245,242,236,0.4)',
                      fontFamily: 'var(--font-inter)',
                      marginBottom: '0.4rem',
                      flexWrap: 'wrap',
                    }}>
                      <span style={{ color: 'var(--teal)' }}>{ev.branch}</span>
                      <span>{ev.timeStart} – {ev.timeEnd}</span>
                      <span>{ev.price === 0 ? 'Free' : `$${ev.price}/person`}</span>
                    </div>

                    <div style={{
                      fontSize: '0.72rem',
                      color: 'rgba(245,242,236,0.4)',
                      fontFamily: 'var(--font-inter)',
                      marginBottom: '0.5rem',
                    }}>👥 {ev.minPlayers}–{ev.maxPlayers} players</div>

                    {ev.contactNumber && (
                      <div style={{
                        fontSize: '0.7rem',
                        color: 'var(--teal)',
                        fontFamily: 'var(--font-inter)',
                        marginBottom: '1rem',
                      }}>📞 {ev.contactNumber}</div>
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => openEdit(ev)} style={{
                        flex: 1,
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'rgba(245,242,236,0.5)',
                        padding: '0.5rem',
                        borderRadius: '2px',
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-inter)',
                      }}>Edit</button>
                      <button onClick={() => handleDelete(ev.id)} style={{
                        flex: 1,
                        background: 'transparent',
                        border: '1px solid rgba(228,51,41,0.3)',
                        color: 'var(--red)',
                        padding: '0.5rem',
                        borderRadius: '2px',
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-inter)',
                      }}>Delete</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Full Screen Modal */}
      {open && (
        <div style={{
          position: 'fixed', inset: 0,
          backgroundColor: '#0d0d0d',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Modal Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: isMobile ? '1.25rem 1.5rem' : '1.5rem 3rem',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}>
            <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.1rem' : '1.5rem', color: 'var(--offwhite)' }}>
              {editing ? 'Edit Event' : 'Add New Event'}
            </h2>
            <button onClick={() => setOpen(false)} style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(245,242,236,0.5)',
              padding: '0.5rem 1.2rem',
              borderRadius: '2px',
              fontSize: '0.75rem',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}>✕ Close</button>
          </div>

          {/* Modal Body */}
          <form onSubmit={handleSave} style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: '0',
            overflow: isMobile ? 'auto' : 'hidden',
          }}>

            {/* Left Column */}
            <div style={{
              padding: isMobile ? '1.5rem' : '2.5rem 3rem',
              borderRight: isMobile ? 'none' : '1px solid rgba(255,255,255,0.06)',
              borderBottom: isMobile ? '1px solid rgba(255,255,255,0.06)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
              overflowY: isMobile ? 'visible' : 'auto',
            }}>
              <p style={{
                fontSize: '0.68rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--red)',
                fontFamily: 'var(--font-inter)',
              }}>Event Details</p>

              <div>
                <label style={labelStyle}>Title</label>
                <input type="text" value={form.title} required
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  style={inputStyle} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Type</label>
                  <select value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    style={{ ...inputStyle, color: '#F5F2EC', backgroundColor: '#1a1a1a' }}>
                    {eventTypes.map(t => (
                      <option key={t.id} value={t.name}
                        style={{ backgroundColor: '#1a1a1a', color: '#F5F2EC' }}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Branch</label>
                  <select value={form.branch}
                    onChange={e => setForm(f => ({ ...f, branch: e.target.value }))}
                    style={{ ...inputStyle, color: '#F5F2EC', backgroundColor: '#1a1a1a' }}>
                    {BRANCHES.map(b => (
                      <option key={b} value={b}
                        style={{ backgroundColor: '#1a1a1a', color: '#F5F2EC' }}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Date</label>
                <input type="date" value={form.date} required
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  style={{ ...inputStyle, colorScheme: 'dark' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Time Start</label>
                  <input type="time" value={form.timeStart} required
                    onChange={e => setForm(f => ({ ...f, timeStart: e.target.value }))}
                    style={{ ...inputStyle, colorScheme: 'dark' }} />
                </div>
                <div>
                  <label style={labelStyle}>Time End</label>
                  <input type="time" value={form.timeEnd} required
                    onChange={e => setForm(f => ({ ...f, timeEnd: e.target.value }))}
                    style={{ ...inputStyle, colorScheme: 'dark' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Min Players</label>
                  <input type="number" min={1} value={form.minPlayers} required
                    onChange={e => setForm(f => ({ ...f, minPlayers: +e.target.value }))}
                    style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Max Players</label>
                  <input type="number" min={1} value={form.maxPlayers} required
                    onChange={e => setForm(f => ({ ...f, maxPlayers: +e.target.value }))}
                    style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Price ($)</label>
                  <input type="number" min={0} value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: +e.target.value }))}
                    style={inputStyle} />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Description</label>
                <textarea value={form.description} rows={4} required
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  style={{ ...inputStyle, resize: 'none' }} />
              </div>

              <div>
                <label style={labelStyle}>Registration Link (optional)</label>
                <input type="url" value={form.registrationLink}
                  placeholder="https://..."
                  onChange={e => setForm(f => ({ ...f, registrationLink: e.target.value }))}
                  style={inputStyle} />
              </div>
            </div>

            {/* Right Column */}
            <div style={{
              padding: isMobile ? '1.5rem' : '2.5rem 3rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
              overflowY: isMobile ? 'visible' : 'auto',
            }}>
              <p style={{
                fontSize: '0.68rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--red)',
                fontFamily: 'var(--font-inter)',
              }}>Image & Contact</p>

              {/* Image Upload */}
              <div>
                <label style={labelStyle}>Upload Image</label>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <input type="file" accept="image/*" onChange={handleImageUpload}
                    style={{ ...inputStyle, cursor: 'pointer', flex: 1 }} />
                  <button type="button" onClick={() => setShowPicker(true)} style={{
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(245,242,236,0.6)',
                    padding: '0.6rem 1rem',
                    borderRadius: '2px',
                    fontSize: '0.72rem',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-inter)',
                    whiteSpace: 'nowrap',
                  }}>Choose from Media</button>
                </div>
                {uploading && (
                  <p style={{
                    marginTop: '0.5rem',
                    fontSize: '0.75rem',
                    color: 'var(--teal)',
                    fontFamily: 'var(--font-inter)',
                  }}>Uploading…</p>
                )}
              </div>

              {/* Image Preview */}
              {form.image && !uploading ? (
                <div style={{
                  borderRadius: '4px',
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.06)',
                  height: '200px',
                }}>
                  <img src={form.image} alt="Preview" style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }} />
                </div>
              ) : (
                <div style={{
                  height: '200px',
                  border: '1px dashed rgba(255,255,255,0.1)',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(245,242,236,0.2)',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.82rem',
                }}>Image preview will appear here</div>
              )}

              {/* Contact Number */}
              <div>
                <label style={labelStyle}>WhatsApp Contact Number</label>

                {/* Quick select branch numbers */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  marginBottom: '0.8rem',
                }}>
                  {BRANCH_NUMBERS.map(({ label, number }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, contactNumber: number }))}
                      style={{
                        backgroundColor: form.contactNumber === number
                          ? 'rgba(0,160,152,0.15)'
                          : 'transparent',
                        border: `1px solid ${form.contactNumber === number
                          ? 'var(--teal)'
                          : 'rgba(255,255,255,0.1)'}`,
                        color: form.contactNumber === number
                          ? 'var(--teal)'
                          : 'rgba(245,242,236,0.5)',
                        padding: '0.6rem 1rem',
                        borderRadius: '2px',
                        fontSize: '0.78rem',
                        letterSpacing: '0.05em',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-inter)',
                        textAlign: 'left',
                        transition: 'all 0.2s',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{label}</span>
                      <span style={{ opacity: 0.7 }}>{number}</span>
                    </button>
                  ))}
                </div>

                {/* Custom number input */}
                <label style={{ ...labelStyle, marginBottom: '0.4rem' }}>
                  Or enter a custom number
                </label>
                <input
                  type="tel"
                  placeholder="+9611234567"
                  value={form.contactNumber}
                  onChange={e => setForm(f => ({ ...f, contactNumber: e.target.value }))}
                  style={inputStyle}
                />

                {/* Preview link */}
                {form.contactNumber && (
                  <p style={{
                    marginTop: '0.5rem',
                    fontSize: '0.72rem',
                    color: 'var(--teal)',
                    fontFamily: 'var(--font-inter)',
                  }}>
                    ✓ WhatsApp: wa.me/{form.contactNumber.replace(/\+/g, '')}
                  </p>
                )}
              </div>

              {/* Preview Card */}
              <div style={{
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '4px',
                padding: '1.2rem',
                background: 'rgba(255,255,255,0.02)',
              }}>
                <p style={{ ...labelStyle, marginBottom: '0.8rem' }}>Preview</p>
                <p style={{
                  fontFamily: 'var(--font-cinzel)',
                  fontSize: '1rem',
                  color: 'var(--offwhite)',
                  marginBottom: '0.4rem',
                }}>{form.title || 'Event Title'}</p>
                <div style={{
                  display: 'flex',
                  gap: '0.8rem',
                  fontSize: '0.72rem',
                  color: 'rgba(245,242,236,0.4)',
                  fontFamily: 'var(--font-inter)',
                  flexWrap: 'wrap',
                }}>
                  <span style={{ color: 'var(--teal)' }}>{form.branch}</span>
                  <span>{form.date}</span>
                  <span>{form.timeStart} – {form.timeEnd}</span>
                  <span>{form.price === 0 ? 'Free' : `$${form.price}/person`}</span>
                  <span>👥 {form.minPlayers}–{form.maxPlayers}</span>
                </div>
              </div>

              {/* Save / Cancel */}
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" onClick={() => setOpen(false)} style={{
                  flex: 1,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(245,242,236,0.5)',
                  padding: '0.9rem',
                  borderRadius: '2px',
                  fontSize: '0.75rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-inter)',
                }}>Cancel</button>
                <button type="submit" disabled={saving || uploading} style={{
                  flex: 1,
                  backgroundColor: 'var(--red)',
                  border: 'none',
                  color: '#fff',
                  padding: '0.9rem',
                  borderRadius: '2px',
                  fontSize: '0.75rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  cursor: saving || uploading ? 'not-allowed' : 'pointer',
                  opacity: saving || uploading ? 0.6 : 1,
                  fontFamily: 'var(--font-inter)',
                }}>{saving ? 'Saving…' : 'Save Event'}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      <MediaPickerModal
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={url => setForm(f => ({ ...f, image: url }))}
      />
    </div>
  )
}