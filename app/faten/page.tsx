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

// This page used to be hardcoded to a branch called "Faten" — one of the
// original café's locations, and not a branch any more. Every read of
// stock['Faten'] returned 0, so the page rendered permanently empty. It now
// follows whichever branch is configured first.
const BRANCH = BRAND.branches[0]

interface Game {
  id: string
  name: string
  category: string
  players: string
  duration: string
  age: string
  wholesalePrice: number
  retailPrice: number
  stock: unknown
  image: string
  fatenStock: number
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

function GameCard({ game }: { game: Game }) {
  const [hovered, setHovered] = useState(false)
  const inStock = game.fatenStock > 0

  return (
    <Link
      href={`/shop/${game.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textDecoration: 'none',
        display: 'flex',
        flexDirection: 'column',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${hovered ? 'rgba(201,150,44,0.4)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: '6px',
        overflow: 'hidden',
        transition: 'all 0.22s ease',
        transform: hovered ? 'translateY(-3px)' : 'none',
        boxShadow: hovered ? '0 8px 32px rgba(0,0,0,0.35)' : 'none',
      }}
    >
      {/* Image */}
      <div style={{ position: 'relative', width: '100%', paddingTop: '66%', overflow: 'hidden', background: '#ffffff' }}>
        {game.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.image}
            alt={game.name}
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

        {/* Price badges — stacked top-right */}
        <div style={{ position: 'absolute', top: '0.6rem', right: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-end' }}>
          {game.wholesalePrice > 0 && (
            <div style={{ background: '#6A6AB7', color: '#fff', padding: '0.22rem 0.55rem', borderRadius: '3px', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--font-inter)', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
              WS ${game.wholesalePrice.toFixed(2)}
            </div>
          )}
          {game.retailPrice > 0 && (
            <div style={{ background: '#C9962C', color: '#000', padding: '0.22rem 0.55rem', borderRadius: '3px', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--font-inter)', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
              RP ${game.retailPrice.toFixed(2)}
            </div>
          )}
        </div>

        {/* Branch stock badge */}
        <div style={{
          position: 'absolute', top: '0.6rem', left: '0.6rem',
          background: inStock ? 'rgba(0,160,152,0.85)' : 'rgba(228,51,41,0.75)',
          color: '#fff',
          padding: '0.2rem 0.55rem',
          borderRadius: '3px',
          fontSize: '0.65rem',
          fontFamily: 'var(--font-inter)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {inStock ? `${game.fatenStock} in stock` : 'Out of stock'}
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1 }}>
        <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.92rem', color: 'var(--offwhite)', lineHeight: 1.3 }}>
          {game.name}
        </p>

        {game.category && (
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--purple)' }}>
            {game.category}
          </span>
        )}

        {game.wholesalePrice > 0 && game.retailPrice > 0 && (
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.28)', marginTop: '0.1rem' }}>
            Margin ${(game.retailPrice - game.wholesalePrice).toFixed(2)}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '0.4rem' }}>
          {game.players && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)' }}>
              <FontAwesomeIcon icon={faUsers} style={{ width: '11px' }} />
              {game.players}
            </span>
          )}
          {game.duration && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)' }}>
              <FontAwesomeIcon icon={faClock} style={{ width: '11px' }} />
              {game.duration}
            </span>
          )}
          {game.age && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)' }}>
              <FontAwesomeIcon icon={faCakeCandles} style={{ width: '11px' }} />
              {game.age}+
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

export default function BranchCataloguePage() {
  const [games, setGames]           = useState<Game[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [category, setCategory]     = useState('All')
  const [stockOnly, setStockOnly]   = useState(true)
  const [categories, setCategories] = useState<string[]>([])
  const isMobile = useIsMobile()

  useEffect(() => {
    async function load() {
      const [gamesSnap, catSnap] = await Promise.all([
        getDocs(collection(db, 'games')),
        getDocs(collection(db, 'gameCategories')),
      ])
      const all = gamesSnap.docs.map(d => {
        const stock = normalizeStock(d.data().stock)
        return {
          id: d.id,
          name:           (d.data().name as string) ?? '',
          category:       (d.data().category as string) ?? '',
          players:        (d.data().players as string) ?? '',
          duration:       (d.data().duration as string) ?? '',
          age:            (d.data().age as string) ?? '',
          wholesalePrice: (d.data().wholesalePrice as number) ?? 0,
          retailPrice:    (d.data().price as number) ?? 0,
          stock:          d.data().stock,
          image:          (d.data().image as string) ?? '',
          fatenStock:     stock[BRANCH] ?? 0,
        } as Game
      })
      const faten = all.filter(g => g.fatenStock > 0)
      const cats = catSnap.docs.map(d => (d.data() as { name: string }).name)
      setGames(faten)
      setCategories(cats.length > 0 ? cats : ['Strategy', 'Party', 'Family', 'Cooperative', 'Card', 'Trivia', 'RPG', 'Puzzle'])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    return games.filter(g => {
      const matchCat    = category === 'All' || g.category === category
      const matchSearch = !search || g.name.toLowerCase().includes(search.toLowerCase())
      const matchStock  = !stockOnly || g.fatenStock > 0
      return matchCat && matchSearch && matchStock
    })
  }, [games, search, category, stockOnly])

  const allCats = useMemo(() => ['All', ...categories], [categories])

  return (
    <>
      <Navbar />
      <main style={{ minHeight: '100vh', backgroundColor: 'var(--black)', paddingTop: '5rem' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '2rem 1.25rem 4rem' : '3rem 2rem 6rem' }}>

          {/* Header */}
          <div style={{ marginBottom: '2.5rem' }}>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.25em', textTransform: 'uppercase', color: '#C9962C', marginBottom: '0.6rem' }}>
              {BRAND.name} — {BRANCH}
            </p>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.8rem' : '2.5rem', color: 'var(--offwhite)', marginBottom: '0.5rem' }}>
              {BRANCH} Catalogue
            </h1>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'rgba(245,242,236,0.4)', lineHeight: 1.7 }}>
              Everything available at the {BRANCH} branch.
            </p>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '0.75rem', marginBottom: '2rem', alignItems: isMobile ? 'stretch' : 'center' }}>
            {/* Search */}
            <div style={{ position: 'relative', flex: isMobile ? undefined : '0 0 260px' }}>
              <FontAwesomeIcon icon={faSearch} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', width: '13px', color: 'rgba(245,242,236,0.3)', pointerEvents: 'none' }} />
              <input
                type="search"
                placeholder="Search products…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--offwhite)', padding: '0.7rem 1rem 0.7rem 2.4rem', borderRadius: '4px', fontSize: '0.85rem', outline: 'none', fontFamily: 'var(--font-inter)', boxSizing: 'border-box' }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(245,242,236,0.35)', cursor: 'pointer', padding: 0 }}>
                  <FontAwesomeIcon icon={faXmark} style={{ width: '13px' }} />
                </button>
              )}
            </div>

            {/* Category selector */}
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              style={{ flex: isMobile ? undefined : '0 0 200px', background: '#1c1c1c', border: '1px solid rgba(255,255,255,0.15)', color: '#F5F2EC', padding: '0.7rem 1rem', borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'var(--font-inter)', outline: 'none', cursor: 'pointer' }}
            >
              {allCats.map(cat => (
                <option key={cat} value={cat} style={{ background: '#1c1c1c', color: '#F5F2EC' }}>{cat}</option>
              ))}
            </select>

            {/* In-stock toggle */}
            <button onClick={() => setStockOnly(s => !s)} style={{ padding: '0.4rem 0.85rem', borderRadius: '20px', border: `1px solid ${stockOnly ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`, fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'var(--font-inter)', backgroundColor: stockOnly ? 'rgba(0,160,152,0.12)' : 'transparent', color: stockOnly ? 'var(--teal)' : 'rgba(245,242,236,0.45)', whiteSpace: 'nowrap', transition: 'all 0.15s ease' }}>
              In Stock Only
            </button>
          </div>

          {/* Results count */}
          {!loading && (
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.25)', marginBottom: '1.5rem', letterSpacing: '0.06em' }}>
              {filtered.length} item{filtered.length !== 1 ? 's' : ''} at {BRANCH}
            </p>
          )}

          {/* Grid */}
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '1.25rem' }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} height="280px" borderRadius="6px" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '6px', padding: '4rem', textAlign: 'center', color: 'rgba(245,242,236,0.2)', fontFamily: 'var(--font-inter)', fontSize: '0.88rem' }}>
              {games.length === 0 ? `Nothing recorded for the ${BRANCH} branch yet.` : 'Nothing matches your filters.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '1.25rem' }}>
              {filtered.map(game => (
                <GameCard key={game.id} game={game} />
              ))}
            </div>
          )}

        </div>
      </main>
      <Footer />
    </>
  )
}
