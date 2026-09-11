// Where the customer site's error boundaries report to. Phase 05 groundwork.
//
// This is the one that has to be unauthenticated: a customer whose page breaks
// is signed out, and nobody phones to say a page went blank. See
// shared/src/server/errorReports.ts for what that costs and what bounds it.

import { toResponse } from '@big-cms/shared/server/auth'
import { readErrorBody, recordError } from '@big-cms/shared/server/errorReports'
import { todayYmd } from '@big-cms/shared/dates'
import { BRAND } from '@big-cms/shared/brand'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readErrorBody(request)
    // The café's day, not the host's — see CLAUDE.md on zones.
    const result = await recordError('web', body, todayYmd(BRAND.locale.timezone))
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
