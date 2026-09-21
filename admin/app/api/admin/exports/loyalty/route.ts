// The points side of the accountant's export: what the loyalty liability did.
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&branch=
//
// Gated on `loyalty` rather than `endOfDay`, unlike its sales sibling: this is
// the loyalty scheme's own ledger, and the people who run it are the ones who
// approve submissions and set the perks. Both keys are admin-and-manager
// today, so nobody gains or loses access by the distinction — it is about
// which section the screen belongs to when those lists diverge.

import { requireSection, toResponse, type Caller } from '@big-cms/shared/server/auth'
import { parseExportRange, requestedBranches } from '@big-cms/shared/server/salesExport'
import { readLoyaltyExport } from '@big-cms/shared/server/loyaltyExport'
import { BRAND } from '@big-cms/shared/brand'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'loyalty')
    const range = parseExportRange(new URL(request.url).searchParams)

    const own = caller.role === 'admin' || caller.branchIds.length === 0
      ? BRAND.branches
      : caller.branchIds
    // One branch, several (a comma list) or all of theirs (UPGRADE.md T7.1).
    requestedBranches(range, own)

    const result = await readLoyaltyExport(range, {
      timeZone: BRAND.locale.timezone,
      branches: own,
    })

    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
