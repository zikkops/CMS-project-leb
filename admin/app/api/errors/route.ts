// Where the admin panel's error boundaries report to. Phase 05 groundwork.
//
// Unauthenticated like its two siblings, and for a duller reason than theirs:
// an error in the root layout takes the Firebase SDK down with it, so there is
// no ID token to send even though the person certainly is signed in.
// See shared/src/server/errorReports.ts.

import { toResponse } from '@big-cms/shared/server/auth'
import { readErrorBody, recordError } from '@big-cms/shared/server/errorReports'
import { todayYmd } from '@big-cms/shared/dates'
import { BRAND } from '@big-cms/shared/brand'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readErrorBody(request)
    // The café's day, not the host's — see CLAUDE.md on zones.
    const result = await recordError('admin', body, todayYmd(BRAND.locale.timezone))
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
