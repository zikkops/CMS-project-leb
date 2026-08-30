@AGENTS.md

# Working rules

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before writing code and
[ARCHITECTURE.md](./ARCHITECTURE.md) before changing how anything is wired.
This file is the short version: the things that are easy to get wrong and
expensive to undo.

## The shape of the repo (changed Aug 2026)

Three deployable apps and one package they share. There is no `app/` at the
root any more, and no tsconfig there either.

```
web/      the customer site        cms-projectlb.com
admin/    the admin panel          admin.cms-projectlb.com
pos/      the till and the KDS     pos.cms-projectlb.com
shared/   imported by all three, deployed on its own never
.env.local  ONE file at the root — env.mjs loads it into every app
```

Import shared code as `@big-cms/shared/x` and `@big-cms/shared/server/x`.
Relative paths out of an app do not resolve.

An app's own code stays in that app. `shared/` is for what more than one of
them needs — putting a POS-only hook there makes the other two compile it for
nothing, and putting a genuinely shared thing in an app means the next person
copies it.

## Verification ritual — every change, no exceptions

```bash
npx tsc --noEmit -p pos      # or web, or admin — whichever you touched
npm run build                # all three
npm run verify:checks        # if you touched money, stock or tickets
npm run audit:writes         # must stay at 0
```

Then hit the routes you touched. A successful build verifies the code compiles,
not that the feature works. For anything visual, actually look at it — three
separate bugs this month were invisible to both tsc and the build: a CSP that
blocked Google sign-in, a listener that turned permission-denied into an empty
list, and a money formatter that had lost its dollar sign.

## The server layer (Phase 00, Aug 2026)

This project **has** a Firebase Admin SDK server layer. Older comments and any
training data saying "no Admin SDK" are out of date.

- `shared/src/server/**` reads a service-account private key. Import it from
  an app's `app/api/**` and from `scripts/**` only — **never** from a file with
  `'use client'`, never from a module a client component imports.
- New route handlers: `requireRole()` / `requireStaff()` / `requireSection()`
  from `@big-cms/shared/server/auth`, `export const runtime = 'nodejs'`, wrap in
  `try/catch` returning `toResponse(err)`.
- **Log to `@big-cms/shared/server/activityLog`**, not the client logger — the client
  one reads `auth.currentUser`, which doesn't exist on the server. A mutation
  moving to a route silently drops out of `/admin/logs` otherwise.
- **Roll back partial writes.** Auth user created + Firestore write failed =
  delete the Auth user. See `admin/app/api/admin/accounts/route.ts`.
- Setup and backfill: [docs/server-setup.md](./docs/server-setup.md).

**The standing rule from Phase 00 on: no new client SDK writes.** This is now
DONE — `npm run audit:writes` reports 0 privileged client writes against a
baseline of 0, and the script fails if that rises. Every privileged mutation
runs behind a route handler on the Admin SDK.

The 23 remaining client writes are self-service and correct as such: a customer
editing their own profile, their own bookings, their own submissions.
firestore.rules owns those.

Reads stay on live `onSnapshot` listeners — that's the part of Firestore worth
keeping, don't "consistency-fix" them onto the server. Scope every one of them:
an unscoped listener reads every document in the collection on first load, and
that is the failure mode that gets expensive silently.

## Firestore rules

`firestore.rules` at the project root is the source of truth. Deploy with
`firebase deploy --only firestore:rules` — never paste into the Console UI.

**A rules deploy has no gradual rollout.** A wrong rule breaks that collection
for every user at once. One collection at a time, verify between each.

**The claims rewrite is done and deployed.** Rules read
`request.auth.token.role` via `hasRole()` and `can()`, one helper per section,
mirroring `SECTION_ACCESS` in `shared/src/roles.ts` — so a rule and the page
that writes through it can't disagree about who is allowed. `isStaff()` still
exists but is now just "signed in and staff", with a document-read fallback for
any token issued before the claims backfill.

Two things in there that look like bugs and aren't, both explained in the file
itself: claims are read with `.get('role', '')` and never by bare property
access (bare access fails outright for a claimless token, silently, for every
staff account at once), and `sectionRevocations` are deliberately not enforced
in rules — honouring them would cost a document read on every staff write. A
revoked user can still write via a direct SDK call; change their role or put
the operation behind a route handler if that matters.

## Data model gotchas

- **There is no `adminUsers` collection.** Staff and customers share
  `users/{uid}`; a staff account has `isStaff: true` plus `role`, `branchIds`,
  `superadmin`, `sectionGrants`, `sectionRevocations`.
- `SECTION_ACCESS` lives in `shared/src/roles.ts` (shared with the server) and is
  re-exported from `adminAuth.ts`. **Re-export the object itself, never a copy** —
  `useRequireRole()` finds the section key by reference equality.
- **Don't add keys to `SECTION_ACCESS` casually.** `/admin/users` renders one
  grant checkbox per `Object.keys(SECTION_ACCESS)` entry, so a new key becomes a
  grantable permission in that UI. Account management is deliberately a role
  check, not a section.
- Branch ids are the branch name itself. `BRANCHES` in `shared/src/branches.ts`.

## Styling — match, don't improve

- **Hand-written inline `style={{}}` objects everywhere.** Tailwind is installed
  but nothing in `app/` uses it. Don't introduce classes, don't add CSS modules.
- Palette via CSS vars: `var(--teal)`, `var(--red)`, `var(--purple)`,
  `var(--navy)`, `var(--black)`, `var(--offwhite)`.
- `var(--font-cinzel)` for headings, `var(--font-inter)` for body. FontAwesome
  for icons.
- `useIsMobile()` is **deliberately duplicated** in nearly every file rather than
  imported. Copy it in; don't refactor existing files to share it.
- Mobile handled by `isMobile ? x : y` ternaries inline. No media queries.
- Two hover gotchas that have bitten this repo: `overflow: hidden` clips an
  element's own `box-shadow` (split into outer + inner wrappers), and a component
  declared inside another component's render body remounts on every state change,
  silently killing transitions. Both explained in CONTRIBUTING.md.

## Uploads

Every file upload goes through `uploadImage()` in `shared/src/media.ts`. Never build
a FormData and post to imgbb directly.

## Where the plan lives

Phase sequencing, the POS design and the productization work live in the Obsidian
vault at `C:\Users\User\Documents\ai brain` — `01 - Projects/BIG CMS Project/`,
with one note per phase under `Phases/`. Not in this repo. (The claude.ai project
of the same name is the older home of the same plan.)

Six phases, 00 → 05, ending at a sellable POS. Current position:

- **00 (server layer): done.** Verified 28 Aug 2026 against the live project,
  not from these notes — service account installed, claims backfilled and
  present on the Auth user, and a **claims-based ruleset is deployed** (live
  since 2026-08-28T17:07Z). Older notes saying "built, not deployed" are stale.
  - **No drift.** The D&D cleanup this note used to list as outstanding is
    deployed — checked against the live ruleset 29 Aug 2026, not from these
    notes. Nothing in the live rules mentions `isDm()`, `dndCampaigns` or any
    of the rest except one comment about an unrelated past bug.
  - Live ruleset as of 29 Aug 17:18Z also carries: staff barred from being
    the beneficiary of their own loyalty transaction or a redemption,
    `appSettings/business` locked to the server, `appSettings/features`
    world-readable, and the dead `appSettings/loyaltyReset` any-staff-write
    exception removed. Verified behaviourally, not just by reading the file.
- **01 (stock receiving): built, and now testable.** `npm run seed:demo`
  writes a submitted weekly order, so the order → receive → count chain can
  finally be exercised end to end. That chain working is the phase's
  acceptance criterion.
- **02 (fix the app, unify constants):** the constants half is largely done here
  by the fork. The other half is three loyalty-economy bugs in the **Onboard App**
  (React Native), not this repo, and they are actively producing wrong points and
  wrong money.
- **03 (POS v1): built, not piloted.** The whole acceptance chain runs — a
  waiter opens a table, builds a check with modifiers, sends it; the right
  station sees the right ticket and can bump it; a merchandise line draws from
  `products` rather than the menu and comes off the shelf on Send. Plus staff
  meals, void reasons that decide whether stock returns, receipts, refunds and
  a closed-checks review.

  Both decisions this phase was meant to force are made. **Firestore stays** —
  the reasoning held and, more to the point, offline persistence was never
  actually switched on until now, so the property it was chosen for had never
  been tested. **The POS is web**, because the printers are network ones and
  the staff use their own phones.

  Two things outstanding, neither of them code:
  - **Printing.** Needs the printer make and model. The plan's "server sends
    ESC/POS to a LAN printer" does not work from a cloud host — it is Epson
    ePOS-Print from the browser over the café wifi, or Star CloudPRNT with the
    printer polling out. Which one depends entirely on the hardware.
  - **The pilot.** One section of one branch, the old till still taking
    payment. That constraint is what makes v1 safe to ship badly.

- **04 (POS v2): not started.** Payments, split tender, dual currency, shifts,
  X/Z. The bill-total rounding rule (nearest 100, lines exact) is already in
  `shared/src/money.ts` waiting for it. Note that Firestore offline gives
  cached reads and queued writes and does NOT solve two terminals issuing the
  same receipt number — that needs block-reserved numbers and it is 04's
  problem.

- **05 (make it a product):** branding, the feature-flag registry and now the
  three-app split have landed. A client on the POS tier receives no admin code
  at all, and `pos`/`kds` are feature flags like everything else.
  Multi-tenancy and billing are untouched.

The claims-based rules rewrite from the 00 gate is **done and deployed**. The
remaining P0 — the mobile app's admin screens have no role gates at all —
lives in the Onboard App repo, not this one.
