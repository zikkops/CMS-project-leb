'use client'

import { exportGamesCSV } from '@big-cms/shared/productPurchases'
import type { Product } from './types'

export default function ProductsHeader({ isMobile, products, openNew }: {
  isMobile: boolean
  products: Product[]
  openNew: () => void
}) {
  return (
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
          color: 'rgba(var(--offwhite-rgb),0.3)',
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
          border: '1px solid rgba(var(--overlay-rgb),0.1)',
          color: 'rgba(var(--offwhite-rgb),0.6)',
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
          border: '1px solid rgba(var(--overlay-rgb),0.1)',
          color: 'rgba(var(--offwhite-rgb),0.6)',
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
          border: '1px solid rgba(var(--overlay-rgb),0.1)',
          color: 'rgba(var(--offwhite-rgb),0.6)',
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
  )
}
