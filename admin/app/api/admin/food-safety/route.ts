// Food safety — settings, units, and the daily diary.
//
// GET  ?view=settings                          staff with foodSafety
// GET  ?view=day&branch=&date=                 staff with foodSafety
// GET  ?view=history&branch=&from=&to=         foodSafetyReview
// PUT  { action: 'day', ... }                  staff with foodSafety (a signed day: foodSafetyReview, with a reason)
// PUT  { action: 'sign', branch, date }        foodSafetyReview
// PUT  { action: 'unit', ... }                 foodSafetyReview
// PUT  { action: 'settings', ... }             admin — the limits are the café's legal thresholds
//
// Nothing a browser sends is a judgement. It sends answers, readings and
// notes; whether a reading needs a note, whether a day can be signed and who
// may write which day are decided in shared/src/foodSafety.ts on the server.

import { requireSection, requireRole, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { logActivity } from '@big-cms/shared/server/activityLog'
import { todayYmd } from '@big-cms/shared/dates'
import { BRAND } from '@big-cms/shared/brand'
import {
  readFoodSafetySettings, parseSettingsInput, writeFoodSafetySettings,
  listUnits, parseUnitInput, saveUnit,
  parseDayInput, saveDay, signDay, readDay, readHistory,
  requireBranch, requireDate, callerBranches,
} from '@big-cms/shared/server/foodSafety'

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

/** Whether the caller also holds the review section. A refusal here is an answer, not an error. */
async function isReviewer(request: Request): Promise<boolean> {
  try {
    await requireSection(request, 'foodSafetyReview')
    return true
  } catch {
    return false
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams
    const view = params.get('view')

    if (view === 'history') {
      const caller: Caller = await requireSection(request, 'foodSafetyReview')
      const branch = requireBranch(caller, params.get('branch'))
      const result = await readHistory(branch, requireDate(params.get('from')), requireDate(params.get('to')))
      return Response.json({ ok: true, ...result })
    }

    const caller: Caller = await requireSection(request, 'foodSafety')

    if (view === 'settings') {
      const settings = await readFoodSafetySettings()
      return Response.json({
        ok: true, settings, branches: callerBranches(caller),
        // The café's day, so a page opens on the right date whatever the device's clock says.
        today: todayYmd(BRAND.locale.timezone),
        reviewer: await isReviewer(request),
      })
    }

    if (view === 'day') {
      const branch = requireBranch(caller, params.get('branch'))
      const date = requireDate(params.get('date'))
      const reviewer = await isReviewer(request)
      const result = await readDay(branch, date, reviewer)
      return Response.json({ ok: true, ...result, reviewer, branches: callerBranches(caller) })
    }

    if (view === 'units') {
      const branch = requireBranch(caller, params.get('branch'))
      return Response.json({ ok: true, units: await listUnits(branch) })
    }

    throw new HttpError(400, 'Unknown view.')
  } catch (err) {
    return toResponse(err)
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await readBody(request)

    if (body.action === 'day') {
      const caller: Caller = await requireSection(request, 'foodSafety')
      const input = parseDayInput(caller, body)
      const result = await saveDay(caller, input, await isReviewer(request))
      // Saves are logged only when they change a signed day. A diary is saved
      // many times as the day goes on, and logging each would bury the
      // amendment somebody will one day need to find.
      if (result.amended) {
        await logActivity(caller, 'update', 'Food Safety', `Amended ${input.branch} — ${input.date}: ${input.amendReason}`)
      }
      return Response.json({ ok: true, ...result })
    }

    if (body.action === 'sign') {
      const caller: Caller = await requireSection(request, 'foodSafetyReview')
      const branch = requireBranch(caller, body.branch)
      const date = requireDate(body.date)
      await signDay(caller, branch, date)
      await logActivity(caller, 'update', 'Food Safety', `Signed ${branch} — ${date} as supervised`)
      return Response.json({ ok: true })
    }

    if (body.action === 'unit') {
      const caller: Caller = await requireSection(request, 'foodSafetyReview')
      const input = parseUnitInput(caller, body)
      const result = await saveUnit(input)
      await logActivity(caller, result.created ? 'create' : 'update', 'Food Safety Unit',
        `${input.branch} — ${input.name} (${input.kind})${input.active ? '' : ', retired'}`)
      return Response.json({ ok: true, ...result })
    }

    if (body.action === 'settings') {
      const caller: Caller = await requireRole(request, ['admin'])
      const input = parseSettingsInput(body)
      await writeFoodSafetySettings(caller, input)
      await logActivity(caller, 'update', 'Food Safety Settings',
        `Limits, ${input.allergens.length} allergens, ${input.openingChecks.length} opening and ${input.closingChecks.length} closing checks`)
      return Response.json({ ok: true })
    }

    throw new HttpError(400, 'Unknown action.')
  } catch (err) {
    return toResponse(err)
  }
}
