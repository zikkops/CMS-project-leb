# Admin Panel

## Auth

Staff sign in at `/admin/login` against the same Firebase Auth pool customers use, but staff identity lives in a completely separate Firestore collection, `adminUsers/{uid}` — see `app/lib/adminAuth.ts`.

**Bootstrapping the first admin is a manual, one-time step**: create one `adminUsers/{uid}` document by hand in the Firebase Console (Firestore → Data), using the uid from Authentication → Users after that person signs in once, with a `role: "admin"` field. There used to be a client-side self-elect-the-first-signer shortcut, but the Firestore rule that made it possible (`allow write: if request.auth != null`) turned out to let *any* signed-up user grant themselves admin, not just the first — see the comment on that rule in `firestore.rules`. Every sign-in with no matching `adminUsers` doc is now just treated as unprovisioned and bounced back to the login page.

**Route protection has two layers**, of very different strength:
1. `proxy.ts` at the project root — an optimistic check that a non-cryptographic `admin_session` cookie exists, before the page shell renders at all for a request with literally no Firebase session. This is not real verification (see [ARCHITECTURE.md](../ARCHITECTURE.md#no-admin-sdk)).
2. `useRequireRole()` inside the page itself — checks the actual role against `adminUsers`, reading live from Firestore.

Both of those are just UX/optimistic gates. The only place this is actually *enforced* is Firestore security rules (`firestore.rules`) — a signed-in, non-staff user calling the Firestore SDK directly, bypassing the UI entirely, is stopped there, not by either of the above.

## Roles

```ts
type Role = 'admin' | 'manager' | 'social' | 'gamer' | 'kitchen_crew' | 'barista'
```

The `dungeonmaster` role and the `isDungeonMaster` flag that went with it were both removed along with the D&D modules. `hasSectionAccess()` — called by both `useRequireRole()` and the dashboard's card-visibility filter, so they can never drift out of sync — now takes only the role, the allowed list, and the per-user grants/revocations.

| Role | Roughly scoped to |
|---|---|
| `admin` | Everything, plus the admin-only pages (Manage Users, Activity Log, Manage Customers) |
| `manager` | Everything except admin-only pages; branch-scoped for loyalty data |
| `social` | Events content + event loyalty logging |
| `gamer` | Games/shop content |
| `kitchen_crew` | Kitchen order department (weekly orders) |
| `barista` | Bar order department (weekly orders) |

`branchIds: string[]` on a manager account scopes what loyalty data / bookings they see — a manager with `branchIds: ['Zouk']` only sees pending transactions, redemptions, and event reservations for Zouk (admins always see everything, via the literal string `'all'` passed instead of an array).

## Section Access

`SECTION_ACCESS` (`app/lib/adminAuth.ts`) is the single map of "which roles can see this section," used both to gate pages (`useRequireRole(SECTION_ACCESS.xxx)`) and to filter which cards the dashboard shows. If you add a new admin page, add an entry here rather than inlining a role array at the call site — keeps the dashboard and the page's own gate from disagreeing about who has access.

## Route Map

```
/admin                          Dashboard — sectioned, color-coded cards with live pending-count badges
/admin/login

# Content management
/admin/games, /admin/games/import   (WooCommerce CSV bulk import)
/admin/menu
/admin/events

# Event bookings
/admin/events/reservations      Approval queue, branch-scoped

# Loyalty management
/admin/loyalty/events             Log event attendance
/admin/loyalty/approvals          Approve/reject submitted transactions
/admin/loyalty/redemption-items   Define what coins can buy
/admin/loyalty/redemptions        Confirm/reject redemption requests
/admin/loyalty/activity           Filtered activity log (loyalty-related sections only)
/admin/loyalty/customers          Admin-only: edit points, delete, password reset, annual reset date

# Administration (admin-only)
/admin/media        Shared media library
/admin/users        Staff account management
/admin/logs         Full activity log, every section
```

## Dashboard Badges

Cards on `/admin` that show a live red count badge (Event Reservations, Table Reservations, Loyalty Approvals, Redemption Requests) are wired to the same `usePendingXxx()` hooks the actual queue pages use — the badge count and the queue page are guaranteed to agree because they're the same query, not a separately-maintained counter.

## Audit Trail

Every create/update/delete from the admin panel is logged via `app/lib/activityLog.ts` (`logCreate`/`logUpdate`/`logDelete`/`logActivity`) into the `activityLog` collection. `logUpdate` does a field-by-field diff between a before/after object and only writes if something actually changed. Two pages read from this same collection:
- `/admin/logs` — everything, admin-only.
- `/admin/loyalty/activity` — client-side filtered down to a hardcoded list of loyalty-related `section` values. If you add a new admin feature whose logs should show up there, add its section name to the `LOYALTY_SECTIONS` array at the top of that file — it isn't automatic.
