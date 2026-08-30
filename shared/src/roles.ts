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

export const SECTION_ACCESS = {
  products:         ['admin', 'manager', 'retail'] as Role[],
  menu:          ['admin', 'manager'] as Role[],
  events:        ['admin', 'manager', 'social'] as Role[],
  loyalty:       ['admin', 'manager'] as Role[],
  // Submission panel — distinct from `events` above, which gates the
  // public-facing content management section, not loyalty logging.
  loyaltyEvents: ['admin', 'manager', 'social'] as Role[],
  branchTables:      ['admin', 'manager'] as Role[],
  tableReservations: ['admin', 'manager'] as Role[],
  productPurchases:     ['admin', 'manager', 'retail'] as Role[],
  productTransfers:     ['admin', 'manager', 'retail'] as Role[],
  weeklyOrders:       ['admin', 'manager'] as Role[],
  weeklyOrdersSubmit: ALL_ROLES,
  // ── Point of sale (Phase 03) ─────────────────────────────────────────────
  // Two keys rather than one, because taking an order and working the pass are
  // different jobs done by different people. Kitchen crew belong on the KDS and
  // nowhere near order entry; a barista does both.
  //
  // Added to SECTION_ACCESS deliberately — CLAUDE.md warns against doing this
  // casually because /admin/users renders a grant checkbox per key. Here that
  // is the point: "can this person take orders" is exactly the sort of thing a
  // manager needs to hand out for one shift without changing somebody's role.
  pos:                ['admin', 'manager', 'barista'] as Role[],
  kds:                ['admin', 'manager', 'kitchen_crew', 'barista'] as Role[],
  endOfDay:           ['admin', 'manager'] as Role[],
  endOfDayHistory:    ['admin', 'manager', 'social', 'retail', 'barista'] as Role[],
  // Consumable inventory — the item list behind the Daily Inventory Count.
  // Deliberately the same roles as dailyInventory below: the people doing the
  // counting are the ones who need to add a missing item or fix a threshold.
  // (Was gated on `products` until Aug 2026, which let a retail edit kitchen
  // supplies while locking out the kitchen crew who actually count them.)
  supplies:           ['admin', 'manager', 'kitchen_crew', 'barista'] as Role[],
  // Floor staff who'd actually be doing a physical stock count day-to-day.
  // Anyone else (e.g. a retail or social hire helping out) can be granted
  // this section individually from Manage Users → sectionGrants.
  dailyInventory:     ['admin', 'manager', 'kitchen_crew', 'barista'] as Role[],
  // Deliberately narrower than endOfDayHistory above — reviewing inventory
  // counts across every department/branch is a management-only concern here,
  // not something every floor role needs visibility into.
  dailyInventoryHistory: ['admin', 'manager'] as Role[],
  // Goods receiving. Same roles as dailyInventory on purpose: a delivery is
  // signed for at a back door by whoever is on shift, which is the same set of
  // people who do the physical count. Anyone else who genuinely receives stock
  // can be granted this individually from Manage Users.
  deliveries: ['admin', 'manager', 'kitchen_crew', 'barista'] as Role[],
  // Cost and variance reporting across deliveries — management-only, the same
  // reasoning as dailyInventoryHistory. Purchase prices and supplier price
  // drift are not something every floor role needs to see.
  deliveriesReport: ['admin', 'manager'] as Role[],
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
