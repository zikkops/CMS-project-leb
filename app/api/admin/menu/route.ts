// The menu — categories and the items customers see priced.
//
// POST    create a category or an item
// PATCH   edit one, or apply a drag-to-reorder
// DELETE  remove one; a category takes its items with it
//
// `kind` picks which.

import { requireSection, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import {
  parseCategoryInput, createCategory, updateCategory, deleteCategory,
  parseMenuItemInput, createMenuItem, updateMenuItem, deleteMenuItem,
  reorderMenuItems,
} from '@/app/lib/server/menu'
import { logCreate, logUpdate, logDelete, logActivity } from '@/app/lib/server/activityLog'

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

function kindOf(raw: unknown): 'category' | 'item' {
  if (raw === 'category' || raw === 'item') return raw
  throw new HttpError(400, 'Missing or unknown kind — expected "category" or "item".')
}

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'menu')
    const body = await readBody(request)

    if (kindOf(body.kind) === 'category') {
      const input = parseCategoryInput(body)
      const { id } = await createCategory(input)
      await logCreate(caller, 'Menu Category', input.name, { section: input.section })
      return Response.json({ ok: true, id })
    }

    const input = parseMenuItemInput(body)
    const { id } = await createMenuItem(input)
    await logCreate(caller, 'Menu Item', input.name, { price: input.price, available: input.available })
    return Response.json({ ok: true, id })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'menu')
    const body = await readBody(request)

    // Reordering is its own action. Sending whole items back to change their
    // positions would let a stale form overwrite a price somebody else just
    // corrected — and a drag is not an edit of the thing being dragged.
    if (body.action === 'reorder') {
      const categoryId = typeof body.categoryId === 'string' ? body.categoryId.trim() : ''
      const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : []
      if (!categoryId || orderedIds.length === 0) throw new HttpError(400, 'Nothing to reorder.')

      const { moved } = await reorderMenuItems(categoryId, orderedIds)
      // Not logged: a menu gets rearranged constantly while it is being built,
      // and an entry per drag would bury the price changes that matter.
      return Response.json({ ok: true, moved })
    }

    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) throw new HttpError(400, 'Missing id.')

    if (kindOf(body.kind) === 'category') {
      const input = parseCategoryInput(body)
      const { before } = await updateCategory(id, input)
      await logUpdate(caller, 'Menu Category', input.name, before, { ...input })
      return Response.json({ ok: true })
    }

    const input = parseMenuItemInput(body)
    const { before } = await updateMenuItem(id, input)
    await logUpdate(caller, 'Menu Item', input.name, before, { ...input })
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'menu')
    const url = new URL(request.url)
    const id = url.searchParams.get('id') ?? ''
    if (!id) throw new HttpError(400, 'Missing id.')

    if (kindOf(url.searchParams.get('kind')) === 'category') {
      const { name, itemsDeleted } = await deleteCategory(id)
      // The item count belongs in the log. "Deleted Drinks" and "deleted
      // Drinks and the 14 items in it" are different events to read back.
      await logActivity(caller, 'delete', 'Menu Category',
        `${name}${itemsDeleted > 0 ? ` (+${itemsDeleted} item${itemsDeleted === 1 ? '' : 's'})` : ''}`)
      return Response.json({ ok: true, itemsDeleted })
    }

    const { name, before } = await deleteMenuItem(id)
    await logDelete(caller, 'Menu Item', name, before)
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}
