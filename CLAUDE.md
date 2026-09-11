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
npm run verify:receipt       # if you touched what a customer is handed
npm run verify:brand         # if you touched a colour, a variable or brand.ts
npm run verify:printing      # if you touched printers or the print seam
npm run verify:dates         # if you touched an event date or what "today" means
npm run verify:payments      # if you touched a payment, tender, change or the bill rate
npm run verify:delivery-math # if you touched receiving or costing
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
- **Anything that adds to a check must be safe to send twice.** A Send whose
  reply is lost — a phone at the edge of the café wifi — has an unknown
  outcome, and resending blind put the order on the kitchen ticket twice.
  Each batch carries a `batchKey`; the server skips a key it has already
  applied (`batchAlreadyApplied()` in `shared/src/checks.ts`), and the phone
  reads the live check to learn whether an unsettled batch landed. A new path
  that appends lines has to do the same. And tell "no answer" from "the answer
  was no" with `isNetworkFailure()` — never treat every `TypeError` as
  offline, or a bug gets reported to a waiter as bad wifi.

  The same holds for any admin write that CREATES something or moves stock:
  posting a delivery, a retail sale, a stock transfer and a weekly order all
  doubled on a retried Save. They go through `postOnce()` in
  `shared/src/apiClient.ts`, and the server takes `parseRequestId()` and uses
  it as the new document's id, returning the stored result when it already
  exists. The key resets on ANY answer, refusal included, so a second
  identical sale is still a second sale. A new create that touches stock or
  money should do the same. Wholesale orders and loyalty event submissions
  do too. A wholesale order passes `postOnce` an `identity` of cart plus
  notes, because the invoice is drawn in the browser and a redrawn one must
  not make the retry look like a new order.

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
- **01 (stock receiving): closed, 7 Sep 2026.** The chain was run end to end
  against the demo project, in a browser, not inferred from these notes:
  `npm run seed:demo -- --apply` → open the seeded Main/Kitchen order in
  Receive a Delivery → post → stock moved → Food Cost Report read 35.0% on
  $1,027.14 of goods against $2,930.83 of till sales → the order showed
  "All 18 lines received".
  - The seed now also writes seven end-of-day reports. Without them the food
    cost report has no sales side to divide into and shows a dash, which looks
    like a bug and is not one.
  - `/admin/supplies/receiving/report` is the food cost report;
    `/admin/weekly-orders` carries the fulfilment bar.
  - **VAT was set to 12% in Business Settings and is now 11%.** The delivery
    posted before the change keeps its 12% — every delivery and end-of-day
    report stores the rate it was written with, which is the whole reason
    changing that setting is safe.
  - Never run against the real café's data. `npm run link:supplies` is the
    step that needs it, and its unmatched list is an audit, not a migration
    report.
- **02 (fix the app, unify constants):** the constants half is largely done here
  by the fork. **Nothing else in 02 belongs to this repo.**

  The other half is three loyalty-economy bugs in the Onboard App (React
  Native), which is a **separate project in a separate repo** that happens to
  share a phase number because BIG CMS was forked from it. Do not offer to
  work on it here, do not ask for access to it, and do not list it as what
  comes next — it is somebody's work, but it is not this repo's. The phase
  numbering is shared history, not a shared backlog.
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
  - **Printing — one arm of one switch.** Everything but the thermal
    transport is built. Documents: `receipt.ts` and `ticketDoc.ts`, laid out
    by `receiptToText()` at 32 or 42 columns. The seam: `printText()` in
    `shared/src/printClient.ts`, switching on the transport — `browser` works
    today (a KDS device prints to whatever printer it is attached to), `epos`
    and `cloudprnt` return a reason rather than pretending. Configuration:
    `/admin/settings/printers`, stored at `appSettings/printing`. The KDS
    auto-prints new tickets and, if switched on, the receipt when a check
    closes — from the device with **Print here** on, never the phone that
    pressed Close. The decisions are pure functions in
    `pos/app/lib/printBatch.ts`, asserted by `verify:printing`.

    Choosing hardware now means implementing one `case` in `printText()`.
    The plan's "server sends ESC/POS to a LAN printer" does not work from a
    cloud host — it is Epson ePOS-Print from the browser over the café wifi,
    or Star CloudPRNT with the printer polling out.

    **The `appSettings/printing` rule is deployed** — 11 Sep 2026, by the
    owner; the CLI reported "released rules firestore.rules". Before that the
    settings were unreadable, every printer read as off and the Print here
    toggle did not appear, so if those symptoms come back, check the live
    ruleset before the code.
  - **Timestamps.** A `serverTimestamp()` field arrives as a Firestore
    `Timestamp`, and `new Date(timestamp)` is Invalid Date — it printed
    "NaN-NaN-NaN NaN:NaN" on every real receipt while the verifier passed on
    a string fixture. Read timestamps through `timestampMs()` in
    `shared/src/timestamps.ts`, never `new Date(field)`.

    Calendar days are the sibling trap. An event's `date` is a `'YYYY-MM-DD'`
    string, and `new Date(date)` is UTC midnight — 03:00 in Beirut — so the
    home page hid an event while it was running. Compare with
    `isTodayOrLater()` and display with `ymdToLocalDate()` from
    `shared/src/dates.ts`, and judge "today" in `BRAND.locale.timezone`, not
    the viewer's.

    And never let `getFullYear()`/`getMonth()`/`getHours()` decide a date or
    a period in shared or server code. On a server they read the HOST's zone,
    usually UTC: that numbered receipts into the wrong month and year, let the
    till charge a sale price the screen had stopped showing, and made the
    server compute different table-lock ids from the browser that created
    them — so a rejected booking left its table blocked. Use `zonedParts()` /
    `todayYmd()` with `BRAND.locale.timezone`. All of it looked right in
    development only because the development machine is in Beirut, which is
    why `verify:dates` pins every case to an explicit zone.
  - **The pilot.** One section of one branch, the old till still taking
    payment. That constraint is what makes v1 safe to ship badly.

- **04 (POS v2): slices 1–3 of 7 built; payment is behind the `payments`
  switch — off.** The plan, its order and the owner's decisions are in the
  Phase 04 note. Built: taking payment (cash USD / cash LBP / card, split
  tender, change), closing only when paid, payments on the receipt; VAT; and
  splitting a bill.
  - **A split is never stored.** One receipt, several payments (owner's
    decision), so `shared/src/splits.ts` only works out each person's share —
    evenly to the cent, by seat, by item — from `lineTotal()`, the same figure
    the bill adds up, so the shares always sum to the bill. The panel fills
    the amount via `fillAmount()`, capped at what is still owed; the waiter
    still presses Take.
  - **VAT is read through `vatRateOn(settings, day)`, never `vatRate`.**
    Settings hold the current rate plus an optional `vatNext` { rate, from };
    on the `from` day (café zone) every caller switches at midnight together.
    `closeCheck()` records the day's rate on the check, and the receipt prints
    "Incl. VAT" from that — prices include VAT, so it is the share of the
    total that was tax (`vatIncluded()`), never added on top. A check closed
    before this has no `vatRate` and no VAT line; do not backfill one from
    today's rate.
  - **Payments:** the arithmetic is `shared/src/payments.ts`, asserted by
    `verify:payments`; the server is `addPayment()` in
    `shared/src/server/checks.ts`.
  - **The switch is the pilot's safety.** Off, a check closes exactly as in
    v1 while the old till takes the money. Do not make closing depend on
    payment anywhere that does not ask `serverFeatureOn('payments')`.
  - **Settled is judged in lira** by the bill rounding rule
    (`roundLbpTotal`), never in exact dollars — a lira-paid check would
    otherwise sit a fraction of a cent short and never close.
  - **One rate per check**, fixed by the first payment (`billRate`). The
    receipt reads it, not today's setting.
  - Owner's decisions (11 Sep 2026): prices include VAT; USD cash gets change
    in whole dollars and the rest in LBP; a split bill is one receipt with
    several payments; cards go through a separate machine, recorded only.
  - Receipt numbers cannot collide yet: `closeCheck()` issues them on the
    server at close. Block-reserved numbers are only needed once a till can
    take payment OFFLINE, which is slice 7 — and offline today means cached
    reads only, because every POS write is a route handler.

- **05 (make it a product):** branding, the feature-flag registry and now the
  three-app split have landed. A client on the POS tier receives no admin code
  at all, and `pos`/`kds` are feature flags like everything else.
  Multi-tenancy and billing are untouched.

The claims-based rules rewrite from the 00 gate is **done and deployed**, so
this repo has no open P0. The one the audit still lists — the mobile app's
admin screens have no role gates — is in the Onboard App, which is a different
project. Same note as 02 above: not this repo's work, and not this repo's
next task.
