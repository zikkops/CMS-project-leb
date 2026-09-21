// The waitlist (UPGRADE.md T3.13).
//
// GET   ?branch=                                today's list at a branch
// POST  { branch, name, partySize, quotedMinutes, note, requestId }   add a party (postOnce)
// PATCH { id, status: 'seated' | 'left' | 'waiting' }                 seat, gone, or undo
//
// The people who handle table reservations (tableReservations section), with
// the waitlist switch on. Not logged: a busy night is dozens of parties, and
// each entry carries who added and moved it.

import { requireSection, toResponse, HttpError } from '@big-cms/shared/server/auth'
import { serverFeatureOn } from '@big-cms/shared/server/features'
import { parseRequestId } from '@big-cms/shared/server/idempotency'
import { addToWaitlist, listWaitlist, setWaitStatus } from '@big-cms/shared/server/waitlist'
import { readWaitInput } from '@big-cms/shared/waitlist'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

async function switchedOn(): Promise<void> {
  if (!(await serverFeatureOn('waitlist'))) throw new HttpError(403, 'The waitlist is switched off.')
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') throw new Error('not an object')
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Invalid request body.')
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const caller = await requireSection(request, 'tableReservations')
    await switchedOn()
    const branch = new URL(request.url).searchParams.get('branch') ?? ''
    return Response.json({ ok: true, ...(await listWaitlist(caller, branch)) }, { headers: noStore })
  } catch (err) {
    return toResponse(err)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const caller = await requireSection(request, 'tableReservations')
    await switchedOn()
    const body = await readBody(request)
    const input = readWaitInput(body)
    if (typeof input === 'string') throw new HttpError(400, input)
    const branch = typeof body.branch === 'string' ? body.branch : ''
    return Response.json({ ok: true, ...(await addToWaitlist(caller, branch, input, parseRequestId(body))) })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const caller = await requireSection(request, 'tableReservations')
    await switchedOn()
    const body = await readBody(request)
    return Response.json({ ok: true, ...(await setWaitStatus(caller, typeof body.id === 'string' ? body.id : '', body.status)) })
  } catch (err) {
    return toResponse(err)
  }
}
