# Architecture

## Security Headers

`next.config.ts`'s `headers()` sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` denying camera/mic/geolocation, on every route. These are all response headers with effectively zero risk of breaking anything — they don't restrict what the page itself can load.

**There *is* a `Content-Security-Policy`,** built in `proxy.ts` (`buildCsp()`) and
set on every non-API response. It was added after this file first claimed there
wasn't one — if you're reading an older copy of this paragraph elsewhere, trust
`proxy.ts`.

Its allowlist is the actual list of origins this app talks to, and the entries
are load-bearing:

- `connect-src` covers Firebase Auth REST, Firestore (including the WebSocket),
  token refresh, and `api.mymemory.translated.net` for `translateToArabic()` in
  `weeklyOrders.ts`. Same-origin `fetch` to `/api/**` is covered by `'self'`.
- `img-src` covers `i.ibb.co` (user uploads) and `api.dicebear.com` (legacy
  avatars). It does **not** cover `images.unsplash.com`, which is why the menu
  hero image silently never renders — see the feature audit.
- `script-src` uses `'unsafe-inline'`, deliberately: the App Router emits inline
  RSC data blocks with no nonce unless the root layout is wired to read
  `x-nonce` from `headers()`. The real auth boundary is Firebase, not the CSP.

A CSP violation is a runtime browser policy, not a compile-time concern —
neither type-checking nor a successful build will catch one. If you add an
external origin, add it here and then actually exercise sign-in, image upload
and avatar loading in a browser.

## The Server Layer

**This section used to say "No Admin SDK." That is no longer true**, and the
change is the single most important thing to understand before touching this
codebase.

For most of this project's life every Firestore read/write and every Auth
operation — including everything staff do in the admin panel — ran through the
Firebase **client SDK**, from the browser, using the same public API key a
customer's browser uses. That was a deliberate choice (no backend to host,
deploy, or pay for) and it was the right one for a marketing site with an admin
panel bolted on.

It stopped being the right one the moment the roadmap included a POS. A browser
cannot issue a gap-free receipt number without two terminals racing, and cannot
be trusted to compute a bill total. Today the blast radius of a tampered client
is loyalty XP; with a POS it is cash.

### What exists now

`app/lib/server/**` — Next.js route handlers running the Firebase **Admin SDK**
on the same Vercel deployment. No new infrastructure, no Cloud Functions.

| File | Covers |
|---|---|
| `server/firebaseAdmin.ts` | Lazy, memoized Admin SDK init from one base64 env var |
| `server/auth.ts` | `getCaller()` / `requireStaff()` / `requireRole()` / `requireSection()` — token verification and authorization for route handlers |
| `server/claims.ts` | The one place that derives and writes custom claims from a `users/{uid}` document |
| `server/activityLog.ts` | Server-side twin of `app/lib/activityLog.ts`, same collection and shape |

**The import rule:** these modules read a service-account private key. They may
be imported from `app/api/**` and `scripts/**`, and nowhere else — never from a
file carrying `'use client'`, never from a module a client component imports.
`firebase-admin` is in `serverExternalPackages` (`next.config.ts`), which both
keeps it out of the bundler's hands and makes an accidental client import fail
the build instead of shipping quietly.

Setup, backfill and verification steps are in [docs/server-setup.md](./docs/server-setup.md).

### Custom claims

A staff member's `role`, `branchIds`, `superadmin` and `dm` flags are mirrored
into their Firebase ID token as custom claims.

The reason is cost, and it's what unblocks the security fix. Firestore rules
read `request.auth.token.<claim>` for free, but pay a billed document read for
anything they have to `get()`. That is why rules today gate on a blanket
`isStaff()` helper: a rule granular enough to check a *role* would have meant a
document read on nearly every write in the app. With claims,
`request.auth.token.role == 'manager'` costs nothing — which is what makes
rewriting the rules affordable.

Deliberately **not** in the claims: `sectionGrants` / `sectionRevocations`.
Claims are capped at 1000 bytes; an unbounded per-user array in a hard-capped
token is how you get an account that silently fails to save. Rules gate on
`role`; the finer per-user grants stay in the document, read server-side via
the Admin SDK (`requireSection()`) or client-side for what the UI shows.

**The refresh window, stated plainly.** An ID token lives up to an hour and
carries a snapshot of the claims at issue time. Rules read that snapshot and do
not check revocation — so an access change can take up to an hour to be
enforced in rules for a tab left open. Mitigations: `syncClaims()` stamps
`claimsUpdatedAt` on the document and `useAdminUser()` force-refreshes when the
token is older than that stamp (so in practice it lands on the next page load);
`syncClaims(uid, { revokeSessions: true })` kills sessions outright for a
deliberate lock-out. Where an immediate boundary is genuinely required, put the
operation behind a route handler — `getCaller()` verifies with
`checkRevoked: true`, which rules cannot do.

### What is still client-side, and what's left

Reads are still live `onSnapshot` listeners from the browser, and should stay
that way — that is the part of Firestore worth keeping. What must change is
writes. **The rule from here: no new client SDK writes.** Move each privileged
mutation behind a route handler as you touch it.

Still outstanding:

- **Firestore rules still gate on the broad `isStaff()` helper.** Claims exist
  now, but the rules haven't been rewritten to read them. This is the largest
  hole in the platform: any staff account, whatever its role, can write to any
  staff-gated collection via a direct SDK call. Rewrite collection by
  collection — a rules deploy has no gradual rollout.
- **No cron job.** Anything that needs to happen on a date is still checked
  passively on the next relevant page load — see `checkAndRunLoyaltyReset()` in
  `app/lib/customerManagement.ts`. Vercel Cron plus a route handler replaces
  this; it just hasn't been built.
- **`deleteCustomerAccount()` still doesn't delete the Auth login.** Now
  possible via `adminAuth().deleteUser()`; not yet done. Until it is, a deleted
  customer who signs in again gets a brand-new blank profile.
- **Race-safety is still `runTransaction`/`writeBatch` against Firestore**, not
  server-side locking. The table booking system (below) is the clearest example,
  and it's a good design — leave it.

### The older `serverAuth.ts` pattern

`app/lib/serverAuth.ts` predates the Admin SDK and still backs the two image
routes (`app/api/import-image`, `app/api/media/delete`). It verifies an ID
token over the Identity Toolkit REST API, and does authorization reads over the
Firestore REST API **passing the caller's own idToken as the Bearer auth** — so
the read is bound by exactly the same rules a browser-side `getDoc` from their
session would be. It grants no access the caller doesn't already have.

That property is its limit as well as its virtue: it can only ever confirm
facts the caller could already read for themselves, never enforce a decision
the browser isn't trusted to make. Leave it where it is; don't extend it. New
routes use `app/lib/server/auth.ts`.

One mistake it exists to prevent, still worth knowing: don't call the Firestore
*client* SDK's `getDoc`/`getDocs` bare inside a route handler to check a role.
There's no signed-in session on the server, so it runs as a fully
unauthenticated read — it either fails against real rules, or worse, pressures
you into loosening a rule to anonymous-readable just to make the check possible.

## Two Identities, One `users` Collection

**Correction to an earlier version of this file, which claimed staff live in an
`adminUsers/{uid}` collection. They do not, and no such collection exists.**
Staff and customers share the single `users/{uid}` collection; a staff account
is one with `isStaff: true` plus role fields alongside the loyalty fields every
customer document has. `app/lib/adminAuth.ts` and `app/lib/serverAuth.ts` both
read `users/{uid}.isStaff`; that is the source of truth.

| | Staff | Customers |
|---|---|---|
| Firestore document | `users/{uid}` with `isStaff: true` | `users/{uid}` |
| Distinguishing fields | `role`, `branchIds`, `superadmin`, `sectionGrants`, `sectionRevocations` | `xp`, `level`, `obCoins`, `themeId`, `badges` |
| Hook | `useAdminUser()` / `useRequireRole()` | `useCustomerUser()` |
| Login page | `/admin/login` | `/customer/login` |

They are still two independent identity systems in every way that matters —
separate hooks, separate login pages, neither checks the other, and there's no
concept of a staff member also being a logged-in customer in the same session.
One shared collection, two roles for a document.

Worth knowing what this shape implies: the same document carries a staff
member's authorization fields *and* their spendable currency. The `users`
update rule handles that by locking specific fields (`xp`/`obCoins` must stay
unchanged unless the writer is staff) rather than gating the whole document —
see the Firestore Rules section below for why that distinction matters.

New staff accounts are created through `POST /api/admin/accounts`. First-time
provisioning of the very first admin is still done by hand in the Firebase
Console (create `users/{uid}` with `isStaff: true`, `role: 'admin'`,
`superadmin: true`, `xp: 0`, `obCoins: 0`) — deliberately, because a
self-elect-first-admin rule can't be expressed safely; see the last bullet of
the Firestore Rules section.

Full detail on the staff side is in [docs/admin-panel.md](./docs/admin-panel.md).

## Data Layer Convention

Almost all Firestore access goes through `app/lib/*.ts` — one file per feature area, each exporting a mix of:
- **Hooks** (`useXxx`) that wrap `onSnapshot` for live data — most UI reads are live listeners, not one-off `getDocs` calls, so admin queues and customer profiles update in real time without a manual refresh.
- **Plain async functions** for writes (`createXxx`, `updateXxx`, `approveXxx`/`rejectXxx`) that the UI calls directly from event handlers.

| File | Covers |
|---|---|
| `adminAuth.ts` | Staff identity, roles, section access |
| `customerAuth.ts` | Customer signup/login (Google + email/password linking), username reservation |
| `customerManagement.ts` | Admin-side customer editing: XP/coins, delete, password reset, annual reset |
| `loyalty.ts` | Transaction (check/event attendance) submission and approval |
| `redemptions.ts` | OB Coin redemption items + requests |
| `friends.ts` | Friend requests, friends list, customer directory search |
| `participantInvites.ts` | Consent flow for being added to someone else's event booking |
| `tableReservations.ts` | Table booking + conflict locking (see below) |
| `eventReservations.ts` | Event spot booking (simpler — capacity check only, no locking) |
| `activityLog.ts` | Generic audit log used by every admin mutation |
| `media.ts` | Shared cross-feature media library |
| `branches.ts` | The three branches, per-branch stock helpers |
| `levelConfig.ts` | XP curve, level titles, tiers — pure functions, no Firestore |

## Firestore Schema

22 top-level collections. None of them have subcollections — everything is flat, with foreign-key-style string fields (`tableId`, `branchId`, `userId`, etc.) instead of nesting.

**Staff & customers**
- `users/{uid}` — every account. Customer fields: `username`, `displayName`, `email`, `avatarUrl`, `themeId`, `xp`, `level`, `levelTitle`, `obCoins`, `badges`. A staff account is the same document plus `isStaff: true`, `role`, `branchIds`, `superadmin`, `sectionGrants`, `sectionRevocations` and `claimsUpdatedAt`. There is no `adminUsers` collection — see Two Identities above.
- `usernames/{lowercased-username}` — uniqueness reservation, written inside the same transaction as account creation

**Content (admin-managed, public-readable)**
- `games`, `gameCategories` — shop catalog; `games.stock` is a `Record<branchName, number>`
- `menuCategories`, `menuItems`
- `events`, `eventTypes`

**Loyalty economy**
- `transactions` — one doc per check/event attendance submission, `status: pending|approved|rejected`
- `transactionLog` — append-only history of transaction status changes
- `redemptionItems` — catalog of things customers can spend OB Coins on
- `redemptions` — one doc per redemption request, same pending/approved/rejected shape

**Bookings**
- `tableReservations`, `tableLocks` — see below
- `eventReservations`
- `participantInvites` — consent records for uid-based participants added to an event booking

**Social**
- `friendRequests` — single collection for both pending requests and accepted friendships (a `status` field distinguishes them)

**Operational**
- `activityLog` — every admin create/update/delete, written by `app/lib/activityLog.ts`
- `mediaLibrary` — every image ever uploaded through any admin form, for the shared media picker
- `appSettings/loyaltyReset` — the one doc holding `nextResetDate` for the annual points reset

## The Table Booking System

This is the most architecturally involved part of the app, so it's worth
walking through. The pattern originated in the D&D session booking system,
which was removed with the rest of the D&D modules; `tableReservations.ts`
generalized it from one locked resource to many and is now the only
implementation.

**The constraint:** a joint booking can span several tables, and every one of
them has to be free for the whole sitting. Two people picking overlapping
tables at the same instant must not both succeed.

**The fix:** every sitting is a fixed `RESERVATION_DURATION_MINUTES = 90`, plus
a `TABLE_RESET_BUFFER_MINUTES = 15` trailing buffer for turnover that's never
shown as a bookable slot — it just extends how long a confirmed booking keeps
blocking those tables. Conflict-checking works through **deterministic lock
documents**: a candidate slot's 30-minute buckets each map to a predictable doc
id (`${tableId}__${dateKey}_${bucketIndex}`) in `tableLocks`. Booking is a
single `runTransaction` that reads every (table × bucket) ref the sitting plus
buffer would occupy, and only commits if none of them already exist. This is
deliberately *not* a query-based check — Firestore transactions can only
re-read specific document references, not run a query, so per-bucket lock
documents are the only race-safe option available without server-side code.

Rejecting or cancelling a booking recomputes the same bucket ids and deletes
them in a `writeBatch`, freeing the slot. The lock ids being a pure function of
(table, time) is what makes that safe to do from a different code path than the
one that created them.

## Firestore Rules

Security rules **are** version-controlled, in `firestore.rules` at the project root — this is the single source of truth for what's actually deployed. Deploy changes with the Firebase CLI (`firebase deploy --only firestore:rules`) rather than pasting into the Console UI, so the repo and the live project never drift apart again.

Every rule follows the same shape: a broad `isStaff()` helper (checks `users/{uid}.isStaff`, not a specific role) gates staff-only writes, while customer-owned documents check `request.auth.uid == resource.data.<ownerField>`.

**Granular role checks are not enforced in rules — only in the client via `useRequireRole`. This is now a known hole, not a tradeoff.** Any staff account, whatever its role, can write to any staff-gated collection via a direct SDK call; the UI just won't show them the button. It was an acceptable position while every account was a trusted employee and the worst case was mis-awarded loyalty XP. It is not acceptable for a system heading toward taking payments, and it is the P0 in the feature audit.

The fix is unblocked, not done. Custom claims now carry `role`, so a rule can read `request.auth.token.role` for free where it previously would have paid a billed document read per evaluation. Rewrite collection by collection — never in one sweep, because a rules deploy has no gradual rollout and a wrong rule breaks that collection for everyone at once. Backfill claims and verify a real token carries them *before* deploying the first claim-checking rule (see [docs/server-setup.md](./docs/server-setup.md)).

`users` remains the one collection that must not be loosened beyond `isStaff()` regardless: it's the collection that defines who's staff in the first place (see the comment on that rule for the privilege-escalation bug this used to have).

If you add a new collection, **add its rule to `firestore.rules` and deploy it** — there's no other safety net catching a missing rule (Firestore denies anything unmatched by default, so forgetting a rule fails closed, but a rule that's *wrong* — too permissive — won't be caught by anything automated). A few patterns worth reusing:
- **Schema/bounds validation on create**, not just "who can write": see `transactions`' `xpAmount`/`coinsAmount` caps — a `create` rule that only checks ownership lets the *creator* set any value for fields a normal UI flow would compute for them.
- **Narrow "customer can update their own participation" rules**, not blanket `isStaff()`: see `tableReservations`/`eventReservations`' update rule, which allows a non-staff edit only when `status` doesn't change — wide enough for the decline-invite flow to work, narrow enough that a customer still can't self-approve their own booking.
- **Lock specific high-value fields, not the whole document**, when a document is otherwise legitimately self-editable: see `users`' update rule — a customer can freely rewrite their own avatar/theme/username/etc., but `xp`/`obCoins` must stay equal to `resource.data.xp`/`obCoins` (i.e. unchanged) unless the writer is staff. Before this fix, "customer owns this doc" had silently meant "customer owns every field on this doc, including their own currency balance" — `allow write: if auth.uid == userId` doesn't stop the owner from writing *anything*, just because the *intended* write path (the app's UI) never asks for that field.
- **Don't try to replicate app-level bootstrap logic in rules that rules can't actually express.** The old staff-account rule tried to allow a one-time "first admin self-elects" write by checking `request.auth != null` — but rules have no way to check "is this whole collection empty," only "does this one document exist," so it ended up allowing *every* signup to self-promote, not just the first. When client-side logic and rules can't agree on the same check, provision by hand instead of weakening the rule to match.
