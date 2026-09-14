// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The staff allergen chart: every dish, what it contains, whether that is
// verified, and what each option changes.
//
// Built here, not in the browser, for one reason: recipes are admin-only
// because a recipe is what a dish costs, and the chart is for the barista
// answering a customer. So the chart is computed from the recipes on the server
// and sent WITHOUT them — names and allergen keys only, no quantities, no costs.
//
// Every decision is shared/src/allergens.ts (verify:food-safety).

import { adminDb } from './firebaseAdmin'
import { readFoodSafetySettings } from './foodSafety'
import {
  dishAllergens, optionAllergenChange, splitTracked, readAllergenKeys,
  type AllergenSupply, type DishAllergenInput,
} from '../allergens'
import type { Recipe, RecipeLine, OptionAdjustment } from '../recipes'

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
  for (const d of supplies.docs) {
    const data = d.data()
    // Absent or null is "not checked". Only an actual list, even an empty one,
    // is an answer.
    supplyMap[d.id] = {
      id: d.id,
      name: String(data.name ?? d.id),
      allergens: Array.isArray(data.allergens) ? readAllergenKeys(data.allergens) : null,
    }
  }

  const categoryById = new Map(categories.docs.map(d => [d.id, { name: String(d.data().name ?? ''), order: Number(d.data().order ?? 0) }]))
  const groupById = new Map(groups.docs.map(d => {
    const data = d.data()
    const options = Array.isArray(data.options) ? (data.options as { id?: unknown; name?: unknown }[]) : []
    return [d.id, { name: String(data.name ?? ''), options: options.filter(o => typeof o.id === 'string').map(o => ({ id: String(o.id), name: String(o.name ?? '') })) }]
  }))
  const recipeById = new Map(recipes.docs.map(d => [d.id, d.data()]))

  const dishes = items.docs.map(doc => {
    const item = doc.data()
    const r = recipeById.get(doc.id)
    const recipe: Recipe | null = r
      ? {
          lines: Array.isArray(r.lines) ? (r.lines as RecipeLine[]) : [],
          adjustments: r.adjustments && typeof r.adjustments === 'object' ? (r.adjustments as Record<string, OptionAdjustment[]>) : {},
        }
      : null
    const confirmation = r?.allergensConfirmed && typeof r.allergensConfirmed === 'object'
      ? (r.allergensConfirmed as { byEmail?: unknown })
      : null
    const input: DishAllergenInput = {
      recipe,
      extraAllergens: readAllergenKeys(r?.extraAllergens),
      confirmed: Boolean(confirmation),
    }

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
        confirmedByEmail: confirmation && typeof confirmation.byEmail === 'string' ? confirmation.byEmail : null,
      } satisfies ChartDish,
      sort: [category?.order ?? 9999, Number(item.order ?? 0)] as const,
    }
  })

  dishes.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.dish.name.localeCompare(b.dish.name))
  return { tracked: settings.allergens, dishes: dishes.map(d => d.dish) }
}
