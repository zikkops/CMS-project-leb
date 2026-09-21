'use client'

import type { Dispatch, SetStateAction, RefObject } from 'react'
import { BRANCHES } from '@big-cms/shared/branches'
import type { Product, ProductForm } from './types'
import { inputStyle, labelStyle } from './styles'

export default function ProductFormModal({
  isMobile, editing, setOpen, handleSave, form, setForm, displayCategories,
  catFileRef, handleImageUpload, setShowPicker, uploading, saving,
}: {
  isMobile: boolean
  editing: Product | null
  setOpen: (open: boolean) => void
  handleSave: (e: React.FormEvent) => void
  form: ProductForm
  setForm: Dispatch<SetStateAction<ProductForm>>
  displayCategories: string[]
  catFileRef: RefObject<HTMLInputElement | null>
  handleImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  setShowPicker: (show: boolean) => void
  uploading: boolean
  saving: boolean
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
          {editing ? 'Edit Product' : 'Add New Product'}
        </h2>
        <button onClick={() => setOpen(false)} style={{
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
            color: 'var(--teal)',
            fontFamily: 'var(--font-inter)',
          }}>Product Details</p>

          <div>
            <label style={labelStyle}>Name</label>
            <input type="text" value={form.name} required
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Category</label>
            <select value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              style={{ ...inputStyle, color: 'var(--offwhite)', backgroundColor: '#1a1a1a' }}>
              {displayCategories.map(c => (
                <option key={c} value={c} style={{ backgroundColor: '#1a1a1a', color: 'var(--offwhite)' }}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} rows={4} required
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ ...inputStyle, resize: 'none' }} />
          </div>

          {/* Players, Duration and Min Age used to sit here, all three
              required: board-game specs, so a café could not save a mug
              without inventing a player count. The server never required
              them. A client that sells something with real attributes of
              its own should get them as configuration, not inherit these. */}
          <div>
            <label style={labelStyle}>Retail Price ($)</label>
            <input type="number" value={form.price} required min={0} step="0.01"
              onChange={e => setForm(f => ({ ...f, price: +e.target.value }))}
              style={inputStyle} />
          </div>

          {/* On offer. A blank sale price means not on offer; the route
              refuses one at or above the normal price, so a typo cannot
              produce a "SAVE -12%" badge on the storefront. */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Sale Price ($) — optional</label>
              <input
                type="number" min={0} step="0.01"
                placeholder="Leave blank if not on offer"
                value={form.salePrice ?? ''}
                onChange={e => setForm(f => ({
                  ...f, salePrice: e.target.value === '' ? null : +e.target.value,
                }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Sale Ends — optional</label>
              <input
                type="date"
                value={form.saleEndsAt}
                onChange={e => setForm(f => ({ ...f, saleEndsAt: e.target.value }))}
                style={{ ...inputStyle, colorScheme: 'dark' }}
              />
            </div>
          </div>
          {form.salePrice != null && form.salePrice < form.price && (
            <p style={{
              fontFamily: 'var(--font-inter)', fontSize: '0.75rem',
              color: 'var(--teal)', marginTop: '-0.4rem',
            }}>
              Customers see {form.price.toFixed(2)} struck through and {form.salePrice.toFixed(2)} beside it
              {' — '}{Math.round((1 - form.salePrice / form.price) * 100)}% off
              {form.saleEndsAt ? ` until ${form.saleEndsAt}` : ', with no end date'}.
            </p>
          )}

          <div>
            <label style={labelStyle}>Wholesale Price ($) — optional</label>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="Leave blank if no wholesale pricing"
              value={form.wholesalePrice ?? ''}
              onChange={e => setForm(f => ({
                ...f,
                wholesalePrice: e.target.value === '' ? null : +e.target.value,
              }))}
              style={inputStyle}
            />
            <p style={{
              fontFamily: 'var(--font-inter)', fontSize: '0.72rem',
              color: 'rgba(var(--offwhite-rgb),0.3)', marginTop: '0.4rem',
            }}>
              Shown only to staff when recording a sale. Not visible to customers.
            </p>
          </div>

          {/* Starting stock, on create only. An existing product's stock
              moves through a sale, a transfer or the CSV import — never
              through an edit, which is how it used to be silently
              rewound. Same rule as Inventory Management. */}
          {!editing && (
          <div>
            <label style={labelStyle}>Starting Stock by Branch</label>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${BRANCHES.length}, 1fr)`, gap: '1rem' }}>
              {BRANCHES.map(branch => (
                <div key={branch}>
                  <p style={{
                    fontSize: '0.7rem',
                    color: 'rgba(var(--offwhite-rgb),0.4)',
                    fontFamily: 'var(--font-inter)',
                    marginBottom: '0.4rem',
                  }}>{branch}</p>
                  <input type="number" value={form.stock[branch] ?? 0} required min={0}
                    onChange={e => setForm(f => ({ ...f, stock: { ...f.stock, [branch]: +e.target.value } }))}
                    style={inputStyle} />
                </div>
              ))}
            </div>
            <p style={{
              fontSize: '0.72rem',
              color: 'rgba(var(--offwhite-rgb),0.3)',
              fontFamily: 'var(--font-inter)',
              marginTop: '0.6rem',
            }}>
              Total: {Object.values(form.stock).reduce((a: number, b) => a + (Number(b) || 0), 0)} across all branches
            </p>
          </div>
          )}
        </div>

        {/* Right Column */}
        <div style={{
          padding: isMobile ? '1.5rem' : '2.5rem 3rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
        }}>
          <p style={{
            fontSize: '0.68rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            fontFamily: 'var(--font-inter)',
          }}>Product Image</p>

          <div>
            <label style={labelStyle}>Upload Image</label>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '0.6rem' }}>
              <input
                ref={catFileRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                style={{ ...inputStyle, cursor: 'pointer', flex: 1 }}
              />
              <button type="button" onClick={() => setShowPicker(true)} style={{
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

          {form.image && !uploading ? (
            <div style={{
              flex: 1,
              borderRadius: '4px',
              overflow: 'hidden',
              border: '1px solid rgba(var(--overlay-rgb),0.06)',
              backgroundColor: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1rem',
              minHeight: isMobile ? '200px' : '300px',
            }}>
              <img src={form.image} alt="Preview" style={{
                maxWidth: '100%',
                maxHeight: '280px',
                objectFit: 'contain',
              }} />
            </div>
          ) : (
            <div style={{
              flex: 1,
              minHeight: isMobile ? '200px' : '300px',
              border: '1px dashed rgba(var(--overlay-rgb),0.1)',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(var(--offwhite-rgb),0.2)',
              fontFamily: 'var(--font-inter)',
              fontSize: '0.82rem',
            }}>
              Image preview will appear here
            </div>
          )}

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button type="button" onClick={() => setOpen(false)} style={{
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
              backgroundColor: 'var(--purple)',
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
            }}>
              {saving ? 'Saving…' : 'Save Product'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
