// What a branch's till shows (UPGRADE.md T7.20).
//
// GET  ?branch=            the menu, with what this branch's till hides
// PUT  { branch, hiddenCategories, hiddenItems }
//
// Gated on `menu`: whoever decides what is on the menu decides what the till
// shows of it, and this is deliberately not a new SECTION_ACCESS key. The
// caller may only touch a branch they are assigned to, as every other
// per-branch write does.
//
// The state is stored on the menu documents themselves (posHidden.<branch>),
// the same place and shape soldOut uses, so there is no new collection and no
// Firestore rule to deploy. Logged with the counts, under "POS Layout".

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { readPosLayout, savePosLayout } from '@big-cms/shared/server/posLayout'
import { logActivity } from '@big-cms/shared/server/activityLog'
import { BRAND } from '@big-cms/shared/brand'

export const runtime = 'nodejs'

/** The branches this caller may configure: an admin every one, anybody else their own. */
function allowed(caller: Caller): string[] {
  return caller.role === 'admin' || caller.superadmin || caller.branchIds.length === 0
    ? [...BRAND.branches]
    : caller.branchIds
}

function chosenBranch(caller: Caller, asked: string | null): string {
  const mine = allowed(caller)
  const branch = asked || mine[0] || ''
  if (!mine.includes(branch)) throw new HttpError(403, `You are not assigned to ${branch || 'that branch'}.`)
  return branch
}

function ids(raw: unknown, what: string): string[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new HttpError(400, `${what} should be a list.`)
  const out = raw.filter((v): v is string => typeof v === 'string' && v !== '' && !v.includes('/'))
  if (out.length !== raw.length) throw new HttpError(400, `${what} holds something that is not an id.`)
  return [...new Set(out)]
}

export async function GET(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'menu')
    const params = new URL(request.url).searchParams
    const branch = chosenBranch(caller, params.get('branch'))
    const view = await readPosLayout(branch)
    return Response.json(
      { ok: true, branches: allowed(caller), ...view },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return toResponse(err)
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'menu')
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }
    const branch = chosenBranch(caller, typeof body.branch === 'string' ? body.branch : null)
    const hiddenCategories = ids(body.hiddenCategories, 'The hidden categories')
    const hiddenItems = ids(body.hiddenItems, 'The hidden items')

    const { changed, counts } = await savePosLayout(branch, hiddenCategories, hiddenItems)
    if (changed > 0) {
      await logActivity(
        caller, 'update', 'POS Layout',
        `${branch}: the till shows ${counts.itemsShown} of ${counts.itemsTotal} items and ${counts.categoriesShown} of ${counts.categoriesTotal} categories (${changed} changed)`,
      )
    }
    return Response.json({ ok: true, changed, counts })
  } catch (err) {
    return toResponse(err)
  }
}
