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

import type { CSSProperties, ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'

export type Tone = 'primary' | 'neutral' | 'danger' | 'warn' | 'quiet'
export type Size = 'sm' | 'md' | 'lg'

/** Touch heights. `sm` still clears the 44px floor; `md` is the default for a touch screen. */
export const HEIGHT: Record<Size, number> = { sm: 44, md: 56, lg: 68 }
const FONT: Record<Size, string> = { sm: '0.88rem', md: '1rem', lg: '1.12rem' }

const TONE: Record<Tone, { bg: string; border: string; color: string }> = {
  primary: { bg: 'var(--teal)', border: 'var(--teal)', color: '#fff' },
  neutral: { bg: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.2)', color: 'var(--offwhite)' },
  danger: { bg: 'rgba(var(--red-rgb),0.14)', border: 'rgba(var(--red-rgb),0.6)', color: 'var(--red)' },
  warn: { bg: 'rgba(var(--brand-secondary-rgb),0.14)', border: 'rgba(var(--brand-secondary-rgb),0.55)', color: 'var(--brand-secondary)' },
  quiet: { bg: 'transparent', border: 'rgba(255,255,255,0.14)', color: 'rgba(var(--offwhite-rgb),0.75)' },
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
  icon, label, tone = 'neutral', size = 'md', onClick, disabled, badge, full, grow, style, ariaLabel, title, iconOnly,
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
}) {
  const t = TONE[tone]
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      title={title ?? (iconOnly && typeof label === 'string' ? label : undefined)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.55rem',
        minHeight: `${HEIGHT[size]}px`, minWidth: iconOnly ? `${HEIGHT[size]}px` : undefined,
        padding: iconOnly ? '0' : size === 'sm' ? '0 0.85rem' : '0 1.1rem',
        width: full ? '100%' : undefined, flex: grow ? `${grow} 1 0` : undefined,
        borderRadius: '8px', cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-inter)', fontSize: FONT[size], fontWeight: tone === 'primary' ? 700 : 600,
        letterSpacing: '0.01em', lineHeight: 1.15, textAlign: 'center',
        background: disabled ? 'rgba(255,255,255,0.03)' : t.bg,
        border: `${disabled ? '1px dashed' : tone === 'primary' ? '2px solid' : '1px solid'} ${disabled ? 'rgba(255,255,255,0.16)' : t.border}`,
        color: disabled ? 'rgba(var(--offwhite-rgb),0.35)' : t.color,
        boxShadow: tone === 'primary' && !disabled ? '0 4px 14px rgba(var(--teal-rgb),0.28)' : 'none',
        transition: 'background 120ms, transform 80ms',
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
    >
      {icon && <FontAwesomeIcon icon={icon} style={{ fontSize: size === 'lg' ? '1.15em' : '1.05em', flexShrink: 0 }} />}
      {!iconOnly && <span>{label}</span>}
      {badge !== undefined && badge !== null && badge !== 0 && (
        <span style={{
          minWidth: '1.6rem', height: '1.6rem', padding: '0 0.45rem', borderRadius: '999px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.85rem', fontWeight: 700,
          background: tone === 'primary' && !disabled ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.12)',
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
        background: active ? c : 'rgba(255,255,255,0.04)',
        border: `2px solid ${active ? c : 'rgba(255,255,255,0.14)'}`,
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
      background: tone === 'primary' ? 'rgba(var(--teal-rgb),0.16)' : tone === 'neutral' ? 'rgba(255,255,255,0.07)' : t.bg,
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
