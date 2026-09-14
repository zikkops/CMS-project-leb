// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Recipes, stored apart from the menu because the menu is public.
//
// ── Why not a field on menuItems ───────────────────────────────────────────
// menuItems and modifierGroups are world-readable so the customer site can show
// the menu signed out. A recipe says what a dish costs to make, and on those
// documents it would publish every margin to anybody — the same leak
// products.ts documents for wholesale prices, fixed by the gated
// productWholesale collection. So recipes live in `recipes/{menuItemId}`, which
// has NO Firestore rule: no browser reads or writes it, and only these
// functions, behind an admin-only route, ever touch it. Same pattern as
// memberCodes.
//
// ── What a save checks ─────────────────────────────────────────────────────
// The arithmetic rules are recipeProblems() in shared/src/recipes.ts, run here
// against the supplies as they are now, so they cannot be skipped by crafting a
// request. Two more things only the server can know: that the menu item still
// exists, and that every option adjusted is one this item actually offers — an
// adjustment keyed to somebody else's option would never apply, and a recipe
// that silently never applies is the kind of wrong nobody notices.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import {
  recipeProblems,
  type Recipe, type RecipeLine, type OptionAdjustment, type RecipeSupply,
} from '../recipes'

const RECIPES = 'recipes'

export const RECIPE_LIMITS = {
  lines: 40,
  options: 60,
  adjustmentsPerOption: 6,
} as const

export interface StoredRecipe extends Recipe {
  menuItemId: string
}

/** A document id from a request: non-empty, bounded, and unable to name another path. */
function docId(raw: unknown, what: string): string {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!v || v.length > 128 || v.includes('/')) throw new HttpError(400, `Missing or invalid ${what}.`)
  return v
}

/** A reference inside a recipe. Blank stays blank, so recipeProblems() can name it. */
function refId(raw: unknown): string {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (v.length > 128 || v.includes('/')) throw new HttpError(400, 'An ingredient reference is invalid.')
  return v
}

function qty(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : Number.NaN
}

export function parseRecipeInput(body: Record<string, unknown>): Recipe {
  const rawLines = Array.isArray(body.lines) ? body.lines : []
  if (rawLines.length > RECIPE_LIMITS.lines) {
    throw new HttpError(400, `A recipe can have at most ${RECIPE_LIMITS.lines} ingredients.`)
  }
  const lines: RecipeLine[] = rawLines.map(row => {
    const r = (row ?? {}) as Record<string, unknown>
    return { supplyId: refId(r.supplyId), qty: qty(r.qty) }
  })

  const rawAdjustments = body.adjustments && typeof body.adjustments === 'object' && !Array.isArray(body.adjustments)
    ? Object.entries(body.adjustments as Record<string, unknown>)
    : []
  if (rawAdjustments.length > RECIPE_LIMITS.options) {
    throw new HttpError(400, `A recipe can adjust at most ${RECIPE_LIMITS.options} options.`)
  }

  const adjustments: Record<string, OptionAdjustment[]> = {}
  for (const [optionId, list] of rawAdjustments) {
    const key = docId(optionId, 'modifier option')
    const items = Array.isArray(list) ? list : []
    if (items.length > RECIPE_LIMITS.adjustmentsPerOption) {
      throw new HttpError(400, `One option can carry at most ${RECIPE_LIMITS.adjustmentsPerOption} adjustments.`)
    }
    const parsed: OptionAdjustment[] = items.map(item => {
      const a = (item ?? {}) as Record<string, unknown>
      if (a.kind === 'add') return { kind: 'add', supplyId: refId(a.supplyId), qty: qty(a.qty) }
      if (a.kind === 'replace') return { kind: 'replace', fromSupplyId: refId(a.fromSupplyId), toSupplyId: refId(a.toSupplyId) }
      throw new HttpError(400, 'An option adjustment must add or replace an ingredient.')
    })
    if (parsed.length > 0) adjustments[key] = parsed
  }

  return { lines, adjustments }
}

/** A supply document as the recipe arithmetic reads it. Missing fields stay missing. */
export function toRecipeSupply(id: string, data: Record<string, unknown>): RecipeSupply {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    id,
    name: String(data.name ?? id),
    unit: String(data.unit ?? ''),
    recipeUnit: typeof data.recipeUnit === 'string' && data.recipeUnit.trim() ? data.recipeUnit : null,
    recipeUnitsPerPurchaseUnit: n(data.recipeUnitsPerPurchaseUnit),
    yieldPercent: n(data.yieldPercent),
    avgUnitCost: n(data.avgUnitCost),
  }
}

async function readSupplies(ids: readonly string[]): Promise<Record<string, RecipeSupply>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return {}
  const db = adminDb()
  const snaps = await db.getAll(...unique.map(id => db.doc(`supplies/${id}`)))
  const out: Record<string, RecipeSupply> = {}
  for (const s of snaps) {
    if (s.exists) out[s.id] = toRecipeSupply(s.id, s.data() ?? {})
  }
  return out
}

/** The item's name and every modifier option id it offers. */
async function readMenuItemOptions(menuItemId: string): Promise<{ name: string; optionIds: Set<string> }> {
  const db = adminDb()
  const item = await db.doc(`menuItems/${menuItemId}`).get()
  if (!item.exists) throw new HttpError(404, 'That menu item no longer exists.')
  const data = item.data() ?? {}

  const groupIds = Array.isArray(data.modifierGroupIds) ? (data.modifierGroupIds as unknown[]).map(String) : []
  const groups = groupIds.length > 0
    ? await db.getAll(...groupIds.map(id => db.doc(`modifierGroups/${id}`)))
    : []

  const optionIds = new Set<string>()
  for (const g of groups) {
    const options = Array.isArray(g.data()?.options) ? (g.data()?.options as { id?: unknown }[]) : []
    for (const o of options) if (typeof o?.id === 'string') optionIds.add(o.id)
  }
  return { name: String(data.name ?? menuItemId), optionIds }
}

export async function listRecipes(): Promise<StoredRecipe[]> {
  const snap = await adminDb().collection(RECIPES).get()
  return snap.docs.map(d => {
    const data = d.data()
    return {
      menuItemId: d.id,
      lines: Array.isArray(data.lines) ? (data.lines as RecipeLine[]) : [],
      adjustments: (data.adjustments && typeof data.adjustments === 'object')
        ? (data.adjustments as Record<string, OptionAdjustment[]>)
        : {},
    }
  })
}

export async function saveRecipe(
  caller: Caller,
  rawMenuItemId: unknown,
  recipe: Recipe,
): Promise<{ name: string; before: StoredRecipe | null }> {
  const menuItemId = docId(rawMenuItemId, 'menu item')
  const { name, optionIds } = await readMenuItemOptions(menuItemId)

  if (Object.keys(recipe.adjustments ?? {}).some(id => !optionIds.has(id))) {
    throw new HttpError(400,
      `${name} no longer offers one of the options this recipe adjusts. Reload the recipe and try again.`)
  }

  const referenced = [
    ...recipe.lines.map(l => l.supplyId),
    ...Object.values(recipe.adjustments ?? {}).flat().flatMap(a =>
      a.kind === 'add' ? [a.supplyId] : [a.fromSupplyId, a.toSupplyId]),
  ]
  const problems = recipeProblems(recipe, await readSupplies(referenced))
  if (problems.length > 0) {
    throw new HttpError(400,
      problems.length === 1 ? problems[0] : `${problems[0]} (and ${problems.length - 1} more)`)
  }

  const ref = adminDb().doc(`${RECIPES}/${menuItemId}`)
  const previous = await ref.get()
  await ref.set({
    menuItemId,
    lines: recipe.lines,
    adjustments: recipe.adjustments ?? {},
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
    updatedByEmail: caller.email ?? '',
  })

  const before = previous.exists
    ? {
        menuItemId,
        lines: (previous.data()?.lines ?? []) as RecipeLine[],
        adjustments: (previous.data()?.adjustments ?? {}) as Record<string, OptionAdjustment[]>,
      }
    : null
  return { name, before }
}

export async function deleteRecipe(rawMenuItemId: unknown): Promise<{ menuItemId: string; existed: boolean; before: StoredRecipe | null }> {
  const menuItemId = docId(rawMenuItemId, 'menu item')
  const ref = adminDb().doc(`${RECIPES}/${menuItemId}`)
  const snap = await ref.get()
  if (!snap.exists) return { menuItemId, existed: false, before: null }
  const data = snap.data() ?? {}
  await ref.delete()
  return {
    menuItemId,
    existed: true,
    before: {
      menuItemId,
      lines: (data.lines ?? []) as RecipeLine[],
      adjustments: (data.adjustments ?? {}) as Record<string, OptionAdjustment[]>,
    },
  }
}
