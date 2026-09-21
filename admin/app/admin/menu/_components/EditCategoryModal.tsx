'use client'

import type { RefObject } from 'react'
import { SECTIONS, sectionColors, inputStyle, labelStyle, type Section } from './menuTypes'

// The Edit Category modal. The page owns the fields and the save; this only
// draws them.
export default function EditCategoryModal({
  isMobile, name, setName, section, setSection, image,
  saving, uploading, fileRef, onImageUpload, onPickMedia, onClose, onSubmit,
}: {
  isMobile: boolean
  name: string
  setName: (name: string) => void
  section: Section
  setSection: (section: Section) => void
  image: string
  saving: boolean
  uploading: boolean
  fileRef: RefObject<HTMLInputElement | null>
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onPickMedia: () => void
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      backgroundColor: 'rgba(0,0,0,0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 200,
      padding: isMobile ? '1rem' : '2rem',
    }}>
      <div style={{
        backgroundColor: '#111',
        border: '1px solid rgba(var(--overlay-rgb),0.1)',
        borderRadius: '8px',
        width: '100%',
        maxWidth: '480px',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: isMobile ? '1.25rem 1.5rem' : '1.5rem 2rem',
          borderBottom: '1px solid rgba(var(--overlay-rgb),0.06)',
        }}>
          <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem', color: 'var(--offwhite)' }}>
            Edit Category
          </h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none',
            color: 'rgba(var(--offwhite-rgb),0.4)', fontSize: '1.2rem', cursor: 'pointer',
          }}>✕</button>
        </div>

        <form onSubmit={onSubmit} style={{ padding: isMobile ? '1.5rem' : '2rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div>
            <label style={labelStyle}>Category Name</label>
            <input type="text" value={name} required
              onChange={e => setName(e.target.value)}
              style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Section</label>
            <select value={section}
              onChange={e => setSection(e.target.value as Section)}
              style={{ ...inputStyle, color: 'var(--offwhite)', backgroundColor: '#1a1a1a' }}>
              {SECTIONS.map(s => (
                <option key={s} value={s} style={{ backgroundColor: '#1a1a1a', color: 'var(--offwhite)' }}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Category Image</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={onImageUpload}
                style={{ ...inputStyle, padding: '0.5rem', fontSize: '0.78rem', cursor: 'pointer', flex: 1 }}
              />
              <button type="button" onClick={onPickMedia} style={{
                background: 'transparent',
                border: '1px solid rgba(var(--overlay-rgb),0.1)',
                color: 'rgba(var(--offwhite-rgb),0.6)',
                padding: '0.5rem 0.8rem',
                borderRadius: '2px',
                fontSize: '0.68rem',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontFamily: 'var(--font-inter)',
                whiteSpace: 'nowrap',
              }}>Media</button>
            </div>
            {uploading && (
              <p style={{ fontSize: '0.72rem', color: 'var(--teal)', fontFamily: 'var(--font-inter)', marginTop: '0.3rem' }}>
                Uploading…
              </p>
            )}
            {image && !uploading && (
              <img src={image} alt="preview" style={{
                width: '100%', height: '100px',
                objectFit: 'cover', borderRadius: '2px',
                marginTop: '0.5rem',
                border: '1px solid rgba(var(--overlay-rgb),0.06)',
              }} />
            )}
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, background: 'transparent',
              border: '1px solid rgba(var(--overlay-rgb),0.1)',
              color: 'rgba(var(--offwhite-rgb),0.5)', padding: '0.8rem',
              borderRadius: '2px', fontSize: '0.75rem',
              cursor: 'pointer', fontFamily: 'var(--font-inter)',
            }}>Cancel</button>
            <button type="submit" disabled={saving || uploading} style={{
              flex: 1, backgroundColor: sectionColors[section],
              border: 'none', color: '#fff', padding: '0.8rem',
              borderRadius: '2px', fontSize: '0.75rem',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving || uploading ? 0.6 : 1,
              fontFamily: 'var(--font-inter)',
            }}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
