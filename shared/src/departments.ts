// The weekly-order departments, in a module with NO imports.
//
// Extracted from weeklyOrders.ts for the same reason roles.ts was extracted
// from adminAuth.ts: that file imports the Firebase client SDK, so a route
// handler validating a department against it would drag the client SDK onto
// the server. weeklyOrders.ts re-exports both names, so every existing import
// site keeps working unchanged.
//
// NOT the same list as DEPARTMENTS in dailyInventory.ts, which carries a
// fourth entry ('Other') and means supply *categories* rather than the
// departments a staff account can submit orders for. Nothing imports that
// one's Department type; the collision is in the name only.

export type Department = 'Kitchen' | 'Bar' | 'Cleaning'

export const DEPARTMENTS: Department[] = ['Kitchen', 'Bar', 'Cleaning']

export function isDepartment(value: unknown): value is Department {
  return typeof value === 'string' && (DEPARTMENTS as string[]).includes(value)
}

// One colour per department, for the chips and bars that group by it.
//
// This lived as an identical `const DEPT_COLOR = { ... }` in eight admin
// screens — five supplies pages and three weekly-order pages — which is the
// same duplication branches.ts records for the branch colours, in the same
// codebase, for the same reason: a small object feels too small to import
// until the eighth copy disagrees with the other seven.
//
// DELIBERATELY NOT brand variables. These are categorical: their job is to be
// distinguishable from each other, not to match the brand. Mapping them onto
// var(--brand-*) would make Kitchen, Bar and Cleaning three shades of one hue,
// which is the opposite of what a category colour is for. The de-branding
// audit skips keyed literals for this reason.
export const DEPARTMENT_COLOR: Record<Department, string> = {
  Kitchen:  '#00A098',
  Bar:      '#C9962C',
  Cleaning: '#8B7CF6',
}

// ── Supply categories, which are NOT the departments above ────────────────
// Same three names plus 'Other', and a different meaning: these group what a
// branch consumes, where DEPARTMENTS groups who may submit a weekly order.
// The note at the top of this file records that collision; this is the second
// half of it, kept here rather than in a supplies page so the two lists sit
// side by side and nobody re-derives one from the other.
//
// It was an identical `const CAT_COLOR` in five supplies screens, each with
// its own local `type Category`.
export type SupplyCategory = Department | 'Other'

export const SUPPLY_CATEGORIES: SupplyCategory[] = ['Kitchen', 'Bar', 'Cleaning', 'Other']

export const SUPPLY_CATEGORY_COLOR: Record<SupplyCategory, string> = {
  ...DEPARTMENT_COLOR,
  // 'Other' is the absence of a category rather than one of them, so it is a
  // muted neutral instead of a fourth hue competing with the three.
  Other: 'rgba(var(--offwhite-rgb),0.45)',
}

/**
 * The colour for a category name that came from Firestore, where it is a
 * plain string and may be anything.
 *
 * The five screens that used to hold their own copy of the map typed it as
 * `Record<string, string>` and indexed it directly, so an unrecognised
 * category produced `undefined` — which React then drops, leaving the chip
 * the colour of whatever is behind it. Some call sites had `?? fallback` and
 * some did not, which is the tell that nobody decided this on purpose.
 */
export function supplyCategoryColor(name: string): string {
  return SUPPLY_CATEGORY_COLOR[name as SupplyCategory] ?? SUPPLY_CATEGORY_COLOR.Other
}
