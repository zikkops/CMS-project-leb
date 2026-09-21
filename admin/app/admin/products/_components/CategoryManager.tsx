'use client'

export default function CategoryManager({
  showCatManager, setShowCatManager, categories, displayCategories,
  deleteCategory, newCategory, setNewCategory, addCategory, addingCat,
}: {
  showCatManager: boolean
  setShowCatManager: (show: boolean) => void
  categories: string[]
  displayCategories: string[]
  deleteCategory: (name: string) => void
  newCategory: string
  setNewCategory: (name: string) => void
  addCategory: () => void
  addingCat: boolean
}) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <button onClick={() => setShowCatManager(!showCatManager)} style={{
        background: 'transparent',
        border: '1px solid rgba(var(--overlay-rgb),0.1)',
        color: 'rgba(var(--offwhite-rgb),0.5)',
        padding: '0.6rem 1.2rem',
        borderRadius: '2px',
        fontSize: '0.72rem',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        fontFamily: 'var(--font-inter)',
        marginBottom: '1rem',
      }}>
        {showCatManager ? 'Hide' : 'Manage'} Categories
      </button>

      {showCatManager && (
        <div style={{
          background: 'rgba(var(--overlay-rgb),0.02)',
          border: '1px solid rgba(var(--overlay-rgb),0.06)',
          borderRadius: '4px',
          padding: '1.5rem',
        }}>
          <p style={{
            fontSize: '0.68rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'rgba(var(--offwhite-rgb),0.3)',
            fontFamily: 'var(--font-inter)',
            marginBottom: '1rem',
          }}>Product Categories</p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            {displayCategories.map(cat => (
              <div key={cat} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                backgroundColor: 'rgba(var(--purple-rgb),0.1)',
                border: '1px solid rgba(var(--purple-rgb),0.2)',
                borderRadius: '2px',
                padding: '0.35rem 0.8rem',
              }}>
                <span style={{
                  fontFamily: 'var(--font-inter)',
                  fontSize: '0.82rem',
                  color: 'var(--offwhite)',
                }}>{cat}</span>
                {categories.length > 0 && (
                  <button onClick={() => deleteCategory(cat)} style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'rgba(var(--red-rgb),0.6)',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    padding: '0',
                    lineHeight: 1,
                  }}>✕</button>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', maxWidth: '400px' }}>
            <input
              type="text"
              placeholder="New category name…"
              value={newCategory}
              onChange={e => setNewCategory(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCategory()}
              style={{
                flex: 1,
                backgroundColor: '#1a1a1a',
                border: '1px solid rgba(var(--overlay-rgb),0.1)',
                color: 'var(--offwhite)',
                padding: '0.6rem 0.8rem',
                borderRadius: '2px',
                fontSize: '0.82rem',
                outline: 'none',
                fontFamily: 'var(--font-inter)',
              }}
            />
            <button onClick={addCategory} disabled={addingCat || !newCategory.trim()} style={{
              backgroundColor: 'var(--purple)',
              border: 'none',
              color: '#fff',
              padding: '0.6rem 1rem',
              borderRadius: '2px',
              fontSize: '0.82rem',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter)',
              opacity: addingCat || !newCategory.trim() ? 0.5 : 1,
            }}>+ Add</button>
          </div>
        </div>
      )}
    </div>
  )
}
