'use client'

import { ymdToLocalDate } from '@big-cms/shared/dates'
import type { GameEvent } from './eventModel'

export default function EventCard({
  ev,
  onEdit,
  onDelete,
}: {
  ev: GameEvent
  onEdit: (ev: GameEvent) => void
  onDelete: (id: string) => void
}) {
  const d = ymdToLocalDate(ev.date)
  return (
    <div style={{
      border: '1px solid rgba(var(--overlay-rgb),0.06)',
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
          backgroundColor: 'rgba(var(--overlay-rgb),0.02)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(var(--overlay-rgb),0.1)',
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
              color: 'rgba(var(--offwhite-rgb),0.4)',
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
            backgroundColor: 'rgba(var(--red-rgb),0.15)',
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
          color: 'rgba(var(--offwhite-rgb),0.4)',
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
          color: 'rgba(var(--offwhite-rgb),0.4)',
          fontFamily: 'var(--font-inter)',
          marginBottom: '0.5rem',
        }}>👥 {ev.minPlayers}–{ev.maxPlayers} participants</div>

        {ev.contactNumber && (
          <div style={{
            fontSize: '0.7rem',
            color: 'var(--teal)',
            fontFamily: 'var(--font-inter)',
            marginBottom: '1rem',
          }}>📞 {ev.contactNumber}</div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => onEdit(ev)} style={{
            flex: 1,
            background: 'transparent',
            border: '1px solid rgba(var(--overlay-rgb),0.1)',
            color: 'rgba(var(--offwhite-rgb),0.5)',
            padding: '0.5rem',
            borderRadius: '2px',
            fontSize: '0.72rem',
            cursor: 'pointer',
            fontFamily: 'var(--font-inter)',
          }}>Edit</button>
          <button onClick={() => onDelete(ev.id)} style={{
            flex: 1,
            background: 'transparent',
            border: '1px solid rgba(var(--red-rgb),0.3)',
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
}
