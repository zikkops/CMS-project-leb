// Supplies and the daily count. Phase 00 standing rule.
//
// POST    create a supply, or seed supplies from the order template
// PATCH   edit a supply, change a threshold, save/submit a daily count, or
//         (admins) accept or reject an allergen change somebody asked for
// DELETE  remove a supply
//
// Two different sections gate this file, because two different jobs share the
// same collection: `supplies` manages the item list, `dailyInventory` records
// what was on the shelf. Kitchen crew and baristas hold both, but a future
// grant could separate them, and the route should honour that split rather
// than flatten it.
//
// Allergens are the exception to the section: only an admin sets them or
// accepts a change (owner's decision, 14 Sep 2026). Anyone else's edit is
// stored as a request — supplyAllergenWrite() in shared/src/allergens.ts.

import { requireSection, requireRole, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import {
  parseSupplyInput, createSupply, updateSupply, setThreshold, deleteSupply, decideSupplyAllergens,
  seedSuppliesFromTemplates, parseCountInput, saveCount, type AllergenChange,
} from '@big-cms/shared/server/inventory'
import { logCreate, logUpdate, logDelete, logActivity } from '@big-cms/shared/server/activityLog'
import { readAllergenKeys, type AllergenList } from '@big-cms/shared/allergens'

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

const listOf = (keys: AllergenList | undefined) =>
  keys === undefined ? 'nothing' : keys === null ? 'not checked' : keys.length === 0 ? 'contains none' : keys.join(', ')

/**
 * Every allergen change is logged with what it was and what it became. The
 * item log only says "edited", and "edited" is not an audit of a milk tag.
 */
async function logAllergens(caller: Caller, name: string, change: AllergenChange): Promise<void> {
  if (change.outcome === 'unchanged') return
  const label = change.outcome === 'proposed'
    ? `${name}: asked for allergens "${listOf(change.proposed)}" (in force: "${listOf(change.before)}") — waiting for an admin`
    : `${name}: allergens "${listOf(change.before)}" → "${listOf(change.after)}"${change.outcome === 'accepted' ? ', accepting the change asked for' : ''}`
  await logActivity(caller, 'update', 'Allergens', label)
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readBody(request)

    if (body.action === 'seed-from-templates') {
      const caller: Caller = await requireSection(request, 'supplies')
      const r = await seedSuppliesFromTemplates()
      await logActivity(caller, 'create', 'Inventory',
        `Seeded from order template — ${r.created} created, ${r.linked} linked, ${r.arabicBackfilled} Arabic name(s) backfilled`)
      return Response.json({ ok: true, ...r })
    }

    const caller: Caller = await requireSection(request, 'supplies')
    const input = parseSupplyInput(body)
    const result = await createSupply(input, Number(body.quantity ?? 0), caller)

    await logCreate(caller, 'Inventory', input.name, { category: input.category, unit: input.unit })
    await logAllergens(caller, input.name, result.allergens)
    return Response.json({ ok: true, id: result.id, allergens: result.allergens.outcome })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = await readBody(request)

    if (body.action === 'count') {
      const caller: Caller = await requireSection(request, 'dailyInventory')
      const input = parseCountInput(body)
      const result = await saveCount(caller, input)

      // A draft is saved repeatedly while someone walks the shelves; logging
      // each save would bury the submission that actually moved stock.
      if (input.submit) {
        await logActivity(caller, 'update', 'Daily Inventory Count',
          `${input.branch} — ${input.department} — ${input.date} (${result.applied} item(s) updated)`)
      }
      return Response.json({ ok: true, ...result })
    }

    if (body.action === 'allergens') {
      const caller: Caller = await requireRole(request, ['admin'])
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (!id) throw new HttpError(400, 'Missing item id.')
      const decision = body.decision === 'accept' ? 'accept' : body.decision === 'reject' ? 'reject' : null
      if (!decision) throw new HttpError(400, 'Accept or reject the change.')
      // The request the admin was looking at. If it has changed since, nothing
      // is decided — see decideSupplyAllergens().
      const expected = Array.isArray(body.expected) ? readAllergenKeys(body.expected) : null
      const r = await decideSupplyAllergens(id, decision, expected, caller)
      await logActivity(caller, 'update', 'Allergens', decision === 'accept'
        ? `${r.name}: accepted the change asked for by ${r.requestedBy || 'staff'} — "${listOf(r.before)}" → "${listOf(r.after)}"`
        : `${r.name}: rejected the change asked for by ${r.requestedBy || 'staff'} — still "${listOf(r.after)}"`)
      return Response.json({ ok: true })
    }

    const caller: Caller = await requireSection(request, 'supplies')
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) throw new HttpError(400, 'Missing item id.')

    if (body.action === 'threshold') {
      await setThreshold(id, Number(body.threshold))
      // Not logged: thresholds get nudged constantly while tuning reorder
      // points, and every nudge in the audit log is noise.
      return Response.json({ ok: true })
    }

    const input = parseSupplyInput(body)
    const { allergens } = await updateSupply(id, input, caller)
    await logUpdate(caller, 'Inventory', input.name, { edited: false }, { edited: true })
    await logAllergens(caller, input.name, allergens)
    return Response.json({ ok: true, allergens: allergens.outcome })
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'supplies')
    const id = new URL(request.url).searchParams.get('id') ?? ''
    if (!id) throw new HttpError(400, 'Missing item id.')

    const result = await deleteSupply(id)
    await logDelete(caller, 'Inventory', result.name, {})
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}
