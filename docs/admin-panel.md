# Admin Panel

## Auth

Staff sign in at `/admin/login` against the same Firebase Auth pool customers use, but staff identity lives in a completely separate Firestore collection, `adminUsers/{uid}` — see `shared/src/adminAuth.ts`.

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
| `retail` | Shop/product content, purchases and transfers (was `gamer`) |
| `kitchen_crew` | Kitchen order department (weekly orders), kitchen side of the POS |
| `barista` | Bar order department (weekly orders), bar side of the POS |

`branchIds: string[]` on a manager account scopes what loyalty data / bookings they see — a manager with `branchIds: ['Zouk']` only sees pending transactions, redemptions, and event reservations for Zouk (admins always see everything, via the literal string `'all'` passed instead of an array).

## Section Access

`SECTION_ACCESS` lives in `shared/src/roles.ts` and is re-exported from `adminAuth.ts`. It is the single map of "which roles can see this section," used to gate pages (`useRequireRole(SECTION_ACCESS.xxx)`), to filter which cards the dashboard shows, and — mirrored, not imported — by `can()` in `firestore.rules`. If you add a new admin page, add an entry here rather than inlining a role array at the call site: that is what keeps the dashboard, the page's own gate and the rule from disagreeing.

**Re-export the object itself, never a copy.** `useRequireRole()` finds the section key by reference equality, so a spread breaks every gate silently.

**Adding a key has a side effect.** `/admin/users` renders one grant checkbox per `Object.keys(SECTION_ACCESS)` entry, so a new key immediately becomes a per-user grantable permission in that UI. Account management is deliberately a role check rather than a section, for exactly this reason.

## Route Map

The admin panel is its own app now — it deploys separately and answers on its
own hostname. Everything below is on the admin app.

```
/admin                          Dashboard — sectioned, color-coded cards with live pending-count badges
/admin/login

# Content management
/admin/products                 Shop catalogue (was /admin/games)
/admin/products/import          WooCommerce CSV bulk import
/admin/products/purchase        Purchase orders for stock
/admin/products/invoices        Received purchase invoices
/admin/products/transfer        Stock transfers between branches
/admin/menu                     Menu categories and items
/admin/menu/modifiers           Modifier groups — the option sets a POS line carries
/admin/events

# Bookings
/admin/events/reservations      Approval queue, branch-scoped
/admin/tables/reservations      Table booking queue
/admin/branches/tables          Floor plans — the tables the POS shows

# Loyalty management
/admin/loyalty/events             Log event attendance
/admin/loyalty/approvals          Approve/reject submitted transactions
/admin/loyalty/redemption-items   Define what points can buy
/admin/loyalty/redemptions        Confirm/reject redemption requests
/admin/loyalty/perks              Tier perks
/admin/loyalty/activity           Filtered activity log (loyalty-related sections only)
/admin/loyalty/customers          Admin-only: edit points, delete, password reset, annual reset date

# Stock and ordering
/admin/supplies                   What a branch consumes
/admin/supplies/receiving         Receive against a submitted order
/admin/supplies/daily             Daily inventory count (+ /history, /history/[date])
/admin/weekly-orders              The standing order (+ /template, /providers, /submit, /log, /access)

# The day
/admin/schedule                   Staff rota
/admin/end-of-day                 Close (+ /staff, /tips, /summary, /log, /history)

# Wholesale
/admin/wholesale/accounts         Shops that buy from us
/admin/wholesale/orders

# Administration (admin-only)
/admin/media        Shared media library
/admin/users        Staff account management
/admin/settings     Business settings (+ /settings/features — the feature-flag registry)
/admin/logs         Full activity log, every section
```

## The POS app

Separate deployable, separate hostname, its own short route map. It is listed
here because its gates come from the same `SECTION_ACCESS` map.

```
/pos                The floor — active tables only, as squares
/pos/check/[id]     One check: build it, send it, void a line, close it
/pos/closed         Past receipts, with timestamps, and refunds
/pos/kds            The kitchen/bar screen — tickets, not checks
/pos/login
```

`pos` and `kds` are feature flags as well as sections. `kds` `requires` `pos`
in the registry, so a café can buy the till without the kitchen screen but not
the other way round. Both default to off.

## Dashboard Badges

Cards on `/admin` that show a live red count badge (Event Reservations, Table Reservations, Loyalty Approvals, Redemption Requests) are wired to the same `usePendingXxx()` hooks the actual queue pages use — the badge count and the queue page are guaranteed to agree because they're the same query, not a separately-maintained counter.

## Audit Trail

Every create/update/delete from the admin panel is logged via `shared/src/server/activityLog.ts` — the **server** logger. The client one in `shared/src/activityLog.ts` reads `auth.currentUser`, which does not exist in a route handler, so a mutation that moves to a route and keeps the client logger silently disappears from `/admin/logs`. It is logged (`logCreate`/`logUpdate`/`logDelete`/`logActivity`) into the `activityLog` collection. `logUpdate` does a field-by-field diff between a before/after object and only writes if something actually changed. Two pages read from this same collection:
- `/admin/logs` — everything, admin-only.
- `/admin/loyalty/activity` — client-side filtered down to a hardcoded list of loyalty-related `section` values. If you add a new admin feature whose logs should show up there, add its section name to the `LOYALTY_SECTIONS` array at the top of that file — it isn't automatic.
