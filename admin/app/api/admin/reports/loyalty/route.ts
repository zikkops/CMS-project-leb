// The loyalty liability (UPGRADE.md T7.14): points issued, reversed and spent
// per branch over a period, and the balance owed at each end, valued at the
// point value when the owner has set one.
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&branch=
//
// Gated on `loyalty`, like the points ledger export beside it, not on
// `endOfDay`: it is the loyalty scheme's own ledger.

import { requireSection, toResponse, type Caller } from '@big-cms/shared/server/auth'
import { parseExportRange, requestedBranches } from '@big-cms/shared/server/salesExport'
import { readLoyaltyLiability } from '@big-cms/shared/server/loyaltyExport'
import { BRAND } from '@big-cms/shared/brand'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'loyalty')
    const range = parseExportRange(new URL(request.url).searchParams)
    const own = caller.role === 'admin' || caller.branchIds.length === 0 ? BRAND.branches : caller.branchIds
    requestedBranches(range, own)
    const result = await readLoyaltyLiability(range, { timeZone: BRAND.locale.timezone, branches: [...own] })
    return Response.json(
      { ok: true, from: range.from, to: range.to, branches: result.period.branches, cutShort: result.period.cutShort, ...result },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return toResponse(err)
  }
}
