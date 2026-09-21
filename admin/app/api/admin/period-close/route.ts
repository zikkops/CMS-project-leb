// Period close (UPGRADE.md T7.17).
//
// GET              every closed period                          (endOfDay)
// GET ?id=         one closed period against the checks now     (endOfDay)
// POST { from, to } close a period, storing its figures as issued (admin)
//
// A close is the business's books, so it covers every branch and only an
// admin makes one. Logged under "Period close".

import { requireRole, requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { checkClose, closePeriod, listCloses } from '@big-cms/shared/server/periodClose'
import { logCreate } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSection(request, 'endOfDay')
    const id = new URL(request.url).searchParams.get('id')
    if (id) {
      if (!/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(id)) throw new HttpError(400, 'That is not a closed period.')
      return Response.json({ ok: true, ...(await checkClose(id)) }, { headers: noStore })
    }
    const closes = (await listCloses()).map(({ days: _days, ...c }) => c)
    return Response.json({ ok: true, closes }, { headers: noStore })
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
    const close = await closePeriod(actor, { from: String(body.from ?? ''), to: String(body.to ?? '') })
    const { days: _days, ...summary } = close
    await logCreate(actor, 'Period close', `${close.from} to ${close.to}`, { from: close.from, to: close.to, totals: close.totals, definitionsVersion: close.definitionsVersion })
    return Response.json({ ok: true, close: summary })
  } catch (err) {
    return toResponse(err)
  }
}
