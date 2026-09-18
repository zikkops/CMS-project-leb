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

// ── Tables (UPGRADE.md T2.2) ───────────────────────────────────────────────

export interface Column<T> {
  key: string
  label: string
  /** What the cell shows; the row's `key` field as text when omitted. */
  render?: (row: T) => ReactNode
  /** Makes the column sortable: compare two rows. */
  sort?: (a: T, b: T) => number
  align?: 'left' | 'right' | 'center'
  width?: string
}

/**
 * A table with a search box, sortable columns and an empty state: the three
 * things most list pages each wrote for themselves, or went without (only ten
 * of 57 admin pages had a search box).
 */
export function DataTable<T>({ columns, rows, rowKey, empty, search, searchLabel = 'Search' }: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** Shown when there are no rows at all (not when a search finds none). */
  empty: ReactNode
  /** Whether a row matches the search text (lower case); no search box without it. */
  search?: (row: T, query: string) => boolean
  searchLabel?: string
}) {
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const q = query.trim().toLowerCase()
  const shown = rows.filter(r => !search || !q || search(r, q))
  const column = sortBy ? columns.find(c => c.key === sortBy.key) : undefined
  const sorted = column?.sort && sortBy ? [...shown].sort((a, b) => column.sort!(a, b) * sortBy.dir) : shown

  if (rows.length === 0) return <>{empty}</>
  return (
    <div>
      {search && (
        <input
          type="search" value={query} onChange={e => setQuery(e.target.value)}
          aria-label={searchLabel} placeholder={`${searchLabel}…`}
          style={{ ...inputStyle, marginBottom: '0.9rem', maxWidth: '360px' }}
        />
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-inter)', fontSize: '0.88rem' }}>
          <thead>
            <tr>
              {columns.map(c => {
                const active = sortBy?.key === c.key
                return (
                  <th key={c.key} scope="col" aria-sort={active && sortBy ? (sortBy.dir === 1 ? 'ascending' : 'descending') : undefined}
                    style={{
                      textAlign: c.align ?? 'left', width: c.width, padding: '0.6rem 0.7rem',
                      fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600,
                      color: 'rgba(var(--offwhite-rgb),0.5)', borderBottom: '1px solid rgba(var(--offwhite-rgb),0.12)',
                    }}>
                    {c.sort ? (
                      <button type="button"
                        onClick={() => setSortBy(active && sortBy ? { key: c.key, dir: sortBy.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', cursor: 'pointer' }}>
                        {c.label}{active && sortBy ? (sortBy.dir === 1 ? ' ↑' : ' ↓') : ''}
                      </button>
                    ) : c.label}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={rowKey(row)} style={{ borderBottom: '1px solid rgba(var(--offwhite-rgb),0.06)' }}>
                {columns.map(c => (
                  <td key={c.key} style={{ textAlign: c.align ?? 'left', padding: '0.7rem', color: 'var(--offwhite)', verticalAlign: 'top' }}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && <EmptyState title={`Nothing matches "${query.trim()}".`} />}
    </div>
  )
}

// ── Confirming and telling (UPGRADE.md T2.2) ───────────────────────────────

export interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmLabel?: string
  /** 'danger' when confirming removes or ends something. */
  tone?: 'danger' | 'primary'
}

/**
 * A confirmation in the page's own style, instead of the browser's confirm(),
 * which a kiosk may block and which reads like an error.
 *
 *   const { confirm, dialog } = useConfirm()
 *   if (!(await confirm({ title: 'Delete this?', tone: 'danger' }))) return
 *   … and render {dialog} once in the page.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [asking, setAsking] = useState<(ConfirmOptions & { resolve: (yes: boolean) => void }) | null>(null)
  const confirm = (options: ConfirmOptions) => new Promise<boolean>(resolve => setAsking({ ...options, resolve }))
  const answer = (yes: boolean) => { asking?.resolve(yes); setAsking(null) }
  const dialog = asking ? <ConfirmDialog options={asking} onAnswer={answer} /> : null
  return { confirm, dialog }
}

function ConfirmDialog({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (yes: boolean) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onAnswer(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAnswer])
  return (
    <div onClick={() => onAnswer(false)} style={{
      position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem',
    }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: '440px', background: '#141414', border: '1px solid rgba(var(--offwhite-rgb),0.14)',
        borderRadius: '10px', padding: '1.4rem 1.3rem', fontFamily: 'var(--font-inter)',
      }}>
        <h2 id="confirm-title" style={{ fontSize: '1.05rem', color: 'var(--offwhite)', marginBottom: options.body ? '0.5rem' : '1.2rem' }}>{options.title}</h2>
        {options.body && <p style={{ fontSize: '0.88rem', color: 'rgba(var(--offwhite-rgb),0.65)', lineHeight: 1.6, marginBottom: '1.2rem' }}>{options.body}</p>}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem' }}>
          <Button onClick={() => onAnswer(false)}>Cancel</Button>
          <Button tone={options.tone ?? 'primary'} onClick={() => onAnswer(true)}>{options.confirmLabel ?? 'Confirm'}</Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Short messages that come and go, instead of alert(): "Saved", or what went
 * wrong. Errors stay until closed; anything else goes after four seconds.
 *
 *   const { toast, toasts } = useToast()
 *   toast('Saved.')  ·  toast('Could not save.', 'error')
 *   … and render {toasts} once in the page.
 */
export function useToast(): { toast: (text: string, kind?: 'info' | 'error') => void; toasts: ReactNode } {
  const [items, setItems] = useState<{ id: number; text: string; kind: 'info' | 'error' }[]>([])
  const toast = (text: string, kind: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random()
    setItems(list => [...list, { id, text, kind }])
    if (kind === 'info') setTimeout(() => setItems(list => list.filter(i => i.id !== id)), 4000)
  }
  const toasts = items.length === 0 ? null : (
    <div aria-live="polite" style={{ position: 'fixed', right: '1rem', bottom: '1rem', zIndex: 310, display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 'calc(100vw - 2rem)' }}>
      {items.map(i => (
        <div key={i.id} role={i.kind === 'error' ? 'alert' : 'status'} style={{
          display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.75rem 0.9rem', borderRadius: '8px',
          fontFamily: 'var(--font-inter)', fontSize: '0.88rem', maxWidth: '420px',
          background: i.kind === 'error' ? 'rgba(var(--red-rgb),0.95)' : '#1d1d1d',
          border: `1px solid ${i.kind === 'error' ? 'var(--red)' : 'rgba(var(--offwhite-rgb),0.18)'}`, color: '#fff',
        }}>
          <span style={{ flex: 1 }}>{i.text}</span>
          <button type="button" aria-label="Close" onClick={() => setItems(list => list.filter(x => x.id !== i.id))}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem', padding: '0 0.2rem' }}>×</button>
        </div>
      ))}
    </div>
  )
  return { toast, toasts }
}
