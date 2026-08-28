'use client'

// A persistent, unmissable marker that this deployment is not a real business.
//
// This exists because the fork's whole purpose is to be somewhere experiments
// can't hurt anyone — and an unbranded café site on a public Vercel URL is
// exactly the kind of thing that gets mistaken for real. Someone lands on it,
// sees a menu and a booking form, and tries to book a table.
//
// It renders only while the brand is still the placeholder, so it disappears
// on its own the moment a real tenant configures NEXT_PUBLIC_BRAND_NAME. No
// flag to remember to flip, no banner accidentally shipped to a paying
// customer's site.
//
// Deliberately NOT dismissible. A banner someone can close is a banner that
// isn't there when it matters.

import { BRAND, isPlaceholderBrand } from '../lib/brand'

export function DemoBanner() {
  if (!isPlaceholderBrand()) return null

  return (
    <div
      role="status"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        background: BRAND.colors.secondary,
        color: '#0F0F11',
        padding: '0.4rem 1rem',
        textAlign: 'center',
        fontFamily: 'var(--font-body)',
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}
    >
      Demo instance — not a real business. Nothing here is a real booking, order, or price.
    </div>
  )
}
