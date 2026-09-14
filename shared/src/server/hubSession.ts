// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Signing in at the café hub, until phone sign-in (stage 5). How long a
// session lasts, and why, is shared/src/hubSession.ts.
//
// - The Firebase sign-in is checked ONCE, when the session starts, against
//   Google's public keys (hubTokenVerifier): no Admin key on the PC. That step
//   needs the internet; nothing after it does.
// - Only a staff token with a role starts a session. The hub holds no staff
//   records yet (stage 4 syncs them), so the token's claims are what it has —
//   the same claims every cloud route already trusts first.
// - A session is stored under a hash of its token, so a copy of the hub's
//   database is not a handful of live sessions.
// - The honest limit: a role changed or an account locked during the night
//   reaches a hub session when it ends, not at once. Stage 4's sync can end
//   sessions early.

import { createHash, randomBytes } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb, hubTokenVerifier } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { isRole } from '../roles'
import { BRAND } from '../brand'
import { hubSessionExpiry } from '../hubSession'
import { timestampMs } from '../timestamps'

const SESSIONS = 'hubSessions'
const PREFIX = 'hub.'

/** What a verified Firebase token says about somebody. */
export interface HubSessionClaims {
  uid: string
  email?: unknown
  staff?: unknown
  role?: unknown
  branchIds?: unknown
  superadmin?: unknown
}

export interface HubCaller extends Caller {
  expiresAt: number
}

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')

const branchList = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((b): b is string => typeof b === 'string') : []

/** Whether a bearer token is shaped like a hub session, as opposed to a Firebase token. */
export function isHubToken(token: string): boolean {
  return token.startsWith(PREFIX) && token.length > PREFIX.length + 20
}

/** Starts a session for claims that have already been verified. */
export async function startHubSession(
  claims: HubSessionClaims,
  now = Date.now(),
): Promise<{ token: string; caller: HubCaller }> {
  if (claims.staff !== true || !isRole(claims.role)) {
    throw new HttpError(403, 'Only staff accounts can sign in to the till.')
  }
  const expiresAt = hubSessionExpiry(now, BRAND.locale.timezone)
  const caller: HubCaller = {
    uid: claims.uid,
    email: typeof claims.email === 'string' ? claims.email : null,
    role: claims.role,
    branchIds: branchList(claims.branchIds),
    superadmin: claims.superadmin === true,
    isStaff: true,
    expiresAt,
  }
  const token = PREFIX + randomBytes(32).toString('base64url')
  await adminDb().doc(`${SESSIONS}/${hashOf(token)}`).create({
    uid: caller.uid,
    email: caller.email,
    role: caller.role,
    branchIds: caller.branchIds,
    superadmin: caller.superadmin,
    startedAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(expiresAt),
    endedAt: null,
  })
  return { token, caller }
}

/** Checks a Firebase sign-in and starts a hub session for it. */
export async function signInAtHub(idToken: string): Promise<{ token: string; caller: HubCaller }> {
  if (!idToken) throw new HttpError(401, 'Not signed in.')
  let claims: HubSessionClaims
  try {
    claims = await hubTokenVerifier().verifyIdToken(idToken)
  } catch {
    // One answer for a bad token and for no internet: either way the person
    // signs in again, and the sentence tells them what the hub needs.
    throw new HttpError(401, 'That sign-in could not be checked. Sign in again — the hub needs the internet to check it.')
  }
  return startHubSession(claims)
}

/** Who a hub session belongs to, or null when there is none, it ended, or it has run out. */
export async function callerFromHubToken(token: string, now = Date.now()): Promise<HubCaller | null> {
  if (!isHubToken(token)) return null
  const snap = await adminDb().doc(`${SESSIONS}/${hashOf(token)}`).get()
  const d = snap.data()
  if (!d || d.endedAt) return null
  const expiresAt = timestampMs(d.expiresAt, 0)
  if (!(expiresAt > now)) return null
  if (typeof d.uid !== 'string' || !isRole(d.role)) return null
  return {
    uid: d.uid,
    email: typeof d.email === 'string' ? d.email : null,
    role: d.role,
    branchIds: branchList(d.branchIds),
    superadmin: d.superadmin === true,
    isStaff: true,
    expiresAt,
  }
}

/** Signs a session out. False when there was nothing live to end. */
export async function endHubSession(token: string): Promise<boolean> {
  if (!isHubToken(token)) return false
  const db = adminDb()
  const ref = db.doc(`${SESSIONS}/${hashOf(token)}`)
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data()?.endedAt) return false
    tx.update(ref, { endedAt: FieldValue.serverTimestamp() })
    return true
  })
}
