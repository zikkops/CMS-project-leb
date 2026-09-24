'use client'

import type { RefObject } from 'react'
import { SECTIONS, sectionColors, inputStyle, labelStyle, type Category, type Section } from './menuTypes'

// The left column of the Menu Manager: the active section's categories, and
// the form that adds one.
export default function CategoryPanel({
  activeSection, sectionCategories, activeCategory, onSelect, onEdit, onDelete,
  newCatName, setNewCatName, newCatSection, setNewCatSection, newCatImage,
  uploadingCat, addingCat, catFileRef, onImageUpload, onPickMedia, onAdd,
}: {
  activeSection: Section
  sectionCategories: Category[]
  activeCategory: string
  onSelect: (id: string) => void
  onEdit: (cat: Category) => void
  onDelete: (id: string) => void
  newCatName: string
  setNewCatName: (name: string) => void
  newCatSection: Section
  setNewCatSection: (section: Section) => void
  newCatImage: string
  uploadingCat: boolean
  addingCat: boolean
  catFileRef: RefObject<HTMLInputElement | null>
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onPickMedia: () => void
  onAdd: () => void
}) {
  return (
    <div>
      <p style={{ ...labelStyle, marginBottom: '1rem' }}>
        {activeSection} Categories
      </p>

      <div style={{
        background: 'rgba(var(--overlay-rgb),0.02)',
        border: '1px solid rgba(var(--overlay-rgb),0.06)',
        borderRadius: '4px',
        overflow: 'hidden',
        marginBottom: '1.5rem',
      }}>
        {sectionCategories.length === 0 ? (
          <p style={{
            padding: '1.5rem',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.82rem',
            color: 'rgba(var(--offwhite-rgb),0.2)',
          }}>No categories yet</p>
        ) : sectionCategories.map(cat => (
          <div key={cat.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.8rem',
            padding: '0.8rem 1rem',
            borderBottom: '1px solid rgba(var(--overlay-rgb),0.04)',
            backgroundColor: activeCategory === cat.id
              ? `color-mix(in srgb, ${sectionColors[activeSection]} 8%, transparent)`
              : 'transparent',
            cursor: 'pointer',
            borderLeft: activeCategory === cat.id
              ? `2px solid ${sectionColors[activeSection]}`
              : '2px solid transparent',
          }} onClick={() => onSelect(cat.id)}>

            {cat.image ? (
              <div style={{
                width: '36px', height: '36px',
                borderRadius: '2px',
                backgroundImage: `url(${cat.image})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                flexShrink: 0,
              }} />
            ) : (
              <div style={{
                width: '36px', height: '36px',
                borderRadius: '2px',
                backgroundColor: 'rgba(var(--overlay-rgb),0.04)',
                flexShrink: 0,
              }} />
            )}

            <span style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.85rem',
              color: activeCategory === cat.id
                ? sectionColors[activeSection]
                : 'rgba(var(--offwhite-rgb),0.6)',
              flex: 1,
            }}>{cat.name}</span>

            <button onClick={e => {
              e.stopPropagation()
              onEdit(cat)
            }} style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(var(--offwhite-rgb),0.3)',
              cursor: 'pointer',
              fontSize: '0.7rem',
              padding: '0.2rem 0.4rem',
            }}>✏️</button>

            <button onClick={e => { e.stopPropagation(); onDelete(cat.id) }} style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(var(--red-rgb),0.4)',
              cursor: 'pointer',
              fontSize: '0.75rem',
              padding: '0.2rem 0.4rem',
            }}>✕</button>
          </div>
        ))}
      </div>

      {/* Add Category Form */}
      <div style={{
        background: 'rgba(var(--overlay-rgb),0.02)',
        border: '1px solid rgba(var(--overlay-rgb),0.06)',
        borderRadius: '4px',
        padding: '1.2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.8rem',
      }}>
        <p style={{ ...labelStyle, margin: 0 }}>Add Category</p>

        <input
          type="text"
          placeholder="Category name…"
          value={newCatName}
          onChange={e => setNewCatName(e.target.value)}
          style={{ ...inputStyle, padding: '0.6rem 0.8rem', fontSize: '0.82rem' }}
        />

        <select
          value={newCatSection}
          onChange={e => setNewCatSection(e.target.value as Section)}
          style={{ ...inputStyle, padding: '0.6rem 0.8rem', fontSize: '0.82rem', color: 'var(--offwhite)', backgroundColor: '#1a1a1a' }}
        >
          {SECTIONS.map(s => (
            <option key={s} value={s} style={{ backgroundColor: '#1a1a1a', color: 'var(--offwhite)' }}>{s}</option>
          ))}
        </select>

        <div>
          <label style={{ ...labelStyle, marginBottom: '0.4rem' }}>Category Image</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              ref={catFileRef}
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
          {uploadingCat && (
            <p style={{ fontSize: '0.72rem', color: 'var(--teal)', fontFamily: 'var(--font-inter)', marginTop: '0.3rem' }}>
              Uploading…
            </p>
          )}
          {newCatImage && !uploadingCat && (
            <img src={newCatImage} alt="preview" style={{
              width: '100%', height: '80px',
              objectFit: 'cover', borderRadius: '2px',
              marginTop: '0.5rem',
              border: '1px solid rgba(var(--overlay-rgb),0.06)',
            }} />
          )}
        </div>

        <button
          onClick={onAdd}
          disabled={addingCat || uploadingCat || !newCatName.trim()}
          style={{
            backgroundColor: sectionColors[newCatSection],
            border: 'none',
            color: '#fff',
            padding: '0.65rem',
            borderRadius: '2px',
            fontSize: '0.78rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: 'var(--font-inter)',
            opacity: addingCat || uploadingCat || !newCatName.trim() ? 0.5 : 1,
          }}
        >
          {addingCat ? 'Adding…' : '+ Add Category'}
        </button>
      </div>
    </div>
  )
}
