'use client'

// The admin panel's shared controls (UPGRADE.md T2.1).
//
// Every admin page drew its own: `const inp` was declared in 19 files, there
// were 14 button-style constants, `h1` came in five sizes and pages in eight
// widths. The pieces here are the house style written down once, in the house
// way — inline style objects over the CSS variables, no classes — so a page
// built from them looks like every other page without anybody copying styles.
//
// Adopt page by page; nothing else changes when a page does.
// Module-scope components only (CONTRIBUTING.md gotcha #2).

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'

// Duplicated per file by convention — see CLAUDE.md. Don't refactor to share.
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

// ── Page ───────────────────────────────────────────────────────────────────

/** How wide a page's content runs. Three widths, not eight. */
export const PAGE_WIDTH = { narrow: '680px', normal: '960px', wide: '1240px' } as const

/**
 * The page itself: the background, the side padding, and one content width.
 */
export function Page({ width = 'normal', children }: { width?: keyof typeof PAGE_WIDTH; children: ReactNode }) {
  const isMobile = useIsMobile()
  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--black)', padding: isMobile ? '2rem 1.25rem 4rem' : '3rem 2.5rem 5rem' }}>
      <div style={{ maxWidth: PAGE_WIDTH[width], margin: '0 auto' }}>{children}</div>
    </div>
  )
}

/**
 * A page's heading: which section it belongs to, its title, one or two
 * sentences on what it is for, and the page's own actions on the right.
 */
export function PageHeader({ section, title, lead, actions }: {
  section?: string
  title: string
  lead?: ReactNode
  actions?: ReactNode
}) {
  const isMobile = useIsMobile()
  return (
    <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        {section && (
          <p style={{
            fontFamily: 'var(--font-inter)', fontSize: '0.72rem', letterSpacing: '0.2em',
            textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.5)', marginBottom: '0.5rem',
          }}>{section}</p>
        )}
        <h1 style={{
          fontFamily: 'var(--font-cinzel)', fontSize: isMobile ? '1.7rem' : '2.1rem',
          color: 'var(--offwhite)', marginBottom: lead ? '0.6rem' : 0, lineHeight: 1.15,
        }}>{title}</h1>
        {lead && (
          <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.9rem', color: 'rgba(var(--offwhite-rgb),0.55)', lineHeight: 1.7, maxWidth: '62ch' }}>{lead}</p>
        )}
      </div>
      {actions && <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>{actions}</div>}
    </header>
  )
}

/** A titled block of a page. */
export function Panel({ title, children, style }: { title?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{
      marginBottom: '2rem', padding: '1.4rem 1.5rem',
      backgroundColor: 'rgba(var(--offwhite-rgb),0.02)', border: '1px solid rgba(var(--offwhite-rgb),0.08)',
      borderRadius: '6px', ...style,
    }}>
      {title && (
        <h2 style={{
          fontFamily: 'var(--font-inter)', fontSize: '0.72rem', letterSpacing: '0.18em',
          textTransform: 'uppercase', color: 'rgba(var(--offwhite-rgb),0.55)', marginBottom: '0.6rem',
        }}>{title}</h2>
      )}
      {children}
    </section>
  )
}

// ── Buttons ────────────────────────────────────────────────────────────────

export type ButtonTone = 'primary' | 'danger' | 'quiet' | 'neutral'

const TONES: Record<ButtonTone, { bg: string; border: string; color: string }> = {
  primary: { bg: 'var(--teal)', border: 'var(--teal)', color: '#fff' },
  danger: { bg: 'var(--red)', border: 'var(--red)', color: '#fff' },
  neutral: { bg: 'rgba(var(--offwhite-rgb),0.07)', border: 'rgba(var(--offwhite-rgb),0.2)', color: 'var(--offwhite)' },
  quiet: { bg: 'transparent', border: 'rgba(var(--offwhite-rgb),0.2)', color: 'rgba(var(--offwhite-rgb),0.8)' },
}

/**
 * A button. Teal is the page's main action and nothing else; red ends or
 * removes something; quiet is everything else. At least 44px tall. Disabled is
 * dashed as well as dim, so it reads as a different state, not a paler button.
 */
export function Button({ children, tone = 'quiet', icon, onClick, disabled, type = 'button', full, style, ariaLabel }: {
  children: ReactNode
  tone?: ButtonTone
  icon?: IconDefinition
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  full?: boolean
  style?: CSSProperties
  ariaLabel?: string
}) {
  const t = TONES[tone]
  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
        minHeight: '44px', padding: '0 1.2rem', borderRadius: '6px', width: full ? '100%' : undefined,
        fontFamily: 'var(--font-inter)', fontSize: '0.85rem', fontWeight: 600, letterSpacing: '0.02em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? 'transparent' : t.bg,
        border: `1px ${disabled ? 'dashed' : 'solid'} ${disabled ? 'rgba(var(--offwhite-rgb),0.2)' : t.border}`,
        color: disabled ? 'rgba(var(--offwhite-rgb),0.35)' : t.color,
        ...style,
      }}
    >
      {icon && <FontAwesomeIcon icon={icon} style={{ flexShrink: 0 }} />}
      {children}
    </button>
  )
}

// ── Forms ──────────────────────────────────────────────────────────────────

/** The one input style: text, number, select and textarea alike. */
export const inputStyle: CSSProperties = {
  width: '100%', minHeight: '44px', boxSizing: 'border-box',
  background: 'rgba(var(--offwhite-rgb),0.04)', border: '1px solid rgba(var(--offwhite-rgb),0.14)',
  borderRadius: '6px', padding: '0.65rem 0.85rem', color: 'var(--offwhite)',
  fontFamily: 'var(--font-inter)', fontSize: '0.95rem', outline: 'none',
}

/**
 * A labelled field: the label is tied to the control (`id`), with an optional
 * hint under it and an error in red. Pass the control as children, with
 * `id={id}` and `style={inputStyle}`.
 */
export function Field({ id, label, hint, error, required, children }: {
  id: string
  label: string
  hint?: ReactNode
  error?: string | null
  required?: boolean
  children: ReactNode
}) {
  return (
    <div style={{ marginBottom: '1.1rem' }}>
      <label htmlFor={id} style={{
        display: 'block', fontFamily: 'var(--font-inter)', fontSize: '0.8rem', fontWeight: 600,
        color: 'rgba(var(--offwhite-rgb),0.75)', marginBottom: '0.4rem',
      }}>{label}{required ? ' *' : ''}</label>
      {children}
      {hint && <p style={{ fontFamily: 'var(--font-inter)', fontSize: '0.75rem', color: 'rgba(var(--offwhite-rgb),0.4)', lineHeight: 1.5, marginTop: '0.4rem' }}>{hint}</p>}
      {error && <p role="alert" style={{ fontFamily: 'var(--font-inter)', fontSize: '0.8rem', color: 'var(--red)', lineHeight: 1.5, marginTop: '0.4rem' }}>{error}</p>}
    </div>
  )
}

// ── States ─────────────────────────────────────────────────────────────────

/** Instead of a blank area while something loads. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '1rem 0',
      fontFamily: 'var(--font-inter)', fontSize: '0.88rem', color: 'rgba(var(--offwhite-rgb),0.45)',
    }}>
      <span aria-hidden style={{
        width: '0.95rem', height: '0.95rem', borderRadius: '50%',
        border: '2px solid rgba(var(--offwhite-rgb),0.2)', borderTopColor: 'rgba(var(--offwhite-rgb),0.7)',
        animation: 'admin-spin 0.8s linear infinite',
      }} />
      {label}
      <style>{'@keyframes admin-spin { to { transform: rotate(360deg) } }'}</style>
    </p>
  )
}

/**
 * Nothing to show, said as what it means and what to do, never an empty box
 * that reads as broken.
 */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ padding: '1.4rem 0', fontFamily: 'var(--font-inter)' }}>
      <p style={{ fontSize: '0.92rem', color: 'rgba(var(--offwhite-rgb),0.7)', fontWeight: 600, marginBottom: children ? '0.3rem' : 0 }}>{title}</p>
      {children && <p style={{ fontSize: '0.82rem', color: 'rgba(var(--offwhite-rgb),0.45)', lineHeight: 1.6 }}>{children}</p>}
      {action && <div style={{ marginTop: '0.8rem' }}>{action}</div>}
    </div>
  )
}

/** A problem with the page as a whole, in red, in words. */
export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" style={{
      color: 'var(--red)', fontFamily: 'var(--font-inter)', fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '1rem',
      background: 'rgba(var(--red-rgb),0.08)', border: '1px solid rgba(var(--red-rgb),0.3)', borderRadius: '6px', padding: '0.7rem 0.9rem',
    }}>{children}</p>
  )
}
