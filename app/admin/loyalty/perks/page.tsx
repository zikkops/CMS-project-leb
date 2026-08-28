'use client'

import { useEffect, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import {
  useLevelPerks, seedLevelPerksIfEmpty, createLevelPerk, updateLevelPerk, deleteLevelPerk,
  type LevelPerk,
} from '../../../lib/levelPerks'
import { getTierFromLevel, TIER_COLORS, MAX_LEVEL } from '../../../lib/levelConfig'

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

const EMPTY_FORM = { level: 5, perk: '' }

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

export default function LevelPerksPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.loyalty)
  const isMobile = useIsMobile()
  const { perks, loading } = useLevelPerks()

  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState<LevelPerk | null>(null)
  const [form, setForm]       = useState({ ...EMPTY_FORM })
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    seedLevelPerksIfEmpty()
  }, [])

  if (checking) return null

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY_FORM })
    setOpen(true)
  }

  function openEdit(p: LevelPerk) {
    setEditing(p)
    setForm({ level: p.level, perk: p.perk })
    setOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) {
        await updateLevelPerk(editing.id, form)
      } else {
        await createLevelPerk(form)
      }
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(p: LevelPerk) {
    if (!confirm(`Remove the Level ${p.level} perk? This won't affect customers who already unlocked it — it's display-only, not a credited reward.`)) return
    await deleteLevelPerk(p.id)
  }

  const canSave = form.level >= 1 && form.level <= MAX_LEVEL && form.perk.trim() !== ''

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

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
              fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.3)', textDecoration: 'none', fontFamily: 'var(--font-inter)',
              marginBottom: '0.5rem', display: 'block',
            }}>← Back to Dashboard</a>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)' }}>
              Level Perks
            </h1>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.4rem' }}>
              Shown publicly on the Loyalty page&apos;s &quot;Perks unlocked by level&quot; section
            </p>
          </div>
          <button onClick={openNew} style={{
            width: isMobile ? '100%' : 'auto',
            backgroundColor: 'var(--purple)', color: '#fff', padding: '0.7rem 1.5rem', border: 'none',
            borderRadius: '2px', fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase',
            cursor: 'pointer', fontFamily: 'var(--font-inter)',
          }}>+ Add Perk</button>
        </div>

        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : perks.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '4px',
            padding: '3rem', textAlign: 'center',
          }}>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.3)' }}>
              No perks yet.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {perks.map(p => {
              const tier = getTierFromLevel(p.level)
              const color = TIER_COLORS[tier]
              return (
                <div key={p.id} style={{
                  display: 'flex',
                  flexDirection: isMobile ? 'column' : 'row',
                  alignItems: isMobile ? 'stretch' : 'center',
                  gap: isMobile ? '0.8rem' : '1.2rem',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderLeft: `3px solid ${color}`,
                  borderRadius: '4px',
                  padding: isMobile ? '1rem 1.2rem' : '1rem 1.5rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexShrink: 0 }}>
                    <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.1rem', color, minWidth: '60px' }}>Lv {p.level}</span>
                    <span style={{
                      fontSize: '0.62rem', padding: '0.2rem 0.6rem', borderRadius: '2px',
                      backgroundColor: `${color}25`, color,
                      fontFamily: 'var(--font-inter)', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                    }}>{tier}</span>
                  </div>
                  <p style={{ flex: 1, fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.7)' }}>
                    {p.perk}
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    <button onClick={() => openEdit(p)} style={{
                      background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(245,242,236,0.5)',
                      padding: '0.4rem 0.8rem', borderRadius: '2px', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'var(--font-inter)',
                    }}>Edit</button>
                    <button onClick={() => handleDelete(p)} style={{
                      background: 'transparent', border: '1px solid rgba(228,51,41,0.3)', color: 'var(--red)',
                      padding: '0.4rem 0.8rem', borderRadius: '2px', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'var(--font-inter)',
                    }}>Delete</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {open && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: isMobile ? '1rem' : '2rem',
        }}>
          <div style={{
            backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
            width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: isMobile ? '1.25rem 1.5rem' : '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem', color: 'var(--offwhite)' }}>
                {editing ? 'Edit Perk' : 'Add New Perk'}
              </h2>
              <button onClick={() => setOpen(false)} style={{
                background: 'transparent', border: 'none', color: 'rgba(245,242,236,0.4)', fontSize: '1.2rem', cursor: 'pointer',
              }}>✕</button>
            </div>

            <form onSubmit={handleSave} style={{ padding: isMobile ? '1.5rem' : '2rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div>
                <label style={labelStyle}>Level (1–{MAX_LEVEL})</label>
                <input type="number" value={form.level} required min={1} max={MAX_LEVEL}
                  onChange={e => setForm(f => ({ ...f, level: +e.target.value }))}
                  style={inputStyle} />
                <p style={{ marginTop: '0.5rem', fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.35)' }}>
                  Tier: {getTierFromLevel(form.level)} (derived automatically from the level)
                </p>
              </div>

              <div>
                <label style={labelStyle}>Perk Description</label>
                <textarea value={form.perk} rows={3} required
                  onChange={e => setForm(f => ({ ...f, perk: e.target.value }))}
                  style={{ ...inputStyle, resize: 'none' }} />
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setOpen(false)} style={{
                  flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(245,242,236,0.5)', padding: '0.8rem', borderRadius: '2px', fontSize: '0.75rem',
                  cursor: 'pointer', fontFamily: 'var(--font-inter)',
                }}>Cancel</button>
                <button type="submit" disabled={saving || !canSave} style={{
                  flex: 1, backgroundColor: 'var(--purple)', border: 'none', color: '#fff', padding: '0.8rem',
                  borderRadius: '2px', fontSize: '0.75rem', cursor: saving || !canSave ? 'not-allowed' : 'pointer',
                  opacity: saving || !canSave ? 0.6 : 1, fontFamily: 'var(--font-inter)',
                }}>{saving ? 'Saving…' : 'Save Perk'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
