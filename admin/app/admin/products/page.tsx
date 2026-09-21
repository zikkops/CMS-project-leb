'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { emptyStock } from '@big-cms/shared/branches'
import { recordMediaUpload, uploadImage } from '@big-cms/shared/media'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import MediaPickerModal from '../../components/admin/MediaPickerModal'
import { startLoad } from '@big-cms/shared/startLoad'
import { type Product, EMPTY, FALLBACK_CATEGORIES } from './_components/types'
import ProductsHeader from './_components/ProductsHeader'
import CategoryManager from './_components/CategoryManager'
import ProductFilters from './_components/ProductFilters'
import ProductList from './_components/ProductList'
import ProductFormModal from './_components/ProductFormModal'

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

export default function AdminGamesPage() {
  const { checking } = useRequireRole(SECTION_ACCESS.products)
  const isMobile = useIsMobile()
  const [products, setGames]                   = useState<Product[]>([])
  const [loading, setLoading]               = useState(true)
  const [open, setOpen]                     = useState(false)
  const [editing, setEditing]               = useState<Product | null>(null)
  const [form, setForm]                     = useState({ ...EMPTY, stock: emptyStock() })
  const [saving, setSaving]                 = useState(false)
  const [uploading, setUploading]           = useState(false)
  const [categories, setCategories]         = useState<string[]>([])
  const [newCategory, setNewCategory]       = useState('')
  const [addingCat, setAddingCat]           = useState(false)
  const [showCatManager, setShowCatManager] = useState(false)
  const [showPicker, setShowPicker]         = useState(false)
  const [search, setSearch]                 = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const catFileRef                          = useRef<HTMLInputElement>(null)

  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(g => {
      const matchesCategory = categoryFilter === 'All' || g.category === categoryFilter
      const matchesSearch   = !q || g.name.toLowerCase().includes(q) || g.category.toLowerCase().includes(q)
      return matchesCategory && matchesSearch
    })
  }, [products, search, categoryFilter])

  async function loadGames() {
    // Trade prices come from /api/admin/products, not the product document —
    // that one is world-readable, so anything on it is public whatever the
    // UI shows. Merged in here so the rest of the page is unchanged.
    const [snap, wholesale] = await Promise.all([
      getDocs(collection(db, 'products')),
      unwrap(await authedFetch('/api/admin/products', 'GET'))
        .then(r => (r.wholesale ?? {}) as Record<string, number>)
        .catch(() => ({} as Record<string, number>)),
    ])
    setGames(snap.docs.map(d => ({
      id: d.id, ...d.data(), wholesalePrice: wholesale[d.id] ?? null,
    } as Product)))
    setLoading(false)
  }

  async function loadCategories() {
    const snap = await getDocs(collection(db, 'productCategories'))
    setCategories(snap.docs.map(d => String((d.data() as { name?: unknown }).name ?? '')))
  }

  useEffect(() => {
    startLoad(loadGames)
    startLoad(loadCategories)
  }, [])

  async function addCategory() {
    if (!newCategory.trim()) return
    setAddingCat(true)
    await unwrap(await authedFetch('/api/admin/products', 'POST', {
      kind: 'category', name: newCategory.trim(),
    }))
    setNewCategory('')
    setAddingCat(false)
    loadCategories()
  }

  async function deleteCategory(name: string) {
    // Refused while products are still filed under it. A product stores its
    // category as a NAME, so deleting one left products pointing at a label
    // that no longer exists — they drop out of the filter rather than error.
    await unwrap(await authedFetch(`/api/admin/products?kind=category&name=${encodeURIComponent(name)}`, 'DELETE'))
    loadCategories()
  }

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY, stock: emptyStock(), category: categories[0] ?? FALLBACK_CATEGORIES[0] })
    setOpen(true)
  }

  function openEdit(product: Product) {
    setEditing(product)
    setForm({
      name:           product.name,
      category:       product.category,
      description:    product.description,
      price:          product.price,
      wholesalePrice: product.wholesalePrice ?? null,
      salePrice:      product.salePrice ?? null,
      saleEndsAt:     product.saleEndsAt ?? '',
      // Deliberately NOT the product's real stock. It used to be loaded here
      // and spread back on save, so fixing a typo in a description reverted
      // every sale and transfer that had happened while the form sat open.
      // The editor below only renders when creating, and PATCH ignores this.
      stock:          emptyStock(),
      image:          product.image,
    })
    setOpen(true)
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { url, deleteUrl, fileName } = await uploadImage(file)
      setForm(f => ({ ...f, image: url }))
      await recordMediaUpload({ url, deleteUrl, fileName })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed.')
      e.target.value = ''
    } finally {
      setUploading(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      // Neither branch sends stock or a SKU. The route's input type carries
      // neither, so a form field added later cannot quietly start writing one:
      // stock moves through receiving, a sale or a transfer, and a SKU is
      // printed on labels and past invoices.
      if (editing) {
        await unwrap(await authedFetch('/api/admin/products', 'PATCH', { id: editing.id, ...form }))
      } else {
        // The SKU is allocated inside the same request that creates the
        // product. Fetching one first and posting it back left a number in the
        // browser's hands between two calls.
        await unwrap(await authedFetch('/api/admin/products', 'POST', { kind: 'product', ...form }))
      }
    } catch (err) {
      setSaving(false)
      alert(err instanceof Error ? err.message : 'Could not save the product.')
      return
    }
    setSaving(false)
    setOpen(false)
    if (catFileRef.current) catFileRef.current.value = ''
    loadGames()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this product?')) return
    await unwrap(await authedFetch(`/api/admin/products?kind=product&id=${encodeURIComponent(id)}`, 'DELETE'))
    loadGames()
  }

  const displayCategories = categories.length > 0 ? categories : FALLBACK_CATEGORIES

  if (checking) return null

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        {/* Header */}
        <ProductsHeader isMobile={isMobile} products={products} openNew={openNew} />

        {/* Category Manager */}
        <CategoryManager
          showCatManager={showCatManager}
          setShowCatManager={setShowCatManager}
          categories={categories}
          displayCategories={displayCategories}
          deleteCategory={deleteCategory}
          newCategory={newCategory}
          setNewCategory={setNewCategory}
          addCategory={addCategory}
          addingCat={addingCat}
        />

        {/* Search + Category Filter */}
        {!loading && (
          <ProductFilters
            isMobile={isMobile}
            search={search}
            setSearch={setSearch}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            displayCategories={displayCategories}
            filteredGames={filteredGames}
            products={products}
          />
        )}

        {/* Table */}
        <ProductList
          loading={loading}
          filteredGames={filteredGames}
          isMobile={isMobile}
          openEdit={openEdit}
          handleDelete={handleDelete}
        />
      </div>

      {/* Full Screen Modal */}
      {open && (
        <ProductFormModal
          isMobile={isMobile}
          editing={editing}
          setOpen={setOpen}
          handleSave={handleSave}
          form={form}
          setForm={setForm}
          displayCategories={displayCategories}
          catFileRef={catFileRef}
          handleImageUpload={handleImageUpload}
          setShowPicker={setShowPicker}
          uploading={uploading}
          saving={saving}
        />
      )}

      <MediaPickerModal
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={url => setForm(f => ({ ...f, image: url }))}
      />
    </div>
  )
}