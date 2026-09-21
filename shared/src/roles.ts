// Shared authorization vocabulary. Deliberately has NO 'use client' directive
// and no imports, so both the browser (shared/src/adminAuth.ts) and the server
// layer (shared/src/server/**, app/api/**) can read from one definition.
//
// Before this file existed, `Role`, `ALL_ROLES` and `SECTION_ACCESS` lived
// inside adminAuth.ts, which is a client module — a route handler importing
// them would have dragged React hooks and the Firebase client SDK onto the
// server with them. adminAuth.ts now re-exports these, so every existing
// import site keeps working unchanged.
//
// IMPORTANT: adminAuth.ts's useRequireRole() identifies which section a call
// is gating by *reference equality* against the arrays in SECTION_ACCESS
// (every caller passes SECTION_ACCESS.xxx directly). Re-export this object
// itself — never spread or clone it — or that lookup silently returns
// undefined and per-user section grants stop working.

// 'dungeonmaster' was removed with the D&D modules — it granted access to
// nothing else, and a role in the picker that opens no screens is a support
// question waiting to happen. If a tabletop tenant ever needs it back, it
// returns alongside the campaign features, not before.
export type Role =
  | 'admin'
  | 'manager'
  | 'social'
  | 'retail'
  | 'kitchen_crew'
  | 'barista'

export const ALL_ROLES: Role[] = [
  'admin',
  'manager',
  'social',
  'retail',
  'kitchen_crew',
  'barista',
]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ALL_ROLES as string[]).includes(value)
}

/**
 * Every section: who may open it, what it is called, and which feature switch
 * governs it, declared once (UPGRADE.md T4.2). SECTION_ACCESS, SECTION_LABELS
 * and each feature's sections are derived from it, so a section cannot be
 * given roles in one place, a name in another and forgotten in a third.
 */
export const SECTIONS = {
  products:         { roles: ['admin', 'manager', 'retail'] as Role[], label: 'Manage Products', feature: 'products' },
  menu:          { roles: ['admin', 'manager'] as Role[], label: 'Manage Menu', feature: 'menu' },
  events:        { roles: ['admin', 'manager', 'social'] as Role[], label: 'Manage Events', feature: 'events' },
  loyalty:       { roles: ['admin', 'manager'] as Role[], label: 'Loyalty Approvals & Catalog', feature: 'loyalty' },
  // Submission panel — distinct from `events` above, which gates the
  // public-facing content management section, not loyalty logging.
  loyaltyEvents: { roles: ['admin', 'manager', 'social'] as Role[], label: 'Event Attendance', feature: 'loyaltyEvents' },
  branchTables:      { roles: ['admin', 'manager'] as Role[], label: 'Table Map Editor', feature: 'branchTables' },
  tableReservations: { roles: ['admin', 'manager'] as Role[], label: 'Table Reservations', feature: 'tableReservations' },
  productPurchases:     { roles: ['admin', 'manager', 'retail'] as Role[], label: 'Record Product Sales', feature: 'productPurchases' },
  productTransfers:     { roles: ['admin', 'manager', 'retail'] as Role[], label: 'Transfer Stock', feature: 'productPurchases' },
  weeklyOrders:       { roles: ['admin', 'manager'] as Role[], label: 'Weekly Order Reports', feature: 'weeklyOrders' },
  weeklyOrdersSubmit: { roles: ALL_ROLES, label: 'Submit a Weekly Order', feature: 'weeklyOrders' },
  // ── Point of sale (Phase 03) ─────────────────────────────────────────────
  // Two keys rather than one, because taking an order and working the pass are
  // different jobs done by different people. Kitchen crew belong on the KDS and
  // nowhere near order entry; a barista does both.
  //
  // Added to SECTION_ACCESS deliberately — CLAUDE.md warns against doing this
  // casually because /admin/users renders a grant checkbox per key. Here that
  // is the point: "can this person take orders" is exactly the sort of thing a
  // manager needs to hand out for one shift without changing somebody's role.
  pos:                { roles: ['admin', 'manager', 'barista'] as Role[], label: 'Point of Sale', feature: 'auth' },
  kds:                { roles: ['admin', 'manager', 'kitchen_crew', 'barista'] as Role[], label: 'Kitchen Display', feature: 'kds' },
  endOfDay:           { roles: ['admin', 'manager'] as Role[], label: 'End of Day Reports', feature: 'endOfDay' },
  endOfDayHistory:    { roles: ['admin', 'manager', 'social', 'retail', 'barista'] as Role[], label: 'End of Day History', feature: 'endOfDay' },
  // Consumable inventory — the item list behind the Daily Inventory Count.
  // Deliberately the same roles as dailyInventory below: the people doing the
  // counting are the ones who need to add a missing item or fix a threshold.
  // (Was gated on `products` until Aug 2026, which let a retail edit kitchen
  // supplies while locking out the kitchen crew who actually count them.)
  supplies:           { roles: ['admin', 'manager', 'kitchen_crew', 'barista'] as Role[], label: 'Inventory Management', feature: 'supplies' },
  // Floor staff who'd actually be doing a physical stock count day-to-day.
  // Anyone else (e.g. a retail or social hire helping out) can be granted
  // this section individually from Manage Users → sectionGrants.
  dailyInventory:     { roles: ['admin', 'manager', 'kitchen_crew', 'barista'] as Role[], label: 'Daily Inventory Count', feature: 'dailyInventory' },
  // Deliberately narrower than endOfDayHistory above — reviewing inventory
  // counts across every department/branch is a management-only concern here,
  // not something every floor role needs visibility into.
  dailyInventoryHistory: { roles: ['admin', 'manager'] as Role[], label: 'Daily Inventory History', feature: 'dailyInventory' },
  // Goods receiving. Same roles as dailyInventory on purpose: a delivery is
  // signed for at a back door by whoever is on shift, which is the same set of
  // people who do the physical count. Anyone else who genuinely receives stock
  // can be granted this individually from Manage Users.
  deliveries: { roles: ['admin', 'manager', 'kitchen_crew', 'barista'] as Role[], label: 'Goods Receiving', feature: 'receiving' },
  // Cost and variance reporting across deliveries — management-only, the same
  // reasoning as dailyInventoryHistory. Purchase prices and supplier price
  // drift are not something every floor role needs to see.
  deliveriesReport: { roles: ['admin', 'manager'] as Role[], label: 'Receiving & Cost Reports', feature: 'receiving' },
  // Food safety (Sep 2026). The floor answers the checks and logs the readings —
  // the same people who count stock and sign for deliveries.
  foodSafety: { roles: ['admin', 'manager', 'kitchen_crew', 'barista'] as Role[], label: 'Food Safety Checks', feature: 'foodSafety' },
  // Signing the day as supervised, the history and the limits. Management only
  // (owner's decision, 14 Sep 2026: staff tick, a manager or admin signs).
  // A key rather than a role check on purpose: a café whose senior barista runs
  // the morning is exactly who a manager grants this to.
  foodSafetyReview: { roles: ['admin', 'manager'] as Role[], label: 'Food Safety Sign-off & History', feature: 'foodSafety' },
} satisfies Record<string, SectionDef>
export interface SectionDef {
  roles: Role[]
  /** What Manage Users calls it, where a per-person grant is ticked. */
  label: string
  /** The feature switch that governs it: a key of features.ts's FEATURES (verify:features checks it is one). */
  feature: string
}

/**
 * Who may open each section: each entry's own roles array, not a copy, so
 * useRequireRole() can still find a section by reference equality.
 */
export const SECTION_ACCESS = Object.fromEntries(
  Object.entries(SECTIONS).map(([key, s]) => [key, s.roles]),
) as { readonly [K in keyof typeof SECTIONS]: Role[] }

/**
 * What each section is called in Manage Users. Typed by the registry, so a
 * section without a name cannot compile (two once went missing and showed as
 * raw camelCase in the grant list).
 */
export const SECTION_LABELS: Record<keyof typeof SECTIONS, string> = Object.fromEntries(
  Object.entries(SECTIONS).map(([key, s]) => [key, s.label]),
) as Record<keyof typeof SECTIONS, string>

/** The feature switch governing a section, or undefined for a key that is not one. */
export function sectionFeature(key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(SECTIONS, key) ? (SECTIONS as Record<string, SectionDef>)[key].feature : undefined
}

// DO NOT add a key here for staff account management. /admin/users gates on
// useRequireRole(['admin']) directly, and it renders one grant checkbox per
// Object.keys(SECTION_ACCESS) entry — so a new key here becomes a new row in
// that UI (unlabelled, since SECTION_LABELS wouldn't have it), and worse, a
// grantable one: any admin could hand a barista the ability to create admin
// accounts by ticking a box. Account management stays a role check, on the
// page and in /api/admin/accounts alike.

export type SectionKey = keyof typeof SECTION_ACCESS

// The single access predicate, shared by the client hook and the server guard
// so the two can never drift. Order matters and is deliberate:
//   1. an explicit revocation beats everything, including the user's own role
//   2. the role's own section list
//   3. an explicit per-user grant
// The `_isDungeonMaster` parameter that used to sit second is gone. It went
// dead when the 'dungeonmaster' role was dropped — no section listed it any
// more, so its branch could never be true — and it was left in place only to
// avoid touching the call sites. There turned out to be four.
export function hasSectionAccess(
  role: Role | null,
  allowed: Role[],
  sectionGrants?: string[],
  sectionKey?: string,
  sectionRevocations?: string[],
): boolean {
  if (!role) return false
  if (sectionKey && sectionRevocations?.includes(sectionKey)) return false
  if (allowed.includes(role)) return true
  if (sectionKey && sectionGrants?.includes(sectionKey)) return true
  return false
}
