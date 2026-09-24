import type React from 'react'

export const inp: React.CSSProperties = {
  backgroundColor: 'rgba(var(--overlay-rgb),0.04)',
  border: '1px solid rgba(var(--overlay-rgb),0.1)',
  color: 'var(--offwhite)',
  padding: '0.6rem 0.8rem',
  borderRadius: '2px',
  fontSize: '0.88rem',
  outline: 'none',
  fontFamily: 'var(--font-inter)',
  width: '100%',
}

export const numInp: React.CSSProperties = { ...inp, textAlign: 'right', width: '90px' }

// Selects need a solid dark background — rgba on a native <select> leaves the
// OS-rendered dropdown options with white text on a white background.
export const selStyle: React.CSSProperties = { ...inp, backgroundColor: '#1a1a1a', cursor: 'pointer' }

export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.68rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'rgba(var(--offwhite-rgb),0.35)',
  marginBottom: '0.4rem',
  fontFamily: 'var(--font-inter)',
}

export const sectionHeader = (color: string): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: '0.6rem',
  paddingBottom: '0.6rem',
  borderBottom: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
  marginBottom: '1.25rem',
})
