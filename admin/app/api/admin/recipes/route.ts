// Recipes — admins only (owner's decision, 14 Sep 2026).
//
// GET     every recipe
// PUT     create or replace one recipe, keyed by its menu item
// DELETE  remove one
//
// Admin for reading as well as writing: a recipe is what a dish costs to make,
// which is margin, and margin is not a grant handed out for a shift. The
// collection has no Firestore rule, so this route is the only way in.

import { requireRole, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseRecipeInput, saveRecipe, listRecipes, deleteRecipe } from '@big-cms/shared/server/recipes'
import { logCreate, logUpdate, logDelete } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') throw new Error('not an object')
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Invalid request body.')
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireRole(request, ['admin'])
    return Response.json({ recipes: await listRecipes() })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireRole(request, ['admin'])
    const body = await readBody(request)
    const recipe = parseRecipeInput(body)
    const { name, before } = await saveRecipe(caller, body.menuItemId, recipe)

    if (before) {
      await logUpdate(caller, 'Recipe', name, before, { menuItemId: before.menuItemId, ...recipe })
    } else {
      await logCreate(caller, 'Recipe', name, {
        ingredients: recipe.lines.length,
        optionsAdjusted: Object.keys(recipe.adjustments ?? {}).length,
      })
    }
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireRole(request, ['admin'])
    const url = new URL(request.url)
    const { menuItemId, existed, before } = await deleteRecipe(url.searchParams.get('menuItemId') ?? '')
    if (existed && before) await logDelete(caller, 'Recipe', menuItemId, before)
    return Response.json({ ok: true, existed })
  } catch (err) {
    return toResponse(err)
  }
}
