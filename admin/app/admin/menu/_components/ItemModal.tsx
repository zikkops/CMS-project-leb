'use client'

import type { Dispatch, SetStateAction } from 'react'
import { formatUsd } from '@big-cms/shared/money'
import type { PriceSuggestion } from '../useSuggestedPrices'
import { sectionColors, smallButton, inputStyle, labelStyle, type ItemForm, type Section } from './menuTypes'
import TimeRulesEditor from './TimeRulesEditor'

// The Add / Edit Item modal. The page owns the form and the save; this only
// draws it.
export default function ItemModal({
  allItems, isMobile, isEditing, form, setForm, activeSection, uploadingItem,
  onImageUpload, onPickMedia, editSuggestion, saving, onClose, onSubmit,
}: {
  /** Every other item that is not itself a combo, to build a combo from (T5.13). */
  allItems: { id: string; name: string }[]
  isMobile: boolean
  isEditing: boolean
  form: ItemForm
  setForm: Dispatch<SetStateAction<ItemForm>>
  activeSection: Section
  uploadingItem: boolean
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onPickMedia: () => void
  /** Admins only, and only for a dish with a costed recipe. */
  editSuggestion: PriceSuggestion | undefined
  saving: boolean
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
      zIndex: 100,
      padding: isMobile ? '1rem' : '2rem',
    }}>
      <div style={{
        backgroundColor: '#111',
        border: '1px solid rgba(var(--overlay-rgb),0.1)',
        borderRadius: '8px',
        width: '100%',
        maxWidth: '500px',
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
            {isEditing ? 'Edit Item' : 'Add Menu Item'}
          </h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none',
            color: 'rgba(var(--offwhite-rgb),0.4)', fontSize: '1.2rem', cursor: 'pointer',
          }}>✕</button>
        </div>

        <form onSubmit={onSubmit} style={{ padding: isMobile ? '1.5rem' : '2rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input type="text" value={form.name} required
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Picture</label>
            <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{
                width: '96px', height: '72px', borderRadius: '4px', overflow: 'hidden', flexShrink: 0,
                background: 'rgba(var(--overlay-rgb),0.05)', border: '1px solid rgba(var(--overlay-rgb),0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {form.image
                  ? <img src={form.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', color: 'rgba(var(--offwhite-rgb),0.35)' }}>No picture</span>}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <label style={{ ...smallButton, display: 'inline-block' }}>
                  {uploadingItem ? 'Uploading…' : 'Upload'}
                  <input type="file" accept="image/*" onChange={onImageUpload} disabled={uploadingItem} style={{ display: 'none' }} />
                </label>
                <button type="button" onClick={onPickMedia} style={smallButton}>From library</button>
                {form.image && (
                  <button type="button" onClick={() => setForm(f => ({ ...f, image: '' }))} style={{ ...smallButton, color: 'var(--red)' }}>Remove</button>
                )}
              </div>
            </div>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(var(--offwhite-rgb),0.35)', marginTop: '0.4rem' }}>
              Shown on the till&apos;s menu tiles.
            </p>
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} rows={2} required
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ ...inputStyle, resize: 'none' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Price ($)</label>
              <input type="number" step="0.01" min="0" value={form.price} required
                onChange={e => setForm(f => ({ ...f, price: +e.target.value }))}
                style={inputStyle} />
              {editSuggestion && (
                <p style={{
                  fontFamily: 'var(--font-inter)', fontSize: '0.7rem', lineHeight: 1.5, marginTop: '0.4rem',
                  color: form.price < editSuggestion.withVatUsd ? 'var(--brand-secondary)' : 'rgba(var(--offwhite-rgb),0.45)',
                }}>
                  Costs {formatUsd(editSuggestion.costUsd)} to make. Suggested {formatUsd(editSuggestion.roundedUsd)} for
                  a {Math.round(editSuggestion.targetMargin * 100)}% margin before VAT.{' '}
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, price: editSuggestion.roundedUsd }))}
                    style={{
                      background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                      color: 'var(--teal)', fontSize: '0.7rem', fontFamily: 'var(--font-inter)', textDecoration: 'underline',
                    }}>Use it</button>
                </p>
              )}
            </div>
            <div>
              <label style={labelStyle}>Badge (optional)</label>
              <input type="text" placeholder="e.g. Popular"
                value={form.badge}
                onChange={e => setForm(f => ({ ...f, badge: e.target.value }))}
                style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={{ ...labelStyle, marginBottom: '0.8rem' }}>Available</label>
            <div style={{ display: 'flex', gap: '1rem' }}>
              {[true, false].map(val => (
                <button key={String(val)} type="button"
                  onClick={() => setForm(f => ({ ...f, available: val }))}
                  style={{
                    flex: 1,
                    padding: '0.6rem',
                    borderRadius: '2px',
                    border: `1px solid ${form.available === val ? sectionColors[activeSection] : 'rgba(var(--overlay-rgb),0.1)'}`,
                    backgroundColor: form.available === val ? `${sectionColors[activeSection]}20` : 'transparent',
                    color: form.available === val ? sectionColors[activeSection] : 'rgba(var(--offwhite-rgb),0.4)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.78rem',
                  }}>
                  {val ? 'Available' : 'Hidden'}
                </button>
              ))}
            </div>
          </div>

          <TimeRulesEditor form={form} setForm={setForm} colour={sectionColors[activeSection]} />

          {/* A combo (UPGRADE.md T5.13): made of two to six other items, at this item's price. */}
          <div>
            <label style={{ ...labelStyle, marginBottom: '0.6rem' }}>Combo of (optional)</label>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', maxHeight: '9rem', overflowY: 'auto' }}>
              {allItems.map(i => {
                const on = form.comboOf.includes(i.id)
                return (
                  <button key={i.id} type="button" aria-pressed={on}
                    onClick={() => setForm(f => ({ ...f, comboOf: on ? f.comboOf.filter(x => x !== i.id) : [...f.comboOf, i.id] }))}
                    style={{ ...smallButton, borderColor: on ? sectionColors[activeSection] : undefined, color: on ? sectionColors[activeSection] : undefined }}>
                    {i.name}
                  </button>
                )
              })}
            </div>
            <p style={{ fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.5)', marginTop: '0.4rem', lineHeight: 1.5 }}>
              {form.comboOf.length > 0
                ? `${form.comboOf.length} items. Each goes to its own station and takes its own ingredients; the combo carries the price.`
                : 'Leave empty for an ordinary item. An item that needs a choice from its options cannot be in a combo yet.'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, background: 'transparent',
              border: '1px solid rgba(var(--overlay-rgb),0.1)',
              color: 'rgba(var(--offwhite-rgb),0.5)', padding: '0.8rem',
              borderRadius: '2px', fontSize: '0.75rem',
              cursor: 'pointer', fontFamily: 'var(--font-inter)',
            }}>Cancel</button>
            <button type="submit" disabled={saving} style={{
              flex: 1, backgroundColor: sectionColors[activeSection],
              border: 'none', color: '#fff', padding: '0.8rem',
              borderRadius: '2px', fontSize: '0.75rem',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1, fontFamily: 'var(--font-inter)',
            }}>{saving ? 'Saving…' : 'Save Item'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
