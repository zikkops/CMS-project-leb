// The ordering setup — suppliers and the list of things we order from them.
//
// POST    create a provider or a template item
// PATCH   edit one
// DELETE  remove one, if nothing still depends on it
//
// `kind` picks which. One route because they are one screen's worth of setup
// and one section owns both — a manager editing the order template is also
// the person adding the supplier it comes from.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import {
  parseProviderInput, createProvider, updateProvider, deleteProvider,
  parseTemplateItemInput, createTemplateItem, updateTemplateItem, deleteTemplateItem,
} from '@big-cms/shared/server/ordering'
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

function kindOf(raw: unknown): 'provider' | 'item' {
  if (raw === 'provider' || raw === 'item') return raw
  throw new HttpError(400, 'Missing or unknown kind — expected "provider" or "item".')
}

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'weeklyOrders')
    const body = await readBody(request)

    if (kindOf(body.kind) === 'provider') {
      const input = parseProviderInput(body)
      const { id } = await createProvider(input)
      await logCreate(caller, 'Order Provider', input.name, { categories: input.categories })
      return Response.json({ ok: true, id })
    }

    const input = parseTemplateItemInput(body)
    const { id } = await createTemplateItem(input)
    await logCreate(caller, 'Weekly Order Template', `${input.department} — ${input.name}`, {
      category: input.category, unit: input.unit,
    })
    return Response.json({ ok: true, id })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'weeklyOrders')
    const body = await readBody(request)
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) throw new HttpError(400, 'Missing id.')

    // `before` is read from the stored document, not sent by the browser. The
    // client used to pass both halves of the diff, so the audit log recorded
    // whatever change the browser claimed it was making.
    if (kindOf(body.kind) === 'provider') {
      const input = parseProviderInput(body)
      const { before } = await updateProvider(id, input)
      await logUpdate(caller, 'Order Provider', input.name, before, { ...input })
      return Response.json({ ok: true })
    }

    const input = parseTemplateItemInput(body)
    const { before } = await updateTemplateItem(id, input)
    await logUpdate(caller, 'Weekly Order Template', input.name, before, { ...input })
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'weeklyOrders')
    const url = new URL(request.url)
    const id = url.searchParams.get('id') ?? ''
    if (!id) throw new HttpError(400, 'Missing id.')

    if (kindOf(url.searchParams.get('kind')) === 'provider') {
      const { name } = await deleteProvider(id)
      await logDelete(caller, 'Order Provider', name, { id })
      return Response.json({ ok: true })
    }

    const { name } = await deleteTemplateItem(id)
    await logDelete(caller, 'Weekly Order Template', name, { id })
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}
