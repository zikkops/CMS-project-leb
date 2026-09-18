// The branch cash drawer — Phase 04, slice 4.
//
// POST   { branch, floatUsd, floatLbp }             open a shift
// POST   { action: 'movement', shiftId, id, kind, usd, lbp, reason, note }
//        a paid-out, pay-in or safe drop (UPGRADE.md T3.1): managers and
//        admins, with the drawerMovements switch on
// GET    ?shiftId=                                  X reading — changes nothing
// PATCH  { shiftId, countLbp, countUsd, note }      Z close
//
// The `pos` section, not a manager role: anyone on the till opens and closes
// the drawer (owner's decision, 11 Sep 2026). Both are logged with who did
// them, which is what makes that safe.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import {
  openShift, xReading, closeShift, recordMovement, parseFloat2, parseLbpCount, parseUsdCount,
} from '@big-cms/shared/server/drawer'
import { serverFeatureOn } from '@big-cms/shared/server/features'
import { MOVEMENT_LABELS } from '@big-cms/shared/drawer'
import { logActivity } from '@big-cms/shared/server/activityLog'
import { refuseWhileHubbed } from '@big-cms/shared/server/hubLock'

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

const lbp = (n: number) => `${Math.round(n).toLocaleString('en-US')} LBP`
const usd = (n: number) => `$${n.toFixed(2)}`
const signed = (s: string, n: number) => (n > 0 ? `+${s}` : s)

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'pos')
    const body = await readBody(request)
    if (body.action === 'movement') return await movement(caller, body)
    const branch = typeof body.branch === 'string' ? body.branch.trim() : ''
    // A branch a café hub trades is view-only here (S10): its drawer is the hub's.
    await refuseWhileHubbed({ branch })
    const float = parseFloat2(body)
    const { id } = await openShift(caller, branch, float)
    await logActivity(caller, 'create', 'POS',
      `Opened the drawer at ${branch} — float ${usd(float.usd)} + ${lbp(float.lbp)}`)
    return Response.json({ ok: true, id })
  } catch (err) {
    return toResponse(err)
  }
}

/**
 * Cash that is not a sale. Taking money out of the drawer is a manager's
 * (the default until the owner says otherwise, UPGRADE.md T3.1), and every
 * one is logged with who, how much and why.
 */
async function movement(caller: Caller, body: Record<string, unknown>): Promise<Response> {
  if (!(await serverFeatureOn('drawerMovements'))) throw new HttpError(403, 'Paid-outs and safe drops are switched off.')
  if (caller.role !== 'manager' && caller.role !== 'admin') {
    throw new HttpError(403, 'Only a manager records cash taken out of the drawer or put in.')
  }
  const shiftId = typeof body.shiftId === 'string' ? body.shiftId : ''
  if (!shiftId) throw new HttpError(400, 'Missing shift id.')
  await refuseWhileHubbed({ shiftId })
  const { branch, movement: m, alreadyRecorded } = await recordMovement(caller, shiftId, body)
  if (!alreadyRecorded) {
    const amount = [m.usd > 0 ? usd(m.usd) : '', m.lbp > 0 ? lbp(m.lbp) : ''].filter(Boolean).join(' + ')
    await logActivity(caller, 'update', 'POS',
      `${MOVEMENT_LABELS[m.kind]} at ${branch}: ${amount} (${m.reason}${m.note ? `: ${m.note}` : ''})`)
  }
  return Response.json({ ok: true, movement: m, alreadyRecorded })
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSection(request, 'pos')
    const shiftId = new URL(request.url).searchParams.get('shiftId') ?? ''
    if (!shiftId) throw new HttpError(400, 'Missing shift id.')
    return Response.json({ ok: true, ...(await xReading(shiftId)) })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'pos')
    const body = await readBody(request)
    const shiftId = typeof body.shiftId === 'string' ? body.shiftId : ''
    if (!shiftId) throw new HttpError(400, 'Missing shift id.')
    await refuseWhileHubbed({ shiftId })

    const z = await closeShift(
      caller, shiftId,
      parseLbpCount(body.countLbp), parseUsdCount(body.countUsd),
      String(body.note ?? ''),
    )
    // The difference is the line a manager looks for, so it is the entry.
    const { usd: du, lbp: dl } = z.difference
    await logActivity(caller, 'update', 'POS',
      `Closed the drawer at ${z.branch} — counted ${usd(z.counted.usd)} + ${lbp(z.counted.lbp)}, ` +
      (du === 0 && dl === 0
        ? 'exactly as expected'
        : `difference ${signed(usd(du), du)} and ${signed(lbp(dl), dl)}`))
    return Response.json({ ok: true, ...z })
  } catch (err) {
    return toResponse(err)
  }
}
