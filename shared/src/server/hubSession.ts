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
// - Revocation cannot be checked without the key. So once the hub is paired,
//   the staff records it pulls every two minutes overrule the token (stage 4,
//   callerFromHubToken below): an account locked in the cloud is refused at the
//   next pull. A hub that has never pulled has only the token's claims, which
//   stand until the session ends.

import { createHash, randomBytes } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb, hubTokenVerifier } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { isRole } from '../roles'
import { BRAND } from '../brand'
import { hubSessionExpiry } from '../hubSession'
import { timestampMs } from '../timestamps'
import { TOUCH_EVERY_MS, idleOver } from '../counterSignIn'

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
  /** 'kds' for a kitchen screen's session (S19): the kitchen display and nothing else. */
  scope?: unknown
  /** For a counter PC sign-in (S25): the session ends after this long without a tap. */
  idleMs?: unknown
}

export interface HubCaller extends Caller {
  expiresAt: number
  scope: HubScope | null
  /** Ends after this long without a tap (S25), or null for a session that lasts until 05:00. */
  idleMs: number | null
}

/** The only scope so far: a kitchen screen (S19). */
export type HubScope = 'kds'

const readScope = (raw: unknown): HubScope | null => (raw === 'kds' ? 'kds' : null)

/** An idle limit between a minute and twelve hours, or none. */
const readIdle = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= 60_000 && raw <= 12 * 3600_000 ? raw : null

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
    scope: readScope(claims.scope),
    idleMs: readIdle(claims.idleMs),
  }
  const token = PREFIX + randomBytes(32).toString('base64url')
  await adminDb().doc(`${SESSIONS}/${hashOf(token)}`).create({
    uid: caller.uid,
    email: caller.email,
    role: caller.role,
    branchIds: caller.branchIds,
    superadmin: caller.superadmin,
    scope: caller.scope,
    idleMs: caller.idleMs,
    lastActiveAt: Timestamp.fromMillis(now),
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
  // A counter sign-in ends after its idle limit without a tap (S25), whatever
  // the page does: the till's own sign-out is a courtesy, this is the rule.
  const idleMs = readIdle(d.idleMs)
  if (idleMs !== null && idleOver(timestampMs(d.lastActiveAt, 0), idleMs, now)) return null

  // The staff record pulled from the cloud (stage 4) overrules what the token
  // said at sign-in: an account locked, or a role changed, in the cloud reaches
  // this session at the hub's next pull rather than at 05:00. Before the first
  // pull there is no record, and the token's claims stand.
  const staff = (await adminDb().doc(`users/${d.uid}`).get()).data()
  if (staff && (staff.isStaff !== true || !isRole(staff.role))) return null
  return {
    uid: d.uid,
    email: typeof d.email === 'string' ? d.email : null,
    role: staff ? staff.role : d.role,
    branchIds: staff
      ? branchList(Array.isArray(staff.branchIds) ? staff.branchIds : typeof staff.branchId === 'string' ? [staff.branchId] : [])
      : branchList(d.branchIds),
    superadmin: staff ? staff.superadmin === true : d.superadmin === true,
    isStaff: true,
    expiresAt,
    scope: readScope(d.scope),
    idleMs,
  }
}

/**
 * The till saw a tap (S25): a session with an idle limit starts its count again.
 * Written at most every TOUCH_EVERY_MS, so a busy counter is not a write per tap.
 * False when there is no live session to touch; a session without an idle limit
 * has nothing to count and is left alone.
 */
export async function touchHubSession(token: string, now = Date.now()): Promise<boolean> {
  if (!isHubToken(token)) return false
  const ref = adminDb().doc(`${SESSIONS}/${hashOf(token)}`)
  const d = (await ref.get()).data()
  if (!d || d.endedAt || !(timestampMs(d.expiresAt, 0) > now)) return false
  const idleMs = readIdle(d.idleMs)
  if (idleMs === null) return true
  const last = timestampMs(d.lastActiveAt, 0)
  if (idleOver(last, idleMs, now)) return false
  if (now - last >= TOUCH_EVERY_MS) await ref.update({ lastActiveAt: Timestamp.fromMillis(now) })
  return true
}

/**
 * How many sessions are live on this hub: not ended, not run out, not idle past
 * their limit. The Windows app installs an update only when this is 0 (S27).
 */
export async function liveHubSessions(now = Date.now()): Promise<number> {
  const snap = await adminDb().collection(SESSIONS).where('endedAt', '==', null).get()
  return snap.docs.filter(doc => {
    const d = doc.data() ?? {}
    if (!(timestampMs(d.expiresAt, 0) > now)) return false
    const idleMs = readIdle(d.idleMs)
    return idleMs === null || !idleOver(timestampMs(d.lastActiveAt, 0), idleMs, now)
  }).length
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
