// Branch floor plans. Phase 00 standing rule — a privileged mutation moved off
// the client SDK and behind a route handler.
//
// PUT  replace one branch's layout
//
// PUT rather than PATCH: the editor commits the entire table array at once,
// so this is a replacement of the document and not a partial change to it.

import { requireSection, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import { parseLayoutInput, saveLayout } from '@/app/lib/server/branchTables'
import { logUpdate } from '@/app/lib/server/activityLog'

export const runtime = 'nodejs'

export async function PUT(request: Request): Promise<Response> {
  try {
    // Mirrors the page's own useRequireRole(SECTION_ACCESS.branchTables).
    const caller: Caller = await requireSection(request, 'branchTables')

    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    const input = parseLayoutInput(body)
    const result = await saveLayout(caller, input)

    // Logged after the write. The same before/after shape the client logger
    // produced, so existing /admin/logs entries stay comparable.
    await logUpdate(caller, 'Branch Table Layout', input.branch,
      { tableCount: result.before }, { tableCount: result.after })

    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
