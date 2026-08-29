// Supplies and the daily count. Phase 00 standing rule.
//
// POST    create a supply, or seed supplies from the order template
// PATCH   edit a supply, change a threshold, or save/submit a daily count
// DELETE  remove a supply
//
// Two different sections gate this file, because two different jobs share the
// same collection: `supplies` manages the item list, `dailyInventory` records
// what was on the shelf. Kitchen crew and baristas hold both, but a future
// grant could separate them, and the route should honour that split rather
// than flatten it.

import { requireSection, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import {
  parseSupplyInput, createSupply, updateSupply, setThreshold, deleteSupply,
  seedSuppliesFromTemplates, parseCountInput, saveCount,
} from '@/app/lib/server/inventory'
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
    const result = await createSupply(input, Number(body.quantity ?? 0))

    await logCreate(caller, 'Inventory', input.name, { category: input.category, unit: input.unit })
    return Response.json({ ok: true, ...result })
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
    await updateSupply(id, input)
    await logUpdate(caller, 'Inventory', input.name, { edited: false }, { edited: true })
    return Response.json({ ok: true })
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
