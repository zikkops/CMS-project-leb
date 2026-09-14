// Which allergens a dish contains, from its recipe (owner's decision, 14 Sep 2026:
// tag ingredients once; dishes inherit through recipes).
//
// Pure, asserted by `npm run verify:food-safety`. The server builds the staff
// allergen chart from this; no page works an allergen out for itself.
//
// ── The one rule ───────────────────────────────────────────────────────────
// A dish is VERIFIED only when all three hold:
//   1. it has a recipe,
//   2. every ingredient in it has been checked for allergens — "contains none"
//      is an answer, not checking is not,
//   3. somebody has confirmed the recipe lists EVERY ingredient: the cooking
//      oil, the sauce, the garnish, the dressing.
// Anything short of that is "not verified", with the reasons, and never "no
// allergens". The third point is not a formality — the demo's own recipes list
// only the main ingredients, which is exactly how a dish would read allergen-free
// while its dressing carries mustard. Same rule as "cost unknown", with far more
// at stake than a margin.
//
// ── Who may say what an ingredient contains ────────────────────────────────
// Only an admin sets an ingredient's allergens or accepts a change (owner's
// decision, 14 Sep 2026). Anyone else's edit is a REQUEST, and while one waits
// every dish using that ingredient is not verified — showing what the request
// would add, and taking nothing away until an admin accepts it.
//
// ── Options ────────────────────────────────────────────────────────────────
// An option with no recipe change is not verified unless an admin has said it
// adds no ingredient. "Hazelnut syrup" added to the menu after the recipe was
// confirmed would otherwise read as changing nothing.

import { resolveLines, type Recipe } from './recipes'
import { ALLERGENS_EU14 } from './foodSafety'

/** Allergen keys, or null for "nobody has checked". [] is "checked, contains none". */
export type AllergenList = readonly string[] | null

export interface AllergenSupply {
  id: string
  name: string
  /** The accepted allergen keys. null means nobody has checked this ingredient yet — not "none". */
  allergens: AllergenList
  /** A change waiting for an admin. Absent: nothing waiting. null: a request to mark it "not checked". */
  proposed?: AllergenList
}

export interface DishAllergenInput {
  recipe: Recipe | null
  /** Allergens from things not in supplies — bought-in bread, a cross-contact warning. */
  extraAllergens?: readonly string[]
  /** Somebody confirmed the recipe lists every ingredient. */
  confirmed: boolean
  /** Options an admin said add no ingredient ("no ice", "extra hot"). */
  noChangeOptions?: readonly string[]
  /** Option names, for the reasons a person reads. */
  optionNames?: Readonly<Record<string, string>>
}

export interface DishAllergens {
  verified: boolean
  /** Keys known to be present, in list order. When not verified: AT LEAST these. */
  contains: string[]
  /** Why it is not verified, for a person. Empty when verified. */
  reasons: string[]
}

export interface OptionAllergenChange {
  /** Present with the option and not without it. */
  adds: string[]
  /** Present without the option and not with it — oat milk for whole. */
  removes: string[]
  verified: boolean
  reasons: string[]
}

const ORDER = new Map(ALLERGENS_EU14.map((a, i) => [a.key, i]))
const ordered = (keys: Iterable<string>) =>
  [...new Set(keys)].filter(k => ORDER.has(k)).sort((a, b) => ORDER.get(a)! - ORDER.get(b)!)

/** What a dish contains as made with these options. */
export function dishAllergens(
  input: DishAllergenInput,
  supplies: Readonly<Record<string, AllergenSupply>>,
  optionIds: readonly string[] = [],
): DishAllergens {
  const found = new Set<string>(input.extraAllergens ?? [])
  const reasons: string[] = []

  if (!input.recipe) {
    reasons.push('No recipe — its ingredients are not known.')
  } else {
    const chosen = [...new Set(optionIds)]
    const noChange = new Set(input.noChangeOptions ?? [])
    for (const id of chosen) {
      if ((input.recipe.adjustments?.[id] ?? []).length > 0 || noChange.has(id)) continue
      reasons.push(`${input.optionNames?.[id] ?? 'An option'} has no recipe change, and nobody has said it adds no ingredient.`)
    }

    const lines = resolveLines(input.recipe, chosen)
    if (lines.length === 0) reasons.push('The recipe has no ingredients.')
    for (const line of lines) {
      const supply = supplies[line.supplyId]
      if (!supply) { reasons.push('An ingredient is no longer in supplies.'); continue }
      if (supply.proposed !== undefined) {
        // What the request would add counts already; what it would take away
        // does not, until an admin accepts it.
        reasons.push(`${supply.name} has an allergen change waiting for an admin.`)
        for (const k of supply.proposed ?? []) found.add(k)
      }
      if (supply.allergens === null) { reasons.push(`${supply.name} has not been checked for allergens.`); continue }
      for (const k of supply.allergens) found.add(k)
    }
    if (!input.confirmed) {
      reasons.push('Nobody has confirmed the recipe lists every ingredient — oils, sauces, garnishes and dressings included.')
    }
  }

  return { verified: reasons.length === 0, contains: ordered(found), reasons: [...new Set(reasons)] }
}

/** How choosing one option changes what the dish contains. */
export function optionAllergenChange(
  input: DishAllergenInput,
  supplies: Readonly<Record<string, AllergenSupply>>,
  optionId: string,
): OptionAllergenChange {
  const base = dishAllergens(input, supplies)
  const withOption = dishAllergens(input, supplies, [optionId])
  const before = new Set(base.contains)
  const after = new Set(withOption.contains)
  return {
    adds: withOption.contains.filter(k => !before.has(k)),
    removes: base.contains.filter(k => !after.has(k)),
    verified: withOption.verified,
    reasons: withOption.reasons,
  }
}

/**
 * The chart's columns, and what does not fit them.
 *
 * Columns are the allergens the café tracks. An allergen tagged on an
 * ingredient but not tracked is NEVER dropped — it goes in `others`. A setting
 * that could hide a real allergen from the person answering a customer is the
 * most dangerous thing this module could do.
 */
export function splitTracked(contains: readonly string[], tracked: readonly string[]): { tracked: string[]; others: string[] } {
  const t = new Set(tracked)
  return { tracked: contains.filter(k => t.has(k)), others: contains.filter(k => !t.has(k)) }
}

export interface StaffAnswer {
  /** 'none' only for a verified dish with nothing in it. */
  kind: 'unverified' | 'contains' | 'none'
  /** Every allergen known to be present, tracked or not. Unverified: at least these. */
  keys: string[]
}

/**
 * What a member of staff tells a customer, in one of three shapes.
 *
 * Decided here rather than by whichever screen draws it, because the till has
 * room on a menu tile for a word and a few chips and nothing else, and the
 * shortest honest answer is the one that gets shortened wrongly. An unverified
 * dish with nothing listed is NOT "none" — nothing is known. And an allergen
 * outside the tracked list still stops "none".
 */
export function staffAnswer(d: { verified: boolean; contains: readonly string[]; others?: readonly string[] }): StaffAnswer {
  const keys = ordered([...d.contains, ...(d.others ?? [])])
  if (!d.verified) return { kind: 'unverified', keys }
  return { kind: keys.length > 0 ? 'contains' : 'none', keys }
}

/**
 * For a customer allergic to one thing: does this dish, as it comes, contain it?
 *
 * 'free' only for a verified dish — an unverified one that lists nothing about
 * nuts has simply not been shown to be free of them, and that is 'unknown'.
 * An allergen on the untracked list counts: a customer's allergy is not
 * governed by which columns the café chose.
 */
export function allergenVerdict(
  d: { verified: boolean; contains: readonly string[]; others?: readonly string[] },
  key: string,
): 'contains' | 'unknown' | 'free' {
  const answer = staffAnswer(d)
  if (answer.keys.includes(key)) return 'contains'
  return answer.kind === 'unverified' ? 'unknown' : 'free'
}

// ── Requests for a change ──────────────────────────────────────────────────

/** The same answer: both "not checked", or the same keys in any order. */
export function sameAllergens(a: AllergenList | undefined, b: AllergenList | undefined): boolean {
  if (a === undefined || b === undefined || a === null || b === null) return a === b
  const x = ordered(a)
  const y = ordered(b)
  return x.length === y.length && x.every((k, i) => k === y[i])
}

export interface AllergenWrite {
  /** What the ingredient's accepted allergens become. */
  allergens: AllergenList
  /** What is left waiting for an admin; undefined when nothing is. */
  proposed: AllergenList | undefined
  outcome: 'unchanged' | 'set' | 'proposed' | 'accepted'
}

/**
 * What saving an ingredient does to its allergens.
 *
 * An admin's save is in force. If it matches a waiting request, that request
 * is accepted; if it does not, the request is left waiting — an admin fixing
 * a unit must not throw away a barista's report that the bread now has sesame
 * in it by pressing Save on a form that never showed it.
 *
 * Anyone else's save never moves the accepted list. A different list becomes
 * the request. The accepted list sent back unchanged (the form re-sent while
 * editing a unit) leaves any waiting request as it was.
 */
export function supplyAllergenWrite(
  stored: { allergens: AllergenList; proposed?: AllergenList },
  sent: AllergenList,
  admin: boolean,
): AllergenWrite {
  if (admin) {
    const accepted = stored.proposed !== undefined && sameAllergens(sent, stored.proposed)
    return {
      allergens: sent,
      proposed: accepted ? undefined : stored.proposed,
      outcome: accepted ? 'accepted' : sameAllergens(sent, stored.allergens) ? 'unchanged' : 'set',
    }
  }
  if (sameAllergens(sent, stored.allergens) || sameAllergens(sent, stored.proposed)) {
    return { allergens: stored.allergens, proposed: stored.proposed, outcome: 'unchanged' }
  }
  return { allergens: stored.allergens, proposed: sent, outcome: 'proposed' }
}

/** An admin's decision on a waiting request; null when nothing is waiting. */
export function decideAllergenRequest(
  stored: { allergens: AllergenList; proposed?: AllergenList },
  decision: 'accept' | 'reject',
): { allergens: AllergenList; proposed: undefined } | null {
  if (stored.proposed === undefined) return null
  return { allergens: decision === 'accept' ? stored.proposed : stored.allergens, proposed: undefined }
}

/**
 * A stored request, from document data. Absent: nothing waiting. Present but
 * malformed counts as a request to mark it "not checked" — waiting, never
 * nothing, because nothing is the answer that verifies a dish.
 */
export function readProposedAllergens(raw: unknown): AllergenList | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const keys = (raw as { keys?: unknown }).keys
  return Array.isArray(keys) ? readAllergenKeys(keys) : null
}

/** Allergen keys from untrusted input: known keys only, once each, in list order. */
export function readAllergenKeys(raw: unknown): string[] {
  return Array.isArray(raw) ? ordered(raw.filter((k): k is string => typeof k === 'string')) : []
}
