// Brand and deployment configuration — one place for everything that changes
// between one café and the next.
//
// ── Why this file exists ───────────────────────────────────────────────────
// The product plan puts it plainly: "Everything hardcoded becomes
// configuration. Fine for one café, fatal for two. The missing settings page
// IS the productization work."
//
// This is that work, started. Every value below was previously inlined
// somewhere — a name in a <title>, a hex code in globals.css, an exchange rate
// in the end-of-day form, a branch list in lib/branches. Scattered constants
// are what make a codebase serve exactly one customer.
//
// ── How it's meant to evolve ───────────────────────────────────────────────
// Right now these read from environment variables with neutral defaults, which
// is enough for one deployment per tenant. When multi-tenancy lands (Phase 05)
// the shape stays and the SOURCE changes: `tenants/{id}/settings/brand` in
// Firestore instead of process.env, loaded once into a provider. Keep this
// module's exported shape stable and that migration is a loader swap, not a
// rewrite of every page.
//
// ── The rule ───────────────────────────────────────────────────────────────
// Do not inline a brand name, colour, currency, rate or branch anywhere else.
// If you're about to type a hex code or a café name into a component, it
// belongs here first. `npm run audit:branding` scans for the ones that got
// away.

// NEXT_PUBLIC_ because the browser renders most of this. Nothing here is
// secret — it's the same information a visitor reads off the page.
function env(key: string, fallback: string): string {
  const value = process.env[key]
  return value === undefined || value === '' ? fallback : value
}

function envNum(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function envList(key: string, fallback: string[]): string[] {
  const raw = process.env[key]
  if (!raw) return fallback
  const items = raw.split(',').map(s => s.trim()).filter(Boolean)
  return items.length > 0 ? items : fallback
}

export interface BrandColors {
  /** Primary accent. Buttons, active states, success. */
  primary: string
  /** Secondary accent. Highlights, warnings, the "attention" colour. */
  secondary: string
  /** Tertiary accent, used for a third category of thing. */
  tertiary: string
  /** Deep accent, used for headers and quieter emphasis. */
  deep: string
  /** Destructive / error. */
  danger: string
  /** Page background. */
  background: string
  /** Default text on `background`. */
  foreground: string
}

export interface BrandConfig {
  /** Full name, used in page titles and headings. */
  name: string
  /** Short form for tight spaces — nav bars, mobile headers. */
  shortName: string
  /** One line under the name. */
  tagline: string
  /** Meta description. Keep it under ~160 characters. */
  description: string

  logoUrl: string
  faviconUrl: string
  /** Optional hero video. Empty string disables the hero video entirely. */
  heroVideoUrl: string

  colors: BrandColors
  fonts: { display: string; body: string }

  contact: {
    email: string
    phone: string
    /** International format, no +, no spaces — wa.me expects it that way. */
    whatsapp: string
    address: string
  }

  social: { instagram: string; facebook: string; tiktok: string }

  /**
   * Locale and money. Lebanon runs two currencies, so `secondaryCurrency` and
   * `exchangeRate` are first-class rather than bolted on — see the note below
   * about why the rate here is only a default.
   */
  locale: {
    currency: string
    secondaryCurrency: string
    /**
     * DEFAULT rate only — units of secondaryCurrency per 1 currency.
     *
     * It seeds a form; it is never the rate a stored record is valued at. Every
     * document that involves money keeps the rate that was actually applied
     * (see `rateUsed` on a delivery), so an old invoice reprints at the same
     * totals after the rate moves. Reading this at display time instead would
     * silently re-value history.
     */
    exchangeRate: number
    /** As a fraction: 0.11 is 11%. */
    vatRate: number
    timezone: string
    locale: string
  }

  /** Ordered. The first is treated as the flagship where one must be chosen. */
  branches: string[]

  /**
   * Branches that hold consumable stock. A branch can exist as a sales
   * location without being stocked and counted — the original codebase had
   * exactly this case and expressed it as `BRANCHES.filter(b => b !== 'Faten')`
   * repeated in three files, which is precisely the kind of thing that drifts.
   */
  stockedBranches: string[]

  /** Departments consumables are filed under. Receiving follows this list. */
  departments: string[]

  /** Percentage deducted from tips before distribution, as a fraction. */
  tipsDeductionRate: number
}

export const BRAND: BrandConfig = {
  name:        env('NEXT_PUBLIC_BRAND_NAME', 'Placeholder Café'),
  shortName:   env('NEXT_PUBLIC_BRAND_SHORT_NAME', 'Placeholder'),
  tagline:     env('NEXT_PUBLIC_BRAND_TAGLINE', 'A café management demo'),
  description: env(
    'NEXT_PUBLIC_BRAND_DESCRIPTION',
    'Demo instance of a café management platform. Not a real business.'
  ),

  logoUrl:      env('NEXT_PUBLIC_BRAND_LOGO', '/images/placeholder-logo.svg'),
  faviconUrl:   env('NEXT_PUBLIC_BRAND_FAVICON', '/images/placeholder-logo.svg'),
  heroVideoUrl: env('NEXT_PUBLIC_BRAND_HERO_VIDEO', ''),

  // Neutral slate and a single muted accent. Deliberately unlike any real
  // brand — a demo should not be mistakable for a customer's site, and a
  // placeholder that looks finished never gets replaced.
  colors: {
    primary:    env('NEXT_PUBLIC_COLOR_PRIMARY',    '#4A8DB7'),
    secondary:  env('NEXT_PUBLIC_COLOR_SECONDARY',  '#B79A4A'),
    tertiary:   env('NEXT_PUBLIC_COLOR_TERTIARY',   '#7C7CA8'),
    deep:       env('NEXT_PUBLIC_COLOR_DEEP',       '#3A3A5C'),
    danger:     env('NEXT_PUBLIC_COLOR_DANGER',     '#C4544A'),
    background: env('NEXT_PUBLIC_COLOR_BACKGROUND', '#0F0F11'),
    foreground: env('NEXT_PUBLIC_COLOR_FOREGROUND', '#EDEBE7'),
  },

  // Font family names as they appear in CSS. The actual loading happens in
  // app/layout.tsx via next/font — changing these strings alone won't load a
  // new face, it just changes which loaded family is referenced.
  fonts: {
    display: env('NEXT_PUBLIC_FONT_DISPLAY', 'var(--font-brand-display)'),
    body:    env('NEXT_PUBLIC_FONT_BODY',    'var(--font-brand-body)'),
  },

  contact: {
    email:    env('NEXT_PUBLIC_CONTACT_EMAIL', 'hello@example.com'),
    phone:    env('NEXT_PUBLIC_CONTACT_PHONE', '+000 00 000 000'),
    whatsapp: env('NEXT_PUBLIC_CONTACT_WHATSAPP', ''),
    address:  env('NEXT_PUBLIC_CONTACT_ADDRESS', '1 Example Street'),
  },

  social: {
    instagram: env('NEXT_PUBLIC_SOCIAL_INSTAGRAM', ''),
    facebook:  env('NEXT_PUBLIC_SOCIAL_FACEBOOK', ''),
    tiktok:    env('NEXT_PUBLIC_SOCIAL_TIKTOK', ''),
  },

  locale: {
    currency:          env('NEXT_PUBLIC_CURRENCY', 'USD'),
    secondaryCurrency: env('NEXT_PUBLIC_SECONDARY_CURRENCY', 'LBP'),
    exchangeRate:      envNum('NEXT_PUBLIC_EXCHANGE_RATE', 90000),
    vatRate:           envNum('NEXT_PUBLIC_VAT_RATE', 0.11),
    timezone:          env('NEXT_PUBLIC_TIMEZONE', 'Asia/Beirut'),
    locale:            env('NEXT_PUBLIC_LOCALE', 'en-US'),
  },

  branches:        envList('NEXT_PUBLIC_BRANCHES', ['Main', 'Second', 'Third']),
  stockedBranches: envList('NEXT_PUBLIC_STOCKED_BRANCHES', ['Main', 'Second', 'Third']),
  departments:     envList('NEXT_PUBLIC_DEPARTMENTS', ['Kitchen', 'Bar', 'Cleaning', 'Other']),

  tipsDeductionRate: envNum('NEXT_PUBLIC_TIPS_DEDUCTION_RATE', 0.11),
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Page title: "Something — Brand Name", or just the brand name when bare. */
export function pageTitle(section?: string): string {
  return section ? `${section} — ${BRAND.name}` : BRAND.name
}

export function formatMoney(amount: number, currency = BRAND.locale.currency): string {
  // A minor unit is meaningless at LBP magnitudes — "9,000,000.00" is noise.
  const fractionDigits = currency === BRAND.locale.secondaryCurrency ? 0 : 2
  return new Intl.NumberFormat(BRAND.locale.locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount)
}

/**
 * Whether the deployment is still running placeholder branding. Used by the
 * demo banner so an unbranded instance is never mistaken for a real café's
 * site — the fork exists to be safe, and silence about what it is undoes that.
 */
export function isPlaceholderBrand(): boolean {
  return BRAND.name === 'Placeholder Café'
}
