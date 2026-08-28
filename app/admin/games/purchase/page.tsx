'use client'

import { useEffect, useState, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { useRequireRole, SECTION_ACCESS } from '../../../lib/adminAuth'
import { BRANCHES, normalizeStock } from '../../../lib/branches'
import { type PurchaseItem, createPurchaseOrder } from '../../../lib/gamePurchases'

interface Game {
  id: string
  name: string
  category: string
  price: number
  wholesalePrice?: number | null
  stock: Record<string, number>
  image?: string
  sku?: string
}

interface CartLine {
  game: Game
  quantity: number
  priceType: 'retail' | 'wholesale'
}

function useIsMobile(bp = 768) {
  const [v, setV] = useState(false)
  useEffect(() => {
    const fn = () => setV(window.innerWidth < bp)
    fn(); window.addEventListener('resize', fn); return () => window.removeEventListener('resize', fn)
  }, [bp])
  return v
}

const inp: React.CSSProperties = {
  width: '100%', backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)',
  color: '#F5F2EC', padding: '0.75rem 1rem', borderRadius: '2px',
  fontSize: '0.85rem', outline: 'none', fontFamily: 'var(--font-inter)',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: '0.65rem', letterSpacing: '0.2em',
  textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)',
  marginBottom: '0.4rem', fontFamily: 'var(--font-inter)',
}

export default function RecordSalePage() {
  const { checking, user } = useRequireRole(SECTION_ACCESS.gamePurchases)
  const isMobile = useIsMobile()

  const [games, setGames] = useState<Game[]>([])
  const [branch, setBranch] = useState<string>(BRANCHES[0])
  const [customerName, setCustomerName] = useState('')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ orderId: string; invoiceUrl: string | null; invoiceNumber: string } | null>(null)

  useEffect(() => {
    getDocs(collection(db, 'games')).then(snap => {
      setGames(snap.docs.map(d => {
        const data = d.data() as Omit<Game, 'id'>
        return { id: d.id, ...data, stock: normalizeStock(data.stock) }
      }))
    })
  }, [])

  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase()
    return games.filter(g =>
      !q || g.name.toLowerCase().includes(q) || (g.category ?? '').toLowerCase().includes(q)
    )
  }, [games, search])

  function branchStock(g: Game): number {
    return (g.stock?.[branch] ?? 0)
  }

  function addToCart(game: Game) {
    setCart(prev => {
      const existing = prev.find(l => l.game.id === game.id)
      if (existing) {
        return prev.map(l =>
          l.game.id === game.id
            ? { ...l, quantity: Math.min(l.quantity + 1, branchStock(game)) }
            : l,
        )
      }
      return [...prev, { game, quantity: 1, priceType: 'retail' }]
    })
  }

  function removeFromCart(gameId: string) {
    setCart(prev => prev.filter(l => l.game.id !== gameId))
  }

  function setQty(gameId: string, qty: number) {
    const game = games.find(g => g.id === gameId)
    if (!game) return
    const maxQty = branchStock(game)
    const clamped = Math.max(1, Math.min(qty, maxQty))
    setCart(prev => prev.map(l => l.game.id === gameId ? { ...l, quantity: clamped } : l))
  }

  function setPriceType(gameId: string, pt: 'retail' | 'wholesale') {
    setCart(prev => prev.map(l => l.game.id === gameId ? { ...l, priceType: pt } : l))
  }

  function lineTotal(line: CartLine): number {
    const price = line.priceType === 'wholesale' && line.game.wholesalePrice != null
      ? line.game.wholesalePrice
      : line.game.price
    return price * line.quantity
  }

  function lineUnitPrice(line: CartLine): number {
    return line.priceType === 'wholesale' && line.game.wholesalePrice != null
      ? line.game.wholesalePrice
      : line.game.price
  }

  const orderTotal = cart.reduce((s, l) => s + lineTotal(l), 0)
  const canSubmit = cart.length > 0 && customerName.trim() !== '' && !submitting

  async function handleSubmit() {
    if (!canSubmit || !user) return
    setSubmitting(true)
    setError('')
    try {
      const items: PurchaseItem[] = cart.map(l => ({
        gameId: l.game.id,
        gameName: l.game.name,
        quantity: l.quantity,
        unitPrice: lineUnitPrice(l),
        priceType: l.priceType,
        subtotal: lineTotal(l),
        sku: l.game.sku,
      }))
      const { orderId, invoiceUrl } = await createPurchaseOrder({
        customerName: customerName.trim(),
        branch,
        items,
        processedBy: user.uid,
        processedByEmail: user.email ?? '',
      })
      // Pull invoice number from the order so we can show it in the success screen.
      // We don't have it directly from createPurchaseOrder, so we read it from the
      // items invoice number that was formatted inside the lib. We can construct
      // the invoice number from the current year by re-checking. Actually, let me
      // just show the orderId and the link.
      setResult({ orderId, invoiceUrl, invoiceNumber: orderId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.startsWith('insufficient-stock:')) {
        setError(`Not enough stock for "${msg.split(':')[1]}" at ${branch}.`)
      } else {
        setError('Something went wrong processing the sale. Please try again.')
        console.error('[RecordSale] createPurchaseOrder failed:', err)
      }
    } finally {
      setSubmitting(false)
    }
  }

  function startNew() {
    setCart([])
    setCustomerName('')
    setSearch('')
    setResult(null)
    setError('')
  }

  if (checking) return null

  const sectionLabel: React.CSSProperties = {
    fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase',
    color: 'var(--teal)', fontFamily: 'var(--font-inter)', marginBottom: '1rem',
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '1.25rem' : '3rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <a href="/admin" style={{
            fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase',
            color: 'rgba(245,242,236,0.3)', textDecoration: 'none',
            fontFamily: 'var(--font-inter)', marginBottom: '0.5rem', display: 'block',
          }}>← Back to Dashboard</a>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '2rem', color: 'var(--offwhite)' }}>
              Record a Sale
            </h1>
            <a href="/admin/games/invoices" style={{
              fontSize: '0.72rem', letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.4)', textDecoration: 'none', fontFamily: 'var(--font-inter)',
              border: '1px solid rgba(255,255,255,0.08)', padding: '0.5rem 1rem', borderRadius: '2px',
            }}>View Invoices →</a>
          </div>
        </div>

        {/* Success */}
        {result && (
          <div style={{
            background: 'rgba(0,160,152,0.08)', border: '1px solid rgba(0,160,152,0.3)',
            borderRadius: '6px', padding: '2rem', textAlign: 'center',
          }}>
            <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.3rem', color: 'var(--offwhite)', marginBottom: '0.6rem' }}>
              Sale Recorded
            </p>
            <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.85rem', color: 'rgba(245,242,236,0.6)', marginBottom: '1.5rem' }}>
              Stock has been deducted and an invoice has been generated.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {result.invoiceUrl && (
                <a
                  href={result.invoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    backgroundColor: 'var(--teal)', color: '#fff', textDecoration: 'none',
                    padding: '0.8rem 1.8rem', borderRadius: '2px', fontSize: '0.78rem',
                    letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                  }}
                >View Invoice</a>
              )}
              <a
                href="/admin/games/invoices"
                style={{
                  backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                  color: 'rgba(245,242,236,0.6)', textDecoration: 'none',
                  padding: '0.8rem 1.8rem', borderRadius: '2px', fontSize: '0.78rem',
                  letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                }}
              >All Invoices</a>
              <button
                onClick={startNew}
                style={{
                  backgroundColor: 'var(--purple)', color: '#fff', border: 'none',
                  padding: '0.8rem 1.8rem', borderRadius: '2px', fontSize: '0.78rem',
                  letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-inter)',
                  cursor: 'pointer',
                }}
              >Record Another Sale</button>
            </div>
          </div>
        )}

        {!result && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 380px',
            gap: '2rem',
            alignItems: 'start',
          }}>

            {/* Left: game picker */}
            <div>
              {/* Order info */}
              <div style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '4px', padding: '1.5rem', marginBottom: '1.5rem',
              }}>
                <p style={sectionLabel}>Order Info</p>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={lbl}>Branch</label>
                    <select
                      value={branch}
                      onChange={e => { setBranch(e.target.value); setCart([]) }}
                      style={{ ...inp, backgroundColor: '#1a1a1a', color: '#F5F2EC' }}
                    >
                      {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Customer / Company Name</label>
                    <input
                      type="text"
                      placeholder="Invoice recipient"
                      value={customerName}
                      onChange={e => setCustomerName(e.target.value)}
                      style={inp}
                    />
                  </div>
                </div>
              </div>

              {/* Game picker */}
              <div style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '4px', padding: '1.5rem',
              }}>
                <p style={sectionLabel}>Add Games</p>
                <input
                  type="text"
                  placeholder="Search by name or category…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ ...inp, marginBottom: '1rem' }}
                />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '420px', overflowY: 'auto' }}>
                  {filteredGames.map(game => {
                    const stock = branchStock(game)
                    const inCart = cart.find(l => l.game.id === game.id)
                    return (
                      <div key={game.id} style={{
                        display: 'flex', alignItems: 'center', gap: '0.8rem',
                        padding: '0.7rem 0.8rem', borderRadius: '3px',
                        backgroundColor: inCart ? 'rgba(106,106,183,0.1)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${inCart ? 'rgba(106,106,183,0.3)' : 'rgba(255,255,255,0.05)'}`,
                        opacity: stock === 0 && !inCart ? 0.4 : 1,
                      }}>
                        {game.image && (
                          <img src={game.image} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: '2px', flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.85rem', color: 'var(--offwhite)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {game.name}
                          </p>
                          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.4)' }}>
                            {game.category} · ${game.price}
                            {game.wholesalePrice != null && ` · WS: $${game.wholesalePrice}`}
                            {' · '}
                            <span style={{ color: stock > 0 ? 'var(--teal)' : 'var(--red)' }}>
                              {stock} at {branch}
                            </span>
                          </p>
                        </div>
                        <button
                          onClick={() => addToCart(game)}
                          disabled={stock === 0}
                          style={{
                            flexShrink: 0,
                            backgroundColor: inCart ? 'rgba(106,106,183,0.2)' : 'var(--purple)',
                            color: '#fff', border: 'none', borderRadius: '2px',
                            padding: '0.4rem 0.8rem', fontSize: '0.7rem',
                            cursor: stock === 0 ? 'not-allowed' : 'pointer',
                            fontFamily: 'var(--font-inter)', letterSpacing: '0.05em',
                            opacity: stock === 0 ? 0.5 : 1,
                          }}
                        >
                          {inCart ? '+ More' : 'Add'}
                        </button>
                      </div>
                    )
                  })}
                  {filteredGames.length === 0 && (
                    <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.3)', padding: '1rem 0' }}>
                      No games match this search.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Right: cart + submit */}
            <div style={{ position: isMobile ? 'static' : 'sticky', top: '2rem' }}>
              <div style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '4px', padding: '1.5rem',
              }}>
                <p style={sectionLabel}>Cart</p>

                {cart.length === 0 ? (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.25)', marginBottom: '1.5rem' }}>
                    No games added yet.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginBottom: '1.2rem' }}>
                    {cart.map(line => {
                      const hasWholesale = line.game.wholesalePrice != null
                      const maxQty = branchStock(line.game)
                      return (
                        <div key={line.game.id} style={{
                          padding: '0.8rem', borderRadius: '3px',
                          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                            <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.82rem', color: 'var(--offwhite)', flex: 1, marginRight: '0.5rem' }}>
                              {line.game.name}
                            </p>
                            <button onClick={() => removeFromCart(line.game.id)} style={{
                              background: 'transparent', border: 'none', color: 'rgba(228,51,41,0.5)',
                              cursor: 'pointer', fontSize: '0.9rem', padding: 0, flexShrink: 0,
                            }}>✕</button>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            <div>
                              <label style={{ ...lbl, marginBottom: '0.25rem' }}>Qty (max {maxQty})</label>
                              <input
                                type="number" min={1} max={maxQty}
                                value={line.quantity}
                                onChange={e => setQty(line.game.id, Number(e.target.value))}
                                style={{ ...inp, padding: '0.5rem 0.6rem', fontSize: '0.82rem' }}
                              />
                            </div>
                            <div>
                              <label style={{ ...lbl, marginBottom: '0.25rem' }}>Price</label>
                              {hasWholesale ? (
                                <select
                                  value={line.priceType}
                                  onChange={e => setPriceType(line.game.id, e.target.value as 'retail' | 'wholesale')}
                                  style={{ ...inp, padding: '0.5rem 0.6rem', fontSize: '0.82rem', backgroundColor: '#1a1a1a', color: '#F5F2EC' }}
                                >
                                  <option value="retail">Retail ${line.game.price}</option>
                                  <option value="wholesale">Wholesale ${line.game.wholesalePrice}</option>
                                </select>
                              ) : (
                                <div style={{ ...inp, padding: '0.5rem 0.6rem', fontSize: '0.82rem' }}>
                                  ${line.game.price}
                                </div>
                              )}
                            </div>
                          </div>

                          <p style={{
                            fontFamily: 'var(--font-inter)', fontSize: '0.78rem',
                            color: 'var(--teal)', marginTop: '0.5rem', textAlign: 'right',
                          }}>
                            Subtotal: ${lineTotal(line).toFixed(2)}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Total */}
                {cart.length > 0 && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.75rem 0', borderTop: '1px solid rgba(255,255,255,0.08)',
                    marginBottom: '1rem',
                  }}>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.5)' }}>Order Total</span>
                    <span style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.05rem', color: 'var(--teal)' }}>
                      ${orderTotal.toFixed(2)}
                    </span>
                  </div>
                )}

                {error && (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'var(--red)', marginBottom: '0.8rem' }}>
                    {error}
                  </p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  style={{
                    width: '100%', backgroundColor: 'var(--teal)', color: '#fff',
                    border: 'none', borderRadius: '2px', padding: '0.9rem',
                    fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase',
                    fontFamily: 'var(--font-inter)',
                    cursor: !canSubmit ? 'not-allowed' : 'pointer',
                    opacity: !canSubmit ? 0.5 : 1,
                  }}
                >
                  {submitting ? 'Processing…' : 'Confirm Sale & Generate Invoice'}
                </button>

                {!customerName.trim() && cart.length > 0 && (
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.72rem', color: 'rgba(245,242,236,0.3)', marginTop: '0.5rem', textAlign: 'center' }}>
                    Enter a customer name to confirm.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
