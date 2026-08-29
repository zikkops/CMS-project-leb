// The superadmin switchboard's write path.
//
// GET    read the stored flags (any staff — the nav needs them)
// PATCH  change them (superadmin only)
//
// The dependency graph is NOT here and never will be: it is a property of the
// build, and a browser must not be able to edit which modules depend on which.
// This endpoint only persists intent.

import { requireStaff, requireSuperadmin, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import { parseFlagsInput, readFlags, writeFlags } from '@/app/lib/server/features'
import { logActivity } from '@/app/lib/server/activityLog'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff(request)
    return Response.json({ ok: true, flags: await readFlags() })
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

    const { changes } = await writeFlags(
      parseFlagsInput(body),
      { uid: actor.uid, email: actor.email ?? '' },
    )

    if (changes.length > 0) {
      // Cascaded entries are marked, so the log distinguishes "they switched
      // this off" from "this went off because its parent did".
      await logActivity(actor, 'update', 'Feature Flags',
        changes
          .map(c => `${c.label} ${c.before ? 'on' : 'off'} → ${c.after ? 'on' : 'off'}${c.cascaded ? ' (cascaded)' : ''}`)
          .join(', '))
    }

    return Response.json({ ok: true, changed: changes.length, changes })
  } catch (err) {
    return toResponse(err)
  }
}
