// The allergen chart, for the till. Food safety, slice 7.
//
// GET                                  every dish: what it contains, verified or not
// GET ?item=ID&option=A&option=B       one dish as made with those options
//
// The second exists because options do not add up: "oat milk" takes milk out
// and "extra cream" adds nothing new on its own, yet together the drink still
// has milk in it. So a choice is worked out from the recipe here, where the
// recipe is, and sent without it — recipes are admin-only, being what a dish
// costs (shared/src/server/allergens.ts).
//
// Gated on `pos`, not `foodSafety`: the person a customer asks is whoever is
// holding the till. And on the module switch, because with it off nobody has
// been asked to keep the answers true.

import { requireSection, toResponse, HttpError } from '@big-cms/shared/server/auth'
import { serverFeatureOn } from '@big-cms/shared/server/features'
import { readAllergenChart, readDishAllergens, parseDishRequest } from '@big-cms/shared/server/allergens'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSection(request, 'pos')
    if (!(await serverFeatureOn('foodSafety'))) {
      throw new HttpError(404, 'Food safety is switched off, so there is no allergen chart.')
    }

    const params = new URL(request.url).searchParams
    if (params.has('item')) {
      const { menuItemId, optionIds } = parseDishRequest(params.get('item'), params.getAll('option'))
      return Response.json({ ok: true, dish: await readDishAllergens(menuItemId, optionIds) })
    }
    return Response.json({ ok: true, ...(await readAllergenChart()) })
  } catch (err) {
    return toResponse(err)
  }
}
