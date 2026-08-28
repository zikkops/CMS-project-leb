'use client'

import { useEffect, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import {
  useRedemptionItems, seedRedemptionItemsIfEmpty, createRedemptionItem, updateRedemptionItem,
  toggleItemActive, deleteRedemptionItem, hasPendingRedemptions, type RedemptionItem,
} from '../../../lib/redemptions'

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

const EMPTY_FORM = { name: '', description: '', coinCost: 100, isActive: true }

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

export default function RedemptionItemsPage() {
  const { checking, user } = useRequireRole(SECTION_ACCESS.loyalty)
  const isMobile = useIsMobile()
  const { items, loading } = useRedemptionItems(false)

  const [open, setOpen]         = useState(false)
  const [editing, setEditing]   = useState<RedemptionItem | null>(null)
  const [form, setForm]         = useState({ ...EMPTY_FORM })
  const [saving, setSaving]     = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (user) seedRedemptionItemsIfEmpty(user.uid)
  }, [user])

  if (checking) return null

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY_FORM })
    setOpen(true)
  }

  function openEdit(item: RedemptionItem) {
    setEditing(item)
    setForm({ name: item.name, description: item.description, coinCost: item.coinCost, isActive: item.isActive })
    setOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) {
        await updateRedemptionItem(editing.id, form)
      } else if (user) {
        await createRedemptionItem({ ...form, createdBy: user.uid })
      }
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(item: RedemptionItem) {
    setDeleteError(null)
    if (await hasPendingRedemptions(item.id)) {
      setDeleteError(`"${item.name}" has pending redemptions. Deactivate it instead of deleting.`)
      return
    }
    if (!confirm('Are you sure? This will permanently remove this item. Past redemptions will not be affected.')) return
    await deleteRedemptionItem(item.id)
  }

  const canSave = form.name.trim() !== '' && form.description.trim() !== '' && form.coinCost >= 1

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>

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
              Redemption Items
            </h1>
          </div>
          <button onClick={openNew} style={{
            width: isMobile ? '100%' : 'auto',
            backgroundColor: 'var(--purple)', color: '#fff', padding: '0.7rem 1.5rem', border: 'none',
            borderRadius: '2px', fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase',
            cursor: 'pointer', fontFamily: 'var(--font-inter)',
          }}>+ Add Item</button>
        </div>

        {deleteError && (
          <p style={{ color: 'var(--red)', fontSize: '0.82rem', fontFamily: 'var(--font-inter)', marginBottom: '1.5rem' }}>
            {deleteError}
          </p>
        )}

        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {items.map(item => (
              <div key={item.id} style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '4px', padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.6rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.95rem', color: 'var(--offwhite)' }}>{item.name}</p>
                  <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--teal)', whiteSpace: 'nowrap' }}>{item.coinCost} coins</span>
                </div>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.45)' }}>{item.description}</p>

                <button onClick={() => toggleItemActive(item.id, !item.isActive)} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '2px',
                  padding: '0.6rem 0.8rem', cursor: 'pointer',
                }}>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(245,242,236,0.6)' }}>
                    {item.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <span style={{
                    width: '40px', height: '22px', borderRadius: '11px',
                    backgroundColor: item.isActive ? 'var(--teal)' : 'rgba(255,255,255,0.15)',
                    position: 'relative', transition: 'background-color 0.2s', flexShrink: 0,
                  }}>
                    <span style={{
                      position: 'absolute', top: '2px', left: item.isActive ? '20px' : '2px',
                      width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#fff', transition: 'left 0.2s',
                    }} />
                  </span>
                </button>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={() => openEdit(item)} style={{
                    flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(245,242,236,0.5)', padding: '0.6rem', borderRadius: '2px', fontSize: '0.72rem',
                    cursor: 'pointer', fontFamily: 'var(--font-inter)',
                  }}>Edit</button>
                  <button onClick={() => handleDelete(item)} style={{
                    flex: 1, background: 'transparent', border: '1px solid rgba(228,51,41,0.3)',
                    color: 'var(--red)', padding: '0.6rem', borderRadius: '2px', fontSize: '0.72rem',
                    cursor: 'pointer', fontFamily: 'var(--font-inter)',
                  }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Name', 'Description', 'Coins', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{
                      padding: '1rem 1.2rem', textAlign: 'left', fontSize: '0.65rem', letterSpacing: '0.2em',
                      textTransform: 'uppercase', color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)', fontWeight: 400,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--offwhite)' }}>{item.name}</td>
                    <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'rgba(245,242,236,0.5)', maxWidth: '280px' }}>{item.description}</td>
                    <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'var(--teal)' }}>{item.coinCost}</td>
                    <td style={{ padding: '1rem 1.2rem' }}>
                      <button onClick={() => toggleItemActive(item.id, !item.isActive)} style={{
                        display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                      }}>
                        <span style={{
                          width: '36px', height: '20px', borderRadius: '10px',
                          backgroundColor: item.isActive ? 'var(--teal)' : 'rgba(255,255,255,0.15)',
                          position: 'relative', transition: 'background-color 0.2s', flexShrink: 0,
                        }}>
                          <span style={{
                            position: 'absolute', top: '2px', left: item.isActive ? '18px' : '2px',
                            width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#fff', transition: 'left 0.2s',
                          }} />
                        </span>
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.5)' }}>
                          {item.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </button>
                    </td>
                    <td style={{ padding: '1rem 1.2rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => openEdit(item)} style={{
                          background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(245,242,236,0.5)',
                          padding: '0.4rem 0.8rem', borderRadius: '2px', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'var(--font-inter)',
                        }}>Edit</button>
                        <button onClick={() => handleDelete(item)} style={{
                          background: 'transparent', border: '1px solid rgba(228,51,41,0.3)', color: 'var(--red)',
                          padding: '0.4rem 0.8rem', borderRadius: '2px', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'var(--font-inter)',
                        }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                {editing ? 'Edit Item' : 'Add New Item'}
              </h2>
              <button onClick={() => setOpen(false)} style={{
                background: 'transparent', border: 'none', color: 'rgba(245,242,236,0.4)', fontSize: '1.2rem', cursor: 'pointer',
              }}>✕</button>
            </div>

            <form onSubmit={handleSave} style={{ padding: isMobile ? '1.5rem' : '2rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div>
                <label style={labelStyle}>Name</label>
                <input type="text" value={form.name} required
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={inputStyle} />
              </div>

              <div>
                <label style={labelStyle}>Description</label>
                <textarea value={form.description} rows={3} required
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  style={{ ...inputStyle, resize: 'none' }} />
              </div>

              <div>
                <label style={labelStyle}>Coin Cost</label>
                <input type="number" value={form.coinCost} required min={1}
                  onChange={e => setForm(f => ({ ...f, coinCost: +e.target.value }))}
                  style={inputStyle} />
              </div>

              <div>
                <label style={{ ...labelStyle, marginBottom: '0.8rem' }}>Active</label>
                <button type="button" onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))} style={{
                  display: 'flex', alignItems: 'center', gap: '0.8rem', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                }}>
                  <span style={{
                    width: '40px', height: '22px', borderRadius: '11px',
                    backgroundColor: form.isActive ? 'var(--teal)' : 'rgba(255,255,255,0.15)',
                    position: 'relative', transition: 'background-color 0.2s', flexShrink: 0,
                  }}>
                    <span style={{
                      position: 'absolute', top: '2px', left: form.isActive ? '20px' : '2px',
                      width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#fff', transition: 'left 0.2s',
                    }} />
                  </span>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.6)' }}>
                    {form.isActive ? 'Visible to customers' : 'Hidden from customers'}
                  </span>
                </button>
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
                }}>{saving ? 'Saving…' : 'Save Item'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
