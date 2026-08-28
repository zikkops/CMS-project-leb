// Staff account management. The first route on the new server layer, and the
// clearest demonstration of what it buys.
//
// WHAT THIS REPLACED
// Creating a staff account used to be a four-step dance in the browser
// (app/lib/adminAuth.ts, createAccount), because no step could be trusted to
// the admin's own session:
//   1. POST identitytoolkit accounts:signUp to mint the Auth user, capturing
//      the NEW user's idToken out of the response
//   2. the admin writes a transient adminInvitations/{uid} doc, purely so a
//      rule has something to check in step 3
//   3. the new user writes their own users/{uid} doc with their own token,
//      retried up to 3× with backoff because exists(adminInvitations/{uid})
//      races Firestore's own replication
//   4. delete the invitation doc
// Four network round trips, a retry loop against a race condition, a whole
// collection and a rule that exists only to prop the sequence up — and a
// failure between any two steps leaves an orphaned Auth user with no document,
// which is exactly the "signed in but not provisioned" state useAdminUser()
// has to special-case.
//
// With the Admin SDK it's createUser + set + syncClaims, in one place, with a
// real rollback. adminInvitations and its rule can be deleted once no client
// calls the old path — see docs/server-setup.md § Cleanup.

import { adminAuth, adminDb } from '@/app/lib/server/firebaseAdmin'
import { requireRole, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import { syncClaims } from '@/app/lib/server/claims'
import { logActivity, logUpdate } from '@/app/lib/server/activityLog'
import { isRole, type Role } from '@/app/lib/roles'
import { BRANCHES } from '@/app/lib/branches'
import { FieldValue } from 'firebase-admin/firestore'

// The Admin SDK opens gRPC connections and reads a PEM private key — neither
// works on the edge runtime. Route handlers default to Node, but state it
// explicitly so a future `export const runtime = 'edge'` added for speed
// doesn't break this file in a way that only shows up at request time.
export const runtime = 'nodejs'

interface AccountInput {
  role: Role
  branchIds: string[]
}

function parseAccountInput(body: Record<string, unknown>): AccountInput {
  if (!isRole(body.role)) {
    throw new HttpError(400, 'Unknown role.')
  }

  const rawBranches = Array.isArray(body.branchIds) ? body.branchIds : []
  const branchIds = rawBranches.filter((b): b is string => typeof b === 'string')

  // Validate against the real branch list rather than storing whatever arrives.
  // The old flow wrote branchIds straight through from the browser; a typo (or
  // a crafted request) produced an account scoped to a branch that does not
  // exist, which reads as "no access" in some views and "all access" in others.
  const unknown = branchIds.filter(b => !(BRANCHES as readonly string[]).includes(b))
  if (unknown.length > 0) {
    throw new HttpError(400, `Unknown branch: ${unknown.join(', ')}`)
  }

  return {
    role: body.role,
    branchIds,
  }
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

// Maps Admin SDK error codes onto the exact user-facing strings the old
// client-side flow produced, so the Manage Users page needs no copy changes.
function accountCreationError(err: unknown): HttpError {
  const code = (err as { code?: string })?.code ?? ''
  if (code === 'auth/email-already-exists') return new HttpError(409, 'An account with this email already exists.')
  if (code === 'auth/invalid-password')     return new HttpError(400, 'Password must be at least 6 characters.')
  if (code === 'auth/invalid-email')        return new HttpError(400, 'Invalid email address.')
  if (code === 'auth/operation-not-allowed') {
    return new HttpError(400, 'Email/password sign-in is disabled in Firebase. Enable it in the console.')
  }
  if (code === 'auth/too-many-requests')    return new HttpError(429, 'Too many attempts. Please try again in a few minutes.')
  return new HttpError(500, 'Account creation failed. Please try again.')
}

// ── POST /api/admin/accounts — create a staff account ────────────────────────
export async function POST(request: Request): Promise<Response> {
  try {
    // Mirrors useRequireRole(['admin']) on /admin/users exactly. Deliberately
    // a role check rather than a section check — see the note at the bottom of
    // app/lib/roles.ts for why account management must not be grantable.
    const actor: Caller = await requireRole(request, ['admin'])
    const body = await readBody(request)

    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email) throw new HttpError(400, 'Invalid email address.')
    if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.')

    const input = parseAccountInput(body)

    let uid: string
    try {
      const user = await adminAuth().createUser({ email, password })
      uid = user.uid
    } catch (err) {
      throw accountCreationError(err)
    }

    // From here on the Auth user exists, so every failure path must clean it
    // up. Without this, a failed Firestore write leaves an account that can
    // sign in but has no profile — the old flow's worst failure mode, since
    // the email is then taken and the admin can't simply retry.
    try {
      await adminDb().doc(`users/${uid}`).set({
        email,
        isStaff: true,
        role: input.role,
        branchIds: input.branchIds,
        pointsEarned: 0,
        points: 0,
        createdAt: FieldValue.serverTimestamp(),
      })

      await syncClaims(uid)

      await logActivity(actor, 'create', 'User Account', `${email} (${input.role})`)
    } catch (err) {
      await adminAuth().deleteUser(uid).catch(cleanupErr => {
        // Surface this loudly: the rollback failing is the one case that does
        // leave an orphan, and whoever is on support needs to know the uid.
        console.error(`[accounts] rollback failed for orphaned auth user ${uid}:`, cleanupErr)
      })
      throw err
    }

    return Response.json({ uid })
  } catch (err) {
    return toResponse(err)
  }
}

// ── PATCH /api/admin/accounts — change an existing account's access ──────────
// Deliberately does not recreate the account: recreating mints a new Firebase
// Auth uid and breaks that person's login, plus orphans everything keyed on
// the old uid (reservations, transactions, activity log entries).
export async function PATCH(request: Request): Promise<Response> {
  try {
    // Mirrors useRequireRole(['admin']) on /admin/users exactly. Deliberately
    // a role check rather than a section check — see the note at the bottom of
    // app/lib/roles.ts for why account management must not be grantable.
    const actor: Caller = await requireRole(request, ['admin'])
    const body = await readBody(request)

    const uid = typeof body.uid === 'string' ? body.uid : ''
    if (!uid) throw new HttpError(400, 'Missing account id.')

    const input = parseAccountInput(body)

    const ref = adminDb().doc(`users/${uid}`)
    const snap = await ref.get()
    if (!snap.exists) throw new HttpError(404, 'That account no longer exists.')

    const existing = snap.data() ?? {}
    if (existing.isStaff !== true) throw new HttpError(400, 'That account is not a staff account.')

    // /admin/users already refuses to let one admin edit a superadmin's account
    // (canEdit(), around line 150) — but that was a disabled button, not a rule.
    // Enforce it here, where it's actually a boundary: a superadmin's access is
    // theirs alone to change, so no admin can quietly demote the person who can
    // undo them.
    if (existing.superadmin === true && uid !== actor.uid) {
      throw new HttpError(403, 'Only that superadmin can change their own access.')
    }

    // Guard against an admin removing their own last route back in. The audit
    // called this out for feature flags ("no state where a superadmin can lock
    // themselves out"); the same reasoning applies harder to roles, because
    // unlike a flag there's no console toggle to undo it from the UI.
    if (uid === actor.uid && input.role !== 'admin') {
      throw new HttpError(400, 'You cannot remove your own admin role. Ask another admin to do it.')
    }

    const before = {
      role: existing.role,
      branchIds: Array.isArray(existing.branchIds) ? existing.branchIds : [],
    }
    const after = {
      role: input.role,
      branchIds: input.branchIds,
    }

    await ref.update(after)

    // Must follow the document write, never precede it — claims are derived
    // from the doc, so syncing first would mint the old values.
    await syncClaims(uid)

    const label = typeof existing.email === 'string'
      ? existing.email
      : typeof body.email === 'string' ? body.email : uid

    await logUpdate(actor, 'User Account', label, before, after)

    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}

// ── DELETE /api/admin/accounts?uid=… — revoke staff access ───────────────────
// Strips the staff fields from the document, keeping the person's customer
// identity (points, bookings, history) intact. Their login still works;
// they're just no longer staff.
//
// THIS HAD TO MOVE SERVER-SIDE. /admin/users used to do it with a client
// `updateDoc` deleting isStaff/role/branchIds/isDungeonMaster. That was
// survivable while rules only ever read the document — but the moment claims
// exist, it becomes a hole: nothing calls setCustomUserClaims, so the revoked
// account's token keeps saying `staff: true` and `role: 'manager'` FOREVER.
// Claims don't expire on their own; they change only when something writes
// them. A rules deploy that trusts claims would have handed a revoked staff
// member permanent access.
//
// Clearing the document and clearing the claims must happen together, which
// means they have to happen where the Admin SDK is.
export async function DELETE(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireRole(request, ['admin'])

    const uid = new URL(request.url).searchParams.get('uid') ?? ''
    if (!uid) throw new HttpError(400, 'Missing account id.')

    const ref = adminDb().doc(`users/${uid}`)
    const snap = await ref.get()
    if (!snap.exists) throw new HttpError(404, 'That account no longer exists.')

    const existing = snap.data() ?? {}
    if (existing.isStaff !== true) throw new HttpError(400, 'That account is not a staff account.')

    // Same protection as PATCH, and for a stronger reason: revoking a
    // superadmin is the one action with no way back through the UI.
    if (existing.superadmin === true) {
      throw new HttpError(403, "A superadmin's access can't be revoked from here.")
    }
    if (uid === actor.uid) {
      throw new HttpError(400, 'You cannot revoke your own access. Ask another admin to do it.')
    }

    const wasRole = typeof existing.role === 'string' ? existing.role : 'unknown'

    await ref.update({
      isStaff: FieldValue.delete(),
      role: FieldValue.delete(),
      branchIds: FieldValue.delete(),
      // The app stopped writing isDungeonMaster when the D&D modules went, but
      // accounts created before then still carry it. Keep deleting it here so
      // revocation leaves nothing privilege-shaped behind on the document.
      isDungeonMaster: FieldValue.delete(),
      orderDepts: FieldValue.delete(),
      sectionGrants: FieldValue.delete(),
      sectionRevocations: FieldValue.delete(),
    })

    // revokeSessions: true — this is the case the flag exists for. Access is
    // being taken away, so the old session dies now rather than lingering.
    // Note the honest limit (see claims.ts): an ID token already in a open tab
    // stays valid to Firestore rules for up to an hour. Revoking stops any new
    // token being minted from the old refresh token, and the SDK signs them
    // out on its next refresh.
    await syncClaims(uid, { revokeSessions: true })

    const label = typeof existing.email === 'string' ? existing.email : uid
    await logActivity(actor, 'delete', 'User Account', `${label} (${wasRole})`)

    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)
  }
}
