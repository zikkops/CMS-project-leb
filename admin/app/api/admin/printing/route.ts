// Printer configuration.
//
// GET  read it (any staff — the KDS needs to know what it prints to)
// PUT  replace it (admin)
//
// PUT rather than PATCH because the document is a whole nested map of branches
// and stations, and a partial merge over that shape is how one branch's
// printers quietly survive being deleted from the settings page.
//
// Admin rather than superadmin, unlike /api/admin/settings next door. That one
// guards three numbers deciding what customers are charged and what staff are
// paid. This decides whether paper comes out of a machine — worth a role
// check, not worth the narrowest one in the system.

import { requireStaff, requireRole, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import {
  readPrintingSettings, writePrintingSettings, parsePrintingInput, describePrinting,
} from '@big-cms/shared/server/printing'
import { logUpdate } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff(request)
    return Response.json({ ok: true, settings: await readPrintingSettings() })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireRole(request, ['admin'])

    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    let settings
    try {
      settings = parsePrintingInput(body)
    } catch (err) {
      // The parser's messages name the branch and station and say what to fix,
      // so they are worth showing rather than replacing with "invalid input".
      throw new HttpError(400, err instanceof Error ? err.message : 'Invalid printer settings.')
    }

    const before = await readPrintingSettings()
    await writePrintingSettings(settings)

    // Summaries rather than the documents: the raw shape is a nested map and a
    // diff of it is unreadable. What anyone asks later is "when did the
    // kitchen stop printing", and that is what these two lines answer.
    await logUpdate(
      actor, 'settings', 'Printers',
      { printers: describePrinting(before) },
      { printers: describePrinting(settings) },
    )

    return Response.json({ ok: true, settings })
  } catch (err) {
    return toResponse(err)
  }
}
