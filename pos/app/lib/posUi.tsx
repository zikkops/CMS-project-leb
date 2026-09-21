'use client'

// How the POS looks and feels — one place for how big a button is, what each
// colour means, and which icon goes with which action.
//
// ── Why this exists ────────────────────────────────────────────────────────
// Every POS screen had its own `tap` constant, and teal meant five things at
// once: selected, primary, money, "fresh", and "sent". The most-used controls
// were the smallest on the screen (a 32×28 ⋯ that opens void and discount, a
// 15px-tall nav link at 35% opacity), and the main action on a screen looked
// the same as the one beside it. Owner's request, 14 Sep 2026: "more UI
// elements, and easier to distinguish and press" — for a touch screen or PC.
//
// So a colour has one meaning here:
//   teal    the main action on the screen, and nothing else loud
//   red     destroys or ends something (void, close, refund, drop)
//   amber   needs attention (not sent yet, waiting, a warning)
//   a hue   what KIND of thing — a menu category, a kitchen station
// and every action carries an icon as well as a word, so nothing is told apart
// by colour alone.
//
// Module-scope components only (CONTRIBUTING.md gotcha #2).

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation, type IconDefinition } from '@fortawesome/free-solid-svg-icons'

export type Tone = 'primary' | 'neutral' | 'danger' | 'warn' | 'quiet'

/**
 * All is well: online, paid, change handed back, food ready. Green, never
 * teal, which is kept for the one main action on a screen (UPGRADE.md T1.9).
 */
export const GOOD = '#22C55E'
export const GOOD_RGB = '34,197,94'
export type Size = 'sm' | 'md' | 'lg'

/** Touch heights. `sm` still clears the 44px floor; `md` is the default for a touch screen. */
export const HEIGHT: Record<Size, number> = { sm: 44, md: 56, lg: 68 }
const FONT: Record<Size, string> = { sm: '0.88rem', md: '1rem', lg: '1.12rem' }

const TONE: Record<Tone, { bg: string; border: string; color: string }> = {
  primary: { bg: 'var(--teal)', border: 'var(--teal)', color: '#fff' },
  neutral: { bg: 'rgba(var(--overlay-rgb),0.07)', border: 'rgba(var(--overlay-rgb),0.2)', color: 'var(--offwhite)' },
  danger: { bg: 'rgba(var(--red-rgb),0.14)', border: 'rgba(var(--red-rgb),0.6)', color: 'var(--red)' },
  warn: { bg: 'rgba(var(--brand-secondary-rgb),0.14)', border: 'rgba(var(--brand-secondary-rgb),0.55)', color: 'var(--brand-secondary)' },
  quiet: { bg: 'transparent', border: 'rgba(var(--overlay-rgb),0.14)', color: 'rgba(var(--offwhite-rgb),0.75)' },
}

/**
 * A button that says what it does twice — an icon and a word — at a size a
 * finger can find without looking.
 *
 * Disabled does not just fade: a faded teal button reads as a slightly dimmer
 * teal button. It goes grey and dashed, so "cannot press this yet" is a
 * different shape, not a different shade.
 */
export function PosButton({
  icon, label, tone = 'neutral', size = 'md', onClick, disabled, badge, full, grow, style, ariaLabel, title, iconOnly, type = 'button',
}: {
  icon?: IconDefinition
  label: ReactNode
  tone?: Tone
  size?: Size
  onClick?: () => void
  disabled?: boolean
  /** A count shown in a pill — e.g. how many items Send will send. */
  badge?: number | string | null
  full?: boolean
  /** flex-grow, for action bars where the main action gets more room. */
  grow?: number
  style?: CSSProperties
  ariaLabel?: string
  title?: string
  /** Show only the icon (the label is still the accessible name). */
  iconOnly?: boolean
  /** 'submit' for the main button of a form, so Enter presses it. */
  type?: 'button' | 'submit'
}) {
  const t = TONE[tone]
  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      title={title ?? (iconOnly && typeof label === 'string' ? label : undefined)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.55rem',
        minHeight: `${HEIGHT[size]}px`,
        // A button sharing a bar (grow) may shrink below its text's width: without
        // this a flex item never goes narrower than its content, and on a phone
        // the bar ran off the screen with Send half outside it (16 Sep, a café).
        minWidth: iconOnly ? `${HEIGHT[size]}px` : grow ? 0 : undefined,
        // A button sharing a bar gets tighter sides, so its word still fits
        // on one line when the bar is a phone's width.
        padding: iconOnly ? '0' : size === 'sm' || grow ? '0 0.75rem' : '0 1.1rem',
        width: full ? '100%' : undefined, flex: grow ? `${grow} 1 0` : undefined,
        borderRadius: '8px', cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-inter)', fontSize: FONT[size], fontWeight: tone === 'primary' ? 700 : 600,
        letterSpacing: '0.01em', lineHeight: 1.15, textAlign: 'center',
        background: disabled ? 'rgba(var(--overlay-rgb),0.03)' : t.bg,
        border: `${disabled ? '1px dashed' : tone === 'primary' ? '2px solid' : '1px solid'} ${disabled ? 'rgba(var(--overlay-rgb),0.16)' : t.border}`,
        color: disabled ? 'rgba(var(--offwhite-rgb),0.35)' : t.color,
        boxShadow: tone === 'primary' && !disabled ? '0 4px 14px rgba(var(--teal-rgb),0.28)' : 'none',
        transition: 'background 120ms, transform 80ms',
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
    >
      {icon && <FontAwesomeIcon icon={icon} style={{ fontSize: size === 'lg' ? '1.15em' : '1.05em', flexShrink: 0 }} />}
      {!iconOnly && <span style={{ overflowWrap: 'break-word' }}>{label}</span>}
      {badge !== undefined && badge !== null && badge !== 0 && (
        <span style={{
          minWidth: '1.6rem', height: '1.6rem', padding: '0 0.45rem', borderRadius: '999px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.85rem', fontWeight: 700,
          background: tone === 'primary' && !disabled ? 'rgba(0,0,0,0.25)' : 'rgba(var(--overlay-rgb),0.12)',
          color: 'inherit',
        }}>{badge}</span>
      )}
    </button>
  )
}

/**
 * A choice among several — a category, a seat, a course, a tender.
 *
 * Selected is a SOLID fill in the chip's own colour with a check-weight
 * border, not a slightly brighter outline: the old active category tab was
 * readable only if you already knew which one you had picked.
 */
export function Chip({ label, active, onClick, colour, icon, size = 'md', count, disabled }: {
  label: ReactNode
  active: boolean
  onClick: () => void
  /** Any CSS colour. Defaults to teal. */
  colour?: string
  icon?: IconDefinition
  size?: Size
  count?: number
  disabled?: boolean
}) {
  const c = colour ?? 'var(--teal)'
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap',
        minHeight: `${HEIGHT[size]}px`, padding: size === 'sm' ? '0 0.85rem' : '0 1.1rem',
        borderRadius: '999px', cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-inter)', fontSize: FONT[size], fontWeight: active ? 700 : 500,
        background: active ? c : 'rgba(var(--overlay-rgb),0.04)',
        border: `2px solid ${active ? c : 'rgba(var(--overlay-rgb),0.14)'}`,
        color: active ? '#fff' : 'var(--offwhite)',
        opacity: disabled ? 0.4 : 1,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {!active && colour && (
        <span style={{ width: '0.7rem', height: '0.7rem', borderRadius: '50%', background: c, flexShrink: 0 }} />
      )}
      {icon && <FontAwesomeIcon icon={icon} />}
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span style={{ fontSize: '0.8em', opacity: 0.85 }}>{count}</span>
      )}
    </button>
  )
}

/** A small labelled state, with an icon so it is never colour alone. */
export function StatusBadge({ icon, label, tone = 'neutral' }: { icon?: IconDefinition; label: ReactNode; tone?: Tone }) {
  const t = TONE[tone]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap',
      padding: '0.22rem 0.6rem', borderRadius: '999px',
      fontFamily: 'var(--font-inter)', fontSize: '0.78rem', fontWeight: 600,
      background: tone === 'primary' ? 'rgba(var(--teal-rgb),0.16)' : tone === 'neutral' ? 'rgba(var(--overlay-rgb),0.07)' : t.bg,
      border: `1px solid ${tone === 'primary' ? 'rgba(var(--teal-rgb),0.5)' : t.border}`,
      color: tone === 'primary' ? 'var(--teal)' : t.color,
    }}>
      {icon && <FontAwesomeIcon icon={icon} />}
      {label}
    </span>
  )
}

/** A heading over a group of lines or controls. Readable, not a 0.6rem whisper. */
export function SectionLabel({ children, icon, colour, right }: { children: ReactNode; icon?: IconDefinition; colour?: string; right?: ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem',
      margin: '1.1rem 0 0.5rem',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
        fontFamily: 'var(--font-inter)', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: colour ?? 'rgba(var(--offwhite-rgb),0.55)',
      }}>
        {icon && <FontAwesomeIcon icon={icon} />}
        {children}
      </span>
      {right}
    </div>
  )
}

/**
 * Colours for KINDS of thing: menu categories in order, and kitchen stations.
 *
 * Deliberately not the brand palette. A brand colour is decoration and can
 * change per client; these only have to be different from each other, and
 * from the three that carry a meaning (teal, red, amber).
 */
export const KIND_COLOURS = ['#3B82F6', '#EC4899', '#22C55E', '#A855F7', '#F97316', '#06B6D4', '#EAB308', '#EF7A9B'] as const

export function kindColour(index: number): string {
  return KIND_COLOURS[((index % KIND_COLOURS.length) + KIND_COLOURS.length) % KIND_COLOURS.length]
}

export const STATION_COLOUR: Record<string, string> = {
  Kitchen: '#F97316',
  Bar: '#3B82F6',
  Sweets: '#EC4899',
}

/**
 * What a till screen shows while it checks who is signed in, instead of a
 * blank page. On a slow phone that check can take a second or two, and a
 * black screen reads as broken (UPGRADE.md T1.1).
 */
export function PosLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <main role="status" aria-live="polite" style={{
      minHeight: '100vh', backgroundColor: 'var(--black)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', gap: '0.7rem',
      fontFamily: 'var(--font-inter)', fontSize: '1.05rem', color: 'rgba(var(--offwhite-rgb),0.6)',
    }}>
      <span aria-hidden style={{
        width: '1.1rem', height: '1.1rem', borderRadius: '50%',
        border: '2px solid rgba(var(--offwhite-rgb),0.2)', borderTopColor: 'rgba(var(--offwhite-rgb),0.7)',
        animation: 'pos-spin 0.8s linear infinite',
      }} />
      {label}
      <style>{'@keyframes pos-spin { to { transform: rotate(360deg) } }'}</style>
    </main>
  )
}

/**
 * A number with − and + either side, for counts a chip row cannot hold: a
 * party of eleven, a quantity of twelve (UPGRADE.md T1.4). Each button is a
 * full touch target; the value between them is read out as it changes.
 */
export function Stepper({ value, onChange, min = 1, max = 99, label }: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  /** What is being counted, for screen readers: "Guests". */
  label: string
}) {
  const btn: CSSProperties = {
    width: `${HEIGHT.sm}px`, height: `${HEIGHT.sm}px`, borderRadius: '8px',
    background: 'rgba(var(--overlay-rgb),0.07)', border: '1px solid rgba(var(--overlay-rgb),0.2)',
    color: 'var(--offwhite)', fontSize: '1.3rem', fontWeight: 700, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
  return (
    <div role="group" aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))} style={{ ...btn, opacity: value <= min ? 0.35 : 1 }}>−</button>
      <span aria-live="polite" style={{
        minWidth: '2.4rem', textAlign: 'center', fontFamily: 'var(--font-inter)',
        fontSize: '1.25rem', fontWeight: 700, color: 'var(--offwhite)',
      }}>{value}</span>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))} style={{ ...btn, opacity: value >= max ? 0.35 : 1 }}>+</button>
    </div>
  )
}

/**
 * The first sentence of a message, and the rest. A server's refusal can run to
 * several sentences, and a waiter reads one (UPGRADE.md T1.7).
 */
export function splitMessage(text: string): { head: string; rest: string } {
  const m = text.match(/^(.+?[.!?])s+(S[sS]*)$/)
  return m ? { head: m[1], rest: m[2] } : { head: text, rest: '' }
}

/**
 * A problem, said in one sentence, with the rest behind "Details". `details`
 * is what to show there; without it, anything after the message's first
 * sentence goes there.
 */
export function ErrorNote({ message, details, tone = 'danger' }: {
  message: string
  details?: string | null
  tone?: 'danger' | 'warn'
}) {
  const [open, setOpen] = useState(false)
  const split = details === undefined ? splitMessage(message) : { head: message, rest: details ?? '' }
  const colour = tone === 'danger' ? 'var(--red)' : 'var(--brand-secondary)'
  const rgb = tone === 'danger' ? 'var(--red-rgb)' : 'var(--brand-secondary-rgb)'
  return (
    <div role="alert" style={{
      color: colour, fontSize: '0.95rem', marginBottom: '1rem', lineHeight: 1.55,
      background: `rgba(${rgb},0.1)`, border: `1px solid rgba(${rgb},0.35)`,
      borderRadius: '8px', padding: '0.8rem 1rem', fontFamily: 'var(--font-inter)',
    }}>
      <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.5rem' }} />
      {split.head}
      {split.rest && (
        <>
          {' '}
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} style={{
            background: 'none', border: 'none', padding: '0 0.2rem', color: 'inherit', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 700, textDecoration: 'underline',
          }}>{open ? 'Less' : 'Details'}</button>
          {open && <span style={{ display: 'block', marginTop: '0.4rem', opacity: 0.85, fontSize: '0.88rem' }}>{split.rest}</span>}
        </>
      )}
    </div>
  )
}

/**
 * A sheet over the screen: the options for a dish, what to do with a line, how
 * to close a check (UPGRADE.md T2.3). Each used to be two divs, which a screen
 * reader did not know was a dialog, which Escape did not close, and which left
 * the focus behind it on the page.
 *
 * - role="dialog", aria-modal, and a label.
 * - Escape closes it, as the backdrop does.
 * - Focus moves into it when it opens and back where it was when it closes.
 * - `backdropCloses={false}` for a sheet holding choices a stray tap must not
 *   throw away (the options for a dish).
 * - `onSubmit` makes the panel a form, so Enter submits it.
 * - `center` puts it in the middle of a wide screen instead of at the bottom.
 */
export function Sheet({ label, onClose, children, backdropCloses = true, onSubmit, center = false }: {
  label: string
  onClose: () => void
  children: ReactNode
  backdropCloses?: boolean
  onSubmit?: () => void
  center?: boolean
}) {
  const panel = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    // Into the sheet: its own autofocus field if it has one, else its first control.
    const el = panel.current
    if (el && !el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>('[autofocus], input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])')
      ;(first ?? el).focus()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (before && document.contains(before)) before.focus()
    }
  }, [])

  const inner: CSSProperties = {
    backgroundColor: '#111', width: '100%', maxWidth: center ? '560px' : '720px',
    maxHeight: '90vh', overflowY: 'auto', borderRadius: center ? '14px' : '14px 14px 0 0',
    padding: '1.4rem 1.2rem 2rem', border: '1px solid rgba(var(--overlay-rgb),0.12)', outline: 'none',
  }
  const common = {
    role: 'dialog' as const, 'aria-modal': true, 'aria-label': label, tabIndex: -1, style: inner,
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  }
  return (
    <div
      onClick={backdropCloses ? onClose : undefined}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 50,
        display: 'flex', alignItems: center ? 'center' : 'flex-end', justifyContent: 'center',
      }}
    >
      {onSubmit
        ? <form {...common} ref={el => { panel.current = el }} onSubmit={e => { e.preventDefault(); onSubmit() }}>{children}</form>
        : <div {...common} ref={el => { panel.current = el }}>{children}</div>}
    </div>
  )
}
