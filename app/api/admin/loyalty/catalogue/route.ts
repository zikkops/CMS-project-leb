// The staff-managed loyalty catalogue — rewards and tier perks.
//
// POST    create a reward or a perk
// PATCH   edit one, or toggle a reward active
// DELETE  remove one
//
// `kind` in the body (or the query string, for DELETE) picks which collection.
// One route rather than two because they are the same job — a manager editing
// what the loyalty programme offers — gated by the same section, and splitting
// them would mean two files that have to stay in step.

import { requireSection, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import {
  parseRedemptionItem, createRedemptionItem, updateRedemptionItem, deleteRedemptionItem,
  parseTierPerk, createTierPerk, updateTierPerk, deleteTierPerk,
} from '@/app/lib/server/loyaltyCatalogue'
import { logCreate, logUpdate, logDelete } from '@/app/lib/server/activityLog'

export const runtime = 'nodejs'

const SECTION = 'Loyalty Management'

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') throw new Error('not an object')
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Invalid request body.')
  }
}

function kindOf(raw: unknown): 'reward' | 'perk' {
  if (raw === 'reward' || raw === 'perk') return raw
  throw new HttpError(400, 'Missing or unknown kind — expected "reward" or "perk".')
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireSection(request, 'loyalty')
    const body = await readBody(request)

    if (kindOf(body.kind) === 'perk') {
      const input = parseTierPerk(body)
      const { id } = await createTierPerk(input)
      await logCreate(actor, SECTION, `Tier perk — ${input.tier}: ${input.perk}`, input)
      return Response.json({ ok: true, id })
    }

    const input = parseRedemptionItem(body)
    const { id } = await createRedemptionItem(input, actor.uid)
    await logCreate(actor, SECTION, `Reward — ${input.name}`, input)
    return Response.json({ ok: true, id })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireSection(request, 'loyalty')
    const body = await readBody(request)
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) throw new HttpError(400, 'Missing id.')

    if (kindOf(body.kind) === 'perk') {
      const input = parseTierPerk(body)
      const { before } = await updateTierPerk(id, input)
      await logUpdate(actor, SECTION, `Tier perk — ${input.tier}`, before, input)
      return Response.json({ ok: true })
    }

    // Toggling active is its own action rather than a full edit: the row has a
    // switch on it, and sending the whole item back to flip one boolean would
    // overwrite anything another manager changed in between.
    if (body.action === 'toggle') {
      const isActive = body.isActive === true
      const { before, name } = await updateRedemptionItem(id, { isActive })
      await logUpdate(actor, SECTION, `Reward — ${name}`, { isActive: before.isActive ?? null }, { isActive })
      return Response.json({ ok: true })
    }

    const input = parseRedemptionItem(body)
    const { before } = await updateRedemptionItem(id, input)
    await logUpdate(actor, SECTION, `Reward — ${input.name}`, before, input)
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireSection(request, 'loyalty')
    const url = new URL(request.url)
    const id = url.searchParams.get('id') ?? ''
    if (!id) throw new HttpError(400, 'Missing id.')

    if (kindOf(url.searchParams.get('kind')) === 'perk') {
      const { before } = await deleteTierPerk(id)
      await logDelete(actor, SECTION, `Tier perk — ${before.tier ?? id}`, before)
      return Response.json({ ok: true })
    }

    // Refuses while a customer is mid-claim — enforced here rather than in the
    // browser, where it was advice anyone could skip.
    const { name, before } = await deleteRedemptionItem(id)
    await logDelete(actor, SECTION, `Reward — ${name}`, before)
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}
