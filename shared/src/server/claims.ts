// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The one place that decides what a staff member's Firebase custom claims say.
// Everything that changes a `users/{uid}` doc's role, branches, DM flag, staff
// flag or superadmin flag must call syncClaims(uid) afterwards, or the token
// and the document drift apart — and once Firestore rules read the token,
// drift means someone silently keeps access they no longer have.
//
// WHY CLAIMS AT ALL
// Firestore rules can read request.auth.token.<claim> for free. Reading the
// same fact out of a document instead costs a billed get() per rule
// evaluation, which is what forced today's blanket isStaff() helper: a rule
// granular enough to check a *role* would have meant a get() on nearly every
// write in the app. Claims make `request.auth.token.role == 'manager'` cost
// nothing, which is what makes the P0 rules rewrite affordable.

import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from './firebaseAdmin'
import { isRole, type Role } from '../roles'

// Firebase caps the custom-claims payload at 1000 bytes, so this stays
// deliberately small: identity and coarse authorization only.
//
// Note what is NOT here: sectionGrants / sectionRevocations. Those are
// per-user lists that can grow, they're a UI-shaped concern, and putting an
// unbounded array in a hard-capped token is how you get an account that
// silently fails to save. Rules gate on `role`; the finer per-user grants stay
// in the document and are read server-side (free, via the Admin SDK) or
// client-side for what the UI shows.
export interface StaffClaims {
  staff: true
  role: Role
  branchIds: string[]
  superadmin: boolean
}

// Wholesale accounts (shops buying from us) are not staff and hold no role, so
// they get their own tiny claim. Rules read request.auth.token.wholesale to
// decide who may see wholesale pricing — free, where a get() on the user doc
// would be billed on every read of every price.
export interface WholesaleClaims {
  wholesale: true
}

// A cleared claim set. setCustomUserClaims(uid, null) wipes claims entirely,
// which is what a customer — or a demoted staff member — should have.
export type ClaimSet = StaffClaims | WholesaleClaims | null

interface UserDocShape {
  isStaff?: unknown
  role?: unknown
  branchIds?: unknown
  branchId?: unknown
  superadmin?: unknown
  isWholesale?: unknown
  wholesaleActive?: unknown
}

// Mirrors normalizeBranchIds() in shared/src/adminAuth.ts — accounts created
// before multi-branch support have a singular `branchId` string instead of a
// `branchIds` array, and must not silently lose their branch here.
function normalizeBranchIds(data: UserDocShape): string[] {
  if (Array.isArray(data.branchIds)) {
    return data.branchIds.filter((b): b is string => typeof b === 'string')
  }
  return typeof data.branchId === 'string' && data.branchId ? [data.branchId] : []
}

// Pure: document in, claim set out. Exported so the backfill script can dry-run
// the whole staff list and print what it *would* write before writing anything.
export function claimsFromUserDoc(data: UserDocShape | undefined): ClaimSet {
  if (!data) return null

  // Staff is checked first: an account should never be both, but if a doc ever
  // carries both flags, staff is the more privileged reading and wins rather
  // than silently downgrading someone to a wholesale buyer.
  if (data.isStaff !== true) {
    // A deactivated wholesale account keeps its doc but loses the claim, so it
    // stops seeing prices without anyone having to delete the login.
    if (data.isWholesale === true && data.wholesaleActive !== false) {
      return { wholesale: true }
    }
    return null
  }
  if (!isRole(data.role)) return null

  return {
    staff: true,
    role: data.role,
    branchIds: normalizeBranchIds(data),
    superadmin: data.superadmin === true,
  }
}

export interface SyncOptions {
  // Revoke the user's existing refresh tokens, forcing them to sign in again.
  //
  // Defaults to FALSE, which is the right call more often than it looks.
  // Claims do not need a revocation to propagate: exchanging a refresh token
  // always mints an ID token carrying the *current* claims, and the
  // claimsUpdatedAt stamp below makes the browser do that exchange on its next
  // load rather than waiting out the hour. So a routine role change reaches
  // the user in seconds without logging them out mid-shift.
  //
  // Pass true when access is being REDUCED and you want the old session dead
  // now — staff status removed, superadmin revoked, an account suspected
  // compromised.
  //
  // HONEST LIMITATION either way: revoking does NOT invalidate an ID token
  // that was already issued, and Firestore rules do not check revocation. An
  // ID token lives up to an hour, so a tab left open can keep writing under
  // its old claims for that long. This window is inherent to claims-based
  // rules. Where it isn't acceptable, put the operation behind a route handler
  // — the Admin SDK verifies with checkRevoked: true there, which rules can't.
  revokeSessions?: boolean
}

// Reads the user doc, derives the claims, writes them to the Auth user, and
// stamps `claimsUpdatedAt` back onto the doc. That stamp is what lets a signed
// -in browser notice its token is stale and force a refresh (see
// useAdminUser() in shared/src/adminAuth.ts) rather than waiting out the hour.
export async function syncClaims(uid: string, options: SyncOptions = {}): Promise<ClaimSet> {
  const { revokeSessions = false } = options

  const snap = await adminDb().doc(`users/${uid}`).get()
  const claims = claimsFromUserDoc(snap.data() as UserDocShape | undefined)

  await adminAuth().setCustomUserClaims(uid, claims)

  if (revokeSessions) {
    await adminAuth().revokeRefreshTokens(uid)
  }

  // Only stamp a doc that exists — syncClaims is safe to call for a uid whose
  // Firestore doc was deleted (clearing claims is exactly what should happen),
  // and set(..., {merge:true}) on a deleted doc would resurrect it as a stub.
  if (snap.exists) {
    await snap.ref.update({ claimsUpdatedAt: FieldValue.serverTimestamp() })
  }

  return claims
}
