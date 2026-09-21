// The accountant's export. Phase 05's "data export" line — the one every POS
// buyer asks about in the first sales call.
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&branch=
//
// Gated on `endOfDay`, which is admin and manager: the same people who do the
// cash-up, reading the same money. Deliberately NOT a new SECTION_ACCESS key —
// /admin/users renders a grant checkbox per key, and "can export the books" is
// not a permission handed out for one shift.
//
// The figures are built on the server from the checks themselves rather than
// from anything the browser sends. A browser names a date range and a branch;
// it never names a rate, a VAT percentage or a total.

import { requireSection, toResponse, type Caller } from '@big-cms/shared/server/auth'
import { parseExportRange, readSalesExport, requestedBranches } from '@big-cms/shared/server/salesExport'
import { readSettings } from '@big-cms/shared/server/settings'
import { BRAND } from '@big-cms/shared/brand'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'endOfDay')
    const range = parseExportRange(new URL(request.url).searchParams)

    // Branch scoping, the same shape the end-of-day route uses: an admin sees
    // every branch, anyone else sees the ones they are assigned to.
    const own = caller.role === 'admin' || caller.branchIds.length === 0
      ? BRAND.branches
      : caller.branchIds
    // One branch, several (a comma list) or all of theirs (UPGRADE.md T7.1).
    requestedBranches(range, own)

    const { exchangeRate } = await readSettings()
    const result = await readSalesExport(range, {
      timeZone: BRAND.locale.timezone,
      // Only ever used for a check closed before the till took payment, which
      // therefore carries no rate of its own.
      fallbackRate: exchangeRate,
      branches: own,
    })

    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
