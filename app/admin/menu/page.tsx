'use client'

import { useEffect, useState, useRef } from 'react'
import {
  collection, getDocs, addDoc, deleteDoc,
  doc, updateDoc, serverTimestamp, writeBatch
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useRequireRole, SECTION_ACCESS } from '../../lib/adminAuth'
import { logActivity, logCreate, logUpdate, logDelete } from '../../lib/activityLog'
import { recordMediaUpload, uploadImage } from '../../lib/media'
import MediaPickerModal from '../../components/admin/MediaPickerModal'
import {
  DndContext, closestCenter, KeyboardSensor,
  PointerSensor, useSensor, useSensors, DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type Section = 'Food' | 'Beverage' | 'Sweets'

interface Category {
  id: string
  name: string
  section: Section
  image?: string
  order: number
}

interface MenuItem {
  id: string
  name: string
  description: string
  price: number
  categoryId: string
  order: number
  badge?: string
  available: boolean
}

const EMPTY_ITEM = {
  name: '',
  description: '',
  price: 0,
  categoryId: '',
  order: 0,
  badge: '',
  available: true,
}

const SECTIONS: Section[] = ['Food', 'Beverage', 'Sweets']

const sectionColors: Record<Section, string> = {
  Food:     'var(--teal)',
  Beverage: 'var(--purple)',
  Sweets:   'var(--red)',
}

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

function SortableItem({ item, onEdit, onDelete, isMobile }: {
  item: MenuItem
  onEdit: (item: MenuItem) => void
  onDelete: (id: string) => void
  isMobile: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={{
      ...style,
      display: 'flex',
      flexWrap: isMobile ? 'wrap' : 'nowrap',
      alignItems: 'center',
      gap: isMobile ? '0.6rem' : '1rem',
      padding: isMobile ? '0.8rem 1rem' : '0.9rem 1.2rem',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      background: 'rgba(255,255,255,0.01)',
    }}>
      <div {...attributes} {...listeners} style={{
        cursor: 'grab',
        color: 'rgba(255,255,255,0.2)',
        fontSize: '1rem',
        flexShrink: 0,
      }}>⠿</div>

      <div style={{ flex: 1 }}>
        <p style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: '0.9rem',
          color: 'var(--offwhite)',
          marginBottom: '0.2rem',
        }}>{item.name}</p>
        <p style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '0.75rem',
          color: 'rgba(245,242,236,0.4)',
        }}>{item.description}</p>
      </div>

      {item.badge && (
        <span style={{
          fontSize: '0.65rem',
          padding: '0.2rem 0.6rem',
          borderRadius: '2px',
          backgroundColor: 'rgba(0,160,152,0.15)',
          color: 'var(--teal)',
          fontFamily: 'var(--font-inter)',
        }}>{item.badge}</span>
      )}

      <span style={{
        fontFamily: 'var(--font-inter)',
        fontSize: '0.9rem',
        color: 'var(--teal)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}>${item.price}</span>

      <span style={{
        fontSize: '0.65rem',
        padding: '0.2rem 0.6rem',
        borderRadius: '2px',
        backgroundColor: item.available ? 'rgba(0,160,152,0.15)' : 'rgba(228,51,41,0.15)',
        color: item.available ? 'var(--teal)' : 'var(--red)',
        fontFamily: 'var(--font-inter)',
      }}>{item.available ? 'Available' : 'Hidden'}</span>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={() => onEdit(item)} style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'rgba(245,242,236,0.5)',
          padding: '0.35rem 0.7rem',
          borderRadius: '2px',
          fontSize: '0.7rem',
          cursor: 'pointer',
          fontFamily: 'var(--font-inter)',
        }}>Edit</button>
        <button onClick={() => onDelete(item.id)} style={{
          background: 'transparent',
          border: '1px solid rgba(228,51,41,0.3)',
          color: 'var(--red)',
          padding: '0.35rem 0.7rem',
          borderRadius: '2px',
          fontSize: '0.7rem',
          cursor: 'pointer',
          fontFamily: 'var(--font-inter)',
        }}>Delete</button>
      </div>
    </div>
  )
}

export default function AdminMenuPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.menu)
  const isMobile = useIsMobile()
  const [categories, setCategories]         = useState<Category[]>([])
  const [items, setItems]                   = useState<MenuItem[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('')
  const [activeSection, setActiveSection]   = useState<Section>('Food')
  const [loading, setLoading]               = useState(true)

  // Category add form
  const [newCatName, setNewCatName]         = useState('')
  const [newCatSection, setNewCatSection]   = useState<Section>('Food')
  const [newCatImage, setNewCatImage]       = useState('')
  const [uploadingCat, setUploadingCat]     = useState(false)
  const [addingCat, setAddingCat]           = useState(false)
  const catFileRef                          = useRef<HTMLInputElement>(null)

  // Category edit
  const [editingCat, setEditingCat]             = useState<Category | null>(null)
  const [editCatName, setEditCatName]           = useState('')
  const [editCatSection, setEditCatSection]     = useState<Section>('Food')
  const [editCatImage, setEditCatImage]         = useState('')
  const [savingCat, setSavingCat]               = useState(false)
  const [uploadingEditCat, setUploadingEditCat] = useState(false)
  const editCatFileRef                          = useRef<HTMLInputElement>(null)

  // Item form
  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState<MenuItem | null>(null)
  const [form, setForm]       = useState({ ...EMPTY_ITEM })

  // Media picker (shared modal — `pickerTarget` says which image field it fills)
  const [pickerTarget, setPickerTarget] = useState<'new' | 'edit' | null>(null)
  const [saving, setSaving]   = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  async function loadData() {
    const [catSnap, itemSnap] = await Promise.all([
      getDocs(collection(db, 'menuCategories')),
      getDocs(collection(db, 'menuItems')),
    ])

    const cats = catSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as Category))
      .sort((a, b) => a.order - b.order)

    const its = itemSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as MenuItem))
      .sort((a, b) => a.order - b.order)

    setCategories(cats)
    setItems(its)
    if (cats.length > 0 && !activeCategory) setActiveCategory(cats[0].id)
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function handleCatImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingCat(true)
    try {
      const { url, deleteUrl, fileName } = await uploadImage(file)
      setNewCatImage(url)
      await recordMediaUpload({ url, deleteUrl, fileName })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed.')
      e.target.value = ''
    } finally {
      setUploadingCat(false)
    }
  }

  async function handleEditCatImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingEditCat(true)
    try {
      const { url, deleteUrl, fileName } = await uploadImage(file)
      setEditCatImage(url)
      await recordMediaUpload({ url, deleteUrl, fileName })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed.')
      e.target.value = ''
    } finally {
      setUploadingEditCat(false)
    }
  }

  async function addCategory() {
    if (!newCatName.trim()) return
    setAddingCat(true)
    await addDoc(collection(db, 'menuCategories'), {
      name:      newCatName.trim(),
      section:   newCatSection,
      image:     newCatImage,
      order:     categories.filter(c => c.section === newCatSection).length,
      createdAt: serverTimestamp(),
    })
    await logCreate('Menu Category', newCatName.trim(), {
      name: newCatName.trim(), section: newCatSection, image: newCatImage,
    })
    setNewCatName('')
    setNewCatImage('')
    setNewCatSection('Food')
    setAddingCat(false)
    if (catFileRef.current) catFileRef.current.value = ''
    loadData()
  }

  async function handleSaveCat(e: React.FormEvent) {
    e.preventDefault()
    if (!editingCat) return
    setSavingCat(true)
    await updateDoc(doc(db, 'menuCategories', editingCat.id), {
      name:      editCatName,
      section:   editCatSection,
      image:     editCatImage,
      updatedAt: serverTimestamp(),
    })
    await logUpdate('Menu Category', editCatName, editingCat, {
      name: editCatName, section: editCatSection, image: editCatImage,
    })
    setSavingCat(false)
    setEditingCat(null)
    if (editCatFileRef.current) editCatFileRef.current.value = ''
    loadData()
  }

  async function deleteCategory(id: string) {
    if (!confirm('Delete this category and all its items?')) return
    const cat = categories.find(c => c.id === id)
    const itemCount = items.filter(i => i.categoryId === id).length
    const batch = writeBatch(db)
    batch.delete(doc(db, 'menuCategories', id))
    items.filter(i => i.categoryId === id).forEach(i => {
      batch.delete(doc(db, 'menuItems', i.id))
    })
    await batch.commit()
    await logDelete('Menu Category', `${cat?.name ?? id}${itemCount > 0 ? ` (+${itemCount} items)` : ''}`, cat)
    if (activeCategory === id) setActiveCategory(categories[0]?.id ?? '')
    loadData()
  }

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY_ITEM, categoryId: activeCategory })
    setOpen(true)
  }

  function openEdit(item: MenuItem) {
    setEditing(item)
    setForm({
      name:        item.name,
      description: item.description,
      price:       item.price,
      categoryId:  item.categoryId,
      order:       item.order,
      badge:       item.badge ?? '',
      available:   item.available,
    })
    setOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    if (editing) {
      await updateDoc(doc(db, 'menuItems', editing.id), { ...form, updatedAt: serverTimestamp() })
      await logUpdate('Menu Item', form.name, editing, form)
    } else {
      const catItems = items.filter(i => i.categoryId === activeCategory)
      await addDoc(collection(db, 'menuItems'), {
        ...form,
        categoryId: activeCategory,
        order:      catItems.length,
        createdAt:  serverTimestamp(),
        updatedAt:  serverTimestamp(),
      })
      await logCreate('Menu Item', form.name, form)
    }
    setSaving(false)
    setOpen(false)
    loadData()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this item?')) return
    const item = items.find(i => i.id === id)
    await deleteDoc(doc(db, 'menuItems', id))
    await logDelete('Menu Item', item?.name ?? id, item)
    loadData()
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const catItems  = items.filter(i => i.categoryId === activeCategory)
    const oldIndex  = catItems.findIndex(i => i.id === active.id)
    const newIndex  = catItems.findIndex(i => i.id === over.id)
    const reordered = arrayMove(catItems, oldIndex, newIndex)
    const batch     = writeBatch(db)
    reordered.forEach((item, index) => {
      batch.update(doc(db, 'menuItems', item.id), { order: index })
    })
    await batch.commit()
    loadData()
  }

  const sectionCategories = categories.filter(c => c.section === activeSection)
  const activeCatItems    = items.filter(i => i.categoryId === activeCategory)

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
              color: 'rgba(245,242,236,0.3)',
              textDecoration: 'none',
              fontFamily: 'var(--font-inter)',
              marginBottom: '0.5rem',
              display: 'block',
            }}>← Back to Dashboard</a>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)' }}>
              Menu Manager
            </h1>
          </div>
          <button onClick={openNew} disabled={!activeCategory} style={{
            backgroundColor: sectionColors[activeSection],
            color: '#fff',
            padding: '0.7rem 1.5rem',
            border: 'none',
            borderRadius: '2px',
            fontSize: '0.75rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: !activeCategory ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-inter)',
            opacity: !activeCategory ? 0.5 : 1,
          }}>+ Add Item</button>
        </div>

        {/* Section Tabs */}
        <div style={{
          display: 'flex',
          gap: '0',
          flexWrap: 'wrap',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          marginBottom: '2rem',
        }}>
          {SECTIONS.map(s => (
            <button key={s} onClick={() => {
              setActiveSection(s)
              const firstCat = categories.find(c => c.section === s)
              if (firstCat) setActiveCategory(firstCat.id)
              else setActiveCategory('')
            }} style={{
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${activeSection === s ? sectionColors[s] : 'transparent'}`,
              color: activeSection === s ? 'var(--offwhite)' : 'rgba(245,242,236,0.4)',
              padding: isMobile ? '0.7rem 1.2rem' : '0.85rem 2rem',
              fontSize: '0.78rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
              marginBottom: '-1px',
            }}>{s}</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '300px 1fr', gap: isMobile ? '1.5rem' : '2rem' }}>

          {/* Left — Categories */}
          <div>
            <p style={{ ...labelStyle, marginBottom: '1rem' }}>
              {activeSection} Categories
            </p>

            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '4px',
              overflow: 'hidden',
              marginBottom: '1.5rem',
            }}>
              {sectionCategories.length === 0 ? (
                <p style={{
                  padding: '1.5rem',
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.82rem',
                  color: 'rgba(245,242,236,0.2)',
                }}>No categories yet</p>
              ) : sectionCategories.map(cat => (
                <div key={cat.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.8rem',
                  padding: '0.8rem 1rem',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  backgroundColor: activeCategory === cat.id
                    ? `${sectionColors[activeSection]}15`
                    : 'transparent',
                  cursor: 'pointer',
                  borderLeft: activeCategory === cat.id
                    ? `2px solid ${sectionColors[activeSection]}`
                    : '2px solid transparent',
                }} onClick={() => setActiveCategory(cat.id)}>

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
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      flexShrink: 0,
                    }} />
                  )}

                  <span style={{
                    fontFamily: 'var(--font-inter)',
                    fontSize: '0.85rem',
                    color: activeCategory === cat.id
                      ? sectionColors[activeSection]
                      : 'rgba(245,242,236,0.6)',
                    flex: 1,
                  }}>{cat.name}</span>

                  <button onClick={e => {
                    e.stopPropagation()
                    setEditingCat(cat)
                    setEditCatName(cat.name)
                    setEditCatSection(cat.section)
                    setEditCatImage(cat.image ?? '')
                  }} style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'rgba(245,242,236,0.3)',
                    cursor: 'pointer',
                    fontSize: '0.7rem',
                    padding: '0.2rem 0.4rem',
                  }}>✏️</button>

                  <button onClick={e => { e.stopPropagation(); deleteCategory(cat.id) }} style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'rgba(228,51,41,0.4)',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.4rem',
                  }}>✕</button>
                </div>
              ))}
            </div>

            {/* Add Category Form */}
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
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
                style={{ ...inputStyle, padding: '0.6rem 0.8rem', fontSize: '0.82rem', color: '#F5F2EC', backgroundColor: '#1a1a1a' }}
              >
                {SECTIONS.map(s => (
                  <option key={s} value={s} style={{ backgroundColor: '#1a1a1a', color: '#F5F2EC' }}>{s}</option>
                ))}
              </select>

              <div>
                <label style={{ ...labelStyle, marginBottom: '0.4rem' }}>Category Image</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    ref={catFileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleCatImageUpload}
                    style={{ ...inputStyle, padding: '0.5rem', fontSize: '0.78rem', cursor: 'pointer', flex: 1 }}
                  />
                  <button type="button" onClick={() => setPickerTarget('new')} style={{
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(245,242,236,0.6)',
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
                    border: '1px solid rgba(255,255,255,0.06)',
                  }} />
                )}
              </div>

              <button
                onClick={addCategory}
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

          {/* Right — Items */}
          <div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1rem',
            }}>
              <p style={{ ...labelStyle, margin: 0 }}>
                {categories.find(c => c.id === activeCategory)?.name ?? 'Select a category'}
                <span style={{ color: 'rgba(245,242,236,0.2)', marginLeft: '0.5rem' }}>
                  ({activeCatItems.length} items) — drag to reorder
                </span>
              </p>
            </div>

            {loading ? (
              <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
            ) : !activeCategory ? (
              <div style={{
                border: '1px dashed rgba(255,255,255,0.08)',
                borderRadius: '4px',
                padding: '3rem',
                textAlign: 'center',
                color: 'rgba(245,242,236,0.2)',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.85rem',
              }}>Select or create a category on the left</div>
            ) : activeCatItems.length === 0 ? (
              <div style={{
                border: '1px dashed rgba(255,255,255,0.08)',
                borderRadius: '4px',
                padding: '3rem',
                textAlign: 'center',
                color: 'rgba(245,242,236,0.2)',
                fontFamily: 'var(--font-inter)',
                fontSize: '0.85rem',
              }}>No items yet — click + Add Item to get started</div>
            ) : (
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '4px',
                overflow: 'hidden',
              }}>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={activeCatItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                    {activeCatItems.map(item => (
                      <SortableItem key={item.id} item={item} onEdit={openEdit} onDelete={handleDelete} isMobile={isMobile} />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Category Modal */}
      {editingCat && (
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
            border: '1px solid rgba(255,255,255,0.1)',
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
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem', color: 'var(--offwhite)' }}>
                Edit Category
              </h2>
              <button onClick={() => setEditingCat(null)} style={{
                background: 'transparent', border: 'none',
                color: 'rgba(245,242,236,0.4)', fontSize: '1.2rem', cursor: 'pointer',
              }}>✕</button>
            </div>

            <form onSubmit={handleSaveCat} style={{ padding: isMobile ? '1.5rem' : '2rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div>
                <label style={labelStyle}>Category Name</label>
                <input type="text" value={editCatName} required
                  onChange={e => setEditCatName(e.target.value)}
                  style={inputStyle} />
              </div>

              <div>
                <label style={labelStyle}>Section</label>
                <select value={editCatSection}
                  onChange={e => setEditCatSection(e.target.value as Section)}
                  style={{ ...inputStyle, color: '#F5F2EC', backgroundColor: '#1a1a1a' }}>
                  {SECTIONS.map(s => (
                    <option key={s} value={s} style={{ backgroundColor: '#1a1a1a', color: '#F5F2EC' }}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Category Image</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    ref={editCatFileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleEditCatImageUpload}
                    style={{ ...inputStyle, padding: '0.5rem', fontSize: '0.78rem', cursor: 'pointer', flex: 1 }}
                  />
                  <button type="button" onClick={() => setPickerTarget('edit')} style={{
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(245,242,236,0.6)',
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
                {uploadingEditCat && (
                  <p style={{ fontSize: '0.72rem', color: 'var(--teal)', fontFamily: 'var(--font-inter)', marginTop: '0.3rem' }}>
                    Uploading…
                  </p>
                )}
                {editCatImage && !uploadingEditCat && (
                  <img src={editCatImage} alt="preview" style={{
                    width: '100%', height: '100px',
                    objectFit: 'cover', borderRadius: '2px',
                    marginTop: '0.5rem',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }} />
                )}
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setEditingCat(null)} style={{
                  flex: 1, background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(245,242,236,0.5)', padding: '0.8rem',
                  borderRadius: '2px', fontSize: '0.75rem',
                  cursor: 'pointer', fontFamily: 'var(--font-inter)',
                }}>Cancel</button>
                <button type="submit" disabled={savingCat || uploadingEditCat} style={{
                  flex: 1, backgroundColor: sectionColors[editCatSection],
                  border: 'none', color: '#fff', padding: '0.8rem',
                  borderRadius: '2px', fontSize: '0.75rem',
                  cursor: savingCat ? 'not-allowed' : 'pointer',
                  opacity: savingCat || uploadingEditCat ? 0.6 : 1,
                  fontFamily: 'var(--font-inter)',
                }}>{savingCat ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Item Modal */}
      {open && (
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
            border: '1px solid rgba(255,255,255,0.1)',
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
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.2rem', color: 'var(--offwhite)' }}>
                {editing ? 'Edit Item' : 'Add Menu Item'}
              </h2>
              <button onClick={() => setOpen(false)} style={{
                background: 'transparent', border: 'none',
                color: 'rgba(245,242,236,0.4)', fontSize: '1.2rem', cursor: 'pointer',
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
                <textarea value={form.description} rows={2} required
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  style={{ ...inputStyle, resize: 'none' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Price ($)</label>
                  <input type="number" step="0.5" value={form.price} required
                    onChange={e => setForm(f => ({ ...f, price: +e.target.value }))}
                    style={inputStyle} />
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
                        border: `1px solid ${form.available === val ? sectionColors[activeSection] : 'rgba(255,255,255,0.1)'}`,
                        backgroundColor: form.available === val ? `${sectionColors[activeSection]}20` : 'transparent',
                        color: form.available === val ? sectionColors[activeSection] : 'rgba(245,242,236,0.4)',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-inter)',
                        fontSize: '0.78rem',
                      }}>
                      {val ? 'Available' : 'Hidden'}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setOpen(false)} style={{
                  flex: 1, background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(245,242,236,0.5)', padding: '0.8rem',
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
      )}

      <MediaPickerModal
        open={pickerTarget !== null}
        onClose={() => setPickerTarget(null)}
        onSelect={url => {
          if (pickerTarget === 'new') setNewCatImage(url)
          else if (pickerTarget === 'edit') setEditCatImage(url)
          setPickerTarget(null)
        }}
      />
    </div>
  )
}