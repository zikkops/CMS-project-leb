// Staff pay: each person's hourly rate and tip weight, with history (UPGRADE.md T7.18).
//
// GET                 every staff member with their pay history      (admin)
// GET ?weights=1      tip weights by date, no rates                  (endOfDay: the tips page)
// POST { uid, entry } add a rate and weight from a day               (admin)
//
// Admin only for rates, deliberately not a section key: pay is not a
// permission handed out for a shift. Every change is logged with before and
// after, under "Staff pay".

import { requireRole, requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { listStaffPay, listTipWeights, setStaffPay } from '@big-cms/shared/server/staffPay'
import { logUpdate } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request: Request): Promise<Response> {
  try {
    if (new URL(request.url).searchParams.get('weights') === '1') {
      await requireSection(request, 'endOfDay')
      return Response.json({ ok: true, staff: await listTipWeights() }, { headers: noStore })
    }
    await requireRole(request, ['admin'])
    return Response.json({ ok: true, staff: await listStaffPay() }, { headers: noStore })
  } catch (err) {
    return toResponse(err)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireRole(request, ['admin'])
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }
    const result = await setStaffPay(actor, typeof body.uid === 'string' ? body.uid : '', body.entry)
    const shape = (e: typeof result.after | null) => e
      ? { from: e.from, hourlyRate: e.hourlyRate, currency: e.currency, tipWeight: e.tipWeight }
      : { from: null, hourlyRate: null, currency: null, tipWeight: null }
    await logUpdate(actor, 'Staff pay', `${result.label}, from ${result.after.from}`, shape(result.before), shape(result.after))
    return Response.json({ ok: true, entry: result.after })
  } catch (err) {
    return toResponse(err)
  }
}
