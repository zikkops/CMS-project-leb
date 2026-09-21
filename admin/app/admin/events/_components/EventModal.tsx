'use client'

import type { Dispatch, SetStateAction } from 'react'
import { BRAND } from '@big-cms/shared/brand'
import {
  BRANCH_NUMBERS,
  BRANCH_OPTIONS,
  inputStyle,
  labelStyle,
  type EventForm,
  type EventType,
} from './eventModel'

export default function EventModal({
  isMobile,
  isEditing,
  form,
  setForm,
  eventTypes,
  saving,
  uploading,
  onClose,
  onSave,
  onImageUpload,
  onOpenPicker,
}: {
  isMobile: boolean
  isEditing: boolean
  form: EventForm
  setForm: Dispatch<SetStateAction<EventForm>>
  eventTypes: EventType[]
  saving: boolean
  uploading: boolean
  onClose: () => void
  onSave: (e: React.FormEvent) => void
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onOpenPicker: () => void
}) {
  return (
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
        borderBottom: '1px solid rgba(var(--overlay-rgb),0.06)',
        flexShrink: 0,
      }}>
        <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.1rem' : '1.5rem', color: 'var(--offwhite)' }}>
          {isEditing ? 'Edit Event' : 'Add New Event'}
        </h2>
        <button onClick={onClose} style={{
          background: 'transparent',
          border: '1px solid rgba(var(--overlay-rgb),0.1)',
          color: 'rgba(var(--offwhite-rgb),0.5)',
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
      <form onSubmit={onSave} style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: '0',
        overflow: isMobile ? 'auto' : 'hidden',
      }}>

        {/* Left Column */}
        <div style={{
          padding: isMobile ? '1.5rem' : '2.5rem 3rem',
          borderRight: isMobile ? 'none' : '1px solid rgba(var(--overlay-rgb),0.06)',
          borderBottom: isMobile ? '1px solid rgba(var(--overlay-rgb),0.06)' : 'none',
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
                style={{ ...inputStyle, color: 'var(--offwhite)', backgroundColor: '#1a1a1a' }}>
                {eventTypes.map(t => (
                  <option key={t.id} value={t.name}
                    style={{ backgroundColor: '#1a1a1a', color: 'var(--offwhite)' }}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Branch</label>
              <select value={form.branch}
                onChange={e => setForm(f => ({ ...f, branch: e.target.value }))}
                style={{ ...inputStyle, color: 'var(--offwhite)', backgroundColor: '#1a1a1a' }}>
                {BRANCH_OPTIONS.map(b => (
                  <option key={b} value={b}
                    style={{ backgroundColor: '#1a1a1a', color: 'var(--offwhite)' }}>
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
              <label style={labelStyle}>Min Participants</label>
              <input type="number" min={1} value={form.minPlayers} required
                onChange={e => setForm(f => ({ ...f, minPlayers: +e.target.value }))}
                style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Max Participants</label>
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
              <input type="file" accept="image/*" onChange={onImageUpload}
                style={{ ...inputStyle, cursor: 'pointer', flex: 1 }} />
              <button type="button" onClick={onOpenPicker} style={{
                background: 'transparent',
                border: '1px solid rgba(var(--overlay-rgb),0.1)',
                color: 'rgba(var(--offwhite-rgb),0.6)',
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
              border: '1px solid rgba(var(--overlay-rgb),0.06)',
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
              border: '1px dashed rgba(var(--overlay-rgb),0.1)',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(var(--offwhite-rgb),0.2)',
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
                      ? 'rgba(var(--teal-rgb),0.15)'
                      : 'transparent',
                    border: `1px solid ${form.contactNumber === number
                      ? 'var(--teal)'
                      : 'rgba(var(--overlay-rgb),0.1)'}`,
                    color: form.contactNumber === number
                      ? 'var(--teal)'
                      : 'rgba(var(--offwhite-rgb),0.5)',
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

            {/* Custom number input. The placeholder was a hardcoded
                +9611234567 — a Lebanese number, in a product meant to be
                sold to cafés anywhere. A placeholder is the example a user
                copies the shape of, so a wrong country code teaches the
                wrong format. */}
            <label style={{ ...labelStyle, marginBottom: '0.4rem' }}>
              Or enter a custom number
            </label>
            <input
              type="tel"
              placeholder={BRAND.contact.phone}
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
            border: '1px solid rgba(var(--overlay-rgb),0.06)',
            borderRadius: '4px',
            padding: '1.2rem',
            background: 'rgba(var(--overlay-rgb),0.02)',
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
              color: 'rgba(var(--offwhite-rgb),0.4)',
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
            <button type="button" onClick={onClose} style={{
              flex: 1,
              background: 'transparent',
              border: '1px solid rgba(var(--overlay-rgb),0.1)',
              color: 'rgba(var(--offwhite-rgb),0.5)',
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
  )
}
