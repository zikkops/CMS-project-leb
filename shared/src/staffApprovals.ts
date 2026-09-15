// A manager approving a staff member's sign-in — POS software, stage 5 (owner's
// decisions S6, S15–S17, 15 Sep 2026).
//
// For a phone with no fingerprint or face Android counts as strong, so its key
// cannot sign anyone in (S12):
//   1. The staff member opens the app, chooses their first name from the hub's
//      list (S15) and asks. The hub keeps a request for a few minutes and gives
//      the phone a secret to collect the answer with.
//   2. A manager sees the request in their own staff app and approves it with
//      their own fingerprint (S16): their phone signs a challenge that names
//      this request, so a manager's session left open on a counter approves
//      nobody.
//   3. The asking phone collects a hub session for the person approved, lasting
//      until 05:00 (S17). The session is made at collection, so no token is
//      ever stored waiting.
//
// Pure, so the app signs exactly what the hub checks. The hub's side is
// shared/src/server/hubApprovals.ts. Asserted by verify:hub-sync.

import type { Role } from './roles'

/** Hub-only collection: `hubApprovals/{id}`. */
export const APPROVALS = 'hubApprovals'

/** How long a request waits for a manager. */
export const APPROVAL_MS = 5 * 60_000

/** Who may approve somebody else's sign-in (S6). */
export const APPROVER_ROLES: readonly Role[] = ['manager', 'admin']

const B64URL_16 = /^[A-Za-z0-9_-]{22}$/
const B64URL_32 = /^[A-Za-z0-9_-]{43}$/

/** A request's id: 16 random bytes, base64url. */
export const isApprovalId = (raw: unknown): raw is string => typeof raw === 'string' && B64URL_16.test(raw)

/** The secret the asking phone collects its answer with: 32 random bytes, base64url. */
export const isApprovalSecret = (raw: unknown): raw is string => typeof raw === 'string' && B64URL_32.test(raw)

/**
 * What a manager's phone signs to approve one request. It names this hub's
 * certificate (as signing in does), the request, and the manager's own key, so
 * an approval cannot be replayed for another request or at another hub.
 */
export function approveMessage(hubFingerprintHex: string, approvalId: string, keyId: string, nonce: string): string {
  return `bigcms-hub-approve:v1\n${hubFingerprintHex}\n${approvalId}\n${keyId}\n${nonce}`
}

/**
 * Why this person may not approve this request, or null. A manager or admin,
 * approving somebody else: nobody approves their own sign-in.
 */
export function approvalProblem(approver: { uid: string; role: unknown }, requestedUid: string): string | null {
  if (!(APPROVER_ROLES as readonly unknown[]).includes(approver.role)) return 'Only a manager or an admin can approve a sign-in.'
  if (approver.uid === requestedUid) return 'Nobody approves their own sign-in. Ask another manager.'
  return null
}

export type ApprovalStatus = 'waiting' | 'approved' | 'denied' | 'collected'

/** Where a request stands for the phone that asked, judged at `now`. */
export function approvalState(data: Record<string, unknown>, expiresAtMs: number, now: number): ApprovalStatus | 'expired' {
  const status = data.status
  if (status === 'collected' || status === 'denied') return status
  if (!(expiresAtMs > now)) return 'expired'
  return status === 'approved' ? 'approved' : 'waiting'
}
