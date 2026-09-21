'use client'

import { useEffect, useState, useRef } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { recordMediaUpload, uploadImage } from '@big-cms/shared/media'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { useSuggestedPrices } from './useSuggestedPrices'
import MediaPickerModal from '../../components/admin/MediaPickerModal'
import {
  KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { startLoad } from '@big-cms/shared/startLoad'
import { EMPTY_ITEM, SECTIONS, sectionColors, type Category, type MenuItem, type Section } from './_components/menuTypes'
import CategoryPanel from './_components/CategoryPanel'
import ItemList from './_components/ItemList'
import EditCategoryModal from './_components/EditCategoryModal'
import ItemModal from './_components/ItemModal'
import { storedHours, storedPriceRules } from '@big-cms/shared/timePricing'
import { readComboOf } from '@big-cms/shared/combos'

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

export default function AdminMenuPage() {
  const { checking, role } = useRequireRole(SECTION_ACCESS.menu)
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
  const [uploadingItem, setUploadingItem] = useState(false)

  // What each dish should sell for from its recipe — admins only, because a
  // suggested price at a known margin gives the cost away.
  const suggestions    = useSuggestedPrices(!checking && role === 'admin', items, categories)
  const editSuggestion = editing ? suggestions[editing.id] : undefined

  // Media picker (shared modal — `pickerTarget` says which image field it fills)
  const [pickerTarget, setPickerTarget] = useState<'new' | 'edit' | 'item' | null>(null)
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
    if (cats.length > 0) setActiveCategory(prev => prev || cats[0].id)
    setLoading(false)
  }

  useEffect(() => { startLoad(loadData) }, [])

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

  // Every upload goes through uploadImage() (CLAUDE.md), and is recorded in
  // the media library so it can be picked again.
  async function handleItemImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingItem(true)
    try {
      const { url, deleteUrl, fileName } = await uploadImage(file)
      setForm(f => ({ ...f, image: url }))
      await recordMediaUpload({ url, deleteUrl, fileName })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      e.target.value = ''
      setUploadingItem(false)
    }
  }

  async function addCategory() {
    if (!newCatName.trim()) return
    setAddingCat(true)
    // The route counts the position itself. The browser used to send the
    // length of the list it happened to be holding, so two people adding a
    // category at the same moment both landed on the same order value.
    await unwrap(await authedFetch('/api/admin/menu', 'POST', {
      kind: 'category', name: newCatName.trim(), section: newCatSection, image: newCatImage,
    }))
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
    await unwrap(await authedFetch('/api/admin/menu', 'PATCH', {
      kind: 'category', id: editingCat.id,
      name: editCatName, section: editCatSection, image: editCatImage,
    }))
    setSavingCat(false)
    setEditingCat(null)
    if (editCatFileRef.current) editCatFileRef.current.value = ''
    loadData()
  }

  async function deleteCategory(id: string) {
    if (!confirm('Delete this category and all its items?')) return
    // The route queries the items rather than trusting this page's copy.
    // Deleting from the loaded array left anything added since the page
    // opened behind — a menu item in a category that no longer exists, which
    // nothing lists and nothing cleans up.
    await unwrap(await authedFetch(`/api/admin/menu?kind=category&id=${encodeURIComponent(id)}`, 'DELETE'))
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
      image:       item.image ?? '',
      hours:       storedHours(item.hours),
      priceRules:  storedPriceRules(item.priceRules),
      comboOf:     readComboOf(item.comboOf, item.id),
    })
    setOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    // `...form` used to be spread straight into Firestore, so a price could
    // be negative, text, or absent. This is the number a customer reads.
    if (editing) {
      await unwrap(await authedFetch('/api/admin/menu', 'PATCH', {
        kind: 'item', id: editing.id, ...form, categoryId: editing.categoryId,
      }))
    } else {
      await unwrap(await authedFetch('/api/admin/menu', 'POST', {
        kind: 'item', ...form, categoryId: activeCategory,
      }))
    }
    setSaving(false)
    setOpen(false)
    loadData()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this item?')) return
    await unwrap(await authedFetch(`/api/admin/menu?kind=item&id=${encodeURIComponent(id)}`, 'DELETE'))
    loadData()
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const catItems  = items.filter(i => i.categoryId === activeCategory)
    const oldIndex  = catItems.findIndex(i => i.id === active.id)
    const newIndex  = catItems.findIndex(i => i.id === over.id)
    const reordered = arrayMove(catItems, oldIndex, newIndex)
    // Send the arrangement, not the items. The route writes positions from
    // the index and checks every id belongs to this category, so a drag
    // cannot renumber a category nobody is looking at — and cannot carry a
    // stale price along with it.
    await unwrap(await authedFetch('/api/admin/menu', 'PATCH', {
      action: 'reorder', categoryId: activeCategory, orderedIds: reordered.map(i => i.id),
    }))
    loadData()
  }

  const sectionCategories = categories.filter(c => c.section === activeSection)
  const activeCatItems    = items.filter(i => i.categoryId === activeCategory)

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
              color: 'rgba(var(--offwhite-rgb),0.3)',
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
          borderBottom: '1px solid rgba(var(--overlay-rgb),0.08)',
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
              color: activeSection === s ? 'var(--offwhite)' : 'rgba(var(--offwhite-rgb),0.4)',
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
          <CategoryPanel
            activeSection={activeSection}
            sectionCategories={sectionCategories}
            activeCategory={activeCategory}
            onSelect={setActiveCategory}
            onEdit={cat => {
              setEditingCat(cat)
              setEditCatName(cat.name)
              setEditCatSection(cat.section)
              setEditCatImage(cat.image ?? '')
            }}
            onDelete={deleteCategory}
            newCatName={newCatName}
            setNewCatName={setNewCatName}
            newCatSection={newCatSection}
            setNewCatSection={setNewCatSection}
            newCatImage={newCatImage}
            uploadingCat={uploadingCat}
            addingCat={addingCat}
            catFileRef={catFileRef}
            onImageUpload={handleCatImageUpload}
            onPickMedia={() => setPickerTarget('new')}
            onAdd={addCategory}
          />

          {/* Right — Items */}
          <ItemList
            categoryName={categories.find(c => c.id === activeCategory)?.name ?? 'Select a category'}
            activeCategory={activeCategory}
            activeCatItems={activeCatItems}
            loading={loading}
            sensors={sensors}
            onDragEnd={handleDragEnd}
            suggestions={suggestions}
            onEdit={openEdit}
            onDelete={handleDelete}
            isMobile={isMobile}
          />
        </div>
      </div>

      {/* Edit Category Modal */}
      {editingCat && (
        <EditCategoryModal
          isMobile={isMobile}
          name={editCatName}
          setName={setEditCatName}
          section={editCatSection}
          setSection={setEditCatSection}
          image={editCatImage}
          saving={savingCat}
          uploading={uploadingEditCat}
          fileRef={editCatFileRef}
          onImageUpload={handleEditCatImageUpload}
          onPickMedia={() => setPickerTarget('edit')}
          onClose={() => setEditingCat(null)}
          onSubmit={handleSaveCat}
        />
      )}

      {/* Item Modal */}
      {open && (
        <ItemModal
          allItems={items.filter(i => i.id !== editing?.id && readComboOf(i.comboOf, i.id).length === 0).map(i => ({ id: i.id, name: i.name }))}
          isMobile={isMobile}
          isEditing={!!editing}
          form={form}
          setForm={setForm}
          activeSection={activeSection}
          uploadingItem={uploadingItem}
          onImageUpload={handleItemImageUpload}
          onPickMedia={() => setPickerTarget('item')}
          editSuggestion={editSuggestion}
          saving={saving}
          onClose={() => setOpen(false)}
          onSubmit={handleSave}
        />
      )}

      <MediaPickerModal
        open={pickerTarget !== null}
        onClose={() => setPickerTarget(null)}
        onSelect={url => {
          if (pickerTarget === 'new') setNewCatImage(url)
          else if (pickerTarget === 'edit') setEditCatImage(url)
          else if (pickerTarget === 'item') setForm(f => ({ ...f, image: url }))
          setPickerTarget(null)
        }}
      />
    </div>
  )
}
