'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { BRANCHES, normalizeStock } from '@big-cms/shared/branches'
import { transferGameStock } from '@big-cms/shared/productPurchases'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSearch, faArrowRight, faXmark, faPlus } from '@fortawesome/free-solid-svg-icons'
import { useIsMobile } from '@big-cms/shared/useIsMobile'

interface Product {
  id: string
  name: string
  category: string
  stock: Record<string, number>
}

interface TransferItem {
  product: Product
  qty: number
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.68rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: 'rgba(245,242,236,0.35)',
  fontFamily: 'var(--font-inter)',
  marginBottom: '0.5rem',
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#1a1a1a',
  border: '1px solid rgba(255,255,255,0.12)',
  color: 'var(--offwhite)',
  padding: '0.75rem 1rem',
  borderRadius: '2px',
  fontSize: '0.85rem',
  fontFamily: 'var(--font-inter)',
  outline: 'none',
}

export default function TransferStockPage() {
  const isMobile = useIsMobile()
  const { checking, role, branchIds } = useRequireRole(SECTION_ACCESS.productTransfers)

  // Gamers are locked to their own branch as the source — they can only send
  // stock out of the branch they're assigned to, not pull from others'.
  const isGamer     = role === 'retail'
  const lockedFrom  = isGamer ? (branchIds[0] ?? null) : null

  const [products, setGames]         = useState<Product[]>([])
  const [loadingGames, setLoadingGames] = useState(true)
  const [search, setSearch]       = useState('')
  const [showResults, setShowResults] = useState(false)
  const searchRef                 = useRef<HTMLInputElement>(null)

  const [fromBranch, setFromBranch] = useState<string>(lockedFrom ?? BRANCHES[0])
  const [toBranch, setToBranch]     = useState<string>(BRANCHES[1])
  const [items, setItems]           = useState<TransferItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult]         = useState<{ ok: boolean; msg: string } | null>(null)

  // Keep fromBranch in sync if the retail's branchIds load after mount
  useEffect(() => {
    if (lockedFrom) setFromBranch(lockedFrom)
  }, [lockedFrom])

  // Avoid "from === to" once fromBranch is locked
  useEffect(() => {
    if (fromBranch === toBranch) {
      const other = BRANCHES.find(b => b !== fromBranch)
      if (other) setToBranch(other)
    }
  }, [fromBranch, toBranch])

  useEffect(() => {
    getDocs(collection(db, 'products')).then(snap => {
      setGames(snap.docs.map(d => {
        const data = d.data()
        return { id: d.id, name: data.name, category: data.category, stock: normalizeStock(data.stock) }
      }).sort((a, b) => a.name.localeCompare(b.name)))
      setLoadingGames(false)
    })
  }, [])

  const alreadyAdded = useMemo(() => new Set(items.map(i => i.product.id)), [items])

  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(g =>
      !alreadyAdded.has(g.id) &&
      (g.name.toLowerCase().includes(q) || g.category?.toLowerCase().includes(q))
    )
  }, [products, search, alreadyAdded])

  function addGame(product: Product) {
    setItems(prev => [...prev, { product, qty: 1 }])
    setSearch('')
    setShowResults(false)
  }

  function removeItem(productId: string) {
    setItems(prev => prev.filter(i => i.product.id !== productId))
  }

  function setQty(productId: string, qty: number) {
    setItems(prev => prev.map(i => i.product.id === productId ? { ...i, qty } : i))
  }

  const canSubmit = items.length > 0 &&
    fromBranch !== toBranch &&
    items.every(i => i.qty >= 1 && i.qty <= (i.product.stock[fromBranch] ?? 0))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setResult(null)
    try {
      await transferGameStock(
        items.map(i => ({ productId: i.product.id, productName: i.product.name, quantity: i.qty })),
        fromBranch,
        toBranch,
      )
      // Update local stock so available counts refresh immediately
      const delta: Record<string, number> = {}
      items.forEach(i => { delta[i.product.id] = i.qty })
      setGames(prev => prev.map(g => {
        if (!delta[g.id]) return g
        const s = { ...g.stock }
        s[fromBranch] = (s[fromBranch] ?? 0) - delta[g.id]
        s[toBranch]   = (s[toBranch]   ?? 0) + delta[g.id]
        return { ...g, stock: s }
      }))
      const summary = items.map(i => `${i.product.name} ×${i.qty}`).join(', ')
      setItems([])
      setResult({ ok: true, msg: `Transferred ${fromBranch} → ${toBranch}: ${summary}` })
    } catch (err) {
      // The route names the product and both figures — "Catan: only 2 at
      // Main, tried to move 5" — which is more use than a sentinel the browser
      // had to reword. Fall back only when there is genuinely no message.
      const msg = err instanceof Error && err.message
        ? err.message
        : 'Transfer failed. Please try again.'
      setResult({ ok: false, msg })
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) return null

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: isMobile ? '1.25rem 1rem 3rem' : '2rem 1.5rem 4rem' }}>
      <p style={{ fontSize: '0.68rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--teal)', fontFamily: 'var(--font-inter)', marginBottom: '0.6rem' }}>
        Product Catalogue
      </p>
      <h1 style={{ fontFamily: 'var(--font-cinzel)', fontSize: '1.8rem', color: 'var(--offwhite)', marginBottom: '0.4rem' }}>
        Transfer Stock
      </h1>
      <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(245,242,236,0.4)', marginBottom: '2.5rem' }}>
        Move copies of one or more products between branches in a single transfer.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

        {/* ── Branch row ── */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto 1fr', gap: '0.8rem', alignItems: isMobile ? 'stretch' : 'end' }}>
          <div>
            <label style={labelStyle}>From Branch</label>
            {lockedFrom ? (
              <div style={{
                ...selectStyle,
                color: 'rgba(245,242,236,0.5)',
                border: '1px solid rgba(255,255,255,0.06)',
                backgroundColor: '#141414',
                display: 'flex', alignItems: 'center',
              }}>
                {lockedFrom}
                <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', color: 'rgba(245,242,236,0.25)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  (your branch)
                </span>
              </div>
            ) : (
              <select value={fromBranch} onChange={e => setFromBranch(e.target.value)} style={selectStyle}>
                {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'center' : undefined, paddingBottom: isMobile ? 0 : '0.75rem' }}>
            <FontAwesomeIcon icon={faArrowRight} style={{ color: 'rgba(245,242,236,0.2)', width: '16px', transform: isMobile ? 'rotate(90deg)' : undefined }} />
          </div>

          <div>
            <label style={labelStyle}>To Branch</label>
            <select
              value={toBranch}
              onChange={e => setToBranch(e.target.value)}
              style={selectStyle}
            >
              {BRANCHES.filter(b => b !== fromBranch).map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        {/* ── Product search ── */}
        <div>
          <label style={labelStyle}>Add Products</label>
          <div style={{ position: 'relative' }}>
            <FontAwesomeIcon
              icon={faSearch}
              style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'rgba(245,242,236,0.3)', width: '13px', pointerEvents: 'none' }}
            />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search by name or category…"
              value={search}
              onChange={e => { setSearch(e.target.value); setShowResults(true) }}
              onFocus={() => setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 150)}
              style={{
                width: '100%',
                backgroundColor: '#1a1a1a',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'var(--offwhite)',
                padding: '0.75rem 1rem 0.75rem 2.4rem',
                borderRadius: '2px',
                fontSize: '0.85rem',
                fontFamily: 'var(--font-inter)',
                outline: 'none',
              }}
            />

            {showResults && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                border: '1px solid rgba(255,255,255,0.08)', borderTop: 'none',
                borderRadius: '0 0 2px 2px', backgroundColor: '#111',
                maxHeight: '220px', overflowY: 'auto',
              }}>
                {loadingGames ? (
                  <p style={{ padding: '0.8rem 1rem', fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)' }}>Loading…</p>
                ) : filteredGames.length === 0 ? (
                  <p style={{ padding: '0.8rem 1rem', fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(245,242,236,0.3)' }}>
                    {search.trim() ? 'No products found.' : 'All products already added.'}
                  </p>
                ) : filteredGames.slice(0, 12).map(g => {
                  const avail = g.stock[fromBranch] ?? 0
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => addGame(g)}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        width: '100%', textAlign: 'left',
                        background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)',
                        color: avail > 0 ? 'var(--offwhite)' : 'rgba(245,242,236,0.3)',
                        padding: '0.65rem 1rem', fontSize: '0.82rem',
                        fontFamily: 'var(--font-inter)', cursor: avail > 0 ? 'pointer' : 'default',
                      }}
                      onMouseEnter={e => { if (avail > 0) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.05)' }}
                      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'}
                    >
                      <span>{g.name}</span>
                      <span style={{ fontSize: '0.72rem', color: avail > 0 ? 'rgba(245,242,236,0.35)' : 'rgba(245,242,236,0.2)', marginLeft: '1rem', flexShrink: 0 }}>
                        {avail} at {fromBranch}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Transfer list ── */}
        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={labelStyle}>Products to Transfer</label>
            {items.map(item => {
              const available = item.product.stock[fromBranch] ?? 0
              const invalid   = item.qty < 1 || item.qty > available
              return (
                <div key={item.product.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.8rem',
                  alignItems: 'center',
                  padding: '0.8rem 1rem',
                  backgroundColor: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${invalid ? 'rgba(228,51,41,0.25)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: '2px',
                }}>
                  <div>
                    <p style={{ fontFamily: 'var(--font-cinzel)', fontSize: '0.85rem', color: 'var(--offwhite)', marginBottom: '0.15rem' }}>
                      {item.product.name}
                    </p>
                    <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', color: 'rgba(245,242,236,0.3)' }}>
                      {available} available at {fromBranch}
                      {invalid && item.qty > available ? ` — max ${available}` : ''}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={available}
                    value={item.qty}
                    onChange={e => setQty(item.product.id, parseInt(e.target.value) || 0)}
                    style={{
                      width: '72px',
                      backgroundColor: '#1a1a1a',
                      border: `1px solid ${invalid ? 'rgba(228,51,41,0.4)' : 'rgba(255,255,255,0.12)'}`,
                      color: 'var(--offwhite)',
                      padding: '0.5rem 0.6rem',
                      borderRadius: '2px',
                      fontSize: '0.85rem',
                      fontFamily: 'var(--font-inter)',
                      outline: 'none',
                      textAlign: 'center',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(item.product.id)}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'rgba(245,242,236,0.3)', cursor: 'pointer',
                      padding: '0.4rem', lineHeight: 1,
                    }}
                  >
                    <FontAwesomeIcon icon={faXmark} style={{ width: '14px' }} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Result banner ── */}
        {result && (
          <div style={{
            padding: '0.85rem 1rem', borderRadius: '2px',
            backgroundColor: result.ok ? 'rgba(0,160,152,0.1)' : 'rgba(228,51,41,0.1)',
            border: `1px solid ${result.ok ? 'rgba(0,160,152,0.3)' : 'rgba(228,51,41,0.3)'}`,
            fontFamily: 'var(--font-inter)', fontSize: '0.82rem',
            color: result.ok ? 'var(--teal)' : 'rgba(228,51,41,0.9)',
          }}>
            {result.msg}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          style={{
            alignSelf: 'flex-start',
            backgroundColor: !canSubmit || submitting ? 'rgba(0,160,152,0.3)' : 'var(--teal)',
            color: '#fff', border: 'none',
            padding: '0.8rem 2rem', borderRadius: '2px',
            fontSize: '0.78rem', letterSpacing: '0.1em', textTransform: 'uppercase',
            fontFamily: 'var(--font-inter)',
            cursor: !canSubmit || submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting
            ? 'Transferring…'
            : items.length > 0
              ? `Transfer ${items.length} Product${items.length > 1 ? 's' : ''}`
              : 'Transfer'}
        </button>
      </form>
    </div>
  )
}
