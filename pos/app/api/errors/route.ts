// Where the POS's error boundaries report to. Phase 05 groundwork.
//
// Unauthenticated on purpose — see shared/src/server/errorReports.ts for what
// that costs and what bounds it. The app name is this route's, not the body's.
//
// It answers 200 even when the report was dropped for the day's cap: the
// caller is an error boundary with a broken page on screen, and there is
// nothing useful it could do with a refusal.

import { toResponse } from '@big-cms/shared/server/auth'
import { readErrorBody, recordError } from '@big-cms/shared/server/errorReports'
import { todayYmd } from '@big-cms/shared/dates'
import { BRAND } from '@big-cms/shared/brand'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readErrorBody(request)
    // The café's day, not the host's. A server in UTC would roll the budget
    // over three hours early and call it midnight — see CLAUDE.md on zones.
    const result = await recordError('pos', body, todayYmd(BRAND.locale.timezone))
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
