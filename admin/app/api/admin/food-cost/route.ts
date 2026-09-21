// Theoretical food cost for the Food Cost Report.
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&branch=   (branch 'all' or empty: every branch the caller may see)
//
// Gated on `deliveriesReport`, the same section as the page it feeds. Built
// on the server because checks are readable only by POS and KDS accounts. The
// browser names a range and a branch; the rates and the costs come from the
// checks themselves.

import { requireSection, toResponse, type Caller } from '@big-cms/shared/server/auth'
import { parseExportRange, requestedBranches } from '@big-cms/shared/server/salesExport'
import { readTheoreticalFoodCost } from '@big-cms/shared/server/foodCost'
import { STOCKED_BRANCHES } from '@big-cms/shared/branches'
import { BRAND } from '@big-cms/shared/brand'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'deliveriesReport')
    const params = new URL(request.url).searchParams
    if (params.get('branch') === 'all') params.set('branch', '')
    const range = parseExportRange(params)

    // The report's branches are the stocked ones; an admin sees all of them,
    // anyone else the ones they are assigned to.
    const own = caller.role === 'admin' || caller.branchIds.length === 0
      ? [...STOCKED_BRANCHES]
      : STOCKED_BRANCHES.filter(b => caller.branchIds.includes(b))
    // One branch, several (a comma list) or all of theirs (UPGRADE.md T7.1).
    requestedBranches(range, own)

    const result = await readTheoreticalFoodCost(range, {
      timeZone: BRAND.locale.timezone,
      branches: own,
    })
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
