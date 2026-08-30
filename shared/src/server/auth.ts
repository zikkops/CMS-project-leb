// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Authorization for route handlers, backed by the Admin SDK.
//
// This supersedes shared/src/serverAuth.ts for every NEW route. serverAuth.ts
// still exists and still works — it verifies a token over the Identity Toolkit
// REST API and does authorization reads over the Firestore REST API *as the
// calling user*, which was the only way to check anything server-side without
// a service account. It stays in place for the two image routes that already
// use it; don't extend it. New routes use this file.
//
// The difference that matters: serverAuth.ts could only ever confirm facts the
// caller could already read for themselves. This module reads and writes with
// full privilege, so a route can enforce a decision the browser is not trusted
// to make — which is the entire point of Phase 00.

import { adminAuth, adminDb } from './firebaseAdmin'
import {
  SECTION_ACCESS,
  hasSectionAccess,
  isRole,
  type Role,
  type SectionKey,
} from '../roles'

export interface Caller {
  uid: string
  email: string | null
  role: Role | null
  branchIds: string[]
  superadmin: boolean
  isStaff: boolean
}

// Thrown by the require* guards; turn it into a Response with toResponse().
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

// Converts a thrown error into a JSON Response. Only an HttpError's message is
// ever sent to the client — anything else is logged and returned as a generic
// 500, so an Admin SDK stack trace or a credential-shaped error string can't
// leak out through an API response.
export function toResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status })
  }
  console.error('[api] unhandled error:', err)
  return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
}

// TRANSITIONAL. Accounts that existed before the claims backfill ran have no
// custom claims on their token yet, so authorization falls back to one
// privileged read of users/{uid}. Once scripts/backfill-claims.mjs has run
// against production AND every staff member's token has rotated (max one
// hour), this fallback can be deleted — but leaving it costs one document read
// only for tokens that predate claims, which is zero in steady state.
async function callerFromDoc(uid: string, email: string | null): Promise<Caller> {
  const snap = await adminDb().doc(`users/${uid}`).get()
  const data = snap.data() ?? {}

  const branchIds = Array.isArray(data.branchIds)
    ? (data.branchIds as unknown[]).filter((b): b is string => typeof b === 'string')
    : typeof data.branchId === 'string' && data.branchId
      ? [data.branchId]
      : []

  return {
    uid,
    email,
    role: isRole(data.role) ? data.role : null,
    branchIds,
    superadmin: data.superadmin === true,
    isStaff: data.isStaff === true,
  }
}

// Verifies the Authorization: Bearer <idToken> header and returns who's
// calling. Returns null when there's no token or the token is invalid — the
// require* helpers below turn that into a 401.
//
// checkRevoked: true costs an extra lookup per call, and is deliberate here.
// These are admin routes; the point of revoking a demoted staff member's
// sessions is that the very next privileged request they make fails.
export async function getCaller(request: Request): Promise<Caller | null> {
  const token = bearerToken(request)
  if (!token) return null

  let decoded
  try {
    decoded = await adminAuth().verifyIdToken(token, true)
  } catch {
    return null
  }

  const email = typeof decoded.email === 'string' ? decoded.email : null

  // The happy path: authorization comes straight off the token, no reads.
  if (decoded.staff === true && isRole(decoded.role)) {
    return {
      uid: decoded.uid,
      email,
      role: decoded.role,
      branchIds: Array.isArray(decoded.branchIds)
        ? (decoded.branchIds as unknown[]).filter((b): b is string => typeof b === 'string')
        : [],
      superadmin: decoded.superadmin === true,
      isStaff: true,
    }
  }

  return callerFromDoc(decoded.uid, email)
}

export async function requireCaller(request: Request): Promise<Caller> {
  const caller = await getCaller(request)
  if (!caller) throw new HttpError(401, 'Not signed in.')
  return caller
}

export async function requireStaff(request: Request): Promise<Caller> {
  const caller = await requireCaller(request)
  if (!caller.isStaff) throw new HttpError(403, 'Staff access required.')
  return caller
}

export async function requireRole(request: Request, allowed: Role[]): Promise<Caller> {
  const caller = await requireStaff(request)
  if (!caller.role || !allowed.includes(caller.role)) {
    throw new HttpError(403, 'You do not have permission to do that.')
  }
  return caller
}

export async function requireSuperadmin(request: Request): Promise<Caller> {
  const caller = await requireStaff(request)
  if (!caller.superadmin) throw new HttpError(403, 'Superadmin access required.')
  return caller
}

// The server-side twin of useRequireRole(). Same predicate, same section keys,
// so a route and the page that calls it can never disagree about who's allowed.
//
// Per-user sectionGrants/sectionRevocations are deliberately NOT in the token
// (see claims.ts for why), so this costs one document read per call — every
// call, not just the deny path, because an explicit revocation has to beat the
// caller's role and we can't know one isn't present without looking. That's
// the price of keeping an unbounded list out of a 1000-byte token. Use
// requireRole() instead on a hot path where per-user grants don't apply.
export async function requireSection(request: Request, section: SectionKey): Promise<Caller> {
  const caller = await requireStaff(request)
  const allowed = SECTION_ACCESS[section]

  const snap = await adminDb().doc(`users/${caller.uid}`).get()
  const data = snap.data() ?? {}
  const grants = Array.isArray(data.sectionGrants) ? (data.sectionGrants as string[]) : []
  const revocations = Array.isArray(data.sectionRevocations) ? (data.sectionRevocations as string[]) : []

  const ok = hasSectionAccess(
    caller.role,
    allowed,
    grants,
    section,
    revocations,
  )
  if (!ok) throw new HttpError(403, 'You do not have permission to do that.')
  return caller
}
