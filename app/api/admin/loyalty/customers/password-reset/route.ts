// Recording that a password-reset email was sent to a customer.
//
// POST  { uid }
//
// The send itself stays in the browser, and that is deliberate rather than
// unfinished. sendPasswordResetEmail() is a Firebase Auth call, not a Firestore
// write — it is not the kind of privileged mutation the Phase 00 rule is about.
// Doing it server-side would mean generatePasswordResetLink() plus mailing the
// link ourselves through Resend, which only ever sends to the Resend account's
// own address (see the note on /api/wholesale/orders). A reset mail to a real
// customer would simply not arrive.
//
// What DOES move here is the audit entry. It was the last client SDK write in
// the app: the browser adding its own row to activityLog, attributed to
// whatever auth.currentUser happened to say.
//
// The label is built from the STORED email, not the one in the request. A log
// line is a claim about what happened, and letting the caller write that claim
// as free text is the thing worth closing — otherwise the record could name an
// address nobody was ever mailed.

import { requireSection, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import { adminDb } from '@/app/lib/server/firebaseAdmin'
import { logActivity } from '@/app/lib/server/activityLog'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'loyalty')

    let body: Record<string, unknown>
    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Invalid request body.')
    }

    const uid = typeof body.uid === 'string' ? body.uid.trim() : ''
    if (!uid) throw new HttpError(400, 'Missing customer id.')

    const snap = await adminDb().doc(`users/${uid}`).get()
    if (!snap.exists) throw new HttpError(404, 'That account no longer exists.')

    const data = snap.data() ?? {}
    // Staff accounts are managed from /admin/users, which has its own reset
    // path. Mirrors the same check on the balance and delete endpoints.
    if (data.isStaff === true) {
      throw new HttpError(400, 'That account is a staff account, not a customer.')
    }

    const email = typeof data.email === 'string' ? data.email : uid
    await logActivity(caller, 'update', 'Customer Account', `Password reset email sent to ${email}`)

    return Response.json({ ok: true, email })
  } catch (err) {
    return toResponse(err)
  }
}
