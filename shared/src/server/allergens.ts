// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The staff allergen chart: every dish, what it contains, whether that is
// verified, and what each option changes. And one dish as actually ordered.
//
// Built here, not in the browser, for one reason: recipes are admin-only
// because a recipe is what a dish costs, and the chart is for the barista
// answering a customer. So the chart is computed from the recipes on the server
// and sent WITHOUT them — names and allergen keys only, no quantities, no costs.
//
// Every decision is shared/src/allergens.ts (verify:food-safety).

import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { readFoodSafetySettings } from './foodSafety'
import {
  dishAllergens, optionAllergenChange, splitTracked, readAllergenKeys,
  type AllergenSupply, type DishAllergenInput,
} from '../allergens'
import { resolveLines, type Recipe, type RecipeLine, type OptionAdjustment } from '../recipes'

export interface ChartOption {
  optionId: string
  name: string
  group: string
  adds: string[]
  removes: string[]
  verified: boolean
}

export interface ChartDish {
  menuItemId: string
  name: string
  category: string
  available: boolean
  verified: boolean
  /** Tracked allergens present — at least these when not verified. */
  contains: string[]
  /** Present, but not among the allergens the café tracks. Never dropped. */
  others: string[]
  reasons: string[]
  /** Only the options that change something, or that cannot be verified. */
  options: ChartOption[]
  confirmedByEmail: string | null
}

/** One dish as made with the options chosen. */
export interface DishAnswer {
  menuItemId: string
  name: string
  verified: boolean
  contains: string[]
  others: string[]
  reasons: string[]
}

/** A dish has a handful of options; this only bounds a hostile request. */
const MAX_OPTIONS = 30

function allergenSupply(id: string, data: Record<string, unknown>): AllergenSupply {
  // Absent or null is "not checked". Only an actual list, even an empty one,
  // is an answer.
  return {
    id,
    name: String(data.name ?? id),
    allergens: Array.isArray(data.allergens) ? readAllergenKeys(data.allergens) : null,
  }
}

function dishInput(r: Record<string, unknown> | undefined): { input: DishAllergenInput; confirmedByEmail: string | null } {
  const recipe: Recipe | null = r
    ? {
        lines: Array.isArray(r.lines) ? (r.lines as RecipeLine[]) : [],
        adjustments: r.adjustments && typeof r.adjustments === 'object' ? (r.adjustments as Record<string, OptionAdjustment[]>) : {},
      }
    : null
  const confirmation = r?.allergensConfirmed && typeof r.allergensConfirmed === 'object'
    ? (r.allergensConfirmed as { byEmail?: unknown })
    : null
  return {
    input: { recipe, extraAllergens: readAllergenKeys(r?.extraAllergens), confirmed: Boolean(confirmation) },
    confirmedByEmail: confirmation && typeof confirmation.byEmail === 'string' ? confirmation.byEmail : null,
  }
}

/** A document id from a request, or a 400. A slash would address a different document. */
function requireId(raw: unknown, what: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 128 || raw.includes('/')) {
    throw new HttpError(400, `Invalid ${what}.`)
  }
  return raw
}

export function parseDishRequest(item: string | null, options: string[]): { menuItemId: string; optionIds: string[] } {
  if (options.length > MAX_OPTIONS) throw new HttpError(400, 'Too many options.')
  return {
    menuItemId: requireId(item, 'item'),
    optionIds: [...new Set(options.map(o => requireId(o, 'option')))],
  }
}

export async function readAllergenChart(): Promise<{ tracked: string[]; dishes: ChartDish[] }> {
  const db = adminDb()
  const [items, categories, groups, recipes, supplies, settings] = await Promise.all([
    db.collection('menuItems').get(),
    db.collection('menuCategories').get(),
    db.collection('modifierGroups').get(),
    db.collection('recipes').get(),
    db.collection('supplies').get(),
    readFoodSafetySettings(),
  ])

  const supplyMap: Record<string, AllergenSupply> = {}
  for (const d of supplies.docs) supplyMap[d.id] = allergenSupply(d.id, d.data())

  const categoryById = new Map(categories.docs.map(d => [d.id, { name: String(d.data().name ?? ''), order: Number(d.data().order ?? 0) }]))
  const groupById = new Map(groups.docs.map(d => {
    const data = d.data()
    const options = Array.isArray(data.options) ? (data.options as { id?: unknown; name?: unknown }[]) : []
    return [d.id, { name: String(data.name ?? ''), options: options.filter(o => typeof o.id === 'string').map(o => ({ id: String(o.id), name: String(o.name ?? '') })) }]
  }))
  const recipeById = new Map(recipes.docs.map(d => [d.id, d.data()]))

  const dishes = items.docs.map(doc => {
    const item = doc.data()
    const { input, confirmedByEmail } = dishInput(recipeById.get(doc.id))

    const base = dishAllergens(input, supplyMap)
    const split = splitTracked(base.contains, settings.allergens)
    const groupIds = Array.isArray(item.modifierGroupIds) ? (item.modifierGroupIds as unknown[]).map(String) : []

    const options: ChartOption[] = []
    for (const gid of groupIds) {
      const group = groupById.get(gid)
      if (!group) continue
      for (const option of group.options) {
        const change = optionAllergenChange(input, supplyMap, option.id)
        if (change.adds.length === 0 && change.removes.length === 0 && (change.verified || !base.verified)) continue
        options.push({ optionId: option.id, name: option.name, group: group.name, adds: change.adds, removes: change.removes, verified: change.verified })
      }
    }

    const category = categoryById.get(String(item.categoryId ?? ''))
    return {
      dish: {
        menuItemId: doc.id,
        name: String(item.name ?? doc.id),
        category: category?.name ?? '',
        available: item.available !== false,
        verified: base.verified,
        contains: split.tracked,
        others: split.others,
        reasons: base.reasons,
        options,
        confirmedByEmail,
      } satisfies ChartDish,
      sort: [category?.order ?? 9999, Number(item.order ?? 0)] as const,
    }
  })

  dishes.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.dish.name.localeCompare(b.dish.name))
  return { tracked: settings.allergens, dishes: dishes.map(d => d.dish) }
}

/**
 * One dish as made with these options, worked out from the recipe.
 *
 * Exists because options do not add up. The chart says what each option
 * changes ON ITS OWN, and "oat milk takes out milk" plus "extra cream changes
 * nothing" reads as no milk, when the cream is milk. Only the recipe with the
 * whole choice applied knows (verify:food-safety has the case).
 *
 * Reads only the supplies this choice uses, since the till asks each time an
 * option is tapped.
 */
export async function readDishAllergens(menuItemId: string, optionIds: string[]): Promise<DishAnswer> {
  const db = adminDb()
  const [item, recipe, settings] = await Promise.all([
    db.doc(`menuItems/${menuItemId}`).get(),
    db.doc(`recipes/${menuItemId}`).get(),
    readFoodSafetySettings(),
  ])
  if (!item.exists) throw new HttpError(404, 'That item is not on the menu.')

  const { input } = dishInput(recipe.exists ? recipe.data() : undefined)
  // An id that could not be a document is left out of the map, which reads as
  // "no longer in supplies" — not verified, rather than a crash or a pass.
  const ids = input.recipe
    ? [...new Set(resolveLines(input.recipe, optionIds).map(l => l.supplyId))].filter(id => typeof id === 'string' && id.length > 0 && !id.includes('/'))
    : []
  const snaps = ids.length > 0 ? await db.getAll(...ids.map(id => db.doc(`supplies/${id}`))) : []

  const supplyMap: Record<string, AllergenSupply> = {}
  for (const s of snaps) {
    const data = s.data()
    if (data) supplyMap[s.id] = allergenSupply(s.id, data)
  }

  const result = dishAllergens(input, supplyMap, optionIds)
  const split = splitTracked(result.contains, settings.allergens)
  return {
    menuItemId,
    name: String(item.data()?.name ?? menuItemId),
    verified: result.verified,
    contains: split.tracked,
    others: split.others,
    reasons: result.reasons,
  }
}
