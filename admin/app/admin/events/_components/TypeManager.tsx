'use client'

import { labelStyle, type EventType } from './eventModel'

export default function TypeManager({
  eventTypes,
  newType,
  setNewType,
  addingType,
  addEventType,
  deleteEventType,
}: {
  eventTypes: EventType[]
  newType: string
  setNewType: (value: string) => void
  addingType: boolean
  addEventType: () => void
  deleteEventType: (id: string) => void
}) {
  return (
    <div style={{
      background: 'rgba(var(--overlay-rgb),0.02)',
      border: '1px solid rgba(var(--overlay-rgb),0.08)',
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
            backgroundColor: 'rgba(var(--red-rgb),0.1)',
            border: '1px solid rgba(var(--red-rgb),0.2)',
            borderRadius: '2px',
            padding: '0.35rem 0.8rem',
          }}>
            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--offwhite)' }}>
              {t.name}
            </span>
            <button onClick={() => deleteEventType(t.id)} style={{
              background: 'transparent', border: 'none',
              color: 'rgba(var(--red-rgb),0.6)', cursor: 'pointer',
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
            border: '1px solid rgba(var(--overlay-rgb),0.1)',
            color: 'var(--offwhite)',
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
  )
}
