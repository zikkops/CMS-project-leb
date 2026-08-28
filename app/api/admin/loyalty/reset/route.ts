// The annual points reset. Phase 00 standing rule, plus the "real cron"
// Phase 00 listed as one of the four things a server made possible.
//
// GET   invoked by Vercel Cron on a schedule (see vercel.json)
// POST  invoked by an admin, to run it now
//
// ── Two callers, two completely different authentications ─────────────────
// Cron is not a signed-in user and never will be, so it cannot present an ID
// token. Vercel sends `Authorization: Bearer $CRON_SECRET` instead, which is
// compared here against the environment. An admin's manual run goes through
// the normal token path.
//
// They are separate HTTP methods rather than one endpoint that sniffs the
// header, so neither auth path can accidentally satisfy the other: a request
// with no valid CRON_SECRET cannot reach the cron branch at all.

import { requireRole, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import { runAnnualReset } from '@/app/lib/server/loyalty'
import { logActivity } from '@/app/lib/server/activityLog'

export const runtime = 'nodejs'

// A completed reset writes to every customer with a balance. On a large
// tenant that is more than the default 10s. The work is resumable, so a
// timeout costs a retry rather than a half-finished reset — but there is no
// reason to make retries the normal case.
export const maxDuration = 300

function summarise(r: Awaited<ReturnType<typeof runAnnualReset>>): string {
  if (r.status === 'seeded') return `Reset schedule seeded — first reset ${r.nextResetDate}`
  if (r.status === 'not-due') return `Not due until ${r.nextResetDate}`
  return `Annual points reset ran for ${r.customersReset} customer${r.customersReset === 1 ? '' : 's'} — next reset ${r.nextResetDate}`
}

// ── GET: Vercel Cron ─────────────────────────────────────────────────────
export async function GET(request: Request): Promise<Response> {
  try {
    const secret = process.env.CRON_SECRET
    // Fail closed. An unset secret must not mean "anyone may run this" — that
    // would make a destructive endpoint public the moment the env var is
    // forgotten, which is precisely when nobody is looking.
    if (!secret) {
      throw new HttpError(503, 'CRON_SECRET is not configured on this deployment.')
    }
    const header = request.headers.get('authorization') ?? ''
    if (header !== `Bearer ${secret}`) {
      throw new HttpError(401, 'Not authorised.')
    }

    const result = await runAnnualReset()

    // Logged only when something actually happened. Cron runs daily; an entry
    // every day saying "not due" would bury the one entry that matters.
    if (result.status !== 'not-due') {
      await logActivity(
        { uid: 'vercel-cron', email: 'cron', role: null, branchIds: [], superadmin: false, isStaff: true },
        'update', 'Loyalty Reset Schedule', summarise(result),
      )
    }

    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}

// ── POST: an admin running it by hand ────────────────────────────────────
export async function POST(request: Request): Promise<Response> {
  try {
    // requireRole('admin'), not the loyalty section: this zeroes every
    // customer's balance in one call. Granting somebody the loyalty section so
    // they can approve check submissions should not also hand them that.
    const caller: Caller = await requireRole(request, ['admin'])

    const body = await request.json().catch(() => ({}))
    const force = (body as Record<string, unknown>)?.force === true

    const result = await runAnnualReset(force)

    await logActivity(caller, 'update', 'Loyalty Reset Schedule', summarise(result))

    return Response.json({ ok: true, ...result })
  } catch (err) {
    return toResponse(err)
  }
}
