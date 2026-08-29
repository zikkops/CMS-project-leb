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
import { totalStock } from '../lib/branches'
import { BRAND } from '../lib/brand'

interface Game {
  id: string
  name: string
  category: string
  description: string
  players: string
  duration: string
  age: string
  price: number
  stock: Record<string, number> | number
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

function GameCard({ game }: { game: Game }) {
  const [hovered, setHovered] = useState(false)
  const stock = totalStock(game.stock)
  const inStock = stock > 0

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
        border: `1px solid ${hovered ? 'rgba(201,150,44,0.35)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: '6px',
        overflow: 'hidden',
        transition: 'all 0.22s ease',
        transform: hovered ? 'translateY(-3px)' : 'none',
        boxShadow: hovered ? '0 8px 32px rgba(0,0,0,0.35)' : 'none',
      }}
    >
      {/* Image */}
      <div style={{ position: 'relative', width: '100%', paddingTop: '66%', overflow: 'hidden', background: 'rgba(255,255,255,0.03)' }}>
        {game.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.image}
            alt={game.name}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'cover',
              transition: 'transform 0.4s ease',
              transform: hovered ? 'scale(1.04)' : 'scale(1)',
            }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'rgba(255,255,255,0.1)', fontSize: '2.5rem' }}>🎲</span>
          </div>
        )}
        {/* Price badge */}
        <div style={{
          position: 'absolute', top: '0.6rem', right: '0.6rem',
          background: '#C9962C',
          color: '#000',
          padding: '0.25rem 0.6rem',
          borderRadius: '3px',
          fontSize: '0.82rem',
          fontWeight: 700,
          fontFamily: 'var(--font-inter)',
          letterSpacing: '0.02em',
        }}>
          ${game.price.toFixed(2)}
        </div>
        {/* Stock badge */}
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
          {inStock ? 'In Stock' : 'Sold Out'}
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
        <p style={{
          fontFamily: 'var(--font-cinzel)',
          fontSize: '0.95rem',
          color: 'var(--offwhite)',
          lineHeight: 1.3,
        }}>{game.name}</p>

        {game.category && (
          <span style={{
            fontFamily: 'var(--font-inter)',
            fontSize: '0.65rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--purple)',
          }}>{game.category}</span>
        )}

        <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '0.5rem' }}>
          {game.players && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)' }}>
              <FontAwesomeIcon icon={faUsers} style={{ width: '11px' }} />
              {game.players}
            </span>
          )}
          {game.duration && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)' }}>
              <FontAwesomeIcon icon={faClock} style={{ width: '11px' }} />
              {game.duration}
            </span>
          )}
          {game.age && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)' }}>
              <FontAwesomeIcon icon={faCakeCandles} style={{ width: '11px' }} />
              {game.age}+
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

export default function RetailPage() {
  const [games, setGames]           = useState<Game[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [category, setCategory]     = useState('All')
  const [stockOnly, setStockOnly]   = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const isMobile = useIsMobile()

  useEffect(() => {
    async function load() {
      const [gamesSnap, catSnap] = await Promise.all([
        getDocs(collection(db, 'games')),
        getDocs(collection(db, 'gameCategories')),
      ])
      const all = gamesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Game))
      const retail = all.filter(g => (g.price ?? 0) > 0)
      const cats = catSnap.docs.map(d => (d.data() as { name: string }).name)
      setGames(retail)
      setCategories(cats.length > 0 ? cats : ['Strategy', 'Party', 'Family', 'Cooperative', 'Card', 'Trivia', 'RPG', 'Puzzle'])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    return games.filter(g => {
      const matchCat    = category === 'All' || g.category === category
      const matchSearch = !search || g.name.toLowerCase().includes(search.toLowerCase())
      const matchStock  = !stockOnly || totalStock(g.stock) > 0
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
            <p style={{
              fontFamily: 'var(--font-inter)',
              fontSize: '0.65rem',
              letterSpacing: '0.25em',
              textTransform: 'uppercase',
              color: '#C9962C',
              marginBottom: '0.6rem',
            }}>{BRAND.name}</p>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.8rem' : '2.5rem', color: 'var(--offwhite)', marginBottom: '0.5rem' }}>
              Games For Sale
            </h1>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'rgba(245,242,236,0.4)', lineHeight: 1.7 }}>
              Take one home. Everything below is available for retail purchase at any {BRAND.name} branch.
            </p>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '0.75rem', marginBottom: '2rem', alignItems: isMobile ? 'stretch' : 'center' }}>
            {/* Search */}
            <div style={{ position: 'relative', flex: isMobile ? undefined : '0 0 260px' }}>
              <FontAwesomeIcon icon={faSearch} style={{
                position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)',
                width: '13px', color: 'rgba(245,242,236,0.3)', pointerEvents: 'none',
              }} />
              <input
                type="search"
                placeholder="Search games…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%', backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)', color: 'var(--offwhite)',
                  padding: '0.7rem 1rem 0.7rem 2.4rem', borderRadius: '4px',
                  fontSize: '0.85rem', outline: 'none', fontFamily: 'var(--font-inter)',
                  boxSizing: 'border-box',
                }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{
                  position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'rgba(245,242,236,0.35)',
                  cursor: 'pointer', padding: 0, fontSize: '0.85rem',
                }}>
                  <FontAwesomeIcon icon={faXmark} style={{ width: '13px' }} />
                </button>
              )}
            </div>

            {/* Category pills */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', flex: 1 }}>
              {allCats.map(cat => (
                <button key={cat} onClick={() => setCategory(cat)} style={{
                  padding: '0.4rem 0.85rem', borderRadius: '20px', border: 'none',
                  fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase',
                  cursor: 'pointer', fontFamily: 'var(--font-inter)',
                  backgroundColor: category === cat ? '#C9962C' : 'rgba(255,255,255,0.06)',
                  color: category === cat ? '#000' : 'rgba(245,242,236,0.5)',
                  transition: 'all 0.15s ease',
                }}>{cat}</button>
              ))}
            </div>

            {/* In-stock toggle */}
            <button onClick={() => setStockOnly(s => !s)} style={{
              padding: '0.4rem 0.85rem', borderRadius: '20px',
              border: `1px solid ${stockOnly ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`,
              fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase',
              cursor: 'pointer', fontFamily: 'var(--font-inter)',
              backgroundColor: stockOnly ? 'rgba(0,160,152,0.12)' : 'transparent',
              color: stockOnly ? 'var(--teal)' : 'rgba(245,242,236,0.45)',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}>In Stock Only</button>
          </div>

          {/* Results count */}
          {!loading && (
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.25)', marginBottom: '1.5rem', letterSpacing: '0.06em' }}>
              {filtered.length} game{filtered.length !== 1 ? 's' : ''} available for purchase
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
            <div style={{
              border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '6px',
              padding: '4rem', textAlign: 'center',
              color: 'rgba(245,242,236,0.2)', fontFamily: 'var(--font-inter)', fontSize: '0.88rem',
            }}>
              {games.length === 0 ? 'No games are currently listed for retail sale.' : 'No games match your filters.'}
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
