// Menu category thumbnails.
//
// These used to be 22 bundled photographs of the original café's actual food,
// served from /public/images/menu. They were the café's own photography and
// can't ship in a product demo, so this now maps to the shared placeholder
// manifest instead — see app/lib/placeholderAssets.ts.
//
// ── The behaviour that has NOT changed, and probably should ────────────────
// This map still takes precedence over whatever `image` is stored on the
// menuCategories doc. That means editing a mapped category's image in Manage
// Menu has NO EFFECT — a documented bug in the feature audit, deliberately
// left alone here so that de-branding and behaviour changes stay in separate
// commits.
//
// The right fix is to invert it: read the Firestore field first and fall back
// to a placeholder only when it's blank. That makes the CMS actually manage
// its own content, which is rather the point of selling a CMS. Doing it now
// would mean an empty menu on a fresh demo, so it wants to land alongside the
// seed script writing image fields.
//
// A category that isn't listed here already falls back to its Firestore
// `image` field, so anything added in Manage Menu later still shows up.

import { PLACEHOLDER_MENU } from './placeholderAssets'

// Matched case- and punctuation-insensitively so "Sauce and Dips",
// "sauce & dips" and "Sauce And Dips" all resolve to the same entry.
export function categoryImage(name: string, fallback?: string): string {
  return PLACEHOLDER_MENU[name.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? fallback ?? ''
}
