// Shared by the page's search box and the product form.
export const inputStyle = {
  width: '100%',
  backgroundColor: '#1a1a1a',
  border: '1px solid rgba(var(--overlay-rgb),0.1)',
  color: 'var(--offwhite)',
  padding: '0.75rem 1rem',
  borderRadius: '2px',
  fontSize: '0.85rem',
  outline: 'none',
  fontFamily: 'var(--font-inter)',
}

export const labelStyle = {
  display: 'block',
  fontSize: '0.68rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase' as const,
  color: 'rgba(var(--offwhite-rgb),0.35)',
  marginBottom: '0.5rem',
  fontFamily: 'var(--font-inter)',
}
