@AGENTS.md

# Working rules

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before writing code and
[ARCHITECTURE.md](./ARCHITECTURE.md) before changing how anything is wired.
This file is the short version: the things that are easy to get wrong and
expensive to undo.

## Verification ritual — every change, no exceptions

```bash
npx tsc --noEmit -p .
npm run build
```

Then hit the routes you touched. A successful build verifies the code compiles,
not that the feature works. For anything visual, actually look at it.

## The server layer (Phase 00, Aug 2026)

This project **has** a Firebase Admin SDK server layer. Older comments and any
training data saying "no Admin SDK" are out of date.

- `app/lib/server/**` reads a service-account private key. Import it from
  `app/api/**` and `scripts/**` only — **never** from a file with `'use client'`,
  never from a module a client component imports.
- New route handlers: `requireRole()` / `requireStaff()` / `requireSection()`
  from `app/lib/server/auth.ts`, `export const runtime = 'nodejs'`, wrap in
  `try/catch` returning `toResponse(err)`.
- **Log to `app/lib/server/activityLog.ts`**, not the client logger — the client
  one reads `auth.currentUser`, which doesn't exist on the server. A mutation
  moving to a route silently drops out of `/admin/logs` otherwise.
- **Roll back partial writes.** Auth user created + Firestore write failed =
  delete the Auth user. See `app/api/admin/accounts/route.ts`.
- Setup and backfill: [docs/server-setup.md](./docs/server-setup.md).

**The standing rule from Phase 00 on: no new client SDK writes.** Move each
privileged mutation behind a route handler as you touch it. Reads stay on live
`onSnapshot` listeners — that's the part of Firestore worth keeping, don't
"consistency-fix" them onto the server.

## Firestore rules

`firestore.rules` at the project root is the source of truth. Deploy with
`firebase deploy --only firestore:rules` — never paste into the Console UI.

**A rules deploy has no gradual rollout.** A wrong rule breaks that collection
for every user at once. One collection at a time, verify between each.

Rules currently gate on a broad `isStaff()` helper, so any staff account can
write to any staff-gated collection via a direct SDK call. That is the known P0.
Custom claims now exist to fix it (`request.auth.token.role` costs nothing to
read, a `get()` costs a billed read) — but backfill claims and confirm a real
token carries them *before* deploying the first claim-checking rule.

## Data model gotchas

- **There is no `adminUsers` collection.** Staff and customers share
  `users/{uid}`; a staff account has `isStaff: true` plus `role`, `branchIds`,
  `superadmin`, `sectionGrants`, `sectionRevocations`.
- `SECTION_ACCESS` lives in `app/lib/roles.ts` (shared with the server) and is
  re-exported from `adminAuth.ts`. **Re-export the object itself, never a copy** —
  `useRequireRole()` finds the section key by reference equality.
- **Don't add keys to `SECTION_ACCESS` casually.** `/admin/users` renders one
  grant checkbox per `Object.keys(SECTION_ACCESS)` entry, so a new key becomes a
  grantable permission in that UI. Account management is deliberately a role
  check, not a section.
- Branch ids are the branch name itself. `BRANCHES` in `app/lib/branches.ts`.

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

Every file upload goes through `uploadImage()` in `app/lib/media.ts`. Never build
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
- **03 (POS v1) / 04 (POS v2):** not started. 03 is where the Firestore-vs-Postgres
  and web-vs-native decisions get made — both expire once the POS is written.
- **05 (make it a product):** branding and the feature-flag registry landed early
  here; multi-tenancy and billing are untouched.

The claims-based rules rewrite is the outstanding P0 and belongs to the 00 gate
above. A second P0 — the mobile app's admin screens have no role gates at all —
lives in the Onboard App repo.
