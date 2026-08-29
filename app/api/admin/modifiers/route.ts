// Menu modifier groups. Phase 03 — the first piece of POS v1.
//
// POST    create a group
// PATCH   update a group, or attach groups to a menu item
// DELETE  remove a group, refusing while a menu item still uses it
//
// Gated on the `menu` section: a modifier changes what a customer is charged,
// so whoever may price the menu is exactly who may price its choices.

import { requireSection, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import {
  parseModifierGroupInput, readModifierGroup, createModifierGroup,
  updateModifierGroup, deleteModifierGroup, setItemModifierGroups,
} from '@/app/lib/server/modifiers'
import { logCreate, logUpdate, logDelete } from '@/app/lib/server/activityLog'

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

/** "Small, Medium (+1.50), Large (+3)" — readable in an audit entry. */
function describeGroup(input: { options: { name: string; priceDelta: number }[] }): string {
  return input.options
    .map(o => o.priceDelta > 0 ? `${o.name} (+${o.priceDelta})` : o.name)
    .join(', ')
}

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'menu')
    const input = parseModifierGroupInput(await readBody(request))
    const { id } = await createModifierGroup(input)

    await logCreate(caller, 'Menu Modifiers', input.name, {
      options: describeGroup(input),
      choose: `${input.minSelections}–${input.maxSelections}`,
    })

    return Response.json({ ok: true, id })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'menu')
    const body = await readBody(request)

    // Attaching groups to an item is a different operation from editing a
    // group, and deliberately does not share a shape with it — one names an
    // item, the other names a group.
    if (typeof body.itemId === 'string' && body.itemId) {
      const groupIds = Array.isArray(body.groupIds) ? body.groupIds as string[] : []
      const result = await setItemModifierGroups(body.itemId, groupIds)

      if (result.before.join('|') !== result.after.join('|')) {
        await logUpdate(caller, 'Menu Modifiers', result.itemName,
          { modifierGroups: result.before.length }, { modifierGroups: result.after.length })
      }
      return Response.json({ ok: true, ...result })
    }

    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) throw new HttpError(400, 'Missing modifier group id.')

    // Read before parsing: the parser needs the stored options to know which
    // ids are genuinely existing ones rather than values from the request.
    const existing = await readModifierGroup(id)
    const input = parseModifierGroupInput(body, existing)
    await updateModifierGroup(id, input)

    await logUpdate(caller, 'Menu Modifiers', input.name,
      {
        options: describeGroup(existing),
        choose: `${existing.minSelections}–${existing.maxSelections}`,
      },
      {
        options: describeGroup(input),
        choose: `${input.minSelections}–${input.maxSelections}`,
      })

    return Response.json({ ok: true, id })
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'menu')
    const id = new URL(request.url).searchParams.get('id') ?? ''
    if (!id) throw new HttpError(400, 'Missing modifier group id.')

    const { name } = await deleteModifierGroup(id)
    await logDelete(caller, 'Menu Modifiers', name)

    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}
