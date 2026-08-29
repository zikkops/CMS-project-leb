'use client'

import { useEffect, useState, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db } from '../lib/firebase'
import Navbar from '../components/layout/Navbar'
import Footer from '../components/layout/Footer'
import Skeleton from '../components/Skeleton'
import Link from 'next/link'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faUsers, faClock, faCakeCandles, faSearch, faXmark } from '@fortawesome/free-solid-svg-icons'
import { totalStock } from '../lib/branches'
import {
  useWholesaleAccount, submitWholesaleOrder,
  orderTotal, orderItemCount, type WholesaleOrderItem,
} from '../lib/wholesale'
import { generateInvoiceForCart } from '../lib/wholesaleInvoice'
import { BRAND } from '../lib/brand'

interface Game {
  id: string
  name: string
  category: string
  players: string
  duration: string
  age: string
  wholesalePrice: number
  retailPrice: number
  stock: Record<string, number> | number
  image: string
  sku?: string
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

// Quantity stepper lives OUTSIDE the <Link> that used to wrap the whole card —
// nested inside it, every +/- click would navigate to the game page instead.
function GameCard({
  game, qty, onQty,
}: {
  game: Game
  qty: number
  onQty: (next: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  const stock = totalStock(game.stock)
  const inStock = stock > 0

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column',
        background: qty > 0 ? 'rgba(106,106,183,0.07)' : hovered ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${qty > 0 ? 'rgba(106,106,183,0.6)' : hovered ? 'rgba(106,106,183,0.4)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: '6px',
        overflow: 'hidden',
        transition: 'all 0.22s ease',
        transform: hovered ? 'translateY(-3px)' : 'none',
        boxShadow: hovered ? '0 8px 32px rgba(0,0,0,0.35)' : 'none',
      }}
    >
      <Link href={`/shop/${game.id}`} style={{ textDecoration: 'none' }}>
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

          <div style={{ position: 'absolute', top: '0.6rem', right: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-end' }}>
            <div style={{ background: '#6A6AB7', color: '#fff', padding: '0.22rem 0.55rem', borderRadius: '3px', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--font-inter)', whiteSpace: 'nowrap' }}>
              WS ${game.wholesalePrice.toFixed(2)}
            </div>
            {game.retailPrice > 0 && (
              <div style={{ background: '#C9962C', color: '#000', padding: '0.22rem 0.55rem', borderRadius: '3px', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--font-inter)', whiteSpace: 'nowrap' }}>
                RP ${game.retailPrice.toFixed(2)}
              </div>
            )}
          </div>

          <div style={{
            position: 'absolute', top: '0.6rem', left: '0.6rem',
            background: inStock ? 'rgba(0,160,152,0.85)' : 'rgba(228,51,41,0.75)',
            color: '#fff', padding: '0.2rem 0.55rem', borderRadius: '3px',
            fontSize: '0.65rem', fontFamily: 'var(--font-inter)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            {inStock ? `${stock} in stock` : 'Out of stock'}
          </div>
        </div>
      </Link>

      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1 }}>
        <Link href={`/shop/${game.id}`} style={{ textDecoration: 'none' }}>
          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.92rem', color: 'var(--offwhite)', lineHeight: 1.3 }}>
            {game.name}
          </p>
        </Link>

        {game.category && (
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--purple)' }}>
            {game.category}
          </span>
        )}

        {game.retailPrice > 0 && (
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', color: 'rgba(245,242,236,0.28)' }}>
            Margin ${(game.retailPrice - game.wholesalePrice).toFixed(2)}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '0.4rem' }}>
          {game.players && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)' }}>
              <FontAwesomeIcon icon={faUsers} style={{ width: '11px' }} />{game.players}
            </span>
          )}
          {game.duration && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)' }}>
              <FontAwesomeIcon icon={faClock} style={{ width: '11px' }} />{game.duration}
            </span>
          )}
          {game.age && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.35)' }}>
              <FontAwesomeIcon icon={faCakeCandles} style={{ width: '11px' }} />{game.age}+
            </span>
          )}
        </div>

        {/* Order quantity. Stock is shown but not enforced here — staff confirm
            availability when they approve, and a hard block would hide demand
            for titles worth restocking. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.6rem' }}>
          <button
            onClick={() => onQty(Math.max(0, qty - 1))}
            disabled={qty === 0}
            aria-label={`Remove one ${game.name}`}
            style={{
              width: '30px', height: '30px', borderRadius: '4px', cursor: qty === 0 ? 'not-allowed' : 'pointer',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
              color: qty === 0 ? 'rgba(245,242,236,0.2)' : 'var(--offwhite)', fontSize: '1rem', lineHeight: 1,
            }}
          >−</button>
          <input
            type="number" min={0} value={qty}
            onChange={e => onQty(Math.max(0, parseInt(e.target.value || '0', 10) || 0))}
            aria-label={`Quantity of ${game.name}`}
            style={{
              width: '56px', textAlign: 'center', padding: '0.35rem',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '4px', color: qty > 0 ? '#6A6AB7' : 'var(--offwhite)',
              fontWeight: 700, fontFamily: 'var(--font-inter)', fontSize: '0.85rem', outline: 'none',
            }}
          />
          <button
            onClick={() => onQty(qty + 1)}
            aria-label={`Add one ${game.name}`}
            style={{
              width: '30px', height: '30px', borderRadius: '4px', cursor: 'pointer',
              background: 'rgba(106,106,183,0.18)', border: '1px solid rgba(106,106,183,0.5)',
              color: '#9B9BD6', fontSize: '1rem', lineHeight: 1,
            }}
          >+</button>
          {qty > 0 && (
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-inter)', fontSize: '0.78rem', fontWeight: 700, color: '#6A6AB7' }}>
              ${(game.wholesalePrice * qty).toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function WholesalePage() {
  const { account, loading: authLoading } = useWholesaleAccount()

  const [games, setGames]           = useState<Game[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [category, setCategory]     = useState('All')
  const [stockOnly, setStockOnly]   = useState(true)
  const [categories, setCategories] = useState<string[]>([])
  const [cart, setCart]             = useState<Record<string, number>>({})
  const [notes, setNotes]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitLabel, setSubmitLabel] = useState('')
  const [placed, setPlaced]         = useState<{ id: string; emailed: boolean; invoiceNumber?: string; invoiceUrl?: string } | null>(null)
  const [error, setError]           = useState('')
  const isMobile = useIsMobile()

  useEffect(() => {
    if (!account) return
    let cancelled = false
    async function load() {
      const [gamesSnap, catSnap] = await Promise.all([
        getDocs(collection(db, 'games')),
        getDocs(collection(db, 'gameCategories')),
      ])
      if (cancelled) return
      const all = gamesSnap.docs.map(d => {
        const data = d.data()
        return {
          id: d.id,
          name:        (data.name as string) ?? '',
          category:    (data.category as string) ?? '',
          players:     (data.players as string) ?? '',
          duration:    (data.duration as string) ?? '',
          age:         (data.age as string) ?? '',
          wholesalePrice: (data.wholesalePrice as number) ?? 0,
          retailPrice: (data.price as number) ?? 0,
          stock:       data.stock,
          image:       (data.image as string) ?? '',
          sku:         (data.sku as string) ?? undefined,
        } as Game
      })
      setGames(all.filter(g => g.wholesalePrice > 0))
      const cats = catSnap.docs.map(d => (d.data() as { name: string }).name)
      setCategories(cats)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [account])

  const filtered = useMemo(() => games.filter(g => {
    const matchCat    = category === 'All' || g.category === category
    const matchSearch = !search || g.name.toLowerCase().includes(search.toLowerCase())
    const matchStock  = !stockOnly || totalStock(g.stock) > 0
    return matchCat && matchSearch && matchStock
  }), [games, search, category, stockOnly])

  const allCats = useMemo(() => ['All', ...categories], [categories])

  const cartItems: WholesaleOrderItem[] = useMemo(
    () => games
      .filter(g => (cart[g.id] ?? 0) > 0)
      .map(g => ({ gameId: g.id, name: g.name, unitPrice: g.wholesalePrice, quantity: cart[g.id], sku: g.sku })),
    [games, cart],
  )

  async function handleSubmit() {
    if (!account || cartItems.length === 0) return
    setSubmitting(true)
    setError('')
    try {
      // The invoice is drawn here because it's a <canvas>, then uploaded, so
      // the order email can carry it. If drawing or uploading fails the order
      // still goes through without one — a missing invoice is worth fixing
      // later, not worth losing the order over.
      let invoice: { invoiceNumber: string; invoiceUrl: string } | undefined
      try {
        setSubmitLabel('Preparing invoice…')
        invoice = await generateInvoiceForCart({
          shopName: account.shopName || account.email,
          items: cartItems,
          totalUsd: total,
          issuedByEmail: account.email,
        })
      } catch {
        invoice = undefined
      }

      setSubmitLabel('Sending order…')
      const result = await submitWholesaleOrder(account, cartItems, notes.trim(), invoice)
      setPlaced({ id: result.id, emailed: result.emailed, ...(invoice ?? {}) })
      setCart({})
      setNotes('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the order. Please try again.')
    } finally {
      setSubmitting(false)
      setSubmitLabel('')
    }
  }

  // ---- Gate ----
  if (authLoading) {
    return (
      <>
        <Navbar />
        <main style={{ minHeight: '100vh', backgroundColor: 'var(--black)', paddingTop: '5rem' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '3rem 2rem' }}>
            <Skeleton height="40px" borderRadius="4px" />
          </div>
        </main>
      </>
    )
  }

  if (!account) {
    return (
      <>
        <Navbar />
        <main style={{
          minHeight: '100vh', backgroundColor: 'var(--black)', paddingTop: '5rem',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem',
        }}>
          <div style={{ textAlign: 'center', maxWidth: '420px' }}>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.25em', textTransform: 'uppercase', color: '#6A6AB7', marginBottom: '0.8rem' }}>
              {BRAND.name} — Wholesale
            </p>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.8rem' }}>
              Trade access only
            </h1>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'rgba(245,242,236,0.4)', lineHeight: 1.7, marginBottom: '2rem' }}>
              Wholesale pricing is available to approved trade accounts. Sign in to see prices and place an order.
            </p>
            <Link href="/wholesale/login" style={{
              display: 'inline-block', background: 'var(--teal)', color: '#000',
              padding: '0.8rem 2rem', borderRadius: '3px', textDecoration: 'none',
              fontFamily: 'var(--font-inter)', fontSize: '0.8rem', fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>Sign In</Link>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  // ---- Confirmation ----
  if (placed) {
    return (
      <>
        <Navbar />
        <main style={{ minHeight: '100vh', backgroundColor: 'var(--black)', paddingTop: '5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div style={{ textAlign: 'center', maxWidth: '460px' }}>
            <p style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>✓</p>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.6rem', color: 'var(--offwhite)', marginBottom: '0.8rem' }}>
              Order received
            </h1>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'rgba(245,242,236,0.45)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
              Thanks — we&apos;ll review it and get back to you to confirm availability and delivery.
              Your reference is <span style={{ color: 'var(--teal)' }}>{placed.id.slice(0, 8).toUpperCase()}</span>.
            </p>

            {placed.invoiceUrl ? (
              <div style={{
                background: 'rgba(0,160,152,0.06)', border: '1px solid rgba(0,160,152,0.28)',
                borderRadius: '6px', padding: '1.1rem 1.25rem', marginBottom: '1.75rem',
              }}>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)', marginBottom: '0.35rem' }}>
                  Invoice
                </p>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.95rem', color: 'var(--offwhite)', marginBottom: '0.9rem' }}>
                  {placed.invoiceNumber}
                </p>
                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {/* download forces a save rather than opening the image in a
                      tab; imgbb is same-scheme so the attribute is honoured. */}
                  <a
                    href={placed.invoiceUrl}
                    download={`${placed.invoiceNumber ?? 'invoice'}.png`}
                    style={{
                      background: 'var(--teal)', color: '#000', padding: '0.65rem 1.4rem',
                      borderRadius: '3px', textDecoration: 'none', fontFamily: 'var(--font-inter)',
                      fontSize: '0.76rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                    }}
                  >Download Invoice</a>
                  <a
                    href={placed.invoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      background: 'transparent', color: 'rgba(245,242,236,0.6)',
                      border: '1px solid rgba(255,255,255,0.15)', padding: '0.65rem 1.4rem',
                      borderRadius: '3px', textDecoration: 'none', fontFamily: 'var(--font-inter)',
                      fontSize: '0.76rem', letterSpacing: '0.08em', textTransform: 'uppercase',
                    }}
                  >View</a>
                </div>
              </div>
            ) : (
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)', marginBottom: '1.75rem' }}>
                Your invoice will follow by email.
              </p>
            )}

            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/wholesale/orders" style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(245,242,236,0.6)', padding: '0.8rem 1.6rem', borderRadius: '3px',
              fontFamily: 'var(--font-inter)', fontSize: '0.8rem', letterSpacing: '0.1em',
              textTransform: 'uppercase', textDecoration: 'none',
            }}>My Orders</Link>
            <button onClick={() => setPlaced(null)} style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(245,242,236,0.6)', padding: '0.8rem 2rem', borderRadius: '3px',
              fontFamily: 'var(--font-inter)', fontSize: '0.8rem', letterSpacing: '0.1em',
              textTransform: 'uppercase', cursor: 'pointer',
            }}>Place another order</button>
            </div>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  const total = orderTotal(cartItems)
  const count = orderItemCount(cartItems)

  return (
    <>
      <Navbar />
      <main style={{ minHeight: '100vh', backgroundColor: 'var(--black)', paddingTop: '5rem', paddingBottom: count > 0 ? '7rem' : 0 }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '2rem 1.25rem 4rem' : '3rem 2rem 6rem' }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '2.5rem' }}>
            <div>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.65rem', letterSpacing: '0.25em', textTransform: 'uppercase', color: '#6A6AB7', marginBottom: '0.6rem' }}>
                {BRAND.name} — Wholesale
              </p>
              <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.8rem' : '2.5rem', color: 'var(--offwhite)', marginBottom: '0.5rem' }}>
                Wholesale Catalogue
              </h1>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'rgba(245,242,236,0.4)' }}>
                Signed in as <span style={{ color: 'var(--teal)' }}>{account.shopName || account.email}</span>
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <Link href="/wholesale/orders" style={{
                fontFamily: 'var(--font-inter)', fontSize: '0.75rem', letterSpacing: '0.06em',
                color: 'rgba(245,242,236,0.5)', textDecoration: 'none',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '3px', padding: '0.5rem 1rem',
              }}>My Orders</Link>
              <button onClick={() => signOut(auth)} style={{
                fontFamily: 'var(--font-inter)', fontSize: '0.75rem', letterSpacing: '0.06em',
                color: 'rgba(245,242,236,0.35)', background: 'none',
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', padding: '0.5rem 1rem', cursor: 'pointer',
              }}>Sign out</button>
            </div>
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

            <button onClick={() => setStockOnly(s => !s)} style={{ padding: '0.4rem 0.85rem', borderRadius: '20px', border: `1px solid ${stockOnly ? 'var(--teal)' : 'rgba(255,255,255,0.1)'}`, fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'var(--font-inter)', backgroundColor: stockOnly ? 'rgba(0,160,152,0.12)' : 'transparent', color: stockOnly ? 'var(--teal)' : 'rgba(245,242,236,0.45)', whiteSpace: 'nowrap' }}>
              In Stock Only
            </button>
          </div>

          {!loading && (
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.25)', marginBottom: '1.5rem', letterSpacing: '0.06em' }}>
              {filtered.length} game{filtered.length !== 1 ? 's' : ''} available at wholesale
            </p>
          )}

          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '1.25rem' }}>
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height="320px" borderRadius="6px" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '6px', padding: '4rem', textAlign: 'center', color: 'rgba(245,242,236,0.2)', fontFamily: 'var(--font-inter)', fontSize: '0.88rem' }}>
              {games.length === 0 ? 'No games are currently listed for wholesale.' : 'No games match your filters.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '1.25rem' }}>
              {filtered.map(game => (
                <GameCard
                  key={game.id}
                  game={game}
                  qty={cart[game.id] ?? 0}
                  onQty={next => setCart(c => {
                    const copy = { ...c }
                    if (next <= 0) delete copy[game.id]
                    else copy[game.id] = next
                    return copy
                  })}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Order bar — only once something is in the cart */}
      {count > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
          background: 'rgba(12,12,12,0.97)', borderTop: '1px solid rgba(106,106,183,0.4)',
          padding: isMobile ? '0.9rem 1rem' : '1rem 2rem',
        }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)' }}>
                {cartItems.length} title{cartItems.length !== 1 ? 's' : ''} · {count} unit{count !== 1 ? 's' : ''}
              </p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '1.15rem', fontWeight: 700, color: '#9B9BD6' }}>
                ${total.toFixed(2)}
              </p>
            </div>

            {!isMobile && (
              <input
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Notes for this order (optional)"
                style={{ flex: 1, minWidth: '180px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#F5F2EC', padding: '0.6rem 0.9rem', borderRadius: '4px', fontSize: '0.82rem', outline: 'none', fontFamily: 'var(--font-inter)' }}
              />
            )}

            <button onClick={() => setCart({})} style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(245,242,236,0.4)',
              padding: '0.7rem 1.1rem', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'var(--font-inter)', fontSize: '0.75rem', letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>Clear</button>

            <button onClick={handleSubmit} disabled={submitting} style={{
              background: submitting ? 'rgba(255,255,255,0.08)' : '#6A6AB7',
              color: submitting ? 'rgba(245,242,236,0.3)' : '#fff',
              border: 'none', padding: '0.75rem 2rem', borderRadius: '3px',
              cursor: submitting ? 'not-allowed' : 'pointer', fontWeight: 700,
              fontFamily: 'var(--font-inter)', fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>{submitting ? (submitLabel || 'Sending…') : 'Submit Order'}</button>

            {error && (
              <p style={{ width: '100%', fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'var(--red)' }}>{error}</p>
            )}
          </div>
        </div>
      )}

      {count === 0 && <Footer />}
    </>
  )
}
