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
npm run verify:all           # type-checks, every verifier, every audit
npm run build                # all three — before a commit that touches an app
```

**`verify:all` discovers the checks from package.json**, so a verifier added
tomorrow is in the run without anybody updating a list. That matters because
this list had already drifted: `verify:features` and `verify:hosts` existed for
weeks without appearing in it. It prints the assertion count per verifier,
because a verifier that silently asserts nothing still exits 0, and the count
is the only thing that shows it. Currently 20 checks, 14 verifiers, 805
assertions, about 50 seconds of work across four lanes. It deliberately does
not run the builds — three Next builds take minutes to prove compilation that
tsc proves faster.

When you want one of them on its own:

```bash
npm run verify:checks        # if you touched money, stock or tickets
npm run verify:receipt       # if you touched what a customer is handed
npm run verify:brand         # if you touched a colour, a variable or brand.ts
npm run verify:printing      # if you touched printers or the print seam
npm run verify:dates         # if you touched an event date or what "today" means
npm run verify:payments      # if you touched a payment, tender, change or the bill rate
npm run verify:offline       # if you touched the counter device's outbox or what it sends
npm run verify:counter       # if you touched what the counter till charges for
npm run verify:export        # if you touched what leaves the building for an accountant
npm run verify:backup        # if you touched how a document is copied out or put back
npm run verify:tips          # if you touched how tips are split
npm run verify:errors        # if you touched what an error report may contain
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

## Error reporting (Phase 05 groundwork, Sep 2026)

Every app's `error.tsx`, plus the shared `GlobalErrorPage`, reports through
`reportError()` to `/api/errors`. **The sink is this project's own Firebase,
not a third party** (owner's decision, 12 Sep 2026);
`shared/src/reportError.ts` is a transport seam, so adding Sentry later means
adding a transport there and changing no call site.

- **One document per distinct fault, not per occurrence.** The id is a
  fingerprint of app + normalised message + first stack frame
  (`shared/src/errorReport.ts`); each occurrence increments `count`. A render
  loop is one problem a hundred times, and a document per frame turns a bug
  into a bill. Any word carrying a digit normalises to `#`, so `check abc123`
  and `check def456` are one fault — and a new build hash in a chunk filename
  does not split a fault in two after every deploy.
- **`/api/errors` takes an UNAUTHENTICATED POST, and has to.** A customer whose
  page breaks is signed out, and a root-layout failure takes the Firebase SDK
  down with it, so there is no token to send even for staff. Everything
  arriving is therefore hostile: the body is size-capped *before* it is parsed,
  fields are whitelisted and truncated, and three things are never taken from
  the caller — which app it was (the route knows), the document id (choosing
  the id is choosing whose report to overwrite) and the count.
- **Redaction happens before storage, never at display.** Emails, JWTs, bearer
  tokens, long key-shaped strings, phone numbers and every query string go in
  `redact()`. Scrubbing at display time is scrubbing after it was written down.
- **The day's supply of NEW fingerprints is capped** (`MAX_NEW_PER_DAY`,
  counted at `appSettings/errorBudget`). Faults already known keep counting
  past the cap; unknown ones are dropped rather than allowed to write without
  limit. The browser throttles as well — same fault once a minute, five per
  page load — but a browser is exactly what an attacker is not obliged to use.
- Read them at **`/admin/errors`**, admin-only through `useRequireRole(['admin'])`
  — deliberately not a new `SECTION_ACCESS` key, because "can see the crash
  reports" is not a permission anybody hands out for one shift.
- `npm run verify:errors` asserts the lot. **The `errorReports` rule IS
  deployed** — checked 12 Sep 2026 against the live ruleset with
  `npm run rules:live`, not read off these notes. `/admin/errors` keeps its "the
  rule may not be live yet" message as the failure path rather than an empty
  list, because an empty list reads as "nothing has broken", which is the most
  reassuring possible way to be wrong.
- **Exercised end to end against the real route, 12 Sep 2026** — not just in
  units. Five reports posted at `/api/errors` unauthenticated, as a broken page
  would: the email arrived as `[email]`, the JWT as `[token]`, and the path lost
  its query string before storage. The same fault twice incremented one
  document to `count: 2` instead of writing a second. `Cannot close check
  abc123` and `Cannot close check def456` folded into ONE document, and so did
  the same fault after a simulated redeploy with a new chunk hash — three
  occurrences, one row. A different sentence got its own document, and a 200KB
  body was refused 413 before it was parsed.

## Data export (Phase 05, Sep 2026)

`/admin/exports` hands an accountant the closed checks for a date range: what
each day took, every check, and how each was paid. Gated on `endOfDay` — the
same people who do the cash-up — and deliberately NOT a new `SECTION_ACCESS`
key, because "can export the books" is not a permission handed out for a shift.

- **The arithmetic is `shared/src/salesExport.ts`: pure, and asserted by
  `npm run verify:export`.** An export is the one artefact that leaves the
  building — read a month later by somebody who cannot check it against a
  drawer, and believed. Four things it has to get right, three of which have
  bitten this repo already:
  - **The day is the café's.** A sale at 01:30 belongs to the night it was
    made, judged in `BRAND.locale.timezone`, never the host clock: 21:00 UTC
    is already tomorrow in Beirut. The test fixture got this wrong before the
    code did.
  - **VAT is extracted, never added** — prices include it, and each check
    carries the rate it closed at. A check from before that was recorded
    contributes no VAT rather than a guess at today's.
  - **Lira figures use the check's own `billRate`**, so re-running last
    quarter's export produces last quarter's numbers.
  - **Refunds are their own column**, never netted into sales. Netting hides
    both halves, and the question being asked reconciles with a drawer.
- **The query is ranged on `closedAt` alone**, padded a day at each end, and
  then narrowed by the same pure function that builds the rows. Date maths
  stays in one place, and it needs no composite index. `MAX_RANGE_DAYS` caps a
  request at 100 days: a quarter covers a VAT filing, and an export that can
  read the whole history by accident eventually will.
- **It has been run against real documents**, which until now nothing built on
  a closed check had been. `npm run seed:pos` writes a café history, because
  seed-demo.mjs predates the POS and writes no checks at all. Against 30 days
  of it: 418 documents queried, 414 in range, 397 sales totalling $8,976.50
  with $887.88 of VAT extracted, 16 refunds kept separate, and **101 checks
  that closed after local midnight filed on the next café day** — the trap,
  met on real data rather than only in a fixture.
- **The points ledger is the other half** (`shared/src/loyaltyExport.ts`, same
  verifier). Points are a liability, so this answers what was issued, taken
  back and spent over a range. **The trap it exists for: `pointsAmount` is
  credited to EVERY user in a transaction’s `userId` array, not divided
  between them** — an event with five attendees at ten points each issues
  fifty, and a report that sums the field says ten. The neighbouring
  `splitCount` actively misleads: it is `attendeeUids.length`, a headcount,
  and the approvals screen labels it "split between N people". Only
  `approved` issues and only `redeemed` spends; a pending submission is a
  request, not a liability. A redemption is dated by when it was handed over,
  which is why the server queries `createdAt` AND `confirmedAt` and unions —
  one asked for last month and collected this month is exactly the movement
  being asked about. Gated on `loyalty`, not `endOfDay`.
- The browser names a date range and a branch, and nothing else — no rate, no
  VAT percentage, no total. `admin/app/admin/exports/workbook.ts` only arranges
  rows into sheets; the moment it does arithmetic there are two answers to what
  a day took.

## Backups (Phase 05, Sep 2026)

`npm run backup` copies every collection to newline-delimited JSON under
`backups/` (gitignored), one file per collection plus a manifest.
`npm run restore -- <dir>` puts it back — but **compare is the default and
writing needs `--apply`**.

- **A Firestore document is not JSON, and that is the whole risk.** Timestamps,
  GeoPoints, references, bytes, NaN and Infinity all lose themselves in
  `JSON.stringify` — a Timestamp becomes `{_seconds,_nanoseconds}` and restores
  as a plain map, so every date in the system silently stops being a date. The
  tagging lives in `shared/src/backupCodec.ts`, pure, with `npm run
  verify:backup` on it (33 cases, four mutations checked). It escapes the tag
  key too: a café will never have a field called `$fs` until an import brings
  one, and an unescaped codec decodes it as a native and mangles the document.
- **Compare is the drill you can actually run.** "Backups, with a restore you
  have actually run" is on the Phase 05 list because an unexercised backup is a
  rumour — but nobody rehearses a destructive restore on a whim. So the default
  mode reads every document back and compares it with the backup THROUGH the
  codec (two Timestamps for one instant are different objects; only the encoded
  forms compare). Run 12 Sep 2026 against the demo project: 790 documents, 790
  identical. `--apply` was then run for real on one collection, and the compare
  repeated: still identical.
- **It refuses to restore into a project the backup did not come from** without
  `--allow-different-project`, and refuses to write into a project that does not
  look like a demo unless `SEED_ALLOW_PROJECT` names it exactly. It never
  deletes: a document created after the backup is reported and left alone.
- **It is NOT a substitute for `gcloud firestore export`** once there is a
  paying customer. A managed export is a consistent point-in-time snapshot taken
  by the database; this reads collection by collection while the café may still
  be trading, so two collections can disagree by seconds. Managed export for
  disaster recovery; this for "send me a copy of that café’s data", for moving a
  dataset between projects, and for the drill.
- It sees TOP-LEVEL collections only, via `listCollections()`. The schema is
  flat today; a subcollection would need that line changed.

## Tips (Sep 2026)

`shared/src/tips.ts` splits the pot; `/admin/end-of-day/tips` displays it.

- **The deduction is a setting, and it was not.** The page carried
  `const DEDUCTION = 0.11` while Business Settings offered an editable
  `tipsDeductionRate` on a form that implies it matters. Changing the setting
  changed nothing — every payout stayed at 11%, with no symptom beyond a
  number being slightly wrong on its way to staff. `audit:branding` had been
  flagging that line for weeks as a hardcoded 11%; it was read as a branding
  smell, and nobody noticed it meant the setting was dead. **When the audit
  points at a constant, ask what reads it.**
- **The shares add up to the pot, to the cent.** The old version multiplied an
  unrounded per-point figure per person and let the remainder evaporate; the
  odd cent now lands on somebody by largest remainder, the same rule seat
  shares follow. Money quietly going missing is the same class of bug as
  netting a refund into sales.
- **A rate that is not a sensible fraction takes nothing off.** A missing or
  misconfigured setting must not be able to take 100% of the tips: paying
  staff too much is noticed, paying them nothing looks like an empty pot.
- `npm run verify:tips` — 26 cases. The period carries the rate it was worked
  out at, so a card can never label a total with a rate that did not produce
  it.

## Seeding a POS history (Sep 2026)

`npm run seed:pos` writes closed checks, their payments, and the drawer shifts
they were taken in. `--clear` removes exactly what it wrote; `--days=` and
`--base=` set the span and the receipt-number block.

- **It borrows the application’s arithmetic rather than imitating it.** Change,
  the receipt-number format, the drawer totals, the note-by-note count and the
  cash-up day all come from `applyPayment()`, `formatInvoiceNumber()`,
  `drawerTotals()`, `countedCash()` and `cashUpDay()`, transpiled and called.
  A seed that reimplements any of them writes figures the application never
  produced — worse than no data, because it looks like evidence.
- **The model decides the tender.** USD notes stop at $1 and lira at 1,000, so
  cash is handed over in whole notes and the change falls out of applyPayment.
  That is what lets a seeded drawer be counted exactly, and it is why the
  counts are a real breakdown rather than a number.
- **The shifts reconcile against a query, not against the seed.** Checked by
  recomputing all 90 the way `shiftTotals()` does — `checks where shiftIds
  array-contains` — and comparing: 90 agreed, 0 did not. Four are counted one
  $5 note short on purpose so the over/short display has something real, and
  each says so in its note.
- **Receipt numbers are burnt, even by a seed.** The block starts at `--base=`
  and the counter is pushed past it, so a real close can never be handed one.
  After a `--clear` the old numbers are NOT given back: re-seeding needs a
  fresh base above the counter, and the script says which.
- Everything it writes carries `seeded: true` — demo data you cannot find
  again is demo data you cannot remove, and it sits in the same collections as
  real sales.

## Firestore rules

`firestore.rules` at the project root is the source of truth. Deploy with
`firebase deploy --only firestore:rules` — never paste into the Console UI.

**A rules deploy has no gradual rollout.** A wrong rule breaks that collection
for every user at once. One collection at a time, verify between each.

**`npm run rules:live` reads the DEPLOYED ruleset and diffs it against this
file.** Read-only — it cannot deploy, and deploying stays a deliberate
`firebase deploy --only firestore:rules`. Run it before blaming the code: a
rule that is written but not deployed looks exactly like a rule that is wrong
from the application's side, and that is precisely what the printing-settings
bug was. It reports the RULESET's createTime rather than the release's, because
a release is created once and updated on every deploy — so the release date
reads as "the day rules were first ever published" forever, which is the wrong
answer to the only question being asked.

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

    **A sweep for this on 12 Sep found three more**, so treat it as live
    rather than closed. The receipt printed `getHours()` off whatever machine
    drew it — correct only on a device standing in the café with its clock
    set right, and the KDS prints from whichever device has "Print here" on.
    `ReceiptOptions.timeZone` is **required**, not optional with a fallback:
    optional leaves the old path reachable, required makes tsc refuse a caller
    that omits it. `getCurrentWeek()` had it too, and there the day is an
    identity — `weekStart` is what a weekly order is filed under — so the
    arithmetic moved to `cafeWeek()` in `dates.ts`, because `weeklyOrders.ts`
    imports Firestore and nothing in it can be asserted. `/pos/closed` grouped
    by the device's day while `/admin/exports` groups the same checks by the
    café's.

    **A Date used only to carry a calendar date should be noon UTC, never
    midnight.** Formatted in a host zone, a UTC midnight reads as the day
    before on every host west of Greenwich. Noon narrows that rather than
    curing it — UTC+12 and east still roll forward — so an explicit
    `timeZone: 'UTC'` on the formatter is the actual fix and noon is the
    smaller blast radius when somebody drops it. That one word was dropped as
    a mutation and **every test still passed**, Beirut being east of UTC and
    Node on Windows ignoring `TZ`: some cases in this class cannot be caught
    from this machine at all, only reasoned about and pinned with named zones.
  - **The pilot.** One section of one branch, the old till still taking
    payment. That constraint is what makes v1 safe to ship badly.
    **[docs/pilot.md](./docs/pilot.md) is the runbook** — what to confirm the
    week before (`rules:live`, a backup and its compare, clearing the seeded
    history, who needs which section), what to watch on the night, what to
    check the same evening, and what a pass actually is. Its first line is the
    decision nobody should discover halfway through a Friday: which Firebase
    project the pilot runs against, given this repo points at a demo one.

- **04 (POS v2): all seven slices built, none piloted; payment is behind the
  `payments` switch — off.** The plan, its order and the owner's decisions are
  in the Phase 04 note. Built: taking payment (cash USD / cash LBP / card,
  split tender, change), closing only when paid, payments on the receipt; VAT;
  splitting a bill; the branch cash drawer; End of Day fed by it; loyalty
  points credited at the till; managers' discounts; and a counter device that
  keeps trading through an outage.
  - **Offline is one device and one screen (slice 7), owner's decisions 12 Sep
    2026: only the counter device**, so there is one queue per branch and never
    two phones disagreeing about a table; **orders taken offline are recorded
    as already made**, never fired at the kitchen, because during an outage the
    kitchen cooked them from a spoken order; and **closing waits for the
    connection**, so a receipt number is still only ever issued by the server
    and block reservation is not needed.
  - **`/pos/counter` is a single screen on purpose.** Tables, the check, the
    menu and the money, with no navigation anywhere: App Router navigation to
    `/pos/check/[id]` asks the server for a page, so every other POS screen is
    a spinner during an outage. It is a client page with no dynamic segment, so
    it prerenders and the service worker can keep it.
  - **The offline path is only used when it has to be.** With a connection and
    nothing already queued for that table, the counter takes the ordinary route
    — `addLines()` then `sendCheck()` — so the kitchen gets its ticket exactly
    as from a waiter's phone. A call that gets NO answer falls into the queue
    carrying the same key it was sent with, so it is neither lost nor applied
    twice. Anything queued for a check keeps everything after it queued too:
    going around would put a payment on the server before the items it paid for.
  - **The outbox is two files, and the split is the point.**
    `pos/app/lib/outbox.ts` is pure — queue, replay, what a refusal does — with
    no browser in it, and `npm run verify:offline` asserts it (28 cases,
    including that a dropped connection resumes where it stopped and that a
    refusal stops the queue rather than pressing on). `pos/app/lib/useOutbox.ts`
    is the plumbing: localStorage, the routes, when to retry. Logic that drifts
    into the second file is logic nothing tests.
  - **The counter's money decisions are a pure module too** —
    `pos/app/lib/counterTotals.ts`, asserted by `npm run verify:counter`. It
    was written after two money bugs in a row got through tsc, three builds,
    five verifiers and a look in a browser. Both were the same shape: the
    arithmetic in `payments.ts` was right, and the wrong FIGURE was handed to
    it from code inline in a React component, where nothing can assert on
    anything. The first counted DRAFT lines — tapped, never sent — in the total
    it took payment against; a card worked out that way is refused on arrival
    and a refusal stops the whole queue, while cash quietly handed back change
    against a short bill. The second priced queued lines from the menu, which
    on that device is a cache that can be cold after a mid-outage reload, so a
    missing item priced at 0 and the bill came out short. Now a queued batch
    carries what it came to, an unpriceable line makes the total `unknown`
    rather than cheap, and `takeBlocked()` refuses the payment with a reason a
    person can act on. `checkDue()` does not take the drafts as a parameter at
    all — the bug cannot be reintroduced without changing its signature.
  - **A refusal stops the queue and names itself**, because what follows it is
    usually for the same table. A person chooses: try again, or drop it —
    dropping a refused *open* drops everything for that check, dropping a
    refused payment drops only the payment, since the items are still real.
  - **The change is worked out twice, and the difference is told.** A device
    that was offline may not have had the check's rate, so the payment carries
    the change the counter actually handed over; if the server makes it
    different, the money has already gone and the screen says the drawer will
    be short by that much (`changeDiffers()`).
  - **The service worker is hand-written** — `pos/public/pos/sw.js`, scope
    `/pos/`, which its location is what buys. HTML network-first (a till
    showing a stale page is the failure this prevents, not causes),
    `/_next/static` cache-first, and **nothing from `/api/` ever cached**: a
    stale answer about money reads exactly like a fresh one. Next's own PWA
    guide suggests Serwist for offline, which needs webpack; this builds with
    Turbopack. Bump `VERSION` when changing it — and the no-store header on
    `/pos/sw.js` in `next.config.ts` is load-bearing, because a device that
    caches the worker keeps serving old code from it forever.
  - **`useAdminUser()` reads the staff record with a one-shot `getDoc`, and
    that can reject** — offline with the document not cached. Nothing caught
    it, so `loading` stayed true and every guarded page rendered nothing,
    forever, with no error anywhere. It is caught now, and treated as "no role
    known", never as "not provisioned", which signs the user out. The counter
    screen does not use that gate at all: it checks only that somebody is
    signed in, because every route it calls is behind `requireSection('pos')`
    on the server, which is where access has always actually been decided.
  - **Discounts (slice 6), owner's decisions 12 Sep 2026: managers and
    admins only, from their own phone** — the signed-in session IS the
    approval; no PIN. Four kinds: an item comped (`line.discount`, kind
    `comp`) or given % off (`percent`); % or a dollar amount off the whole
    check (`check.discount`). Each carries a reason from `DISCOUNT_REASONS`
    and who gave it, and is logged. Refused once any payment is on the check.
  - **The stacking order is the arithmetic, in `lineTotal()` /
    `checkTotals()`:** staff-meal rate first, then the item discount on what
    is left, then the whole-check discount on the subtotal, capped so a check
    never goes below zero. `checkTotals()` keeps `gross`, `discount` (STILL the
    staff meal — the v1 name) and `net`, and adds `itemDiscounts`, `subtotal`
    and `checkDiscount`. Everything reads `net`, so payments, the drawer, VAT
    and loyalty points follow without knowing discounts exist. Seat shares
    spread a whole-check discount by largest remainder so they still sum to
    `net`.
  - **Loyalty at payment (slice 5), owner's decisions 12 Sep 2026: a QR in
    the customer's app, and points land straight away.** The code is random
    (`shared/src/memberCode.ts`), never the uid, and lives only server-side in
    `memberCodes/{code}` + `memberCodeOwners/{uid}` — no Firestore rule, so no
    browser reads or writes it; NOT a field on `users/{uid}`, which the owner
    may edit. The till scans it (the browser's BarcodeDetector) or types it;
    `setLoyaltyCustomer()` puts the customer on the open check; `closeCheck()`
    credits `pointsForCheck(net, staffMeal)` INSIDE the close transaction as an
    approved `check` transaction with `source: 'pos'`; a refund takes back
    exactly `loyaltyPoints` and marks that transaction `reversed`. All gated by
    the `loyalty` feature. The POS allows `camera=(self)` for the scanner;
    `qrcode` draws the code on the customer site. The receipt-photo queue
    stays until every branch is on the POS.
  - **Test fixtures avoid the café's configured literals** (10% VAT and a
    91,000 rate in the verifiers): `audit:branding` flags them anywhere in
    code, fixtures included, and that is the rule working — not noise.
  - **End of Day's "system" figure comes from the day's drawers** when
    `payments` is on (`daySystem()` / `daySystemFor()`): the sum of each
    shift's expected cash, in LBP at the business rate. Owner's answers
    (12 Sep 2026): the old till's figure was CASH sales only, and the count is
    made with the float in the drawer — so card is left out and the float is
    kept in. A shift belongs to the cash-up day it was OPENED on
    (`cashUpDay`, stored on the shift). The form derives the figure from the
    server's answer rather than copying it into the field, and is read-only
    while payment is on.
  - **The cash handling is USD + LBP by construction, whatever `BRAND.locale`
    says.** `LBP_DENOMS` and `USD_DENOMS` are literal constants in
    `shared/src/drawer.ts`, shared by this drawer and End of Day; stored
    reports persist `totalCashLbp`/`totalCashUsd`; change is whole dollars with
    the remainder in lira. `secondaryCurrency` renames a currency, it does not
    change one. So **do not make End of Day's "Lebanese Pound (LBP)" label
    read from config on its own** — it looks like the tips-deduction bug and is
    the opposite: a configurable label over hardwired lira notes is a screen
    that lies. Currency-generic cash is per-tenant denominations plus new
    stored fields, which is a data-model change and belongs with
    multi-tenancy (13 Sep 2026).
  - **One drawer per branch, one open shift at a time** (owner's decision:
    staff use their own phones, and a phone is not a drawer). `shared/src/drawer.ts`
    is the arithmetic — float + cash in − change − cash refunds, compared with
    the count PER CURRENCY and never netted at a rate. `shared/src/server/drawer.ts`
    owns open/X/Z; a server-only pointer `branchDrawers/{branch}` names the open
    shift and is checked inside the transaction that sets it.
  - **With `payments` on, a payment needs an open shift** and records
    `shiftId`; its check lists it in `shiftIds`. A refund that gives cash back
    needs one too and records `refundShiftId`. The Z close marks the shift
    `closing` and clears the pointer BEFORE adding up, so no payment can land
    in a shift while it is being counted.
  - **The `drawerShifts` rule is deployed** — 12 Sep 2026; the CLI reported
    "released rules firestore.rules". If the Drawer screen cannot read the
    open shift, check the live ruleset before the code.
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
  - **Receipt numbers still cannot collide, and slice 7 kept it that way.**
    `closeCheck()` issues them on the server at close, and closing waits for
    the connection (owner's decision), so the block-reserved ranges the plan
    called for were never needed and 7d was dropped. A payment CAN now be
    taken offline — it waits in the counter device's outbox — but a receipt
    number cannot be issued there.

- **What this product is (owner's decision, 13 Sep 2026): a pure coffee and
  restaurant POS.** Nothing in the defaults may assume gaming. BIG CMS was
  forked from a board-game café, and that café kept surfacing in places no
  grep for "D&D" reached: a D20 on the 404, "players" on every event, board-game
  genres as the fallback product categories, and three *required* product
  fields — Players, Duration, Min Age — so a café could not save a mug without
  inventing a player count. All removed: events have "participants", the
  product model has no players/duration/age (older documents may still carry
  them; nothing reads or writes them). **Anything a particular client needs
  that is not generic café/restaurant belongs in that client's configuration,
  not in the defaults** — and per-client custom product attributes do not
  exist yet, so a client who sells something with real attributes of its own
  is a feature request, not a reason to put fields back.
- **05 (make it a product):** branding, the feature-flag registry and now the
  three-app split have landed. A client on the POS tier receives no admin code
  at all, and `pos`/`kds` are feature flags like everything else.
  Multi-tenancy and billing are untouched.

The claims-based rules rewrite from the 00 gate is **done and deployed**, so
this repo has no open P0. The one the audit still lists — the mobile app's
admin screens have no role gates — is in the Onboard App, which is a different
project. Same note as 02 above: not this repo's work, and not this repo's
next task.
