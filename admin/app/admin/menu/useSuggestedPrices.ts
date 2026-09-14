'use client'

// What each dish should sell for, from its recipe cost and the target margin
// for its station — shown beside the real price on the menu screens.
//
// Admins only. A suggested price at a known margin IS the dish cost (price ×
// (1 − margin) ÷ VAT), and dish cost is margin, which is why recipes are
// admin-only. The recipes route refuses anyone else anyway; asking only when
// `enabled` saves a manager a 403 on every visit.
//
// The arithmetic is suggestedPrice() in shared/src/recipes.ts, asserted by
// verify:recipes. This file only fetches and hands over.

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@big-cms/shared/firebase'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { useBusinessSettings } from '@big-cms/shared/useBusinessSettings'
import { vatRateOn } from '@big-cms/shared/businessSettings'
import { stationForSection } from '@big-cms/shared/checks'
import { todayYmd } from '@big-cms/shared/dates'
import { BRAND } from '@big-cms/shared/brand'
import {
  consumptionCost, lineConsumption, readRecipeSupply, suggestedPrice, targetMarginFor,
  type Recipe, type RecipeSupply, type SuggestedPrice,
} from '@big-cms/shared/recipes'

export interface PriceSuggestion extends SuggestedPrice {
  costUsd: number
  targetMargin: number
}

export function useSuggestedPrices(
  enabled: boolean,
  items: readonly { id: string; categoryId: string }[],
  categories: readonly { id: string; section: string }[],
): Record<string, PriceSuggestion> {
  const { settings } = useBusinessSettings()
  const [supplies, setSupplies] = useState<Record<string, RecipeSupply>>({})
  const [recipes, setRecipes] = useState<Record<string, Recipe>>({})

  useEffect(() => {
    if (!enabled) return
    let alive = true
    Promise.all([
      getDocs(collection(db, 'supplies')),
      authedFetch('/api/admin/recipes', 'GET').then(res => unwrap(res)),
    ])
      .then(([supplySnap, recipeData]) => {
        if (!alive) return
        setSupplies(Object.fromEntries(supplySnap.docs.map(d => [d.id, readRecipeSupply(d.id, d.data())])))
        const list = ((recipeData as { recipes?: (Recipe & { menuItemId: string })[] }).recipes ?? [])
        setRecipes(Object.fromEntries(list.map(r => [r.menuItemId, { lines: r.lines, adjustments: r.adjustments }])))
      })
      // A suggestion is a hint beside the price, never something the page
      // needs to work. Failing to load one shows no hint rather than an error.
      .catch(() => {})
    return () => { alive = false }
  }, [enabled])

  return useMemo(() => {
    if (!enabled) return {}
    const vatRate = vatRateOn(settings, todayYmd(BRAND.locale.timezone))
    const sectionOf = new Map(categories.map(c => [c.id, c.section]))
    const out: Record<string, PriceSuggestion> = {}
    for (const item of items) {
      const recipe = recipes[item.id]
      if (!recipe) continue
      const target = targetMarginFor(stationForSection(sectionOf.get(item.categoryId)), {
        food: settings.targetMarginFood,
        drink: settings.targetMarginDrink,
      })
      if (target === null) continue
      const { costUsd } = consumptionCost(lineConsumption(recipe, [], 1, supplies))
      const s = suggestedPrice(costUsd, target, vatRate)
      if (s && costUsd !== null) out[item.id] = { ...s, costUsd, targetMargin: target }
    }
    return out
  }, [enabled, items, categories, recipes, supplies, settings])
}
