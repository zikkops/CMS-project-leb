'use client'

import { useEffect, useState, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { recordMediaUpload, uploadImage } from '@big-cms/shared/media'
import MediaPickerModal from '../../components/admin/MediaPickerModal'
import { BRAND } from '@big-cms/shared/brand'
import { todayYmd } from '@big-cms/shared/dates'
import { startLoad } from '@big-cms/shared/startLoad'
import { EMPTY, type EventType, type GameEvent } from './_components/eventModel'
import TypeManager from './_components/TypeManager'
import EventFilters from './_components/EventFilters'
import EventCard from './_components/EventCard'
import EventModal from './_components/EventModal'

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
    // The café's today. toISOString() is the UTC date, which rolls over in the
    // evening west of Greenwich and moved tonight's event to "done" early.
    const today = todayYmd(BRAND.locale.timezone)
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

  useEffect(() => { startLoad(loadData) }, [])

  async function addEventType() {
    if (!newType.trim()) return
    setAddingType(true)
    await unwrap(await authedFetch('/api/admin/events', 'POST', { kind: 'type', name: newType.trim() }))
    setNewType('')
    setAddingType(false)
    loadData()
  }

  async function deleteEventType(id: string) {
    if (!confirm('Delete this event type?')) return
    // Refused while events are still filed under it. An event stores its type
    // as a NAME, so deleting one left events pointing at a label no longer in
    // the list — they drop out of the type filter rather than erroring.
    await unwrap(await authedFetch(`/api/admin/events?kind=type&id=${encodeURIComponent(id)}`, 'DELETE'))
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
      contactNumber:    ev.contactNumber ?? BRAND.contact.phone,
    })
    setOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    // `...form` went straight into Firestore before, so a price could be
    // negative and a maximum party size could sit below the minimum — which
    // makes an event unbookable, because the booking form rejects every party
    // size and explains nothing.
    if (editing) {
      await unwrap(await authedFetch('/api/admin/events', 'PATCH', { id: editing.id, ...form }))
    } else {
      await unwrap(await authedFetch('/api/admin/events', 'POST', { kind: 'event', ...form }))
    }
    setSaving(false)
    setOpen(false)
    loadData()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this event?')) return
    // Refused while anyone still holds a spot. Deleting an event with live
    // bookings leaves people holding a reservation for something that does not
    // exist, with nothing anywhere telling them.
    await unwrap(await authedFetch(`/api/admin/events?kind=event&id=${encodeURIComponent(id)}`, 'DELETE'))
    loadData()
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
              color: 'rgba(var(--offwhite-rgb),0.3)',
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
              color: 'rgba(var(--offwhite-rgb),0.5)',
              padding: '0.7rem 1.5rem',
              border: '1px solid rgba(var(--overlay-rgb),0.1)',
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
          <TypeManager
            eventTypes={eventTypes}
            newType={newType}
            setNewType={setNewType}
            addingType={addingType}
            addEventType={addEventType}
            deleteEventType={deleteEventType}
          />
        )}

        {/* Filters */}
        <EventFilters
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          filterBranch={filterBranch}
          setFilterBranch={setFilterBranch}
        />

        {/* Events Grid */}
        {loading ? (
          <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : filteredEvents.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(var(--overlay-rgb),0.08)',
            borderRadius: '4px',
            padding: '4rem',
            textAlign: 'center',
            color: 'rgba(var(--offwhite-rgb),0.2)',
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
            {filteredEvents.map(ev => (
              <EventCard key={ev.id} ev={ev} onEdit={openEdit} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Full Screen Modal */}
      {open && (
        <EventModal
          isMobile={isMobile}
          isEditing={!!editing}
          form={form}
          setForm={setForm}
          eventTypes={eventTypes}
          saving={saving}
          uploading={uploading}
          onClose={() => setOpen(false)}
          onSave={handleSave}
          onImageUpload={handleImageUpload}
          onOpenPicker={() => setShowPicker(true)}
        />
      )}

      <MediaPickerModal
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={url => setForm(f => ({ ...f, image: url }))}
      />
    </div>
  )
}