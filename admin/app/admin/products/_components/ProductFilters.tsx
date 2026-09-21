'use client'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSearch } from '@fortawesome/free-solid-svg-icons'
import type { Product } from './types'
import { inputStyle } from './styles'

export default function ProductFilters({
  isMobile, search, setSearch, categoryFilter, setCategoryFilter,
  displayCategories, filteredGames, products,
}: {
  isMobile: boolean
  search: string
  setSearch: (search: string) => void
  categoryFilter: string
  setCategoryFilter: (category: string) => void
  displayCategories: string[]
  filteredGames: Product[]
  products: Product[]
}) {
  return (
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
          color: 'rgba(var(--offwhite-rgb),0.35)',
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
          color: 'var(--offwhite)',
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
        color: 'rgba(var(--offwhite-rgb),0.35)',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        flex: '0 0 auto',
      }}>
        <span style={{ color: 'var(--offwhite)', fontFamily: 'var(--font-cinzel)', marginRight: '0.3rem' }}>{filteredGames.length}</span> of {products.length}
      </p>
    </div>
  )
}
