// Business settings — VAT, exchange rate, tips deduction.
//
// GET    read the current values (any staff — the receiving form needs them)
// PATCH  change them (superadmin only)
//
// Superadmin rather than a section grant, deliberately. These are three
// numbers that decide what customers are charged and what staff are paid, and
// SECTION_ACCESS grants are handed out per user in /admin/users — adding a
// section here would make "can change the VAT rate" a checkbox somebody ticks
// while trying to give a barista access to the stock count.

import { requireStaff, requireSuperadmin, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseSettingsInput, readSettings, writeSettings, invoicesIssued } from '@big-cms/shared/server/settings'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

// Rates are fractions everywhere in the codebase; percentages exist only for
// human display. Formatting here keeps the audit entry readable without the
// stored shape following it.
function show(field: string, value: number | string): string {
  // The prefix is the one setting that is not a rate. Percent-formatting it
  // would have produced "NaN%" in the audit entry.
  if (typeof value === 'string') return value
  return field === 'exchangeRate'
    ? value.toLocaleString('en-US')
    : `${(value * 100).toFixed(2).replace(/\.?0+$/, '')}%`
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff(request)
    // prefixLocked lets the settings page explain WHY the field is disabled
    // rather than presenting a greyed-out box with no reason.
    const [settings, locked] = await Promise.all([readSettings(), invoicesIssued()])
    return Response.json({ ok: true, settings, prefixLocked: locked })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireSuperadmin(request)

    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    const input = parseSettingsInput(body)
    const { changes } = await writeSettings(input, { uid: actor.uid, email: actor.email ?? '' })

    // Only log a real change. Opening the page and pressing Save without
    // touching anything should not fill the audit log with entries that say
    // nothing happened.
    if (changes.length > 0) {
      await logActivity(actor, 'update', 'Business Settings',
        changes.map(c => `${c.field} ${show(c.field, c.before)} → ${show(c.field, c.after)}`).join(', '))
    }

    return Response.json({ ok: true, changed: changes.length, settings: input })
  } catch (err) {
    return toResponse(err)
  }
}
