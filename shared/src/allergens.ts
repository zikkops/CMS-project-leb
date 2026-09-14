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

import { resolveLines, type Recipe } from './recipes'
import { ALLERGENS_EU14 } from './foodSafety'

export interface AllergenSupply {
  id: string
  name: string
  /** Allergen keys. null means nobody has checked this ingredient yet — not "none". */
  allergens: readonly string[] | null
}

export interface DishAllergenInput {
  recipe: Recipe | null
  /** Allergens from things not in supplies — bought-in bread, a cross-contact warning. */
  extraAllergens?: readonly string[]
  /** Somebody confirmed the recipe lists every ingredient. */
  confirmed: boolean
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
    const lines = resolveLines(input.recipe, optionIds)
    if (lines.length === 0) reasons.push('The recipe has no ingredients.')
    for (const line of lines) {
      const supply = supplies[line.supplyId]
      if (!supply) { reasons.push('An ingredient is no longer in supplies.'); continue }
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

/** Allergen keys from untrusted input: known keys only, once each, in list order. */
export function readAllergenKeys(raw: unknown): string[] {
  return Array.isArray(raw) ? ordered(raw.filter((k): k is string => typeof k === 'string')) : []
}
