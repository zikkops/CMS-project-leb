// Wholesale account management — the shops that buy from us at wholesale
// prices. Not to be confused with `orderProviders`, which are the suppliers
// we buy FROM.
//
// Mirrors app/api/admin/accounts/route.ts: create the Auth user with the Admin
// SDK, write the users/{uid} doc, mint claims, and roll the Auth user back if
// any of that fails. The claim (`wholesale: true`) is what makes the Firestore
// rules on gameWholesale and wholesaleOrders free to evaluate.

import { adminAuth, adminDb } from '@/app/lib/server/firebaseAdmin'
import { requireRole, toResponse, HttpError, type Caller } from '@/app/lib/server/auth'
import { syncClaims } from '@/app/lib/server/claims'
import { logCreate, logUpdate } from '@/app/lib/server/activityLog'

export const runtime = 'nodejs'

interface WholesaleInput {
  shopName:    string
  contactName: string
  phone:       string
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object') throw new Error('not an object')
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Request body must be JSON.')
  }
}

function parseInput(body: Record<string, unknown>): WholesaleInput {
  const shopName = typeof body.shopName === 'string' ? body.shopName.trim() : ''
  if (!shopName) throw new HttpError(400, 'Shop name is required.')
  return {
    shopName,
    contactName: typeof body.contactName === 'string' ? body.contactName.trim() : '',
    phone:       typeof body.phone === 'string' ? body.phone.trim() : '',
  }
}

function creationError(err: unknown): HttpError {
  const code = (err as { code?: string })?.code ?? ''
  if (code === 'auth/email-already-exists') {
    return new HttpError(409, 'That email already has an account.')
  }
  if (code === 'auth/invalid-password') {
    return new HttpError(400, 'Password must be at least 6 characters.')
  }
  if (code === 'auth/invalid-email') {
    return new HttpError(400, 'That email address is not valid.')
  }
  return new HttpError(502, 'Could not create the account.')
}

// ---- Create ----
export async function POST(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireRole(request, ['admin'])
    const body = await readBody(request)

    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email) throw new HttpError(400, 'Invalid email address.')
    if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.')

    const input = parseInput(body)

    let uid: string
    try {
      const user = await adminAuth().createUser({ email, password, displayName: input.shopName })
      uid = user.uid
    } catch (err) {
      throw creationError(err)
    }

    // Auth user exists from here, so every failure below must delete it —
    // otherwise the email is taken by an account with no profile and the admin
    // can't simply retry.
    try {
      await adminDb().doc(`users/${uid}`).set({
        email,
        isWholesale:     true,
        wholesaleActive: true,
        shopName:        input.shopName,
        contactName:     input.contactName,
        phone:           input.phone,
        displayName:     input.shopName,
        // Explicitly NOT staff and holds no role, so no SECTION_ACCESS entry
        // can ever match and /admin/** stays closed to this account.
        isStaff:         false,
        createdAt:       new Date(),
        createdBy:       actor.uid,
      })
      await syncClaims(uid)
    } catch (err) {
      await adminAuth().deleteUser(uid).catch(() => {})
      throw err instanceof HttpError ? err : new HttpError(502, 'Could not save the account.')
    }

    await logCreate(actor, 'Wholesale Account', input.shopName, { email, ...input })

    return Response.json({ uid, email, ...input, wholesaleActive: true }, { status: 201 })
  } catch (err) {
    return toResponse(err)
  }
}

// ---- Update details, or activate/deactivate ----
export async function PATCH(request: Request): Promise<Response> {
  try {
    const actor: Caller = await requireRole(request, ['admin'])
    const body = await readBody(request)

    const uid = typeof body.uid === 'string' ? body.uid : ''
    if (!uid) throw new HttpError(400, 'uid is required.')

    const ref = adminDb().doc(`users/${uid}`)
    const snap = await ref.get()
    if (!snap.exists) throw new HttpError(404, 'Account not found.')
    const before = snap.data() ?? {}
    if (before.isWholesale !== true) throw new HttpError(400, 'That account is not a wholesale account.')

    const patch: Record<string, unknown> = {}
    if (typeof body.shopName === 'string' && body.shopName.trim()) {
      patch.shopName = body.shopName.trim()
      patch.displayName = body.shopName.trim()
    }
    if (typeof body.contactName === 'string') patch.contactName = body.contactName.trim()
    if (typeof body.phone === 'string') patch.phone = body.phone.trim()
    if (typeof body.wholesaleActive === 'boolean') patch.wholesaleActive = body.wholesaleActive

    if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to update.')

    await ref.update(patch)

    // Deactivating drops the `wholesale` claim, which is what actually closes
    // off pricing — revoke sessions too, so an open tab can't keep reading
    // prices for up to an hour on its existing ID token.
    const deactivating = patch.wholesaleActive === false
    await syncClaims(uid, { revokeSessions: deactivating })

    await logUpdate(
      actor,
      'Wholesale Account',
      (patch.shopName as string) ?? (before.shopName as string) ?? uid,
      before,
      patch,
    )

    return Response.json({ uid, ...patch })
  } catch (err) {
    return toResponse(err)
  }
}
