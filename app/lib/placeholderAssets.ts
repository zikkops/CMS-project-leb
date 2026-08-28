// Placeholder imagery for the demo instance.
//
// The fork inherited ~32 MB of the original café's photography, logo videos and
// character artwork. None of it can ship in a product demo: it's someone's
// brand, and some of it is licensed work.
//
// ── Why remote URLs instead of bundled files ──────────────────────────────
// Bundling replacements would mean shipping another 30 MB of images that exist
// only to be thrown away the moment a real tenant configures their own. Hosted
// placeholders keep the repo small and make it obvious at a glance that none of
// this is the product's own content.
//
// ── TWO CONFIG CHANGES ARE LOAD-BEARING ───────────────────────────────────
// An external image host has to be allowed in BOTH places or it fails silently:
//
//   1. `proxy.ts` → the CSP's `img-src`. A blocked image logs a console warning
//      and renders nothing. No error, no broken-image icon in some browsers.
//   2. `next.config.ts` → `images.remotePatterns`, for anything going through
//      next/image.
//
// This is not hypothetical. ARCHITECTURE.md already documents the bug: the menu
// hero pointed at images.unsplash.com, was blocked by the CSP, and silently
// never rendered. Adding the host to the CSP fixes that too.
//
// ── Licensing ─────────────────────────────────────────────────────────────
// Every URL below is a FREE Unsplash photo on images.unsplash.com, and
// hotlinking them is what Unsplash's own guideline asks for.
//
// Deliberately NOT used: plus.unsplash.com / premium_photo- URLs. Those are
// Unsplash+ subscription content and must not be hotlinked into a product demo.
// If you add photos, check the host — Unsplash's search pages now surface a lot
// of premium results, and the URL is the only way to tell them apart.
//
// Every URL here was checked to resolve before being committed. If one 404s
// later, it's one string to change.

/** Sized on request — Unsplash serves the resize; we never ship the bytes. */
function unsplash(id: string, w: number, h?: number): string {
  const crop = h ? `&h=${h}&fit=crop` : ''
  return `https://images.unsplash.com/${id}?auto=format&q=70&w=${w}${crop}`
}

// The verified pool. Reused across categories on purpose — a demo needs to look
// plausible, not to be a stock library. Reusing eight photos across twenty-two
// categories is fine and keeps the set easy to audit.
const PHOTO = {
  cafeCounter:  'photo-1501339847302-ac426a4a7cbb',
  cafeInterior: 'photo-1554118811-1e0d58224f24',
  coffeeCup:    'photo-1495474472287-4d71bcdd2085',
  pizza:        'photo-1513104890138-7c749659a591',
  burger:       'photo-1568901346375-23c9450c58cd',
  salad:        'photo-1546069901-ba9599a7e63c',
  dessert:      'photo-1551024506-0bccd828d307',
  cocktail:     'photo-1544145945-f90425340c7e',
  beer:         'photo-1514362545857-3bc16c4c7d1b',
  sandwich:     'photo-1553909489-cd47e0907980',
  cookies:      'photo-1499636136210-6f4ee915583e',
  storefront:   'photo-1559925393-8be0ec4767c8',
  // Page-hero backgrounds. These three were inlined in menu/, events/ and
  // shop/page.tsx as raw URLs — outside this manifest, so nothing checked
  // their host against the CSP or their prefix against Unsplash+.
  menuHero:     'photo-1414235077428-338989a2e8c0',
  eventsHero:   'photo-1605870445919-838d190e8e1b',
  shopHero:     'photo-1610890716171-6b1bb98ffd09',
  // Retail shelving. The catalogue's stand-in for "a product we have no photo
  // of" — deliberately not food, so it reads as merchandise next to a price
  // and a stock count rather than as another menu item.
  shelves:      'photo-1441986300917-64674bd600d8',
} as const

export const PLACEHOLDER = {
  /** Full-bleed hero. Replaces the original BG-img1.webp. */
  heroBackground: unsplash(PHOTO.cafeInterior, 1920, 1080),

  // `sectionBackground` stood in for bg-dnd.webp and used a board-game photo.
  // Both the D&D section it backed and the file it replaced are gone, and
  // nothing imported it — removed rather than left as a board-game image in a
  // generic catalogue's asset manifest.

  /** Branch/location card. Replaces "location image/Frame 1.jpg". */
  location: unsplash(PHOTO.storefront, 1200, 800),

  /** Shop catalogue card and product page, when the product has no image. */
  product: unsplash(PHOTO.shelves, 800, 600),

  /** Page-hero backgrounds, one per public section. */
  menuHero: unsplash(PHOTO.menuHero, 1600, 900),
  eventsHero: unsplash(PHOTO.eventsHero, 1600, 900),
  shopHero: unsplash(PHOTO.shopHero, 1600, 900),

  /** Generic fallback wherever a photo is missing. */
  generic: unsplash(PHOTO.cafeCounter, 800, 600),
} as const

// Menu category thumbnails. The menu renders these at 50px at most (24px in the
// rail), so they're requested small — no reason to pull a 2000px photo for a
// thumbnail, and it keeps the demo quick on a phone.
const MENU_W = 400
const MENU_H = 300

export const PLACEHOLDER_MENU: Record<string, string> = {
  appetizers:        unsplash(PHOTO.salad,       MENU_W, MENU_H),
  salad:             unsplash(PHOTO.salad,       MENU_W, MENU_H),
  sandwiches:        unsplash(PHOTO.sandwich,    MENU_W, MENU_H),
  burgers:           unsplash(PHOTO.burger,      MENU_W, MENU_H),
  pizzas:            unsplash(PHOTO.pizza,       MENU_W, MENU_H),
  platters:          unsplash(PHOTO.salad,       MENU_W, MENU_H),
  sauceanddips:      unsplash(PHOTO.salad,       MENU_W, MENU_H),
  cocktails:         unsplash(PHOTO.cocktail,    MENU_W, MENU_H),
  beer:              unsplash(PHOTO.beer,        MENU_W, MENU_H),
  beverages:         unsplash(PHOTO.coffeeCup,   MENU_W, MENU_H),
  smoothies:         unsplash(PHOTO.coffeeCup,   MENU_W, MENU_H),
  hotcoffee:         unsplash(PHOTO.coffeeCup,   MENU_W, MENU_H),
  coldcoffee:        unsplash(PHOTO.coffeeCup,   MENU_W, MENU_H),
  lemonades:         unsplash(PHOTO.cocktail,    MENU_W, MENU_H),
  milkshakes:        unsplash(PHOTO.dessert,     MENU_W, MENU_H),
  hotbeverage:       unsplash(PHOTO.coffeeCup,   MENU_W, MENU_H),
  coldbeverage:      unsplash(PHOTO.coffeeCup,   MENU_W, MENU_H),
  spiritsandliqueur: unsplash(PHOTO.cocktail,    MENU_W, MENU_H),
  cakes:             unsplash(PHOTO.dessert,     MENU_W, MENU_H),
  cookies:           unsplash(PHOTO.cookies,     MENU_W, MENU_H),
  desserts:          unsplash(PHOTO.dessert,     MENU_W, MENU_H),
  // 'kaake' was a region-specific item on the original menu. Dropped rather
  // than mapped — a generic café product has no opinion about it, and leaving
  // it unmapped is the honest signal that the demo menu is a placeholder.
}

// Customer avatars. The original shipped seven pieces of fantasy character art,
// three of them 8–10 MB PNGs — roughly 28 MB for avatars rendered at 64px.
//
// DiceBear is used instead because it generates a deterministic avatar per seed,
// needs no bundled files, and is ALREADY in the CSP's img-src (it backs the
// legacy avatar flow), so this needs no further config change.
export function placeholderAvatar(seed: string): string {
  return `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(seed)}`
}

/**
 * The pickable set on the customer profile, replacing the eight D&D class
 * portraits that shipped with the fork (paladin, rogue, barbarian, wizard,
 * fighter, bard, sorcerer, ranger).
 *
 * The seed is what determines the artwork, so these strings are effectively
 * the image filenames — renaming one silently changes that avatar for every
 * account already using it. Add to the end instead.
 */
export const PLACEHOLDER_AVATARS = [
  { seed: 'amber',   label: 'Amber'   },
  { seed: 'basil',   label: 'Basil'   },
  { seed: 'cobalt',  label: 'Cobalt'  },
  { seed: 'dusk',    label: 'Dusk'    },
  { seed: 'ember',   label: 'Ember'   },
  { seed: 'fern',    label: 'Fern'    },
  { seed: 'harbour', label: 'Harbour' },
  { seed: 'indigo',  label: 'Indigo'  },
].map(a => ({ ...a, url: placeholderAvatar(a.seed) }))

/** Every external host these placeholders need. Keep the CSP and next.config in step with this list. */
export const PLACEHOLDER_HOSTS = ['images.unsplash.com', 'api.dicebear.com'] as const
