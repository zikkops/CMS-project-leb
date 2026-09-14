// Whether a café hub trades this branch — POS software, stage 4 (S10).
//
// GET ?branch=   { hub: { name } | null }
//
// The online till asks, so it can say it is view-only before anybody taps
// something the till routes would refuse anyway (hubLock.ts). On the hub
// itself the answer is always null: there, it is the master.

import { requireSection, toResponse } from '@big-cms/shared/server/auth'
import { hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import { branchHub } from '@big-cms/shared/server/hubLock'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSection(request, 'pos')
    const branch = new URL(request.url).searchParams.get('branch') ?? ''
    const hub = hubDbPath() ? null : await branchHub(branch)
    return Response.json({ ok: true, hub: hub ? { name: hub.name } : null }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}
