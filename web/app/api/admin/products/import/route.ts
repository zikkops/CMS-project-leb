// Bulk product import from a mapped CSV.
//
// POST  { rows: [...] }
//
// Its own route rather than a loop against /api/admin/products: an import is
// hundreds of rows, and a request each would mean hundreds of round trips and
// a separate SKU allocation per created row. Here the whole file is one call,
// the SKUs come from one block, and the counts come back together.
//
// The browser still parses the file and maps the columns — that is
// presentation work. Every write happens here.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseImportRows, runImport } from '@big-cms/shared/server/productImport'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

// A large file does real work per row. The default would cut a big import off
// part-way, which is the worst outcome available — some products in, some not,
// and no way to tell which from the response.
export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'products')

    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    const rows = parseImportRows(body)
    const result = await runImport(rows)

    // One entry for the run, not one per row. A 400-row import would
    // otherwise bury every other thing that happened that day.
    await logActivity(caller, 'create', 'Product Import',
      `${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged` +
      (result.skippedUnknownSku > 0 ? `, ${result.skippedUnknownSku} skipped (unknown SKU)` : '') +
      (result.skippedNoName > 0 ? `, ${result.skippedNoName} skipped (no name)` : '') +
      (result.categoriesCreated.length > 0 ? ` · new categories: ${result.categoriesCreated.join(', ')}` : ''))

    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
