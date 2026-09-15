// Whether a café hub trades this branch — POS software, stage 4 (S10, S21).
//
// GET ?branch=   { hub: { name } | null, onlineInstead: boolean }
//
// The online till asks, so it can say it is view-only before anybody taps
// something the till routes would refuse anyway (hubLock.ts). On the hub
// itself `hub` is always null, since there it is the master; `onlineInstead`
// says an admin switched its branch to the online till while the counter PC
// was out of action, so the hub's own screens can say why they refuse.

import { requireSection, toResponse } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { branchHub, hubTradingOnline } from '@big-cms/shared/server/hubLock'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSection(request, 'pos')
    const branch = new URL(request.url).searchParams.get('branch') ?? ''
    const onHub = Boolean(hubDbPath())
    const hub = onHub ? null : await branchHub(branch)
    const onlineInstead = onHub ? (await hubTradingOnline()).online : false
    return Response.json({ ok: true, hub: hub ? { name: hub.name } : null, onlineInstead }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}
