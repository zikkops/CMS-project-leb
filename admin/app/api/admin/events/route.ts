// Events and the types they are filed under.
//
// POST    create an event, or a type
// PATCH   edit an event
// DELETE  remove an event nobody has booked, or a type nothing uses
//
// `kind` picks which. Approving and rejecting the bookings themselves lives
// in /api/admin/reservations — a different job, and one a role can be trusted
// with separately.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import {
  parseEventInput, createEvent, updateEvent, deleteEvent,
  createEventType, deleteEventType,
} from '@big-cms/shared/server/events'
import { logCreate, logUpdate, logDelete, logActivity } from '@big-cms/shared/server/activityLog'

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

function kindOf(raw: unknown): 'event' | 'type' {
  if (raw === 'event' || raw === 'type') return raw
  throw new HttpError(400, 'Missing or unknown kind — expected "event" or "type".')
}

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'events')
    const body = await readBody(request)

    if (kindOf(body.kind) === 'type') {
      const name = String(body.name ?? '').trim()
      const { id } = await createEventType(name)
      await logActivity(caller, 'create', 'Event Type', name)
      return Response.json({ ok: true, id })
    }

    const input = parseEventInput(body)
    const { id } = await createEvent(input)
    await logCreate(caller, 'Event', input.title, {
      type: input.type, branch: input.branch, date: input.date, price: input.price,
    })
    return Response.json({ ok: true, id })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'events')
    const body = await readBody(request)
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) throw new HttpError(400, 'Missing id.')

    const input = parseEventInput(body)
    const { before } = await updateEvent(id, input)
    await logUpdate(caller, 'Event', input.title, before, { ...input })
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'events')
    const url = new URL(request.url)
    const id = url.searchParams.get('id') ?? ''
    if (!id) throw new HttpError(400, 'Missing id.')

    if (kindOf(url.searchParams.get('kind')) === 'type') {
      const { name } = await deleteEventType(id)
      await logActivity(caller, 'delete', 'Event Type', name)
      return Response.json({ ok: true })
    }

    const { title, before } = await deleteEvent(id)
    await logDelete(caller, 'Event', title, before)
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}
