'use client'

import { useEffect, useState, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import Navbar from '../components/layout/Navbar'
import Footer from '../components/layout/Footer'
import Skeleton from '../components/Skeleton'
import Link from 'next/link'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faUsers, faClock, faCakeCandles, faSearch, faXmark } from '@fortawesome/free-solid-svg-icons'
import { normalizeStock } from '../lib/branches'
import { BRAND } from '../lib/brand'

// This list is one branch's shelf, so stock comes from that branch alone
// rather than the summed total the shop and wholesale pages show.
const BRANCH = BRAND.branches[0]

interface Product {
  id: string
  name: string
  category: string
  players: string
  duration: string
  age: string
  price: number
  stock: number
  image: string
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

function ProductCard({ product }: { product: Product }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${hovered ? 'rgba(0,160,152,0.4)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: '6px',
        overflow: 'hidden',
        transition: 'all 0.22s ease',
        transform: hovered ? 'translateY(-3px)' : 'none',
        boxShadow: hovered ? '0 8px 32px rgba(0,0,0,0.35)' : 'none',
      }}
    >
      <Link href={`/shop/${product.id}`} style={{ textDecoration: 'none' }}>
        <div style={{ position: 'relative', width: '100%', paddingTop: '66%', overflow: 'hidden', background: '#ffffff' }}>
          {product.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image}
              alt={product.name}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'contain',
                transition: 'transform 0.4s ease',
                transform: hovered ? 'scale(1.04)' : 'scale(1)',
              }}
            />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'rgba(255,255,255,0.1)', fontSize: '2.5rem' }}>🎲</span>
            </div>
          )}

          {product.price > 0 && (
            <div style={{
              position: 'absolute', top: '0.6rem', right: '0.6rem',
              background: '#C9962C', color: '#000',
              padding: '0.25rem 0.6rem', borderRadius: '3px',
              fontSize: '0.8rem', fontWeight: 700, fontFamily: 'var(--font-inter)', whiteSpace: 'nowrap',
            }}>
              ${product.price.toFixed(2)}
            </div>
          )}

          <div style={{
            position: 'absolute', top: '0.6rem', left: '0.6rem',
            background: 'rgba(0,160,152,0.85)', color: '#fff',
            padding: '0.2rem 0.55rem', borderRadius: '3px',
            fontSize: '0.65rem', fontFamily: 'var(--font-inter)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            {product.stock} in stock
          </div>
        </div>
      </Link>

      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1 }}>
        <Link href={`/shop/${product.id}`} style={{ textDecoration: 'none' }}>
          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.92rem', color: 'var(--offwhite)', lineHeight: 1.3 }}>
            {product.name}
          </p>
        </Link>

        {product.category && (
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--purple)' }}>
            {product.category}
          </span>
        )}

        <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '0.4rem' }}>
          {product.players && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)' }}>
              <FontAwesomeIcon icon={faUsers} style={{ width: '11px' }} />{product.players}
            </span>
          )}
          {product.duration && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)' }}>
              <FontAwesomeIcon icon={faClock} style={{ width: '11px' }} />{product.duration}
            </span>
          )}
          {product.age && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)' }}>
              <FontAwesomeIcon icon={faCakeCandles} style={{ width: '11px' }} />{product.age}+
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PriceListPage() {
  const [products, setGames]           = useState<Product[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [category, setCategory]     = useState('All')
  const [categories, setCategories] = useState<string[]>([])
  const isMobile = useIsMobile()

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [gamesSnap, catSnap] = await Promise.all([
        getDocs(collection(db, 'products')),
        getDocs(collection(db, 'productCategories')),
      ])
      if (cancelled) return
      const all = gamesSnap.docs.map(d => {
        const data = d.data()
        return {
          id: d.id,
          name:     (data.name as string) ?? '',
          category: (data.category as string) ?? '',
          players:  (data.players as string) ?? '',
          duration: (data.duration as string) ?? '',
          age:      (data.age as string) ?? '',
          price:    (data.price as number) ?? 0,
          stock:    normalizeStock(data.stock)[BRANCH],
          image:    (data.image as string) ?? '',
        } as Product
      })
      const listed = all
        .filter(g => g.stock > 0)
        .sort((a, b) => a.name.localeCompare(b.name))
      setGames(listed)

      // Only categories that something on this page actually belongs to —
      // the full productCategories list would offer filters that return nothing.
      //
      // Matched case-insensitively on purpose: productCategories holds both
      // "Strategy" and "strategy" (and "Family"/"family", "Party"/"party
      // products"), and the products are split across both spellings. Comparing
      // exactly would list them as two options, each hiding the other's products.
      const present = new Map<string, string>()
      for (const g of listed) {
        const c = g.category.trim()
        if (c && !present.has(c.toLowerCase())) present.set(c.toLowerCase(), c)
      }
      // The catalogue drives ordering and preferred spelling; anything it
      // doesn't know about is appended so an off-list category can't vanish.
      const seen = new Set<string>()
      const ordered: string[] = []
      for (const raw of catSnap.docs.map(d => (d.data() as { name: string }).name.trim())) {
        const key = raw.toLowerCase()
        if (present.has(key) && !seen.has(key)) { seen.add(key); ordered.push(raw) }
      }
      for (const [key, label] of present) {
        if (!seen.has(key)) { seen.add(key); ordered.push(label) }
      }
      setCategories(ordered)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => products.filter(g => {
    const matchCat    = category === 'All' || g.category.trim().toLowerCase() === category.trim().toLowerCase()
    const matchSearch = !search || g.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  }), [products, search, category])

  const allCats = useMemo(() => ['All', ...categories], [categories])

  return (
    <>
      <Navbar />
      <main style={{ minHeight: '100vh', backgroundColor: 'var(--black)', paddingTop: '5rem' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '2rem 1.25rem 4rem' : '3rem 2rem 6rem' }}>

          <div style={{ marginBottom: '2.5rem' }}>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.25em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: '0.6rem' }}>
              {BRAND.name} — {BRANCH}
            </p>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.8rem' : '2.5rem', color: 'var(--offwhite)', marginBottom: '0.5rem' }}>
              Price List
            </h1>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'rgba(245,242,236,0.4)' }}>
              Everything currently in stock at our {BRANCH} branch.
            </p>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '0.75rem', marginBottom: '2rem', alignItems: isMobile ? 'stretch' : 'center' }}>
            <div style={{ position: 'relative', flex: isMobile ? undefined : '0 0 260px' }}>
              <FontAwesomeIcon icon={faSearch} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', width: '13px', color: 'rgba(245,242,236,0.3)', pointerEvents: 'none' }} />
              <input
                type="search" placeholder="Search products…" value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--offwhite)', padding: '0.7rem 1rem 0.7rem 2.4rem', borderRadius: '4px', fontSize: '0.85rem', outline: 'none', fontFamily: 'var(--font-inter)', boxSizing: 'border-box' }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(245,242,236,0.35)', cursor: 'pointer', padding: 0 }}>
                  <FontAwesomeIcon icon={faXmark} style={{ width: '13px' }} />
                </button>
              )}
            </div>

            <select
              value={category} onChange={e => setCategory(e.target.value)}
              style={{ flex: isMobile ? undefined : '0 0 200px', background: '#1c1c1c', border: '1px solid rgba(255,255,255,0.15)', color: '#F5F2EC', padding: '0.7rem 1rem', borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'var(--font-inter)', outline: 'none', cursor: 'pointer' }}
            >
              {allCats.map(cat => (
                <option key={cat} value={cat} style={{ background: '#1c1c1c', color: '#F5F2EC' }}>{cat}</option>
              ))}
            </select>
          </div>

          {!loading && (
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.25)', marginBottom: '1.5rem', letterSpacing: '0.06em' }}>
              {filtered.length} product{filtered.length !== 1 ? 's' : ''} in stock at {BRANCH}
            </p>
          )}

          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '1.25rem' }}>
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height="320px" borderRadius="6px" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '6px', padding: '4rem', textAlign: 'center', color: 'rgba(245,242,236,0.2)', fontFamily: 'var(--font-inter)', fontSize: '0.88rem' }}>
              {products.length === 0 ? `Nothing is currently in stock at ${BRANCH}.` : 'No products match your filters.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '1.25rem' }}>
              {filtered.map(product => <ProductCard key={product.id} product={product} />)}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
