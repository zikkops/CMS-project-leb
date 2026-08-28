// The end-of-day cash-up. Phase 00 standing rule.
//
// POST   save (create or replace) a branch's report for one date
// PATCH  correct the tips figure, or set a branch's staff roster
//
// Tips get their own action rather than a whole-report save because that is
// how the summary screen uses it: a manager reconciling tips should not have
// to re-submit every drawer count to change one number, and re-submitting is
// how a stale form silently reverts someone else's correction.

import { requireSection, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import { parseEodInput, saveEndOfDay, updateTips, saveBranchStaff } from '@/app/lib/server/endOfDay'
import { logCreate, logUpdate } from '@/app/lib/server/activityLog'

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
    const caller: Caller = await requireSection(request, 'endOfDay')
    const input = parseEodInput(await readBody(request))

    const result = await saveEndOfDay(caller, input)
    const label = `${input.branch} — ${input.date}`

    // Created and corrected are different events. The old client flow logged
    // one shape for both, so "who cashed up" and "who edited it afterwards"
    // were indistinguishable in the audit trail.
    if (result.created) {
      await logCreate(caller, 'End of Day', label, {
        systemUsd: input.systemUsd, systemLbp: input.systemLbp, tipsUsd: input.tipsUsd,
      })
    } else {
      await logUpdate(caller, 'End of Day', label, { edited: false }, {
        edited: true, systemUsd: input.systemUsd, systemLbp: input.systemLbp, tipsUsd: input.tipsUsd,
      })
    }

    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'endOfDay')
    const body = await readBody(request)

    if (body.action === 'tips') {
      const branch = String(body.branch ?? '')
      const date = String(body.date ?? '')
      const result = await updateTips(caller, branch, date, Number(body.tipsUsd))

      // Tips feed the monthly payroll figure, so a change to them is worth its
      // own log entry with both values — not folded into a generic "report
      // updated".
      await logUpdate(caller, 'End of Day', `${branch} — ${date} tips`,
        { tipsUsd: result.before }, { tipsUsd: result.after })

      return Response.json({ ok: true, tipsUsd: result.after })
    }

    if (body.action === 'staff') {
      const branch = String(body.branch ?? '')
      const staff = Array.isArray(body.staff) ? (body.staff as string[]) : []
      const result = await saveBranchStaff(caller, branch, staff)

      await logUpdate(caller, 'End of Day', `${branch} — staff roster`,
        { count: null }, { count: result.count })

      return Response.json({ ok: true, ...result })
    }

    throw new HttpError(400, 'Unknown action.')
  } catch (err) {
    return toResponse(err)
  }
}
