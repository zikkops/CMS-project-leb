// Module feature flags — the registry.
//
// Design taken from the feature audit's superadmin switchboard section, with
// one change made necessary by this fork: the gaming modules now default OFF.
// A generic café installation should never see D&D campaigns; a board product café
// switches the pack on. That's the "Gaming pack" tier in the product plan, and
// it's the thing no competitor sells.
//
// ── What lives here vs. in Firestore ───────────────────────────────────────
// The DEPENDENCY GRAPH lives in code, because it is a property of the build —
// `loyaltyDnd` cannot work without `dnd` no matter what a database says, and a
// browser must not be able to edit that relationship.
//
// The CHOSEN STATE lives in Firestore at `appSettings/features`, editable by a
// superadmin. Store intent there, never the computed result, so disabling a
// parent never overwrites a child's own setting — re-enabling the parent must
// restore exactly what was there before.
//
// ── Three enforcement layers, only one of which is real ────────────────────
//   1. Navigation and dashboard cards don't render. Cosmetic.
//   2. useRequireFeature() in the page catches direct URL entry. Cosmetic.
//   3. Firestore rules. The only layer that actually stops anything.
//
// A flag is a BUSINESS SWITCH, not an access control. The moment you'd be
// tempted to use one to hide something sensitive, the answer is a rule keyed on
// a role — not a flag. That distinction is what makes fail-open safe below.

export interface FeatureDefinition {
  label: string
  /** Grouping in the superadmin switchboard UI. */
  group: string
  /** Other features that must be on for this one to function. */
  requires: readonly string[]
  /** SECTION_ACCESS keys this feature governs. */
  sections?: readonly string[]
  /** Firestore collections this feature owns, for the rules work. */
  collections?: readonly string[]
  /**
   * Core modules that can never be switched off. Without these there is no
   * state in which a superadmin can lock themselves out of the panel.
   */
  locked?: boolean
  /** Default when no stored setting exists. */
  defaultEnabled: boolean
}

export const FEATURES = {
  // ── Locked core ──────────────────────────────────────────────────────────
  auth:      { label: 'Authentication', group: 'Core', requires: [], locked: true, defaultEnabled: true },
  dashboard: { label: 'Dashboard',      group: 'Core', requires: [], locked: true, defaultEnabled: true },
  users:     { label: 'Staff Accounts', group: 'Core', requires: [], locked: true, defaultEnabled: true, collections: ['users'] },
  logs:      { label: 'Activity Log',   group: 'Core', requires: [], locked: true, defaultEnabled: true, collections: ['activityLog'] },
  media:     { label: 'Media Library',  group: 'Core', requires: [], locked: true, defaultEnabled: true, collections: ['mediaLibrary'] },

  // ── Operations — the actual product ──────────────────────────────────────
  menu: {
    label: 'Menu', group: 'Operations', requires: [], defaultEnabled: true,
    sections: ['menu'], collections: ['menuCategories', 'menuItems'],
  },
  supplies: {
    label: 'Inventory', group: 'Operations', requires: [], defaultEnabled: true,
    sections: ['supplies'], collections: ['supplies'],
  },
  dailyInventory: {
    label: 'Daily Count', group: 'Operations', requires: ['supplies'], defaultEnabled: true,
    sections: ['dailyInventory', 'dailyInventoryHistory'], collections: ['dailyInventoryCounts'],
  },
  ordersTemplate: {
    label: 'Order Template', group: 'Operations', requires: [], defaultEnabled: true,
    collections: ['orderTemplateItems', 'orderCategoryMeta'],
  },
  weeklyOrders: {
    label: 'Weekly Orders', group: 'Operations', requires: ['ordersTemplate'], defaultEnabled: true,
    sections: ['weeklyOrders', 'weeklyOrdersSubmit'],
    collections: ['weeklyOrderReports', 'orderProviders', 'weeklyOrderLogs'],
  },
  // Phase 01. Needs both ends of the chain it bridges: something to order
  // against, and somewhere for the stock to land.
  receiving: {
    label: 'Goods Receiving', group: 'Operations', requires: ['supplies', 'weeklyOrders'], defaultEnabled: true,
    sections: ['deliveries', 'deliveriesReport'], collections: ['deliveries'],
  },
  endOfDay: {
    label: 'End of Day', group: 'Operations', requires: [], defaultEnabled: true,
    sections: ['endOfDay', 'endOfDayHistory'],
    collections: ['endOfDayReports', 'branchStaff', 'endOfDayLogs'],
  },

  // ── Front of house ───────────────────────────────────────────────────────
  branchTables: {
    label: 'Floor Plan', group: 'Front of House', requires: [], defaultEnabled: true,
    sections: ['branchTables'], collections: ['branchTableLayouts'],
  },
  tableReservations: {
    label: 'Table Reservations', group: 'Front of House', requires: ['branchTables'], defaultEnabled: true,
    sections: ['tableReservations'], collections: ['tableReservations', 'tableLocks'],
  },
  events: {
    label: 'Events', group: 'Front of House', requires: [], defaultEnabled: true,
    sections: ['events'], collections: ['events', 'eventTypes', 'eventReservations'],
  },

  // ── Retail ───────────────────────────────────────────────────────────────
  products: {
    label: 'Product Catalogue', group: 'Retail', requires: [], defaultEnabled: true,
    sections: ['products'], collections: ['products', 'productCategories'],
  },
  productPurchases: {
    label: 'Sales & Invoices', group: 'Retail', requires: ['products'], defaultEnabled: true,
    sections: ['productPurchases', 'productTransfers'], collections: ['productPurchaseOrders'],
  },

  // ── Loyalty ──────────────────────────────────────────────────────────────
  loyalty: {
    label: 'Loyalty Programme', group: 'Loyalty', requires: [], defaultEnabled: false,
    sections: ['loyalty'],
    collections: ['transactions', 'transactionLog', 'redemptionItems', 'redemptions', 'tierPerks'],
  },
  loyaltyEvents: {
    label: 'Event Attendance Points', group: 'Loyalty', requires: ['loyalty', 'events'], defaultEnabled: false,
    sections: ['loyaltyEvents'],
  },

  // ── Gaming pack — REMOVED ────────────────────────────────────────────────
  // The D&D modules (campaign bookings, reservations, looking-for-players,
  // campaign attendance points, leaderboard) were deleted from this codebase.
  //
  // They were genuinely differentiating for a board product café and are the
  // "Gaming pack" tier in the product plan — but carrying five modules of dead
  // code through every refactor to keep an option open is the wrong trade. The
  // original implementation lives in the onboardlb repo if it's ever wanted
  // back, and it would return as a plugin rather than as core.

} as const satisfies Record<string, FeatureDefinition>

export type FeatureKey = keyof typeof FEATURES

/** Stored intent — what a superadmin actually chose. Never the computed result. */
export interface FeatureState {
  enabled?: boolean
  surfaces?: { public?: boolean; admin?: boolean; app?: boolean }
  branches?: Record<string, boolean>
  note?: string
}

export type FeatureFlags = Partial<Record<FeatureKey, FeatureState>>

/**
 * Effective state: a feature is on when its own stored setting allows it AND
 * every feature it requires is effectively on.
 *
 * OFF CASCADES, ON DOESN'T. Disabling a parent computes its dependents as off;
 * enabling a parent only ever OFFERS to enable dependents. That asymmetry is
 * deliberate — silently switching on a module someone deliberately turned off
 * is the kind of surprise that erodes trust in the whole switchboard.
 *
 * The graph is acyclic and shallow, so plain recursion is fine; a `seen` set
 * guards against a future edit accidentally introducing a cycle rather than
 * hanging the render.
 */
export function isFeatureOn(
  key: FeatureKey,
  flags: FeatureFlags,
  seen: Set<string> = new Set(),
): boolean {
  const def = FEATURES[key] as FeatureDefinition | undefined
  if (!def) return true              // unknown key: fail open, see below
  if (def.locked) return true
  if (seen.has(key)) return false    // cycle — treat as off rather than loop
  seen.add(key)

  const stored = flags[key]?.enabled
  const own = stored === undefined ? def.defaultEnabled : stored
  if (!own) return false

  return def.requires.every(r => isFeatureOn(r as FeatureKey, flags, seen))
}

/**
 * Which feature governs a given SECTION_ACCESS key, or undefined for a section
 * no feature claims.
 *
 * Derived from the registry's own `sections` lists rather than annotating
 * every navigation entry with a feature key. A second mapping would be a
 * second thing to keep in step, and this one cannot drift from the registry
 * because it IS the registry.
 */
export function featureForSection(sectionKey: string): FeatureKey | undefined {
  return (Object.keys(FEATURES) as FeatureKey[]).find(k => {
    const def = FEATURES[k] as FeatureDefinition
    return (def.sections as readonly string[] | undefined)?.includes(sectionKey)
  })
}

/** Every feature that would break if `key` were switched off. */
export function dependentsOf(key: FeatureKey): FeatureKey[] {
  return (Object.keys(FEATURES) as FeatureKey[]).filter(k => {
    const def = FEATURES[k] as FeatureDefinition
    return (def.requires as readonly string[]).includes(key)
  })
}

/** Grouped for the switchboard UI, in registry order. */
export function featuresByGroup(): { group: string; keys: FeatureKey[] }[] {
  const groups = new Map<string, FeatureKey[]>()
  for (const key of Object.keys(FEATURES) as FeatureKey[]) {
    const g = (FEATURES[key] as FeatureDefinition).group
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(key)
  }
  return Array.from(groups.entries()).map(([group, keys]) => ({ group, keys }))
}

/**
 * FAIL OPEN. If the flag document is missing or unreadable, every module
 * behaves as though enabled.
 *
 * A Firestore hiccup must not dark-screen the storefront. That choice is only
 * safe because flags are a business switch and never an access control — the
 * moment a flag is doing security work, this default becomes a hole. Keep them
 * separate and this stays the right call.
 */
export const FAIL_OPEN_FLAGS: FeatureFlags = {}
