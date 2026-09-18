// Reports over closed checks (UPGRADE.md T3.2–T3.4).
//
// GET ?report=voids|mix&from=YYYY-MM-DD&to=YYYY-MM-DD&branch=
//
// Gated on `endOfDay`, as the accountant's export is: the same people, reading
// the same money, and deliberately not a new SECTION_ACCESS key. The checks
// come from the export's own read (readClosedChecks()), so a report and the
// export cannot disagree about which café day a check was, and the figures
// are built here by shared/src/salesReports.ts. The browser names a range and
// a branch, never a figure.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseExportRange, readClosedChecks } from '@big-cms/shared/server/salesExport'
import { productMix, voidDiscountReport } from '@big-cms/shared/salesReports'
import { adminDb } from '@big-cms/shared/server/firebaseAdmin'
import { BRAND } from '@big-cms/shared/brand'

export const runtime = 'nodejs'

/**
 * Which category each menu item is in NOW, by the item's id. Lines do not
 * carry their category, and the menu is small (two collections, a few dozen
 * documents), so it is read whole rather than per line.
 */
async function menuCategories(): Promise<Record<string, string>> {
  const db = adminDb()
  const [items, categories] = await Promise.all([db.collection('menuItems').get(), db.collection('menuCategories').get()])
  const names = new Map(categories.docs.map(d => [d.id, String(d.data().name ?? '')]))
  const out: Record<string, string> = {}
  for (const d of items.docs) {
    const name = names.get(String(d.data().categoryId ?? ''))
    if (name) out[d.id] = name
  }
  return out
}

export async function GET(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'endOfDay')
    const params = new URL(request.url).searchParams
    const range = parseExportRange(params)

    // Branch scoping, as the export does it: an admin sees every branch,
    // anyone else the ones they are assigned to.
    const own = caller.role === 'admin' || caller.branchIds.length === 0 ? BRAND.branches : caller.branchIds
    if (range.branch && !own.includes(range.branch)) throw new HttpError(403, 'That branch is not one of yours.')

    const timeZone = BRAND.locale.timezone
    const report = params.get('report')
    if (report === 'voids') {
      const { checks, branches } = await readClosedChecks(range, { timeZone, branches: own })
      return Response.json(
        { ok: true, from: range.from, to: range.to, branches, checks: checks.length, ...voidDiscountReport(checks, { timeZone }) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (report === 'mix') {
      const [{ checks, branches }, categoryOf] = await Promise.all([
        readClosedChecks(range, { timeZone, branches: own }),
        menuCategories(),
      ])
      return Response.json(
        { ok: true, from: range.from, to: range.to, branches, ...productMix(checks, { categoryOf }) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    throw new HttpError(400, 'Unknown report.')
  } catch (err) {
    return toResponse(err)
  }
}
