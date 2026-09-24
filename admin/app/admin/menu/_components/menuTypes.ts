// Types, constants and shared style objects for the Menu Manager page and
// its pieces.

import type { PriceRule, TimeWindow } from '@big-cms/shared/timePricing'

/**
 * 'Charges' is for what a café sells that is not food or drink — a games
 * hour, an event fee, room hire (owner's request, 24 Sep 2026). A category in
 * it is a folder on the till like any other, but its items fire to no kitchen
 * station, take no staff-meal rate and are left out of the food cost rather
 * than counted as dishes with a recipe missing.
 */
export type Section = 'Food' | 'Beverage' | 'Sweets' | 'Charges'

export interface Category {
  id: string
  name: string
  section: Section
  image?: string
  order: number
}

export interface MenuItem {
  id: string
  name: string
  description: string
  price: number
  categoryId: string
  order: number
  badge?: string
  available: boolean
  /** Shown on the till's menu tiles. */
  image?: string
  /** Serving hours and happy-hour prices (UPGRADE.md T5.12), as stored; read with storedHours()/storedPriceRules(). */
  hours?: unknown
  priceRules?: unknown
  /** The items this combo is made of (UPGRADE.md T5.13). */
  comboOf?: unknown
}

export const EMPTY_ITEM = {
  name: '',
  description: '',
  price: 0,
  categoryId: '',
  order: 0,
  badge: '',
  available: true,
  image: '',
  hours: null as TimeWindow | null,
  priceRules: [] as PriceRule[],
  comboOf: [] as string[],
}

export type ItemForm = typeof EMPTY_ITEM

export const SECTIONS: Section[] = ['Food', 'Beverage', 'Sweets', 'Charges']

export const smallButton: React.CSSProperties = {
  background: 'transparent', border: '1px solid rgba(var(--overlay-rgb),0.15)', color: 'rgba(var(--offwhite-rgb),0.75)',
  padding: '0.45rem 0.8rem', borderRadius: '2px', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'var(--font-inter)',
}

export const sectionColors: Record<Section, string> = {
  Food:     'var(--teal)',
  Beverage: 'var(--purple)',
  Sweets:   'var(--red)',
  Charges:  'var(--navy)',
}

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
