'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { ALL_ROLES, SECTION_ACCESS, hasSectionAccess, type Role, type SectionKey } from './roles'
import { authedFetch, unwrap } from './apiClient'

// Role, ALL_ROLES, SECTION_ACCESS and hasSectionAccess moved to ./roles so the
// server layer can share one definition with the browser (a route handler
// importing them from here would drag React and the Firebase client SDK onto
// the server). Re-exported so every existing import site keeps working.
//
// SECTION_ACCESS must be re-exported as the same object, never spread — see
// the note in ./roles about useRequireRole's reference-equality lookup.
export { ALL_ROLES, SECTION_ACCESS, hasSectionAccess }
export type { Role, SectionKey }

export const ROLE_LABELS: Record<Role, string> = {
  admin:         'Admin',
  manager:       'Manager',
  social:        'Social Media',
  gamer:         'Gamer',
  kitchen_crew:  'Kitchen Crew',
  barista:       'Barista / Bartender',
}

export const ROLE_COLORS: Record<Role, string> = {
  admin:         'var(--purple)',
  manager:       'var(--navy)',
  social:        'var(--red)',
  gamer:         'var(--teal)',
  kitchen_crew:  '#E8965A',
  barista:       '#8B6914',
}

// Human-readable labels for every section key — used in Manage Users to let
// admins grant per-user access beyond what the user's role normally covers.
export const SECTION_LABELS: Record<string, string> = {
  games:             'Manage Games',
  menu:              'Manage Menu',
  events:            'Manage Events',
  loyalty:           'Loyalty Approvals & Catalog',
  loyaltyEvents:     'Event Attendance',
  branchTables:      'Table Map Editor',
  tableReservations: 'Table Reservations',
  gamePurchases:     'Record Game Sales',
  gameTransfers:     'Transfer Stock',
  weeklyOrders:      'Weekly Order Reports',
  endOfDay:          'End of Day Reports',
  supplies:              'Inventory Management',
  dailyInventory:        'Daily Inventory Count',
  dailyInventoryHistory: 'Daily Inventory History',
  deliveries:            'Goods Receiving',
  deliveriesReport:      'Receiving & Cost Reports',
}

// Reads either shape — the new `branchIds` array, or the older singular
// `branchId` from accounts created before multi-branch support existed —
// so existing managers keep their access without a manual data migration.
function normalizeBranchIds(data: { branchIds?: unknown; branchId?: unknown }): string[] {
  if (Array.isArray(data.branchIds)) return data.branchIds as string[]
  return data.branchId ? [data.branchId as string] : []
}

// Firebase Auth keeps its session in IndexedDB, not a cookie — proxy.ts (see
// project root) only ever sees HTTP requests, so it has no way to know a
// Firebase session exists unless the app also tells it via a cookie. This
// cookie is *not* cryptographic proof of anything — it's just "this browser
// has a Firebase session," so proxy.ts can redirect a fully-anonymous
// request away before the admin page's shell ever renders. The actual
// security boundary stays exactly where it already was: Firestore rules.
// A signed-in-but-unauthorized visitor still reaches the page; useRequireRole
// below is what bounces them from there.
const ADMIN_SESSION_COOKIE = 'admin_session'

// Exported — /admin/login calls setAdminSessionCookie() itself, right after
// a successful sign-in and before its redirect to /admin. That page never
// calls useAdminUser() (no reason to — it's the one page a signed-out visitor
// is supposed to reach), so without this, the cookie wouldn't exist yet at
// the exact moment proxy.ts needs it for that first post-login navigation.
export function setAdminSessionCookie() {
  document.cookie = `${ADMIN_SESSION_COOKIE}=1; path=/; max-age=2592000; SameSite=Lax`
}

export function clearAdminSessionCookie() {
  document.cookie = `${ADMIN_SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`
}

// A staff member's role, branches and superadmin flag now live in their
// Firebase ID token as custom claims, because Firestore rules can read a claim
// for free but pay a billed document read for anything else. That buys the
// granular rules the audit called for — and costs one thing: the token is a
// snapshot, refreshed at most hourly, so an access change made by an admin
// wouldn't otherwise reach this browser until the token happened to rotate.
//
// The server stamps `claimsUpdatedAt` on the document every time it writes
// claims (see app/lib/server/claims.ts). If that stamp is newer than the token
// in hand, the token is stale by definition — force a refresh and the new
// claims arrive in seconds instead of up to an hour.
async function refreshStaleClaims(u: User, data: Record<string, unknown> | null) {
  const stamp = data?.claimsUpdatedAt as { toMillis?: () => number } | undefined
  const claimsAt = typeof stamp?.toMillis === 'function' ? stamp.toMillis() : 0
  if (!claimsAt) return

  try {
    const result = await u.getIdTokenResult()
    const issuedAt = new Date(result.issuedAtTime).getTime()
    if (claimsAt > issuedAt) {
      await u.getIdToken(true)
    }
  } catch {
    // getIdToken(true) throws when the refresh token has been revoked — which
    // is exactly what a deliberate lock-out does. Swallow it here: the Firebase
    // SDK signs the user out on its own, onAuthStateChanged fires again with
    // null, and useRequireRole sends them to the login page. Rethrowing would
    // only strand the hook in a permanent loading state.
  }
}

export function useAdminUser() {
  const [user, setUser]             = useState<User | null>(null)
  const [role, setRole]             = useState<Role | null>(null)
  const [branchIds, setBranchIds]   = useState<string[]>([])
  const [orderDepts, setOrderDepts] = useState<string[]>([])
  const [sectionGrants, setSectionGrants] = useState<string[]>([])
  const [sectionRevocations, setSectionRevocations] = useState<string[]>([])
  const [superadmin, setSuperadmin] = useState(false)
  const [loading, setLoading]       = useState(true)
  const [provisioned, setProvisioned] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        clearAdminSessionCookie()
        setUser(null)
        setRole(null)
        setBranchIds([])
        setOrderDepts([])
        setSectionGrants([])
        setSectionRevocations([])
        setSuperadmin(false)
        setProvisioned(true)
        setLoading(false)
        return
      }
      setAdminSessionCookie()
      setUser(u)
      const snap = await getDoc(doc(db, 'users', u.uid))
      const data = snap.exists() ? snap.data() : null
      await refreshStaleClaims(u, data)
      if (data?.isStaff === true) {
        const roleVal = (data.role as Role) ?? null
        setRole(roleVal)
        setBranchIds(normalizeBranchIds(data))
        setSectionGrants(Array.isArray(data.sectionGrants) ? data.sectionGrants as string[] : [])
        setSectionRevocations(Array.isArray(data.sectionRevocations) ? data.sectionRevocations as string[] : [])
        setSuperadmin(data.superadmin === true)
        setProvisioned(true)
        // Admin/manager always have access to all three order departments.
        // Other roles only see the departments listed in their orderDepts field.
        setOrderDepts(
          (roleVal === 'admin' || roleVal === 'manager')
            ? ['Kitchen', 'Bar', 'Cleaning']
            : roleVal === 'kitchen_crew'
              ? ['Kitchen']
              : roleVal === 'barista'
                ? ['Bar']
                : (Array.isArray(data.orderDepts) ? data.orderDepts as string[] : [])
        )
      } else {
        // users/{uid} either doesn't exist or has no isStaff: true.
        // First-time admins must be provisioned by hand in Firebase Console:
        // create users/{uid} with isStaff: true, role: 'admin', superadmin: true,
        // pointsEarned: 0, points: 0. See ARCHITECTURE.md.
        setRole(null)
        setBranchIds([])
        setOrderDepts([])
        setSectionGrants([])
        setSectionRevocations([])
        setSuperadmin(false)
        setProvisioned(false)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  return { user, role, branchIds, orderDepts, sectionGrants, sectionRevocations, superadmin, loading, provisioned }
}

// Lightweight, read-only staff check for public/customer-facing components
// (e.g. swapping a CTA for staff) — unlike useAdminUser(), this never
// attempts to write anything (no self-elect-first-admin side effect), since
// it has to run safely on every page load for every anonymous visitor too.
export function useIsStaff(): boolean {
  const [isStaff, setIsStaff] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { setIsStaff(false); return }
      const snap = await getDoc(doc(db, 'users', u.uid))
      setIsStaff(snap.exists() && snap.data()?.isStaff === true)
    })
    return unsub
  }, [])

  return isStaff
}

// hasSectionAccess() now lives in ./roles (re-exported at the top of this
// file) so the server guard in app/lib/server/auth.ts evaluates access with
// the exact same predicate this hook does.

export function useRequireRole(allowed: Role[]) {
  const router = useRouter()
  const { user, role, branchIds, orderDepts, sectionGrants, sectionRevocations, superadmin, loading, provisioned } = useAdminUser()

  // Detect which section key this call is gating by reference equality —
  // all callers pass SECTION_ACCESS.xxx directly, so the array object is the same.
  const sectionKey = Object.entries(SECTION_ACCESS).find(([, v]) => v === allowed)?.[0]
  const hasAccess = hasSectionAccess(role, allowed, sectionGrants, sectionKey, sectionRevocations)

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/admin/login')
      return
    }
    if (!provisioned) {
      signOut(auth).then(() => router.replace('/admin/login'))
      return
    }
    if (!hasAccess) {
      router.replace('/admin')
    }
  }, [loading, user, hasAccess, provisioned, router])

  const checking = loading || !user || !provisioned || !hasAccess
  return { checking, role, branchIds, orderDepts, sectionGrants, sectionRevocations, superadmin, user }
}

// Staff accounts live in the same `users` collection as customers — they just
// have isStaff: true plus role/branchIds fields.
//
// Both functions below are now thin callers of /api/admin/accounts. What used
// to be here — a four-step REST sequence that minted the Auth user, wrote a
// throwaway adminInvitations doc so a rule had something to check, had the NEW
// user write their own profile with their own token (retried three times
// against a replication race), then cleaned the invitation up — is gone. It
// existed only because the browser had no privileged path to create a user,
// and it could strand an Auth account with no profile if it failed midway.
//
// Authorization, validation, audit logging and rollback all live in the route
// now. These functions just pass the caller's ID token and surface the error.

// Every call into the server layer carries the caller's Firebase ID token; the
// route verifies it with the Admin SDK and derives permissions from its claims.
// authedFetch and unwrap moved to ./apiClient — every route-handler
// migration under the Phase 00 rule needs them, and a second copy of ID-token
// handling per module is how that drifts.


export async function createAccount(
  email: string,
  password: string,
  role: Role,
  branchIds?: string[],
): Promise<string> {
  const res = await authedFetch('/api/admin/accounts', 'POST', {
    email, password, role, branchIds: branchIds ?? [],
  })
  const data = await unwrap(res)
  return data.uid as string
}

// Lets an admin change an existing account's role/branches without
// recreating it — recreating would mint a new Firebase Auth UID and break
// that person's login entirely.
//
// `_before` is no longer read here: the route diffs against the CURRENT
// document for the activity log, which is authoritative in a way a browser's
// copy of it is not (two admins on the page at once used to produce a diff
// against whichever stale copy happened to submit). It stays in the signature
// so no caller has to change.
export async function updateAccountAccess(
  uid: string,
  email: string,
  _before: { role: Role; branchIds: string[] },
  after: { role: Role; branchIds: string[] },
): Promise<void> {
  const res = await authedFetch('/api/admin/accounts', 'PATCH', {
    uid,
    // Only a label fallback for the audit entry if the document has no email.
    email,
    role: after.role,
    branchIds: after.branchIds,
  })
  await unwrap(res)
}

// Removes a person's staff standing while leaving their customer identity —
// points, bookings, history — completely intact. Their login still works.
//
// This used to be a client `updateDoc` deleting isStaff/role/branchIds. It had
// to move: with custom claims in play, clearing the document alone leaves the
// revoked account's token asserting `staff: true` forever, because claims only
// change when something calls setCustomUserClaims. Document and claims have to
// be cleared together, which means server-side.
export async function revokeAccountAccess(uid: string): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('Session expired — please sign in again.')
  const token = await user.getIdToken()

  const res = await fetch(`/api/admin/accounts?uid=${encodeURIComponent(uid)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  await unwrap(res)
}
