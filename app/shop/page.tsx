'use client'

import { useEffect, useState, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import Navbar from '../components/layout/Navbar'
import Footer from '../components/layout/Footer'
import Skeleton from '../components/Skeleton'
import Link from 'next/link'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSearch, faSliders, faXmark } from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { totalStock } from '../lib/branches'
import { searchItems, highlight, snippet } from '../lib/productSearch'
import { PLACEHOLDER } from '../lib/placeholderAssets'

// The stored documents still carry the board-game-era `players`, `duration`
// and `age` fields (Manage Games still writes them). This page no longer reads
// them, so they're left off the interface rather than declared and ignored —
// anything that isn't rendered here shouldn't look like it might be.
interface Product {
  id: string
  name: string
  category: string
  description: string
  stock: Record<string, number>
  price: number
  image: string
}

function truncate(text: string, words: number) {
  const arr = text.split(' ')
  return arr.length > words ? arr.slice(0, words).join(' ') + '…' : text
}

// Declared at module scope, NOT inside ShopPage's render body. A component
// defined inside another component is a new type on every render, so React
// unmounts and remounts it — which would restart the card's hover transitions
// on every keystroke in the search box. See CONTRIBUTING.md.
function Highlighted({ text, query }: { text: string; query: string }) {
  const segments = highlight(text, query)
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} style={{
            background: 'rgba(106,106,183,0.32)',
            color: 'var(--offwhite)',
            borderRadius: '2px',
            padding: '0 0.1em',
          }}>{seg.text}</mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  )
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

function FilterSection({
  title, icon, collapsed, onToggle, children, maxHeight = '500px',
}: {
  title: string
  icon?: IconDefinition
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
  maxHeight?: string
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div>
      <button onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          background: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${hovered ? 'rgba(106,106,183,0.4)' : 'rgba(255,255,255,0.06)'}`,
          padding: '0 0 0.8rem',
          marginBottom: collapsed ? '0' : '0.8rem',
          cursor: 'pointer',
          transition: 'border-color 0.2s ease',
        }}>
        <span style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.65rem',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: hovered ? 'rgba(245,242,236,0.6)' : 'rgba(245,242,236,0.3)',
          fontFamily: 'var(--font-inter)',
          transition: 'color 0.2s ease',
        }}>
          {icon && <FontAwesomeIcon icon={icon} style={{ width: '12px' }} />}
          {title}
        </span>
        <span style={{
          color: 'var(--purple)',
          fontSize: '0.6rem',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
        }}>▼</span>
      </button>
      <div style={{
        maxHeight: collapsed ? '0' : maxHeight,
        overflow: 'hidden',
        transition: 'max-height 0.4s ease',
      }}>
        {children}
      </div>
    </div>
  )
}

export default function ShopPage() {
  const [products, setProducts]               = useState<Product[]>([])
  const [loading, setLoading]           = useState(true)
  const [filter, setFilter]             = useState('All')
  const [search, setSearch]             = useState('')
  const [maxPrice, setMaxPrice]         = useState<number | null>(null)
  const [sliderMax, setSliderMax]       = useState<number>(200)
  const [hoveredId, setHoveredId]       = useState<string | null>(null)
  const [dbCategories, setDbCategories] = useState<string[]>([])
  const isMobile = useIsMobile()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [hoveredCat, setHoveredCat] = useState<string | null>(null)
  const [resetHovered, setResetHovered] = useState(false)
  const [mobileSearchHovered, setMobileSearchHovered] = useState(false)
  const [filterTabHovered, setFilterTabHovered] = useState(false)
  const [closeFiltersHovered, setCloseFiltersHovered] = useState(false)
  const [collapsedFilters, setCollapsedFilters] = useState<Record<string, boolean>>({
    search: true,
    category: true,
    price: true,
  })

  function toggleFilter(key: string) {
    setCollapsedFilters(prev => ({ ...prev, [key]: !prev[key] }))
  }

  useEffect(() => {
    async function load() {
      // The COLLECTION names are still `games`/`gameCategories`. This page's
      // language is generic now, but renaming a Firestore collection is a data
      // migration plus a rules change, not a find-and-replace — so the storage
      // names stay until that's done deliberately. Admin still says "Games"
      // for the same reason.
      const [productsSnap, catSnap] = await Promise.all([
        getDocs(collection(db, 'games')),
        getDocs(collection(db, 'gameCategories')),
      ])

      const loadedProducts = productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Product))
      const cats        = catSnap.docs
        .map(d => (d.data() as { name?: string }).name ?? '')
        .filter(Boolean)

      const highestPrice = loadedProducts.length > 0
        ? Math.max(...loadedProducts.map(g => g.price ?? 0))
        : 200

      setProducts(loadedProducts)
      setDbCategories(cats)
      setSliderMax(highestPrice)
      setMaxPrice(highestPrice)
      setLoading(false)
    }
    load()
  }, [])

  const CATEGORIES = useMemo(() => {
    const cats = dbCategories.length > 0
      ? dbCategories
      : ['Featured', 'New Arrivals', 'Accessories', 'Gifts', 'Home', 'Stationery', 'Apparel', 'Clearance']
    return ['All', ...cats]
  }, [dbCategories])

  // Filter first, rank second. Category and price are hard constraints — a
  // product outside them is not a worse result, it's not a result — so they
  // must not compete with relevance. searchItems() then orders what survives,
  // and preserves the incoming order when the query is empty, which is why the
  // alphabetical sort happens here rather than after.
  const filtered = useMemo(() => {
    const constrained = products
      .filter(p => filter === 'All' || p.category === filter)
      .filter(p => maxPrice === null || (p.price ?? 0) <= maxPrice)
      .sort((a, b) => a.name.localeCompare(b.name))

    return searchItems(constrained, search)
  }, [products, filter, search, maxPrice])

  const searching = search.trim().length > 0

  const PAGE_SIZE = 20
  const [page, setPage] = useState(1)

  // Reset to page 1 whenever the result set changes underneath us — a new
  // query's best matches are on page 1, and staying on page 4 of the previous
  // results shows an arbitrary slice of the new ones.
  //
  // Adjusted during render rather than from an effect. The effect version
  // (`useEffect(() => setPage(1), [filter, search, maxPrice])`) rendered the
  // stale page once, then re-rendered — a visible flash of the wrong slice on
  // every keystroke. React re-runs this component immediately on a render-
  // phase setState, before touching the DOM, so nothing wrong is ever painted.
  const resultKey = `${filter}|${search.trim()}|${maxPrice}`
  const [prevResultKey, setPrevResultKey] = useState(resultKey)
  if (resultKey !== prevResultKey) {
    setPrevResultKey(resultKey)
    setPage(1)
  }

  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visibleProducts = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function goToPage(p: number) {
    setPage(p)
    scrollToTop()
  }

  function reset() {
    setSearch('')
    setFilter('All')
    setMaxPrice(sliderMax)
  }

  const filterFields = (
    <>
      {/* Search */}
      <FilterSection title="Search" icon={faSearch} maxHeight="100px"
        collapsed={collapsedFilters.search} onToggle={() => toggleFilter('search')}>
        <div style={{ position: 'relative' }}>
          <FontAwesomeIcon icon={faSearch} style={{
            position: 'absolute',
            left: '0.9rem',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '13px',
            color: 'rgba(245,242,236,0.3)',
            pointerEvents: 'none',
          }} />
          <input
            type="search"
            placeholder="Search products…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--offwhite)',
              padding: '0.75rem 1rem 0.75rem 2.5rem',
              borderRadius: '4px',
              fontSize: '0.85rem',
              outline: 'none',
              fontFamily: 'var(--font-inter)',
            }}
          />
        </div>
      </FilterSection>

      {/* Category */}
      <FilterSection title="Category" icon={faSliders} maxHeight="320px"
        collapsed={collapsedFilters.category} onToggle={() => toggleFilter('category')}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.3rem',
          maxHeight: '260px',
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          padding: '0.6rem',
          borderRadius: '8px',
          background: 'rgba(106,106,183,0.1)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid rgba(106,106,183,0.25)',
        }}>
          {CATEGORIES.map(cat => {
            const active = filter === cat
            const hov = hoveredCat === cat
            return (
              <button key={cat} onClick={() => setFilter(cat)}
                onMouseEnter={() => setHoveredCat(cat)}
                onMouseLeave={() => setHoveredCat(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderLeft: `2px solid ${active ? 'var(--purple)' : hov ? 'rgba(106,106,183,0.5)' : 'transparent'}`,
                  color: active ? 'var(--offwhite)' : hov ? 'var(--offwhite)' : 'rgba(245,242,236,0.55)',
                  padding: '0.5rem 0.8rem',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-inter)',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  borderRadius: '0 4px 4px 0',
                  background: active ? 'rgba(106,106,183,0.25)' : hov ? 'rgba(106,106,183,0.12)' : 'transparent',
                  flexShrink: 0,
                }}>{cat}</button>
            )
          })}
        </div>
      </FilterSection>

      {/* Price Range */}
      <FilterSection title="Max Price" maxHeight="200px"
        collapsed={collapsedFilters.price} onToggle={() => toggleFilter('price')}>
        <p style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: '1.5rem',
          color: 'var(--purple)',
          marginBottom: '1rem',
        }}>${maxPrice ?? sliderMax}</p>
        <input
          type="range"
          min={0}
          max={sliderMax}
          value={maxPrice ?? sliderMax}
          onChange={e => setMaxPrice(+e.target.value)}
          style={{
            width: '100%',
            accentColor: 'var(--purple)',
            cursor: 'pointer',
            height: '4px',
          }}
        />
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '0.4rem',
          fontSize: '0.68rem',
          color: 'rgba(245,242,236,0.25)',
          fontFamily: 'var(--font-inter)',
        }}>
          <span>$0</span>
          <span>${sliderMax}</span>
        </div>
      </FilterSection>

      <div style={{ height: '1px', backgroundColor: 'rgba(255,255,255,0.06)' }} />

      {/* Results + Reset */}
      <div>
        <p style={{
          fontFamily: 'var(--font-inter)',
          fontSize: '0.78rem',
          color: 'rgba(245,242,236,0.35)',
          marginBottom: '0.8rem',
        }}>
          <span style={{ color: 'var(--offwhite)', fontFamily: 'var(--font-cinzel)' }}>{filtered.length}</span>
          {searching
            ? <> {filtered.length === 1 ? 'result' : 'results'} for &ldquo;{search.trim()}&rdquo;</>
            : <> of {products.length} products</>}
        </p>
        <button onClick={reset}
          onMouseEnter={() => setResetHovered(true)}
          onMouseLeave={() => setResetHovered(false)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            background: resetHovered ? 'rgba(255,255,255,0.06)' : 'transparent',
            border: `1px solid ${resetHovered ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
            color: resetHovered ? 'var(--offwhite)' : 'rgba(245,242,236,0.4)',
            padding: '0.6rem',
            borderRadius: '4px',
            fontSize: '0.72rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: 'var(--font-inter)',
            transition: 'all 0.2s ease',
          }}>
          <FontAwesomeIcon icon={faXmark} style={{ width: '12px' }} />
          Reset Filters
        </button>

        {isMobile && (
          <button onClick={() => setFiltersOpen(false)}
            onMouseEnter={() => setMobileSearchHovered(true)}
            onMouseLeave={() => setMobileSearchHovered(false)}
            style={{
              width: '100%',
              marginTop: '0.6rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              background: mobileSearchHovered ? 'rgba(106,106,183,0.8)' : 'var(--purple)',
              border: 'none',
              color: '#fff',
              padding: '0.8rem',
              borderRadius: '4px',
              fontSize: '0.78rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
              boxShadow: mobileSearchHovered ? '0 8px 16px rgba(106,106,183,0.4)' : 'none',
              transition: 'all 0.2s ease',
            }}>
            <FontAwesomeIcon icon={faSearch} style={{ width: '12px' }} />
            Search ({filtered.length})
          </button>
        )}
      </div>
    </>
  )

  return (
    <>
      <Navbar />
      <main>

        {/* Hero */}
        <section style={{
          position: 'relative',
          height: '55vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'url(https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=1200&q=80)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }} />
          <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)' }} />
          <div style={{ position: 'relative', zIndex: 1, paddingTop: '4rem' }}>
            <p style={{
              fontSize: '0.7rem',
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              color: 'var(--purple)',
              marginBottom: '1rem',
              fontFamily: 'var(--font-inter)',
            }}>Product Catalogue</p>
            <h1 style={{
              fontFamily: 'var(--font-cinzel)',
              fontSize: '3.5rem',
              color: 'var(--offwhite)',
              lineHeight: 1.2,
            }}>
              Browse the<br />Full Range
            </h1>
          </div>
        </section>

        {/* Main content */}
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: isMobile ? '2.5rem 1.25rem' : '5rem 3rem',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '260px 1fr',
          gap: isMobile ? '1.5rem' : '3rem',
          alignItems: 'start',
        }}>

          {/* LEFT SIDEBAR — desktop only, always visible */}
          {!isMobile && (
            <div style={{
              position: 'sticky',
              top: '90px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2rem',
            }}>
              {filterFields}
            </div>
          )}

          {/* Mobile filter tab — fixed, vertically centered on the left edge */}
          {isMobile && !filtersOpen && (
            <button onClick={() => setFiltersOpen(true)}
              onMouseEnter={() => setFilterTabHovered(true)}
              onMouseLeave={() => setFilterTabHovered(false)}
              style={{
                position: 'fixed',
                left: 0,
                top: '50%',
                transform: filterTabHovered ? 'translateY(-50%) translateX(3px)' : 'translateY(-50%)',
                zIndex: 60,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.4rem',
                background: filterTabHovered ? 'rgba(106,106,183,0.85)' : 'var(--purple)',
                border: 'none',
                color: '#fff',
                padding: '1rem 0.6rem',
                borderRadius: '0 6px 6px 0',
                fontSize: '0.65rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontFamily: 'var(--font-inter)',
                boxShadow: filterTabHovered ? '6px 0 16px rgba(0,0,0,0.5)' : '4px 0 12px rgba(0,0,0,0.4)',
                transition: 'all 0.2s ease',
              }}>
              <FontAwesomeIcon icon={faSliders} style={{ width: '13px' }} />
              Filters
            </button>
          )}

          {/* Backdrop — closes the panel when tapped outside it */}
          {isMobile && filtersOpen && (
            <div onClick={() => setFiltersOpen(false)} style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              zIndex: 59,
            }} />
          )}

          {/* Mobile filter panel — slides in from the left, covers half the page */}
          {isMobile && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              bottom: 0,
              width: '50%',
              backgroundColor: 'var(--black)',
              borderRight: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '8px 0 24px rgba(0,0,0,0.6)',
              zIndex: 60,
              overflowY: 'auto',
              padding: '0 1.25rem 2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.75rem',
              transform: filtersOpen ? 'translateX(0)' : 'translateX(-100%)',
              transition: 'transform 0.3s ease',
            }}>
              {/* Header — pinned, with close button */}
              <div style={{
                position: 'sticky',
                top: 0,
                backgroundColor: 'var(--black)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1.5rem 0 1rem',
                marginBottom: '-0.5rem',
                zIndex: 1,
              }}>
                <p style={{
                  fontFamily: 'var(--font-cinzel)',
                  fontSize: '1rem',
                  color: 'var(--offwhite)',
                }}>Filters</p>
                <button onClick={() => setFiltersOpen(false)} aria-label="Close filters"
                  onMouseEnter={() => setCloseFiltersHovered(true)}
                  onMouseLeave={() => setCloseFiltersHovered(false)}
                  style={{
                    background: closeFiltersHovered ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border: `1px solid ${closeFiltersHovered ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
                    color: closeFiltersHovered ? 'var(--offwhite)' : 'rgba(245,242,236,0.6)',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    lineHeight: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: closeFiltersHovered ? 'rotate(90deg)' : 'none',
                    transition: 'all 0.25s ease',
                  }}>
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>

              {filterFields}
            </div>
          )}

          {/* RIGHT — Product grid */}
          <div>
            {loading ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
                gap: isMobile ? '0.75rem' : '1.5rem',
              }}>
                {Array.from({ length: isMobile ? 4 : 6 }).map((_, i) => (
                  <div key={i} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                    <Skeleton height={isMobile ? '120px' : '200px'} borderRadius="0" />
                    <div style={{ padding: isMobile ? '0.8rem' : '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <Skeleton width="70%" height="1rem" />
                      <Skeleton width="45%" height="0.8rem" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '5rem',
                color: 'rgba(245,242,236,0.2)',
                fontFamily: 'var(--font-inter)',
              }}>
                <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>
                  {searching
                    ? <>Nothing matches &ldquo;{search.trim()}&rdquo;</>
                    : 'No products found'}
                </p>
                <p style={{ fontSize: '0.82rem' }}>
                  {searching && filter !== 'All'
                    ? <>Nothing in {filter} matched. Try All categories, or a different search.</>
                    : searching
                      ? 'Try fewer words, or a different spelling.'
                      : 'Try adjusting your filters'}
                </p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
                gap: isMobile ? '0.75rem' : '1.5rem',
              }}>
                {visibleProducts.map(product => {
                  const stock       = totalStock(product.stock)
                  const outOfStock  = stock === 0
                  const hovered     = hoveredId === product.id
                  return (
                    <Link key={product.id} href={`/shop/${product.id}`}
                      onMouseEnter={() => setHoveredId(product.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      style={{
                        background: 'rgba(255,255,255,0.02)',
                        border: `1px solid ${hovered && !outOfStock ? 'rgba(106,106,183,0.4)' : 'rgba(255,255,255,0.06)'}`,
                        borderRadius: '4px',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        textDecoration: 'none',
                        cursor: 'pointer',
                        opacity: outOfStock ? 0.6 : 1,
                        transition: 'border-color 0.2s, opacity 0.2s',
                        position: 'relative',
                      }}>

                      {/* Out of stock banner */}
                      {outOfStock && (
                        <div style={{
                          position: 'absolute',
                          top: '1rem', left: 0, right: 0,
                          textAlign: 'center',
                          zIndex: 2,
                        }}>
                          <span style={{
                            backgroundColor: 'rgba(228,51,41,0.9)',
                            color: '#fff',
                            padding: '0.3rem 1rem',
                            fontSize: '0.65rem',
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            fontFamily: 'var(--font-inter)',
                            borderRadius: '2px',
                          }}>Out of Stock</span>
                        </div>
                      )}

                      {/* Image */}
                      <div style={{
                        backgroundColor: '#fff',
                        padding: isMobile ? '0.6rem' : '1rem',
                        height: isMobile ? '120px' : '200px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        flexShrink: 0,
                      }}>
                        <img
                          src={product.image || PLACEHOLDER.product}
                          alt={product.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            filter: outOfStock ? 'grayscale(60%)' : 'none',
                            transform: hovered && !outOfStock ? 'scale(1.08)' : 'scale(1)',
                            transition: 'transform 0.35s ease, filter 0.3s ease',
                          }}
                        />
                      </div>

                      {/* Content */}
                      <div style={{
                        padding: isMobile ? '0.8rem' : '1.2rem',
                        display: 'flex',
                        flexDirection: 'column',
                        flex: 1,
                        gap: '0.6rem',
                      }}>
                        <span style={{
                          display: 'inline-block',
                          backgroundColor: 'rgba(50,50,124,0.3)',
                          color: 'rgba(245,242,236,0.6)',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '2px',
                          fontSize: '0.65rem',
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          fontFamily: 'var(--font-inter)',
                          width: 'fit-content',
                        }}>{product.category}</span>

                        <h3 style={{
                          fontFamily: 'var(--font-cinzel)',
                          fontSize: isMobile ? '0.85rem' : '1rem',
                          color: 'var(--offwhite)',
                        }}><Highlighted text={product.name} query={search} /></h3>

                        {!isMobile && (
                          <p style={{
                            fontFamily: 'var(--font-inter)',
                            fontSize: '0.78rem',
                            color: 'rgba(245,242,236,0.4)',
                            lineHeight: 1.6,
                          }}>
                            <Highlighted text={searching ? snippet(product.description, search) : truncate(product.description, 10)} query={search} />
                          </p>
                        )}

                        <div style={{
                          marginTop: 'auto',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingTop: '0.6rem',
                          borderTop: '1px solid rgba(255,255,255,0.05)',
                        }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            {product.price > 0 && (
                              <span style={{
                                fontFamily: 'var(--font-cinzel)',
                                fontSize: isMobile ? '1rem' : '1.2rem',
                                color: 'var(--purple)',
                              }}>${product.price}</span>
                            )}
                            <span style={{
                              fontFamily: 'var(--font-inter)',
                              fontSize: isMobile ? '0.6rem' : '0.68rem',
                              color: outOfStock ? 'var(--red)' : 'var(--teal)',
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                            }}>
                              {outOfStock ? 'Out of stock' : `${stock} in stock`}
                            </span>
                          </div>
                          {!isMobile && (
                            <span style={{
                              fontFamily: 'var(--font-inter)',
                              fontSize: '0.7rem',
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                              color: hovered && !outOfStock ? 'var(--purple)' : 'rgba(245,242,236,0.3)',
                              transition: 'color 0.2s',
                            }}>
                              Learn More →
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                marginTop: '2.5rem',
                flexWrap: 'wrap',
              }}>
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 1}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: page === 1 ? 'rgba(245,242,236,0.2)' : 'rgba(245,242,236,0.6)',
                    padding: '0.5rem 1rem',
                    borderRadius: '2px',
                    fontSize: '0.78rem',
                    cursor: page === 1 ? 'default' : 'pointer',
                    fontFamily: 'var(--font-inter)',
                  }}
                >← Prev</button>

                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                  const active = p === page
                  if (totalPages > 7 && Math.abs(p - page) > 2 && p !== 1 && p !== totalPages) {
                    if (p === 2 || p === totalPages - 1) return <span key={p} style={{ color: 'rgba(245,242,236,0.2)', fontFamily: 'var(--font-inter)', fontSize: '0.78rem' }}>…</span>
                    return null
                  }
                  return (
                    <button key={p} onClick={() => goToPage(p)} style={{
                      background: active ? 'var(--purple)' : 'transparent',
                      border: `1px solid ${active ? 'var(--purple)' : 'rgba(255,255,255,0.1)'}`,
                      color: active ? '#fff' : 'rgba(245,242,236,0.5)',
                      width: '36px', height: '36px',
                      borderRadius: '2px',
                      fontSize: '0.78rem',
                      cursor: active ? 'default' : 'pointer',
                      fontFamily: 'var(--font-inter)',
                    }}>{p}</button>
                  )
                })}

                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page === totalPages}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: page === totalPages ? 'rgba(245,242,236,0.2)' : 'rgba(245,242,236,0.6)',
                    padding: '0.5rem 1rem',
                    borderRadius: '2px',
                    fontSize: '0.78rem',
                    cursor: page === totalPages ? 'default' : 'pointer',
                    fontFamily: 'var(--font-inter)',
                  }}
                >Next →</button>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}