// The café hub's pairing with the cloud — POS software, stage 4.
//
// GET              whether this hub is paired, for which branch, and how its pulls are going
// POST { code }    pair it, with a code from Settings → Café Hubs
//
// Only on a hub. No sign-in, on purpose: a hub that is not paired has no staff
// records, and the code an admin made is itself the authority. Once paired, a
// second POST is refused, so nobody at the counter can move the hub to another
// café's cloud. The status never includes the hub's secret.

import { toResponse, HttpError } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { hubSyncStatus, pairHub } from '@big-cms/shared/server/hubSync'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  try {
    if (!hubDbPath()) throw new HttpError(404, 'Not found.')
    return Response.json({ ok: true, ...(await hubSyncStatus()) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!hubDbPath()) throw new HttpError(404, 'Not found.')
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }
    await pairHub(body.code)
    return Response.json({ ok: true, ...(await hubSyncStatus()) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}
