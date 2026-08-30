// Weekly ordering. Phase 00 standing rule.
//
// POST    submit an order for a branch and week
// PATCH   change one line's quantity, or flag an order as sent to a supplier
// DELETE  remove an order that has not been received against
//
// Submitting uses the `weeklyOrdersSubmit` section rather than `weeklyOrders`:
// kitchen crew and baristas submit their own department's order but do not
// manage the template or edit a submitted one. That split already exists in
// SECTION_ACCESS; this is the first place it's enforced server-side.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import {
  parseSubmitInput, submitWeeklyOrder, updateReportItemQty,
  deleteWeeklyOrder, setWhatsappSent, appendOrderLog,
} from '@big-cms/shared/server/weeklyOrders'
import { logCreate, logUpdate, logDelete } from '@big-cms/shared/server/activityLog'

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
    const caller: Caller = await requireSection(request, 'weeklyOrdersSubmit')
    const input = parseSubmitInput(await readBody(request))

    const result = await submitWeeklyOrder(caller, input)
    const label = `${input.branch}${input.department ? ` — ${input.department}` : ''} — ${input.weekLabel}`

    await logCreate(caller, 'Weekly Order Report', label, { lines: result.lines })
    await appendOrderLog(caller, {
      action: 'submit', reportId: result.id,
      branch: input.branch, department: input.department, weekLabel: input.weekLabel,
    })

    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    // Editing a submitted order is the manager-side section, not the
    // submit-side one — a barista submits the bar order, they don't then
    // revise it after the fact.
    const caller: Caller = await requireSection(request, 'weeklyOrders')
    const body = await readBody(request)

    const reportId = typeof body.reportId === 'string' ? body.reportId.trim() : ''
    if (!reportId) throw new HttpError(400, 'Missing order id.')

    if (body.action === 'quantity') {
      const templateId = String(body.templateId ?? '')
      const r = await updateReportItemQty(caller, reportId, templateId, Number(body.quantity))

      await logUpdate(caller, 'Weekly Order Report', `${r.branch} — ${r.name}`,
        { quantity: r.before }, { quantity: r.after })
      await appendOrderLog(caller, {
        action: 'edit-quantity', reportId, branch: r.branch,
        itemName: r.name, from: r.before, to: r.after,
      })

      return Response.json({ ok: true, quantity: r.after })
    }

    if (body.action === 'whatsapp') {
      const providerKey = String(body.providerKey ?? '')
      if (!providerKey) throw new HttpError(400, 'Missing provider.')
      await setWhatsappSent(caller, reportId, providerKey, body.sent === true)
      // Not logged: a send flag gets toggled repeatedly while someone works
      // through a supplier list, and every toggle in the audit log would bury
      // the entries that matter.
      return Response.json({ ok: true })
    }

    throw new HttpError(400, 'Unknown action.')
  } catch (err) {
    return toResponse(err)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'weeklyOrders')
    const reportId = new URL(request.url).searchParams.get('id') ?? ''
    if (!reportId) throw new HttpError(400, 'Missing order id.')

    const result = await deleteWeeklyOrder(caller, reportId)

    await logDelete(caller, 'Weekly Order Report', result.label, { branch: result.branch })
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}
