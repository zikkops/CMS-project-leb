// Open checks. Phase 03, POS v1.
//
// POST   open a check on a table, or add lines to one
// PATCH  send, void a line, move to another table, or close
//
// Gated on the `pos` section, which is grantable per person: taking orders is
// a shift-by-shift thing a manager hands out without changing a role.
//
// Every price is looked up server-side. The browser sends an item id, a
// quantity and modifier option ids — never a price, a name or a station. See
// the note at the top of @big-cms/shared/server/checks.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import {
  parseLineRequests, openCheck, addLines, sendCheck, voidLine, moveCheck, closeCheck,
} from '@big-cms/shared/server/checks'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') throw new Error('not an object')
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Invalid request body.')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'pos')
    const body = await readBody(request)

    // Adding to an existing check names one; opening a new check names a table.
    const checkId = typeof body.checkId === 'string' ? body.checkId : ''
    if (checkId) {
      const result = await addLines(caller, checkId, parseLineRequests(body))
      // Deliberately not logged. A service is hundreds of these, and an audit
      // entry per item would bury every other thing that happened that day.
      // The check itself is the record of what was ordered.
      return Response.json({ ok: true, ...result })
    }

    const { id } = await openCheck(caller, {
      branch: String(body.branch ?? ''),
      tableId: String(body.tableId ?? ''),
      guestCount: Number(body.guestCount ?? 1),
    })
    return Response.json({ ok: true, id })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'pos')
    const body = await readBody(request)

    const checkId = typeof body.checkId === 'string' ? body.checkId : ''
    if (!checkId) throw new HttpError(400, 'Missing check id.')

    switch (String(body.action ?? '')) {
      case 'send': {
        const result = await sendCheck(caller, checkId)
        return Response.json({ ok: true, ...result })
      }
      case 'void': {
        // Logged, unlike adding an item: striking something off is a decision
        // with a reason attached, and it is the one a manager asks about.
        const lineId = String(body.lineId ?? '')
        const reason = String(body.reason ?? '')
        const result = await voidLine(caller, checkId, lineId, reason)
        await logActivity(caller, 'delete', 'POS',
          `Voided an item${result.wasSent ? ' after it was sent' : ''} — ${reason}`)
        return Response.json({ ok: true, ...result })
      }
      case 'move': {
        const result = await moveCheck(caller, checkId, String(body.tableId ?? ''))
        await logActivity(caller, 'update', 'POS',
          `Moved a check from table ${result.from} to table ${result.to}`)
        return Response.json({ ok: true, ...result })
      }
      case 'close': {
        const result = await closeCheck(caller, checkId)
        return Response.json({ ok: true, ...result })
      }
      default:
        throw new HttpError(400, 'Unknown action.')
    }
  } catch (err) {
    return toResponse(err)
  }
}
