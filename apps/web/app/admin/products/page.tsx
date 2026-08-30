'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRANCHES, emptyStock, totalStock } from '@big-cms/shared/branches'
import { recordMediaUpload, uploadImage } from '@big-cms/shared/media'
import { exportGamesCSV } from '@big-cms/shared/productPurchases'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import MediaPickerModal from '../../components/admin/MediaPickerModal'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSearch } from '@fortawesome/free-solid-svg-icons'

interface Product {
  id: string
  name: string
  category: string
  description: string
  players: string
  duration: string
  age: string
  price: number
  wholesalePrice?: number | null
  salePrice?: number | null
  saleEndsAt?: string | null
  stock: Record<string, number>
  image: string
  // Issued once on create and never rewritten — see app/lib/skuFormat.ts.
  // Optional because products that predate the backfill may not carry one.
  sku?: string
}

const EMPTY = {
  name: '',
  category: '',
  description: '',
  players: '',
  duration: '',
  age: '',
  price: 0,
  wholesalePrice: null as number | null,
  salePrice: null as number | null,
  saleEndsAt: '' as string,
  image: '',
}

const FALLBACK_CATEGORIES = ['Strategy', 'Party', 'Family', 'Cooperative', 'Card', 'Trivia', 'RPG', 'Puzzle']

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
    setCategories(snap.docs.map(d => (d.data() as any).name))
  }

  useEffect(() => {
    loadGames()
    loadCategories()
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
      players:        product.players,
      duration:       product.duration,
      age:            product.age,
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
              Product Catalogue
            </h1>
          </div>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '0.8rem', width: isMobile ? '100%' : 'auto', flexWrap: 'wrap' }}>
            <button onClick={() => exportGamesCSV(products, false)} style={{
              backgroundColor: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(245,242,236,0.6)',
              padding: '0.7rem 1.2rem',
              borderRadius: '2px',
              fontSize: '0.72rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
            }}>Export Retail CSV</button>
            <button onClick={() => exportGamesCSV(products, true)} style={{
              backgroundColor: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(245,242,236,0.6)',
              padding: '0.7rem 1.2rem',
              borderRadius: '2px',
              fontSize: '0.72rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
            }}>Export Full CSV</button>
            <a href="/admin/products/import" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(245,242,236,0.6)',
              padding: '0.7rem 1.5rem',
              borderRadius: '2px',
              fontSize: '0.75rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
              textDecoration: 'none',
            }}>Bulk Import</a>
            <button onClick={openNew} style={{
              backgroundColor: 'var(--purple)',
              color: '#fff',
              padding: '0.7rem 1.5rem',
              border: 'none',
              borderRadius: '2px',
              fontSize: '0.75rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
            }}>+ Add Product</button>
          </div>
        </div>

        {/* Category Manager */}
        <div style={{ marginBottom: '2rem' }}>
          <button onClick={() => setShowCatManager(!showCatManager)} style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(245,242,236,0.5)',
            padding: '0.6rem 1.2rem',
            borderRadius: '2px',
            fontSize: '0.72rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: 'var(--font-inter)',
            marginBottom: '1rem',
          }}>
            {showCatManager ? 'Hide' : 'Manage'} Categories
          </button>

          {showCatManager && (
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '4px',
              padding: '1.5rem',
            }}>
              <p style={{
                fontSize: '0.68rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'rgba(245,242,236,0.3)',
                fontFamily: 'var(--font-inter)',
                marginBottom: '1rem',
              }}>Product Categories</p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                {displayCategories.map(cat => (
                  <div key={cat} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    backgroundColor: 'rgba(106,106,183,0.1)',
                    border: '1px solid rgba(106,106,183,0.2)',
                    borderRadius: '2px',
                    padding: '0.35rem 0.8rem',
                  }}>
                    <span style={{
                      fontFamily: 'var(--font-inter)',
                      fontSize: '0.82rem',
                      color: 'var(--offwhite)',
                    }}>{cat}</span>
                    {categories.length > 0 && (
                      <button onClick={() => deleteCategory(cat)} style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'rgba(228,51,41,0.6)',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        padding: '0',
                        lineHeight: 1,
                      }}>✕</button>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', maxWidth: '400px' }}>
                <input
                  type="text"
                  placeholder="New category name…"
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCategory()}
                  style={{
                    flex: 1,
                    backgroundColor: '#1a1a1a',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#F5F2EC',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '2px',
                    fontSize: '0.82rem',
                    outline: 'none',
                    fontFamily: 'var(--font-inter)',
                  }}
                />
                <button onClick={addCategory} disabled={addingCat || !newCategory.trim()} style={{
                  backgroundColor: 'var(--purple)',
                  border: 'none',
                  color: '#fff',
                  padding: '0.6rem 1rem',
                  borderRadius: '2px',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-inter)',
                  opacity: addingCat || !newCategory.trim() ? 0.5 : 1,
                }}>+ Add</button>
              </div>
            </div>
          )}
        </div>

        {/* Search + Category Filter */}
        {!loading && (
          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: '0.8rem',
            marginBottom: '1.5rem',
          }}>
            <div style={{ position: 'relative', flex: isMobile ? 'auto' : 2 }}>
              <FontAwesomeIcon icon={faSearch} style={{
                position: 'absolute',
                left: '1.1rem',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '15px',
                color: 'rgba(245,242,236,0.35)',
                pointerEvents: 'none',
              }} />
              <input
                type="text"
                placeholder="Search by name or category…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  ...inputStyle,
                  width: '100%',
                  padding: '1rem 1.2rem 1rem 2.8rem',
                  fontSize: '0.95rem',
                  borderRadius: '4px',
                }}
              />
            </div>
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              style={{
                ...inputStyle,
                color: '#F5F2EC',
                backgroundColor: '#1a1a1a',
                flex: isMobile ? 'auto' : '0 0 220px',
                padding: '1rem 1.2rem',
                fontSize: '0.95rem',
                borderRadius: '4px',
              }}
            >
              <option value="All">All Categories</option>
              {displayCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <p style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.78rem',
              color: 'rgba(245,242,236,0.35)',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              flex: '0 0 auto',
            }}>
              <span style={{ color: 'var(--offwhite)', fontFamily: 'var(--font-cinzel)', marginRight: '0.3rem' }}>{filteredGames.length}</span> of {products.length}
            </p>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <p style={{ color: 'rgba(245,242,236,0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
        ) : filteredGames.length === 0 ? (
          <div style={{
            border: '1px dashed rgba(255,255,255,0.08)',
            borderRadius: '4px',
            padding: '3rem',
            textAlign: 'center',
            color: 'rgba(245,242,236,0.2)',
            fontFamily: 'var(--font-inter)',
            fontSize: '0.85rem',
          }}>No products match these filters.</div>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {filteredGames.map(product => {
              const stock = totalStock(product.stock)
              return (
                <div key={product.id} style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '4px',
                  padding: '1rem 1.2rem',
                  display: 'flex',
                  gap: '1rem',
                }}>
                  {product.image && (
                    <img src={product.image} alt={product.name} style={{
                      width: '60px', height: '60px',
                      objectFit: 'cover', borderRadius: '2px',
                      flexShrink: 0,
                    }} />
                  )}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.95rem', color: 'var(--offwhite)' }}>{product.name}</p>
                    {product.sku && (
                      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'rgba(201,150,44,0.85)' }}>
                        {product.sku}
                      </p>
                    )}
                    <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.5)' }}>
                      {product.category} · {product.players}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--teal)' }}>
                        {product.price > 0 ? `$${product.price}` : '—'}
                      </span>
                      <span style={{
                        fontSize: '0.68rem',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '2px',
                        backgroundColor: stock > 0 ? 'rgba(0,160,152,0.15)' : 'rgba(228,51,41,0.15)',
                        color: stock > 0 ? 'var(--teal)' : 'var(--red)',
                        fontFamily: 'var(--font-inter)',
                      }}>
                        {stock > 0 ? `${stock} in stock` : 'Out of stock'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem' }}>
                      <button onClick={() => openEdit(product)} style={{
                        flex: 1,
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'rgba(245,242,236,0.5)',
                        padding: '0.5rem',
                        borderRadius: '2px',
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-inter)',
                      }}>Edit</button>
                      <button onClick={() => handleDelete(product.id)} style={{
                        flex: 1,
                        background: 'transparent',
                        border: '1px solid rgba(228,51,41,0.3)',
                        color: 'var(--red)',
                        padding: '0.5rem',
                        borderRadius: '2px',
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-inter)',
                      }}>Delete</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Image', 'Name', 'Category', 'Players', 'Retail', 'Wholesale', 'Stock', 'Actions'].map(h => (
                    <th key={h} style={{
                      padding: '1rem 1.2rem',
                      textAlign: 'left',
                      fontSize: '0.65rem',
                      letterSpacing: '0.2em',
                      textTransform: 'uppercase',
                      color: 'rgba(245,242,236,0.3)',
                      fontFamily: 'var(--font-inter)',
                      fontWeight: 400,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredGames.map(product => (
                  <tr key={product.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '0.8rem 1.2rem' }}>
                      {product.image && (
                        <img src={product.image} alt={product.name} style={{
                          width: '50px', height: '50px',
                          objectFit: 'cover', borderRadius: '2px',
                        }} />
                      )}
                    </td>
                    <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-cinzel)', fontSize: '0.9rem', color: 'var(--offwhite)' }}>
                      {product.name}
                      {product.sku && (
                        <span style={{ display: 'block', fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.08em', color: 'rgba(201,150,44,0.8)', marginTop: '0.15rem' }}>
                          {product.sku}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.5)' }}>{product.category}</td>
                    <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.5)' }}>{product.players}</td>
                    <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--teal)' }}>
                      {product.price > 0 ? `$${product.price}` : '—'}
                    </td>
                    <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.45)' }}>
                      {product.wholesalePrice != null ? `$${product.wholesalePrice}` : '—'}
                    </td>
                    <td style={{ padding: '1rem 1.2rem' }}>
                      {(() => {
                        const stock = totalStock(product.stock)
                        return (
                          <span style={{
                            fontSize: '0.72rem',
                            padding: '0.25rem 0.7rem',
                            borderRadius: '2px',
                            backgroundColor: stock > 0 ? 'rgba(0,160,152,0.15)' : 'rgba(228,51,41,0.15)',
                            color: stock > 0 ? 'var(--teal)' : 'var(--red)',
                            fontFamily: 'var(--font-inter)',
                          }}>
                            {stock > 0 ? `${stock} in stock` : 'Out of stock'}
                          </span>
                        )
                      })()}
                    </td>
                    <td style={{ padding: '1rem 1.2rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => openEdit(product)} style={{
                          background: 'transparent',
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: 'rgba(245,242,236,0.5)',
                          padding: '0.4rem 0.8rem',
                          borderRadius: '2px',
                          fontSize: '0.7rem',
                          cursor: 'pointer',
                          fontFamily: 'var(--font-inter)',
                        }}>Edit</button>
                        <button onClick={() => handleDelete(product.id)} style={{
                          background: 'transparent',
                          border: '1px solid rgba(228,51,41,0.3)',
                          color: 'var(--red)',
                          padding: '0.4rem 0.8rem',
                          borderRadius: '2px',
                          fontSize: '0.7rem',
                          cursor: 'pointer',
                          fontFamily: 'var(--font-inter)',
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

      {/* Full Screen Modal */}
      {open && (
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
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}>
            <h2 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.1rem' : '1.5rem', color: 'var(--offwhite)' }}>
              {editing ? 'Edit Product' : 'Add New Product'}
            </h2>
            <button onClick={() => setOpen(false)} style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(245,242,236,0.5)',
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
              borderRight: isMobile ? 'none' : '1px solid rgba(255,255,255,0.06)',
              borderBottom: isMobile ? '1px solid rgba(255,255,255,0.06)' : 'none',
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
                  style={{ ...inputStyle, color: '#F5F2EC', backgroundColor: '#1a1a1a' }}>
                  {displayCategories.map(c => (
                    <option key={c} value={c} style={{ backgroundColor: '#1a1a1a', color: '#F5F2EC' }}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Description</label>
                <textarea value={form.description} rows={4} required
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  style={{ ...inputStyle, resize: 'none' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Players (e.g. 2–4)</label>
                  <input type="text" value={form.players} required
                    onChange={e => setForm(f => ({ ...f, players: e.target.value }))}
                    style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Duration</label>
                  <input type="text" value={form.duration} required
                    onChange={e => setForm(f => ({ ...f, duration: e.target.value }))}
                    style={inputStyle} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Min Age (e.g. 8+)</label>
                  <input type="text" value={form.age} required
                    onChange={e => setForm(f => ({ ...f, age: e.target.value }))}
                    style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Retail Price ($)</label>
                  <input type="number" value={form.price} required min={0} step="0.01"
                    onChange={e => setForm(f => ({ ...f, price: +e.target.value }))}
                    style={inputStyle} />
                </div>
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
                  color: 'rgba(245,242,236,0.3)', marginTop: '0.4rem',
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
                        color: 'rgba(245,242,236,0.4)',
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
                  color: 'rgba(245,242,236,0.3)',
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
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(245,242,236,0.6)',
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
                  border: '1px solid rgba(255,255,255,0.06)',
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
                  border: '1px dashed rgba(255,255,255,0.1)',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(245,242,236,0.2)',
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
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(245,242,236,0.5)',
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
      )}

      <MediaPickerModal
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={url => setForm(f => ({ ...f, image: url }))}
      />
    </div>
  )
}