// The chart of accounts the journal posts to (UPGRADE.md T7.15).
//
// GET   the codes in force, with the menu's categories   (endOfDay: the journal page)
// PUT   { accounts, categories }                        (admin)
//
// Stored at appSettings/accountCodes, server-only. A code the accountant could
// not import is refused, never saved quietly as a default. Logged with before
// and after, under "Account codes".

import { requireRole, requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { ACCOUNT_CODES_DOC, readAccountCodesDoc } from '@big-cms/shared/server/journal'
import { accountCodesProblem, readAccountCodes } from '@big-cms/shared/journal'
import { adminDb } from '@big-cms/shared/server/firebaseAdmin'
import { logUpdate } from '@big-cms/shared/server/activityLog'
import { FieldValue } from 'firebase-admin/firestore'

export const runtime = 'nodejs'

async function categoryNames(): Promise<string[]> {
  const snap = await adminDb().collection('menuCategories').get()
  const names = snap.docs.map(d => String(d.data().name ?? '')).filter(Boolean)
  return [...new Set([...names, 'Retail', 'No longer on the menu'])].sort()
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSection(request, 'endOfDay')
    const [codes, categories] = await Promise.all([readAccountCodesDoc(), categoryNames()])
    return Response.json({ ok: true, codes, categories }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return toResponse(err)
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireRole(request, ['admin'])
    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }
    const problem = accountCodesProblem(body)
    if (problem) throw new HttpError(400, problem)
    const before = await readAccountCodesDoc()
    const after = readAccountCodes(body)
    await adminDb().doc(ACCOUNT_CODES_DOC).set({ ...after, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
    await logUpdate(actor, 'Account codes', 'Chart of accounts for the journal', before, after)
    return Response.json({ ok: true, codes: after })
  } catch (err) {
    return toResponse(err)
  }
}
