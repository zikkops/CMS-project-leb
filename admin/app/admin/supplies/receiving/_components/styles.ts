import type React from 'react'

export const inp: React.CSSProperties = {
  background: 'rgba(var(--overlay-rgb),0.05)', border: '1px solid rgba(var(--overlay-rgb),0.12)',
  color: 'var(--offwhite)', borderRadius: '4px', padding: '0.5rem 0.7rem',
  fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'var(--font-inter)',
}

export const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.65rem', letterSpacing: '0.12em',
  textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.35)',
  marginBottom: '0.4rem', fontFamily: 'var(--font-inter)',
}
