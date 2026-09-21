'use client'

import { totalStock } from '@big-cms/shared/branches'
import { formatUsd } from '@big-cms/shared/money'
import type { Product } from './types'

export default function ProductList({ loading, filteredGames, isMobile, openEdit, handleDelete }: {
  loading: boolean
  filteredGames: Product[]
  isMobile: boolean
  openEdit: (product: Product) => void
  handleDelete: (id: string) => void
}) {
  return (
    loading ? (
      <p style={{ color: 'rgba(var(--offwhite-rgb),0.3)', fontFamily: 'var(--font-inter)' }}>Loading…</p>
    ) : filteredGames.length === 0 ? (
      <div style={{
        border: '1px dashed rgba(var(--overlay-rgb),0.08)',
        borderRadius: '4px',
        padding: '3rem',
        textAlign: 'center',
        color: 'rgba(var(--offwhite-rgb),0.2)',
        fontFamily: 'var(--font-inter)',
        fontSize: '0.85rem',
      }}>No products match these filters.</div>
    ) : isMobile ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        {filteredGames.map(product => {
          const stock = totalStock(product.stock)
          return (
            <div key={product.id} style={{
              background: 'rgba(var(--overlay-rgb),0.02)',
              border: '1px solid rgba(var(--overlay-rgb),0.06)',
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
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.7rem', letterSpacing: '0.08em', color: 'rgba(var(--brand-secondary-rgb),0.85)' }}>
                    {product.sku}
                  </p>
                )}
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.78rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>
                  {product.category}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--teal)' }}>
                    {product.price > 0 ? formatUsd(product.price) : "—"}
                  </span>
                  <span style={{
                    fontSize: '0.68rem',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '2px',
                    backgroundColor: stock > 0 ? 'rgba(var(--teal-rgb),0.15)' : 'rgba(var(--red-rgb),0.15)',
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
                    border: '1px solid rgba(var(--overlay-rgb),0.1)',
                    color: 'rgba(var(--offwhite-rgb),0.5)',
                    padding: '0.5rem',
                    borderRadius: '2px',
                    fontSize: '0.72rem',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-inter)',
                  }}>Edit</button>
                  <button onClick={() => handleDelete(product.id)} style={{
                    flex: 1,
                    background: 'transparent',
                    border: '1px solid rgba(var(--red-rgb),0.3)',
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
        background: 'rgba(var(--overlay-rgb),0.02)',
        border: '1px solid rgba(var(--overlay-rgb),0.06)',
        borderRadius: '4px',
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(var(--overlay-rgb),0.06)' }}>
              {['Image', 'Name', 'Category', 'Retail', 'Wholesale', 'Stock', 'Actions'].map(h => (
                <th key={h} style={{
                  padding: '1rem 1.2rem',
                  textAlign: 'left',
                  fontSize: '0.65rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: 'rgba(var(--offwhite-rgb),0.3)',
                  fontFamily: 'var(--font-inter)',
                  fontWeight: 400,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredGames.map(product => (
              <tr key={product.id} style={{ borderBottom: '1px solid rgba(var(--overlay-rgb),0.04)' }}>
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
                    <span style={{ display: 'block', fontFamily: 'var(--font-inter)', fontSize: '0.68rem', letterSpacing: '0.08em', color: 'rgba(var(--brand-secondary-rgb),0.8)', marginTop: '0.15rem' }}>
                      {product.sku}
                    </span>
                  )}
                </td>
                <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.5)' }}>{product.category}</td>
                <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'var(--teal)' }}>
                  {product.price > 0 ? formatUsd(product.price) : "—"}
                </td>
                <td style={{ padding: '1rem 1.2rem', fontFamily: 'var(--font-inter)', fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.45)' }}>
                  {product.wholesalePrice != null ? formatUsd(product.wholesalePrice) : "—"}
                </td>
                <td style={{ padding: '1rem 1.2rem' }}>
                  {(() => {
                    const stock = totalStock(product.stock)
                    return (
                      <span style={{
                        fontSize: '0.72rem',
                        padding: '0.25rem 0.7rem',
                        borderRadius: '2px',
                        backgroundColor: stock > 0 ? 'rgba(var(--teal-rgb),0.15)' : 'rgba(var(--red-rgb),0.15)',
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
                      border: '1px solid rgba(var(--overlay-rgb),0.1)',
                      color: 'rgba(var(--offwhite-rgb),0.5)',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '2px',
                      fontSize: '0.7rem',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-inter)',
                    }}>Edit</button>
                    <button onClick={() => handleDelete(product.id)} style={{
                      background: 'transparent',
                      border: '1px solid rgba(var(--red-rgb),0.3)',
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
    )
  )
}
