// The annual points reset. Phase 00 standing rule, plus the "real cron"
// Phase 00 listed as one of the four things a server made possible.
//
// GET   invoked by Vercel Cron on a schedule (see vercel.json)
// POST  invoked by an admin, to run it now
//
// ── Why the schedule is DAILY for an annual job ───────────────────────────
// vercel.json runs this at 03:00 UTC every day, and on ~364 of those days it
// reads appSettings/loyaltyReset, sees the date hasn't passed, and returns
// 'not-due' having written nothing.
//
// That looks wasteful and is the point. An annual schedule gets exactly one
// chance a year; a deploy, an outage or a timeout on that single day would
// skip the reset for twelve months, silently. Daily means a missed run is
// simply retried tomorrow.
//
// (This rationale lived in vercel.json as a "comment" key. Vercel's schema
// rejects unknown properties on a cron entry, which failed the build — JSON
// has nowhere to put prose, so it lives here instead.)
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

import { requireRole, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { runAnnualReset } from '@big-cms/shared/server/loyalty'
import { logActivity } from '@big-cms/shared/server/activityLog'

export const runtime = 'nodejs'

// A completed reset writes to every customer with a balance, which on a large
// tenant is more than the default.
//
// 60 is the Hobby-plan ceiling. It was 300 briefly, which FAILED THE BUILD —
// Vercel validates maxDuration against the plan's limit at build time, not at
// request time, so an over-limit value doesn't degrade gracefully, it stops
// the whole deployment. Raise this only alongside the plan.
//
// A timeout is survivable here in a way it wouldn't be for most jobs: the
// reset is resumable by construction (it queries for accounts that still have
// a balance), so hitting the ceiling costs a retry on tomorrow's run rather
// than a half-finished reset.
export const maxDuration = 60

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
