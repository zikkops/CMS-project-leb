// The allergen chart on the till — the plumbing only.
//
// What a dish contains, and whether that is verified, is decided on the server
// (shared/src/server/allergens.ts) and how it is said is staffAnswer() in
// shared/src/allergens.ts. Nothing here works an allergen out.

import { useEffect, useState } from 'react'
import { backend } from './backend'

export interface ChartOption { optionId: string; name: string; group: string; adds: string[]; removes: string[]; verified: boolean }

export interface ChartDish {
  menuItemId: string
  name: string
  category: string
  available: boolean
  verified: boolean
  contains: string[]
  others: string[]
  reasons: string[]
  options: ChartOption[]
  confirmedByEmail: string | null
}

export interface DishAnswer {
  menuItemId: string
  name: string
  verified: boolean
  contains: string[]
  others: string[]
  reasons: string[]
}

/**
 * The whole chart, fetched once when `enabled` turns on.
 *
 * Once per screen rather than live: it is built from recipes and supplies on
 * the server, and nothing listens to those from the till. A recipe corrected
 * mid-service reaches a screen when it is next opened.
 */
export function useAllergenChart(enabled: boolean) {
  const [dishes, setDishes] = useState<ChartDish[] | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let live = true
    backend().request('GET', '/api/pos/allergens')
      .then(r => { if (live) { setDishes((r.dishes as ChartDish[]) ?? []); setError('') } })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not load the allergen chart.') })
    return () => { live = false }
  }, [enabled, attempt])

  return {
    dishes,
    error,
    loading: enabled && dishes === null && !error,
    retry: () => { setError(''); setAttempt(n => n + 1) },
  }
}

/** One dish as made with these options — never the chart's option lines added up. */
export async function readDishAllergens(menuItemId: string, optionIds: string[]): Promise<DishAnswer> {
  const q = new URLSearchParams({ item: menuItemId })
  for (const id of optionIds) q.append('option', id)
  const data = await backend().request('GET', `/api/pos/allergens?${q}`)
  return data.dish as DishAnswer
}
