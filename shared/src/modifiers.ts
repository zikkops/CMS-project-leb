// Menu modifiers: the choices a customer makes on an item.
//
// "Large, oat milk, extra shot" — three selections from three groups, each
// possibly moving the price. Phase 03 builds this FIRST and deliberately so:
// a check line is `item + chosen modifiers`, and the KDS ticket, the bill
// line, the price and later the recipe cost all read from that. Retrofitting
// modifiers into an existing check model is a rewrite, not a migration.
//
// No React and no Firebase import: app/lib/server/** validates against these
// rules and the browser renders from them, so both halves have to be able to
// import this. Same split as roles.ts and businessSettings.ts.

// ── Shape ──────────────────────────────────────────────────────────────────

export interface ModifierOption {
  /**
   * Stable across renames. Server-generated, never derived from the name —
   * a group whose option ids changed when somebody fixed a typo would orphan
   * every reference to it.
   */
  id: string
  name: string
  /**
   * Added to the line price when chosen, in the main currency.
   *
   * Non-negative, deliberately. "Small −$1" is the same menu expressed
   * badly: price the item at small and charge +$1 for large. Allowing
   * negatives means a combination of selections can drive a line below zero,
   * and the only ways to prevent that are a combinatorial check at save time
   * or a silent clamp at sale time. Taking money OFF a line is a discount,
   * and discounts are Phase 04 with approval limits attached.
   */
  priceDelta: number
}

export interface ModifierGroup {
  id: string
  /** What the waiter sees as the heading: "Milk", "Size", "Extras". */
  name: string
  /**
   * How many options must and may be chosen.
   *
   *   min 0, max 1  — optional single choice
   *   min 1, max 1  — required single choice (a radio group)
   *   min 0, max N  — optional multi-select
   *   min 1, max N  — required multi-select
   *
   * `required` is not stored separately: it is min > 0, and a second field
   * saying the same thing is a second field that can disagree.
   */
  minSelections: number
  maxSelections: number
  options: ModifierOption[]
  /** Ordering in the waiter's list. Ties fall back to name. */
  sortOrder: number
}

/**
 * What a check line stores once the choices are made.
 *
 * A SNAPSHOT — the names and the price deltas, not just the ids. The same
 * reason an end-of-day report stores its own exchange rate and a delivery
 * stores its own VAT: re-reading the live group to price or print a check
 * written last week means last week's check changes when somebody edits the
 * menu. Ids are kept alongside so a report can still group by option, but
 * nothing on a check is ever priced from them.
 */
export interface ModifierSelection {
  groupId: string
  groupName: string
  optionId: string
  optionName: string
  priceDelta: number
}

// ── Bounds ────────────────────────────────────────────────────────────────
// Generous enough for any real menu, tight enough that a mistake or a crafted
// request cannot produce something unusable.

export const MODIFIER_LIMITS = {
  /** A group with more options than this is a menu, not a choice. */
  optionsPerGroup: 50,
  /** Attaching more than this to one item makes it unorderable on a phone. */
  groupsPerItem: 12,
  /** Same ceiling the menu itself uses for a price. */
  maxPriceDelta: 10_000,
  nameLength: 80,
} as const

export function isRequired(group: Pick<ModifierGroup, 'minSelections'>): boolean {
  return group.minSelections > 0
}

/** "Choose 1", "Choose up to 3", "Choose 2 to 4", "Optional". */
export function selectionLabel(group: Pick<ModifierGroup, 'minSelections' | 'maxSelections'>): string {
  const { minSelections: min, maxSelections: max } = group
  if (min === 0 && max === 1) return 'Optional'
  if (min === max) return `Choose ${min}`
  if (min === 0) return `Choose up to ${max}`
  return `Choose ${min} to ${max}`
}

/**
 * Whether a set of chosen option ids satisfies a group.
 *
 * Returns a message a waiter can read, or null. Shared so the phone can grey
 * out Send for the same reason the route refuses the request — one rule, not
 * two that drift.
 */
export function validateSelection(group: ModifierGroup, chosenIds: string[]): string | null {
  const known = new Set(group.options.map(o => o.id))
  const unknown = chosenIds.filter(id => !known.has(id))
  if (unknown.length > 0) return `${group.name}: that choice is no longer on the menu.`

  // Deduplicated before counting: the same option twice is one choice, and
  // counting it as two would fail a max that was never actually exceeded.
  const count = new Set(chosenIds).size
  if (count < group.minSelections) {
    return group.minSelections === 1
      ? `${group.name}: choose one.`
      : `${group.name}: choose at least ${group.minSelections}.`
  }
  if (count > group.maxSelections) {
    return group.maxSelections === 1
      ? `${group.name}: choose only one.`
      : `${group.name}: choose at most ${group.maxSelections}.`
  }
  return null
}

/** The selections for one group, as a check line stores them. */
export function toSelections(group: ModifierGroup, chosenIds: string[]): ModifierSelection[] {
  const unique = [...new Set(chosenIds)]
  return unique.flatMap(id => {
    const option = group.options.find(o => o.id === id)
    if (!option) return []
    return [{
      groupId: group.id,
      groupName: group.name,
      optionId: option.id,
      optionName: option.name,
      priceDelta: option.priceDelta,
    }]
  })
}

/**
 * A line's unit price: the item plus its chosen modifiers.
 *
 * Reads the snapshot on the line, never the live group. Rounded to cents at
 * the end rather than per delta, so three ⅓-cent modifiers cannot each round
 * up into a price nobody charged.
 */
export function lineUnitPrice(basePrice: number, selections: ModifierSelection[]): number {
  const total = selections.reduce((sum, s) => sum + s.priceDelta, basePrice)
  return Math.round(total * 100) / 100
}

/** "Large, Oat milk, Extra shot" — for a ticket, a bill line, a summary. */
export function describeSelections(selections: ModifierSelection[]): string {
  return selections.map(s => s.optionName).join(', ')
}
