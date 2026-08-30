// Menu category thumbnails.
//
// These used to be 22 bundled photographs of the original café's actual food,
// served from /public/images/menu. They were the café's own photography and
// can't ship in a product demo, so this now maps to the shared placeholder
// manifest instead — see shared/src/placeholderAssets.ts.
//
// ── Firestore wins ─────────────────────────────────────────────────────────
// This map used to take precedence over the `image` stored on the
// menuCategories doc, so editing a mapped category's image in Manage Menu had
// no effect at all — the CMS could not manage its own content, which is
// somewhat the point of selling a CMS.
//
// It was left that way deliberately while de-branding, with a note that the
// fix wanted to land "alongside the seed script writing image fields."
// npm run seed:demo now writes an image on every category, so a fresh demo no
// longer depends on this map to look populated, and the precedence is
// inverted: the stored field first, the placeholder only when it is blank.

import { PLACEHOLDER_MENU } from './placeholderAssets'

/**
 * The image to show for a menu category.
 *
 * `stored` is the category's own `image` field and wins whenever it is set.
 * The placeholder map is the fallback, matched case- and
 * punctuation-insensitively so "Sauce and Dips", "sauce & dips" and
 * "Sauce And Dips" all resolve to the same entry.
 *
 * The parameter is still second so every existing call site — `categoryImage(
 * cat.name, cat.image)` — keeps working while meaning the opposite thing.
 */
export function categoryImage(name: string, stored?: string): string {
  const trimmed = stored?.trim()
  if (trimmed) return trimmed
  return PLACEHOLDER_MENU[name.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? ''
}
