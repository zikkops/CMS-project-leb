// Printing from the café hub itself — POS software (owner's decision S28).
//
// GET                      the network printers at this hub, what printed today, recent failures
// POST { station }         a test page on that station's printer, now
//
// Only on a hub, and only from the counter PC itself (a localhost Host): this
// is for whoever is setting printers up at the counter, and a test page from a
// phone on the wifi is paper nobody asked for.

import { toResponse, HttpError } from '@big-cms/shared/server/auth'
import { adminDb, hubDbPath } from '@big-cms/shared/server/firebaseAdmin'
import type { HubStore } from '@big-cms/shared/server/hubStore'
import { printTestPage, printingStatus } from '@big-cms/shared/server/hubPrinting'
import { isCounterHost } from '@big-cms/shared/counterSignIn'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

function counterOnly(request: Request): HubStore {
  if (!hubDbPath()) throw new HttpError(404, 'Not found.')
  if (!isCounterHost(request.headers.get('host'))) throw new HttpError(403, 'Printers are set up on the counter PC itself.')
  return adminDb() as unknown as HubStore
}

export async function GET(request: Request): Promise<Response> {
  try {
    return Response.json({ ok: true, ...(await printingStatus(counterOnly(request))) }, { headers: noStore })
  } catch (err) {
    return toResponse(err)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const store = counterOnly(request)
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }
    const result = await printTestPage(store, body.station)
    return Response.json({ ok: true, ...result }, { headers: noStore })
  } catch (err) {
    return toResponse(err)
  }
}
