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
is the only thing that shows it. Currently 27 checks, 21 verifiers, 1794
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
npm run verify:recipes       # if you touched a recipe, a unit conversion or what a sale takes off the shelf
npm run verify:food-safety   # if you touched a food safety limit, a reading, or who may sign a day
npm run verify:admin-nav     # if you added, moved or renamed an admin page
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

## Recipes & ingredient stock (Sep 2026)

Scoped in the vault (`Recipes and Ingredient Stock - Scope.md`), with the
owner's decisions of 14 Sep 2026. Built: the arithmetic, admin costing at
`/admin/menu/recipes`, ingredients leaving stock on Send behind the `recipes`
switch (off), expected-vs-counted on the count history, and theoretical food
cost on the Food Cost Report. None of the till side has run against the
database.

- **Theoretical food cost divides only what it can cost.** Recipe cost of the
  closed checks' menu lines ÷ those lines' share of the bill before VAT, each
  check at its own `vatRate` (owner's choice, 14 Sep 2026: the POS checks' own
  sales, not the end-of-day till figure). A line with no recipe snapshot, or
  one with an uncosted ingredient, is left out of BOTH sides and lowers
  `coverage` instead — dividing a partial cost by all of sales prints a
  flattering percentage for every recipe nobody wrote. `theoreticalFoodCost()`
  in `recipes.ts`; the server read is `shared/src/server/foodCost.ts`, reusing
  the export's padded `closedAt` window, because checks are unreadable to the
  report's audience in the browser.
- **Waste is read from stamps, not recomputed.** `voidLine()` puts
  `voidWasteUsd` on a line and `refundCheck()` puts `refundWasteUsd` on the
  check, only when the reason made the ingredients waste. So a number means
  wasted at that cost, `null` means wasted but uncosted, and an absent field means
  nothing was wasted. `wasteSummary()` adds them up by reason under the
  theoretical row, as a share of the same POS sales. Uncosted waste is counted
  apart, never as $0. A refund is filed under the day its check closed,
  because the report has one window. Checks that were refunded or cancelled
  count for waste but not sales.

- **A count stores what was expected.** `saveCount()` reads each supply inside
  a transaction and stores the full line from the supply document — name,
  unit, `previousQty` (what the branch held when it was saved: the expected
  figure) and `unitCostUsd` — before overwriting the stock. It used to store
  only the browser's `{ supplyId, countedQty }` and replace the document, so
  the history showed blank names and a difference of NaN; confirmed against the
  demo project on 14 Sep 2026. Counts from before then lack those fields, which
  is why they are optional on `InventoryLine` — read them with a fallback.

- **What a serving takes is snapshotted onto the line when it is added**
  (`consumesPerServing`, in `buildLines()`), only while the switch is on — off,
  there are no extra reads and no new fields. Per serving, not per line: the
  quantity multiplies it wherever stock moves, so the snapshot cannot go stale
  if a quantity ever becomes editable. Firestore refuses `undefined`, so the
  fields are set only when there is something to record.
- **Send and offline-made orders take one move per supply for the batch**
  (`sendMoves()`). Supplies are read inside the transaction before the first
  write, and one that no longer exists is **skipped, never allowed to fail the
  Send**. A branch not in `STOCKED_BRANCHES` moves none. Stock may go negative.
- **Voids and refunds apply `reversalPlan()`**, never an inline decision.
  **Refunds take a reason from `VOID_REASONS`** now, and merchandise follows it
  too — they used to put every product back whatever had happened to it.
- **Deleting a supply is refused while a recipe uses it**; recipes store
  `supplyIds` so that is one array-contains query.

- **The arithmetic is `shared/src/recipes.ts`, pure, asserted by `npm run
  verify:recipes`** (127 cases, 31 mutations caught by name). The page and the
  server only apply what it computed.
- **Suggested prices come from a target margin, split food / drinks.**
  `targetMarginFood` (default 70%) and `targetMarginDrink` (default 80%) live in
  Business Settings. They're the usual rule-of-thumb food cost of about 30% and
  about 20% on coffee and soft drinks. Drink or food is decided by station, Bar
  versus Kitchen/Sweets, the same split as the staff discount
  (`targetMarginFor()`); an unmapped station gets no suggestion.
  `suggestedPrice()` divides the cost by (1 − margin) **before VAT**, adds VAT,
  and rounds **up** to $0.25, so rounding can only add margin. A dish priced at
  its suggestion shows at least the target on the Recipes page. It's flagged
  as below target only when the price is under the unrounded figure. Shown on the
  Recipes page, beside each price on `/admin/menu`, and under the price field
  with a "Use it" button — **admins only**, through `useSuggestedPrices`,
  because a suggested price at a known margin gives the cost away. Nothing is
  ever charged from it. The item form's price step was 0.5, which made the
  browser refuse to save $3.75 or $4.25 — prices already on the menu; it is
  0.01 now.
- **`npm run seed:recipes` gives the demo something to cost.** Recipes for 15
  of the 16 dishes, the unit conversions they need, and the per-serving
  snapshots on the SEEDED checks only, all through `recipeProblems()` and
  `lineConsumption()` transpiled and called. The Club Sandwich has no recipe
  on purpose, since there is no bread in supplies, so the report's coverage
  warning has something real to show. It fills only conversions that are
  missing and never touches a recipe saved on the Recipes page. `--clear`
  removes exactly what it flagged. Applied to the demo project on 14 Sep 2026:
  23 conversions, 15 recipes, 963 lines snapshotted across 415 checks. It
  prints the figure the Food Cost Report should show for the whole seeded span:
  **16.3% theoretical on $7,177.48 of costed sales, 87.9% coverage**. A second
  dry run reproduced it from the stored documents. The report page itself has
  not been looked at signed in.
- **Recipes never live on `menuItems` or `modifierGroups`.** Both are
  world-readable so the menu works signed out, and a recipe there publishes
  every margin. They live in `recipes/{menuItemId}`, which has **no Firestore
  rule** — server-only, behind `/api/admin/recipes`. Admin only, reading as
  well as writing: dish cost is margin.
- **Stock stays counted in the purchase unit** (`supply.unit`), because
  receiving and the daily count use it. Recipes measure in `recipeUnit`, with
  `recipeUnitsPerPurchaseUnit` between them. **A missing or nonsensical factor
  is unknown, never 1** — guessing is a silent 1,000× error. Unit spellings
  meet in `normalizeUnit()`: the inventory form says "L", the order template
  "liter". The inventory form sends all three recipe fields on every save,
  because the route replaces the whole item and omitting them would wipe a
  conversion.
- **Trim is `yieldPercent` on the supply**, set once; the purchase quantity is
  divided by it.
- **Modifiers add or replace (owner's decision). Additions apply first, then
  replacements over everything.** A replacement is a choice about an
  ingredient, so it covers every portion: an extra shot in a decaf is decaf.
  The reverse order passed every test until a mutation survived — no test had
  combined an addition with a replacement of the same ingredient.
- **A cost that cannot be known reads "cost unknown" and names the
  ingredient**, never $0.00: a never-received supply has no average cost.
  Margin is on the price **before** VAT.
- **Voids and refunds follow their cause** (owner's decision): never sent
  takes nothing; not made goes back; already made is waste. A reason claiming
  both is waste, so stock is never invented (`ingredientOutcome()`).
- **The `recipes` feature switch governs depletion only**, off by default.
  Entering recipes and costing dishes never depends on it.

## Food safety (Sep 2026)

Scoped in the vault (`Food Safety - Scope.md`) from a full read of the FSA's
*Safer Food, Better Business for caterers* (UK, 2015 edition, Open Government
Licence — structure and numbers used, wording our own, no logos or photos) and
from research into Lebanese requirements. Built: the diary and allergens.
Not yet: safe method cards, training and cleaning records, the 4-weekly
review, recall. Behind the `foodSafety` module, **off by default**.

- **Allergens come from ingredients, through recipes** (owner's decision,
  14 Sep 2026), in `shared/src/allergens.ts`. A supply's `allergens` is
  `null` (nobody checked) or a list, where `[]` is "checked, contains none". The
  supplies form sends it on every save, and a request without it reads as
  **not checked, never none**. **A dish is verified only when its recipe
  exists, every ingredient is checked, AND an admin has ticked that the recipe
  lists every ingredient**, oils, sauces and garnishes included. The demo's
  recipes list only mains, which is exactly how a dish reads allergen-free while
  its dressing carries mustard. Unverified shows "at least these", in red. Any
  change to the ingredients clears the tick. The tick is stored with who gave it
  (`recipes/{id}.allergensConfirmed`). `extraAllergens` covers things not in
  supplies. **The tracked-allergen setting picks the chart's columns but never
  hides an allergen**: an untracked one goes in `others`. The staff chart at
  `/admin/food-safety/allergens` is for the floor, built on the server from
  recipes and sent **without quantities or costs**, because recipes are
  admin-only.
- **The till has it too**, behind `pos` and the module switch
  (`/api/pos/allergens`): an Allergens button on the floor opens
  `/pos/allergens`, and a per-device toggle on the order screen puts chips on
  every menu tile. **Options do not add up.** Oat milk takes milk out, extra
  cream adds nothing on its own, and together the drink still has milk in it.
  So the options sheet asks the server about the WHOLE choice
  (`readDishAllergens()`, only the supplies it uses) and never combines the
  chart's per-option lines. How an answer is said is `staffAnswer()`: an
  unverified dish that lists nothing is never "none". For a customer's one
  allergy, `allergenVerdict()` gives free / can't be sure / contains, and
  "free" needs a verified dish.
- **Only an admin sets an ingredient's allergens or accepts a change**
  (owner's decision, 14 Sep 2026). The supplies section is open to baristas and
  kitchen crew, and until then any of them could untick Milk on Whole Milk and
  turn every milk dish into verified, no milk. Now anyone else's save is stored
  as `supplies/{id}.allergensProposed`, a request, and never moves
  `allergens` (`supplyAllergenWrite()`). **While a request waits, every dish
  using the ingredient is not verified**, showing what the request would add
  and taking nothing away. An admin saving the requested list accepts it. An
  admin saving anything else leaves the request waiting, so fixing a unit never
  throws away a report that the bread now has sesame. Accept and reject go
  through `PATCH action: 'allergens'` with the request the admin saw
  (`expected`); a request changed since is refused. Every allergen change is
  logged with before and after, under "Allergens". A malformed stored request
  reads as waiting, never as nothing.
- **An option with no recipe change is not verified** unless an admin ticked
  "Adds no ingredient" on the Recipes page (`recipes/{id}.noChangeOptions`).
  Without this, "Hazelnut syrup" added to the menu after the recipe was
  confirmed read as changing nothing, and the latte stayed verified nut-free.
- **An unsigned day keeps its corrections** as `edits`: each entry a save
  changes or removes, as it stood and with who entered it (`changedEntries()`).
  Additions are not recorded, since a day is saved many times. Only signed days
  used to keep history, so a 9 °C breach could become 4 °C before signing with
  no trace. Entries are compared ignoring stamps AND field order
  (`sameEntry()`): Firestore does not promise to return a map's fields in the
  order written, and the old `JSON.stringify` comparison could re-stamp an
  untouched answer to whoever saved last. **Answers to a check removed from
  the list are kept** (`withRetiredAnswers()`), since the browser only sends
  today's checks.
- **The admin food safety route refuses everything with the module off**, like
  the POS route. An admin switches the module on before configuring it.
- **Deliveries record the temperature of chilled and frozen food** (the
  Lebanese MoPH checklist asks for it). Owner's decisions, 14 Sep 2026:
  **a chilled or frozen line is not received without a reading; one that
  arrived too warm is accepted only with what was done; "too warm" is the
  existing chilled keep limit and freezer limit** (8 °C and −18 °C, the
  checklist's own), not a new setting.
  - A supply's `storage` (ambient, chilled or frozen) decides whether a
    reading is asked for, so **only managers and admins set it**
    (`canSetStorage()`, refused 403 in `updateSupply()`/`createSupply()`, and
    logged under "Storage").
  - `postDelivery()` reads the storage from the supply, never from the
    browser, and judges inside the transaction with `deliveryTempProblem()`.
    It stamps `storage` and `tempStatus` on each line, so a delivery reads as
    it was judged. Only when the module is on, and only for what is taken in:
    a draft is never refused, and a line rejected in full needs no reading.
  - The rules are in `shared/src/foodSafety.ts`, asserted by
    `verify:food-safety`.

- **Every limit is a setting with a UK default, never a constant.** The pack's
  temperatures are UK law; the client is in Lebanon. `readLimits()` reads them
  fail-safe (out of bounds, text, or a contradictory pair → default); the
  settings route REFUSES a bad value rather than quietly saving the default, so
  nobody believes their local rule is in force when it is not. Lebanon, from a
  Ministry of Public Health inspection checklist (not a decree): fridge below
  8 °C, freezer below −18 °C, logged daily — both met by the defaults. Nothing
  Lebanese was found for hot holding, cooking, allergens or retention, and no
  number was guessed.
- **Readings are logged, which the pack does not ask for** (owner's decision,
  14 Sep 2026). `judgeReading()`: chilled at or below the set point is ok,
  above it a warning, above the keep limit a breach; limits are inclusive, as
  the pack writes them, judged to a tenth of a degree. A breach cannot be saved
  without what was done about it; a typo (800 °C) is not a reading at all.
- **Staff answer, a manager signs** (owner's decision). A check is DONE or NOT
  DONE WITH A NOTE — `signingBlockers()` accepts either. A diary that can only
  be signed by ticking everything is a diary that gets ticked.
- **The unit decides a reading's kind**, never the request: 5 °C sent as a
  "fridge" reading for a bain-marie is judged as hot holding.
- **Who may write which day is `dayAccess()`**: staff today and yesterday (a
  closing check after midnight belongs to the night before); a manager may fill
  an unsigned day up to a week back, and it then reads "signed late"; nobody
  writes tomorrow; **a signed day is amended with a reason, never edited** — the
  amendment keeps what the day said before.
- **A signed day keeps what it was judged against** (`atSigning`: limits,
  checklists, units), so a limit changed next month cannot re-judge it — the VAT
  rule again. History lists unsigned past days as MISSED, never just absent.
- Server-only collections `foodSafetyDays/{branch}_{date}` and
  `foodSafetyUnits`, behind `/api/admin/food-safety`; **no Firestore rule, so
  no rules deploy**. Sections `foodSafety` (floor) and `foodSafetyReview`
  (managers, admins); limits and the allergen list are admin-only in the route.
  Units are retired, never deleted. `npm run verify:food-safety`, 55 mutations
  caught by name.

## Admin navigation (Sep 2026)

**`shared/src/adminNav.ts` is the one list of admin pages**, and the sidebar
(`AdminShell.tsx`) and the dashboard (`admin/app/admin/page.tsx`) both read
it. They used to be declared separately with a comment asking whoever added a
page to update both. Nobody did: by September each had pages the other lacked,
and four pages were in neither.

- **Adding an admin page means adding it to `ADMIN_NAV`**, or to `NOT_IN_NAV`
  with a reason. `npm run verify:admin-nav` fails otherwise, and also when an
  entry points at a page that does not exist.
- **Every section has a `purpose`** (what it is for, for somebody new), and
  every item a `desc` and a `kind`: `'use'` for daily work, `'setup'` for
  configuration done once. The sidebar and dashboard show setup pages under
  their own "Setup" heading. **Every admin page opens with a guide strip**
  giving its section, what the section is for, what the page does, and links to
  that section's setup pages (`sectionForPath()`, longest match). It can be
  hidden, and the choice is remembered per browser.
- `access` must be `SECTION_ACCESS.xxx` itself, so the module switch hides the
  item. adminNav imports it from `roles.ts`, not `adminAuth.ts` (the same
  object), so the verifier can load the file without a browser.
- Tints use `color-mix(in srgb, <colour> N%, transparent)`. The old dashboard
  appended hex alpha to colours like `var(--teal)`, which produces an invalid
  colour, so the browser silently dropped the tint.

## POS look and feel (Sep 2026)

Owner's request, 14 Sep 2026: bigger, easier to tell apart and to press,
desktop / touch screen first. Shared controls are in `pos/app/lib/posUi.tsx`
(`PosButton`, `Chip`, `StatusBadge`, `SectionLabel`). **Build new POS screens
from them, not from a fresh `tap` constant.**

- **A colour has one meaning.** Teal is the main action on the screen and
  nothing else loud. Red destroys or ends something. Amber needs attention
  (not sent yet, waiting). A hue from `KIND_COLOURS` says what kind of thing it
  is (a menu category, a station). Every action has an icon as well as a word,
  so nothing is told apart by colour alone. Disabled is grey and dashed, not a
  paler teal.
- **Touch heights:** 44px small, 56px default, 68px for the main action.
- **The order screen on a wide screen keeps the menu open beside the check.**
  Below 900px it is the old sheet. Unsent lines have their own amber section.
  Send is the widest button in the bar. Void reasons that waste food are red
  with a bin icon.
- **The floor has a square Readings button.** Each device picks what to show
  (remembered in localStorage): closed today (the main one), open tables total,
  tables open, average bill, refunds today. The adding-up is
  `pos/app/lib/floorReadings.ts`, asserted in `verify:counter`, in cents, with
  refunds kept apart from sales and "today" as the café's day.
  **Closed today reads `useChecksClosedSince()`, bounded by time, not
  `useClosedChecks()`**. That one is capped at 50 for the review screen and
  would undercount a busy day; the time-bounded query has a 2,000 ceiling and
  says so on screen when it is hit.
- **Every POS screen is on it now.**
  - **KDS:** a ticket's status is its header, tinted with an icon (new, preparing,
    ready), because a new ticket and a started one looked identical from across
    the kitchen. How long it has waited is the border and the timer. Back moved
    to the top of the card, away from Start/Ready/Bump, which it sat 1px from.
  - **Counter:** on a wide screen the check and money are on the left and the
    menu is on the right. The connection is a large badge. "Try again" and
    "Drop it" are different buttons at opposite ends.
  - **Closed checks:** Receipt and Refund sit at opposite ends of an opened row,
    and the refund panel puts Cancel on the left like every other confirmation.
  - **Drawer:** "Close shift" is an outline and only the final "Close with this
    count" is solid red. A difference has an icon as well as a colour.
- The counter's links to the floor and to the full check use a plain
  `window.location` load, not the router, so that screen never waits on a
  server-rendered page during an outage.
- **The floor's other screens are big boxes down the right** (owner's request,
  14 Sep 2026): Counter, Closed, Kitchen display, then Drawer and Allergens
  when those are on. On a phone they are a grid under the title. Each has its
  own hue, never teal (`NavTile` in `pos/app/pos/page.tsx`).
- **The order screen takes no seats or courses, and the menu is screens**
  (owner's request, 14 Sep 2026). The first screen is the categories as big
  picture tiles, plus Retail; tapping one opens its items as picture tiles,
  with a Categories button back (`MenuPicker`, `CategoryTile`, `ItemTile` in
  `pos/app/pos/check/[id]/page.tsx`). New lines carry `seat: null, course:
  null`. Older checks that have a seat still show it on the line.
- **Menu items have a picture** (`menuItems/{id}.image`), set on the admin Menu
  page by upload (through `uploadImage()`) or from the media library. An update
  that does not send `image` leaves the stored one alone, and `''` removes it.
  An item with no picture shows its first letter. `npm run seed:menu-images`
  puts a photo on each demo dish that has none, marks it `imageSeeded`, and
  `--clear` takes off only those. The photos are in
  `scripts/menu-item-photos.mjs`; each was looked at, not just loaded.
- **Splitting a bill is between any number of people, evenly or by item**
  (owner's request, 14 Sep 2026). By item, the waiter taps who had each line.
  A line nobody is tapped for is shared by everyone, and a line tapped for
  several is divided between them. `sharesByPerson()` in `shared/src/splits.ts`
  (verify:payments) builds every share from the line totals, so the people
  always sum to the bill, discounts included. "By seat" went with the seats.
  As before, a share only fills the amount; the waiter still takes it.

## Ready to go out (Sep 2026)

Owner's decisions, 14 Sep 2026: **when the kitchen marks a ticket Ready, it
pops up on the counter and the floor, and the front taps "Picked up"**, which
clears it from the kitchen display too. The kitchen no longer bumps.

- `ReadyPanel` (`pos/app/lib/ReadyPanel.tsx`) is a sticky green panel. There is
  one card per ready ticket, longest waiting first, with a chime when a plate
  turns ready while the screen is open. The chime is per device and can be
  switched off. It is mounted only when the `kds` feature is on. The listener
  is `useReadyTickets()`, and the existing (branch, status, sentAt) index
  serves it.
- **The arithmetic is `pos/app/lib/pickups.ts`, asserted in `verify:counter`.**
  The wait counts from `readyAt`, which `advanceTicket()` now stamps, not from
  when the order was sent. A voided line is not food to carry. Plates already
  waiting when a screen opens do not ring, or every reload would ring.
- **Picking up is `PATCH /api/pos/tickets { action: 'pickup' }`, gated on
  `pos`, not `kds`,** and `pickupOutcome()` lets it take only a READY ticket.
  A late tap on one the kitchen sent back to preparing is refused, so the front
  cannot clear food still cooking. Already picked up is an answer, not an error.
  It sets `pickedUp: true` beside the usual `bumpedAt`/`bumpedBy`.
- The KDS card for a ready ticket says "Waiting for the front", with a small
  Clear as a fallback so a pass is never stuck behind an unwatched screen.

## POS software: the Windows counter app (Sep 2026)

Owner's decisions, 14 Sep 2026: **one product, two modes, chosen per client**.
Online is today's browsers. Software is the POS installed on the café's Windows
counter PC, which becomes a local hub that phones (a small Android app) and
the kitchen screen reach over the café wifi. Everything keeps working with no
internet, receipt numbers included, and staff sign in with their own phone's
face or fingerprint unlock, only while connected to the hub, with a manager
approving when that fails. The plan, stages and decisions are in the vault
(`POS Software (Local Hub) - Scope.md`). **Not React Native**: the phone app
wraps the same React screens.

- **Stage 1 is `desktop/`**: an Electron app that opens the hosted POS full
  screen. It starts with Windows, keeps the display awake, runs once per PC,
  reloads after a crash, and shows its own retrying screen with no connection.
  `npm run desktop` runs it, `npm --prefix desktop run smoke` loads the POS and
  exits, and `npm --prefix desktop run dist` builds the installer.
- **It is outside the npm workspaces on purpose**, with its own
  `node_modules` (gitignored). Electron's download must never reach a Hostinger
  build of web, admin or pos.
- **It holds no secrets, and the hub never will hold the Firebase Admin key.**
  That key bypasses every rule. The stage 3 hub gets its own revocable device
  credential and syncs through cloud routes.
- **Every decision about addresses and permissions is `desktop/policy.js`**,
  asserted by `npm run verify:desktop`:
  - https only, or http on localhost for development
  - never navigates off the POS origin; other links open in the real browser
  - grants only the camera (loyalty QR) and full screen, to the POS
  - a typo in `config.json` falls back to the default rather than switching
    kiosk off or re-pointing the till
- Electron 44 downloads its binary on first run, not at `npm install`, verified
  against the bundled `checksums.json`.
- **electron-builder walks up to the repo root and bundles ITS packages.** It
  found the workspace lock file and put all of web/admin/pos's node_modules
  into the app: a 370 MB `app.asar` with Firebase, firebase-admin and the rest.
  No secrets went in, but it shipped the whole platform's code. `files` ends in
  `!**/node_modules/**` and `npmRebuild` is false, because the app has no runtime
  dependencies. The asar is 13 KB and holds exactly main.js, policy.js,
  offline.html and package.json. **After changing the build config, list the
  asar** (`npx @electron/asar list dist/win-unpacked/resources/app.asar`) before
  shipping an installer.
- **A smoke run reports its first outcome only.** A failed load is followed by
  Chromium's error page finishing, and reporting both turned "could not load
  the POS" into exit 0.
- **Online till or café hub is chosen on the PC** (owner's decisions S29–S30,
  15 Sep 2026). One installer. A PC whose `config.json` names no mode
  (`modeChosen` false in `readConfig()`) opens `desktop/setup.html` instead of
  guessing: "Online till" or "Café hub". Café hub starts the hub and, while it
  is not paired, opens `/pos/hub` for the admin's pairing code, so only that code
  makes a PC a working hub. **Ctrl+Shift+Alt+M** reopens the screen for a
  manager.
  - **The bridge is narrow.** `preload.js` exposes `counterSetup` only to the
    app's own `setup.html` (a `file:` page), and every `ipcMain` handler checks
    the sender again with `isSetupPage()`: a POS page, which comes from the
    network, can never switch the PC. `configWithMode()` writes the mode and keeps
    every other setting; the app then starts again in that mode.
  - **Leaving hub mode waits (S30).** The app asks the hub `GET /api/hub/leave`
    (counter PC only; `readyToLeaveHub()` with the pure `leaveHubReasons()`):
    refused, with the reasons on screen, while any change is unsent (walked to
    the end of the change log), any check is open, or any drawer shift is open.
    Ready, it stops the hub and renames `pos.db` (and `-wal`, `-shm`) to
    `pos.db.hub-backup-YYYYMMDD-HHMMSS` beside it before starting online.
  - `npm --prefix desktop run smoke:setup` loads the setup screen hidden, with
    `BIG_CMS_USER_DATA` pointing at a folder of its own, and reports whether the
    bridge reached it. Run 15 Sep 2026: the bridge reached the page, not chosen,
    and no settings file was written; the ordinary smoke still loaded the live
    POS.
  - 13 mutations, all caught by name. "Only the first batch of unsent changes is
    counted" first survived: nothing put more than a batch of changes with
    nothing to send in front of an unsent check.
  - **Not run:** the switch itself on a real hub, and the backup rename.
- **The counter app updates itself** (owner's decisions S26–S27, 15 Sep 2026):
  new versions from our own site, installed only when nobody is using the PC.
  The rules are `desktop/update.js` (no Electron, asserted by
  `verify:desktop`); releasing one is
  [docs/desktop-updates.md](./docs/desktop-updates.md).
  - **Where from (S26):** `updatesUrl`, by default
    `https://pos.cms-projectlb.com/api/desktop-updates/`. The POS route serves
    `latest.json` and `BIG-CMS-POS-Setup-x.y.z.exe` from `DESKTOP_UPDATES_DIR`,
    a folder on the server outside the app (rebuilt on every deploy), and
    nothing else. Not GitHub: the repository is private, and a token in every
    counter PC could be copied from any of them.
  - **Trust:** https is not enough, because the installer runs on every till.
    The manifest must be signed by the Ed25519 release key; the app pins its
    public half (`UPDATE_PUBLIC_KEY`). The installer's name is bound to its
    version, and it must match the manifest's size and SHA-512 when downloaded
    and again before it runs. An oversized or mismatched download is removed,
    never kept. **The private key is `%USERPROFILE%\.big-cms\desktop-update-key.pem`
    on the machine that made it, outside the repo and never printed**;
    `scripts/release-desktop.mjs --make-key` refuses to replace it, since a new
    key means reinstalling every counter PC by hand.
  - **When (S27):** checked two minutes after start and every six hours. A
    checked download installs at the next start, or between 05:00 and 10:00 on
    the PC's own clock with the PC idle ten minutes (`powerMonitor`) and, on a
    hub, `GET /api/hub/quiet` answering 0 live sessions (`liveHubSessions()`,
    localhost only). A hub that does not answer counts as busy. The installer
    runs silently (`/S --force-run`) and starts the app again. One started
    twice without the version changing is not started again, so a broken
    installer cannot restart a till in a loop. Never a downgrade.
  - Only the installed app updates itself, and `"autoUpdate": false` in
    `config.json` switches it off. `update.js` is in the asar's `files`.
  - **Not run end to end:** no installer has been built, signed, served and
    installed over an installed app. The download, checks and waiting installer
    run against a real local http server in `verify:desktop` (29 more
    assertions; one more in `verify:hub-sync` for the live-session count).
    23 mutations, all caught by name. "A kept installer is reused without
    checking it" first survived: nothing changed the kept file on disk between
    two checks.
  - **Checked over HTTP, 15 Sep 2026**, on the built POS. In cloud mode with
    `DESKTOP_UPDATES_DIR` set: `latest.json` 200 `no-store`, the installer 200
    `immutable`, and another file in the folder, a `../` path and a version not
    there all 404. On the test hub: `/api/hub/quiet` answered the counter PC
    `{ live: 3 }` (sessions until 05:00 from earlier tests) and a wifi Host 403,
    and the updates route 404s there. The unpackaged app's smoke run still
    loaded the live POS with the updater wired in.
- **Stage 2 is the backend seam, `pos/app/lib/backend/`.** Nothing in the till
  talks to Firestore or the routes directly any more.
  - A screen's live read is a `PosQuery`: the open checks at a branch, one
    check, a station's tickets, the menu, the open shift and so on.
    `planQuery()` turns it into a plain plan.
  - The cloud backend (`cloud.ts`) runs a plan as the same Firestore listener
    as before. The stage 3 hub will run the same plan over its local copy with
    `runPlan()`, so the two cannot mean different things by one query.
  - Every write is `backend().request()`, today's routes.
  - `verify:backend` asserts that every query the till can make is scoped
    (branch, one document, or a small collection by design), and that
    `runPlan()` matches Firestore: branch, statuses, order, limit, ties by
    id, and a document missing the ordered field left out.
  - **New till code reads through `backend()`, never `firebase/firestore` or
    `authedFetch`.** Only `backend/cloud.ts` and the login page import Firebase.
  - **The till's settings go through it too.** `pos/app/lib/useTillSettings.ts`
    has the till's own `useFeature`, `useFeatureFlags`, `useBusinessSettings`
    and `usePrintingSettings`. They have the same names and answers as the
    shared hooks, which admin and web keep, and they fail the same way:
    features open, business and printing on defaults. They read the settings
    documents as `{ kind: 'settings' }` plans. **POS pages import these, not
    `@big-cms/shared/use*`.** `parseFlags` moved to `features.ts`, and
    `useFeatures.ts` re-exports it.
  - **Not rerouted, on purpose:** the staff check, `useRequireRole` in
    `adminAuth`. It reads the signed-in user's token and staff record, which
    is sign-in, so it moves with the phone sign-in in stage 5.
- **Stage 3 starts with the hub's database, `shared/src/server/hubStore.ts`.**
  On a hub, `BIG_CMS_HUB_DB` names a SQLite file and `adminDb()` returns a
  store with Firestore's shape. So `checks.ts`, `tickets.ts` and `drawer.ts`
  run there **unchanged**; there is no second copy of the rules about money.
  - It covers the part of the Admin SDK those files use: `doc`,
    `collection`, `where`/`orderBy`/`limit`, `getAll`, `runTransaction`,
    `set`/`update`/`create`/`delete`, `batch` and the `FieldValue` sentinels.
    It runs on `node:sqlite`, which is built into Electron's Node 24, so
    there is nothing to install. Anything else (listeners, counts, cursors)
    is a TypeError, never a wrong answer.
  - **Transactions retry as Firestore's do.** A read records the version it
    saw and a query records what it returned. At commit both are checked
    again, and if either moved the callback runs again, up to five times.
    **The query is re-run, not just its documents re-checked**: two waiters
    opening one table both find no open check, and only the re-run finds
    the one the other just made. Commit is synchronous, so nothing lands
    between the check and the write.
  - **It refuses what Firestore refuses**, so code that passes on the hub
    cannot fail in the cloud:
    - a read after a write
    - `undefined`
    - a sentinel or an array inside an array
    - `update()` on a missing document (code 5)
    - `create()` on an existing one (code 6, what `idempotency.ts` checks)
  - Values are stored with the backup codec's tags, so Timestamps come back
    as Timestamps and a hub row is a backup line.
  - **The sentinels' operands are read from fields the SDK does not
    document** (`operand`, `elements`). `verify:hub` pins them: a firebase-admin
    upgrade that renames them fails there, not at a till.
  - **`adminAuth()` refuses on a hub.** A hub route's caller is a hub session,
    never a Firebase token sent straight to it (`getCaller()`).
  - **Signing in on a hub, until phone sign-in** (owner's decision, 14 Sep
    2026: "today's sign in for now but it should last until they check out
    at night").
    - The login page signs in with Firebase as always, then swaps the ID
      token at `POST /api/hub/session` for a hub session. The hub checks that
      token ONCE, with Google's public keys (`hubTokenVerifier()`, a project
      id and no credential), so there is no Admin key on the PC. That step
      needs the internet; the rest of the night does not.
    - **A session lasts until 05:00 café time**, the first one at least four
      hours away (`hubSessionExpiry()` in `shared/src/hubSession.ts`). Someone
      signing in at 03:00 to close is not put out at 05:00. The POS has no
      check-out yet, so that or `DELETE /api/hub/session` ends it.
    - Only a token with `staff: true` and a role starts one. The hub holds no
      staff records yet, so the role decides and there are no grants.
    - Sessions are stored under a SHA-256 of the token, so a copy of the hub
      file holds no live sessions.
    - **Revocation cannot be checked without the key**, so the token alone
      would keep a locked account signed in until 05:00. Once the hub is
      paired, the staff records it pulls every two minutes overrule the
      session (stage 4, below). On a hub that has never pulled, the token's
      claims still stand until the session ends.
    - The till keeps the session in localStorage. **POS pages gate on
      `useTillAccess()`** (`pos/app/lib/useTillAccess.ts`), not
      `useRequireRole()`. Online it is `useRequireRole()`; on a hub it reads the
      session, because Firebase's staff record cannot be read offline.
  - **The page knows it is on a hub from `<html data-backend="hub">`**, set by
    the root layout when `BIG_CMS_HUB_DB` is set. `backend()` then returns
    `hubBackend` (`pos/app/lib/backend/hub.ts`).
  - **Live queries on a hub are one change feed per screen plus a request per
    query**:
    - `GET /api/hub/changes` streams which documents each commit wrote, never
      their contents.
    - `GET /api/hub/query` answers one `PosQuery` with `runHubPlan()` and the
      change log position read before it ran.
    - A watch asks again only when a write touching its plan is newer than
      its last answer.
    - **Never a stream per query.** A browser allows six connections to one
      address over plain HTTP. The first version streamed each watch, the
      floor opened seven, and "Open table" and even a page reload queued
      behind them for good. That was found in a browser, not by any test.
    - A query from a request goes through `parsePosQuery()`, where a document
      id with a slash is refused, and must be scoped.
    - `compareResults()` delivers nothing when a write elsewhere did not
      change the answer.
    - `verify:hub` asserts `runHubPlan()` answers all 14 till query shapes as
      `runPlan()` does.
    - 18 mutations to sign-in and the live queries are caught by name. Two
      of them first exposed weak tests, and both tests were tightened: the
      "stores a hash" check compared whole tokens, so a lightly disguised token
      passed. And nothing tried an account marked not staff whose token still
      names a role.
  - **Run a hub on a developer's machine:**
    - `npm run hub:seed` copies the menu, products, table layouts, features
      and business settings from `.env.local`'s project into `.hub/dev.db`.
      It is read-only against Firestore, and a real hub never runs it.
    - `npm run dev:pos-hub` serves the POS as a hub on port 3004. Stop the
      ordinary POS dev server first: one `next dev` per app.
  - **Exercised in a browser, 14 Sep 2026**, through the till's own screens on
    a dev hub: open table 12 → Fries → Send → the kitchen display showed it →
    Start → Ready → the floor's ready panel → Picked up. Every step's route
    answered 200 in under 60 ms, and every screen updated from the feed.
    - The session was made by a script, not a real Firebase sign-in, because
      nobody's password is typed here. **The real login-to-hub swap has not
      been run.**
    - Nor has a phone on the café wifi. An http LAN address gets no service
      worker and no camera. Firebase sign-in needs that address in the
      project's authorised domains.
  - Every commit goes into a `changes` table with a sequence number and fires
    `onChange()`. That is what the hub's clients will follow and stage 4
    will sync. Nothing trims it yet.
  - `npm run verify:hub` does two things:
    - It checks the store behaves as Firestore does.
    - It runs the real open shift → open check → add → send → bump → pay →
      close → Z close over a hub file. That includes two waiters opening one
      table, two taps on one ticket, and a batch and a payment each sent
      twice.
    - 20 mutations to the store are caught by name. **A missing field matching
      `!=` survives, and should:** every inequality also orders by its field,
      which drops documents without it, as Firestore does. The same shortcut
      on `== null` is caught.
    - A throw from the store is counted as a failure, so a broken store
      cannot hide the count by crashing the run.
  - **The Windows app runs the hub** (`"mode": "hub"` in its `config.json`).
    - The installer carries the POS server. `scripts/package-hub.mjs` assembles
      it with `package-app.mjs pos` into `desktop/hub-bundle/hub`, and
      electron-builder copies `hub-bundle` into the resources, so it lands at
      `resources/hub`.
    - **electron-builder drops a `node_modules` folder at the ROOT of any copy
      source, whatever the filter says.** It is a hard-coded rule in
      `app-builder-lib/out/util/filter.js` (`relative === "node_modules"`).
      - The first installer copied from a folder with the server at its root.
        It shipped 402 of the server's 2,352 files, built, passed the key search
        and ran fine from the assembled folder. Packaged, the server died on
        start with "Cannot find module 'next'" and restarted forever.
      - Naming `node_modules` in the filter then changed nothing, and only the
        new check said so.
      - Hence the extra level: from `hub-bundle`, it is `hub/node_modules`.
    - `npm run dist` ends with `scripts/check-hub-shipped.mjs`. It fails unless
      every assembled file is in `win-unpacked/resources/hub` at the same size.
      **Smoke-run the packaged `.exe`, not the assembled folder, before
      shipping an installer.**
    - `main.js` starts it with `utilityProcess.fork` on `127.0.0.1:3100`, with
      its database in `%APPDATA%\BIG CMS POS\hub\pos.db` and `hub.log` beside it.
    - It looks at `/api/hub/session` until it answers 401 as JSON. Only a hub
      does that, so another program on the port is refused, not opened. Then
      it opens `http://localhost:3100/pos`.
    - A server that exits is started again, 1 s doubling to 30 s. Quitting
      the app stops it.
  - **The hub server's environment is a short allowlist, never a copy of the
    PC's** (`hubServerEnv()` in `policy.js`), so `FIREBASE_SERVICE_ACCOUNT`,
    `GOOGLE_APPLICATION_CREDENTIALS` or `NODE_OPTIONS` set on the PC cannot
    reach it.
  - **`package-hub.mjs` refuses to package a server containing this machine's
    service account.** It searches every shipped file for the key id, the
    client email, a line of the key and the setting as stored, plus any `.env`
    or `.pem` file. It names the file, never the value, and deletes the
    folder. Proved by planting a made-up account whose email was a word the
    files do contain: refused, folder removed. The real search: 2,352 files,
    30.6 MB, nothing found.
  - The decisions are in `policy.js` (mode, port, address, environment, what
    counts as the hub, restart delay), asserted by `verify:desktop` (48).
  - **Smoke-run in hub mode, 14 Sep 2026, packaged and unpackaged.** The
    installer is 118 MB and holds all 2,352 server files. Its `win-unpacked`
    `.exe` started the server, saw it answer as the hub (17 s from start on a
    cold first run), loaded the POS at `localhost:3100/pos`, and the server
    exited with the app. It has not been installed on a clean PC.
- **Stage 4 starts with pairing a hub and pulling from the cloud.** The rules
  are `shared/src/hubSync.ts`, pure, asserted by `npm run verify:hub-sync`. The
  cloud's side is `shared/src/server/hubDevices.ts`; the hub's side is
  `shared/src/server/hubSync.ts`.
  - **Pairing.** An admin makes a one-time code at `/admin/settings/hubs`
    (Café Hubs, admin only) for a branch. Somebody at the counter PC types it
    at `/pos/hub`, which the hub's sign-in page links to while unpaired.
    - The hub sends it to the cloud's `POST /api/hub-sync/pair` and gets its
      own credential back: a device id and a 43-character secret.
    - The code is ten letters from a 32-letter alphabet with no I, O, 0 or 1,
      so 50 bits. It works once, for fifteen minutes.
    - Used, expired and never-made codes get ONE refusal, so a guesser learns
      nothing.
    - The cloud stores codes and secrets only as SHA-256
      (`hubPairingCodes/{hash}`, `hubDevices/{id}`, server-only, no rule, so no
      rules deploy). The code is never logged.
    - The hub keeps its credential in its own database (`hubMeta/device`), so
      it is still never the Admin key.
  - **The credential header is `Hub <id>.<secret>`, never `Bearer`**, so a
    person's token and a hub's credential cannot be mistaken for each other.
    The cloud checks it in constant time. An unpaired hub is refused and told
    so, and marks itself unpaired rather than asking in vain.
  - **Pulling.** `pos/instrumentation.ts` starts it on a hub: every two
    minutes, and straight after pairing. `GET /api/hub-sync/pull` returns
    exactly `pullSpec()`:
    - menu categories, items, modifier groups and products
    - this branch's table layout
    - the three settings the till reads
    - staff accounts cut to `STAFF_FIELDS`: role, branches, grants and
      revocations, never name, email, phone or points
    - never a check, a customer, another branch, or `appSettings/invoiceCounter`

    A digest makes an unchanged snapshot one line.
  - **`planPull()` decides what the hub writes.**
    - The cloud's version, except `keepLocal` fields of a document the hub
      already holds: **a product's stock stays the hub's**, because the hub
      counts what it sells.
    - A document gone from the snapshot is deleted from the hub, within the
      named ids only.
    - An unchanged document is not written, so a quiet pull is no commit and
      wakes no screen.
    - Anything the spec does not name is ignored, so the cloud cannot write
      the hub's receipt counter or its checks.
  - **Pulled staff records overrule a hub session** (`callerFromHubToken()`).
    An account locked or a role changed in the cloud reaches the till at the
    next pull, not at 05:00. Before the first pull the token's claims stand.
  - **The Windows app passes the cloud's address** (`cloudUrl` in
    `config.json`, default the hosted POS), https or localhost only, origin
    only, through the environment allowlist. `npm run dev:pos-hub` points a dev
    hub at the POS dev server on 3002.
  - `verify:hub-sync` has 62 assertions; 23 mutations are caught by name,
    together with `verify:desktop`. They include:
    - the receipt counter pulled
    - a pairing code working twice or never running out
    - the secret not checked
    - a Bearer token read as a hub's credential
    - staff sent whole
    - a locked account keeping its hub session
    - the cloud allowed on plain http across a network
  - **Exercised end to end, 14 Sep 2026**, between the POS dev server on the
    demo project (the cloud, port 3002) and a production build running as a
    hub with no Admin key in its environment (port 3004). The code came from a
    script, not the admin page, because nobody's password is typed here.
    - **Refusals:** the cloud's pull route refused no credential and a
      person's Bearer token (401). Each side answered 404 to the other side's
      routes.
    - **Pairing:** the hub paired with a real code. Its first pull, about a
      second later, wrote 54 documents: 4 categories, 16 items, 3 option
      groups, 26 products, 2 staff records, the features and business
      settings, and Main's table layout. That matches the cloud exactly. The
      same code again was refused (409).
    - **Unchanged pull:** after a restart the first pull sent the digest and
      came back unchanged, 0 written.
    - **Unpairing:** the test hub was unpaired in the cloud and the hub
      restarted. It marked itself unpaired with the admin's message, kept every
      document, and `/pos/hub` offered pairing again.
    - **Left in the demo project:** the test hub "E2E test hub" (unpaired),
      its used code and one activity log entry.
    - **Not yet run:** the admin page signed in, and pairing from the Windows
      app's own hub.
  - **Receipt numbers on a hub come in blocks** (owner's decision, 14 Sep 2026:
    500 at a time, refilled once fewer than 100 are left). The rules are
    `shared/src/receiptBlocks.ts`.
    - The cloud reserves a block off the same `appSettings/invoiceCounter` it
      issues its own from, in one transaction
      (`reserveReceiptBlock()`, `POST /api/hub-sync/receipts`), so its own next
      receipt comes after the block. It writes down which hub got which numbers
      (`hubReceiptBlocks`) and refuses a hub that says it still has 100 or more.
    - On a hub, `issueInvoiceNumber()` takes numbers ONLY from
      `hubMeta/receipts`. **With none for this year, closing is refused with a
      reason and the check stays open**, never numbered from a counter of its
      own. A hub counting from 1 would print numbers the cloud has given out.
    - **A block belongs to one café year**, because the sequence restarts every
      year and the printed number carries its month and year. A hub offline
      across New Year cannot close until it fetches this year's first block.
    - Unused numbers are skipped, which leaves gaps; accounting accepts gaps,
      not duplicates.
    - The hub fetches after pairing and on every two-minute sync.
      `/pos/hub` shows how many are left.
    - **A dev hub that is not paired cannot close checks any more**, so pair it
      with the POS dev server first.
    - A used-up block is kept until a new one arrives. So a hub out of numbers
      says "used all its receipt numbers", not "has none for this year yet",
      which would send somebody looking for a problem with New Year. The first
      test run caught that.
    - `verify:hub-sync` runs the hub's real `pairHub()` and `refillReceipts()`
      against the cloud's real functions over a fake connection. **Not run
      against the demo project**, because every reservation permanently uses
      500 of its receipt numbers.
    - 14 mutations: 13 caught by name. The survivor is "an upside-down block
      is read as a block". It survives correctly, because `readBlocks()` also
      requires `next` between `first` and `last + 1`, and the only
      upside-down block that passes is an empty used-up one, which issues
      nothing.
  - **A hub sends its trading up**: its checks, kitchen tickets, drawer
    shifts, branch drawer and activity, and its stock as **movements, never
    counts** (owner's decision, 14 Sep 2026). The rules are
    `shared/src/hubPush.ts`.
    - **Why movements:** the cloud's count stays the true one, and deliveries
      and stock counts entered in admin still count. A count sent up would wipe
      out a delivery recorded while the hub was offline.
    - **The hub's database records each stock increment as a movement IN THE
      SAME COMMIT** (`HubStoreOptions.journal`, opened with `moveFromIncrement`
      in `firebaseAdmin.ts`). An increment and its record land together or not
      at all. A refused commit records nothing, and a transaction that runs
      again records once, because nothing is recorded until it commits. Only
      `stock.<branch>` on products and `quantity.<branch>` on supplies are
      movements.
    - **Sending** (`pushToCloud()`, before every pull): batches of 200 from
      the change log, each document as it stands. The hub's place is kept in
      the store's `meta` table, OUTSIDE the change log, because recording
      "sent up to 40" as a document would be change 41 and the hub would never
      be done. A batch the cloud refuses is sent again next time, never
      skipped. Movements the cloud has are deleted from the hub.
    - **The cloud** (`applyPush()`, `POST /api/hub-sync/push`) checks every
      item: only what a hub is master for, only its own branch, never a
      deletion. **One refused item refuses the whole request.** It writes
      documents as the hub has them, and stamps activity with the hub. Each
      movement gets a marker in the same transaction as its increment, so a
      movement sent twice is applied once. A movement for a product the cloud
      no longer has is marked and skipped.
    - **A pull takes the cloud's count back once the hub's movements have
      landed** (`planPull(..., holdLocal)` with `pendingStock()`). Until then
      the hub keeps its own.
    - **Not sent up:** loyalty. A hub holds no customer records and credits no
      points. Error reports stay on the hub too.
    - 18 mutations, all caught by name. Three first got through:
      - "any two-part field is a movement" survived, because no test offered a
        branch-shaped field that was not the count, like `price.Main` or a
        supply's `stock.Main`.
      - "the cloud does not check a hub's movements" survived, because the
        all-or-nothing test only mixed in another branch's check, never another
        branch's shelf.
      - The first run of two cloud mutations did not compile, which proves
        nothing, and they were rewritten.
  - **While a branch has a paired hub, the online till for it is view-only**
    (owner's decision S10, 14 Sep 2026). The hub is master for that branch's
    checks, tickets and drawer, and sends them up as they stand. So a payment
    taken online meanwhile is written over at the hub's next push, and a table
    opened online is a second open check the hub never sees.
    - **The lock is on the server:** `refuseWhileHubbed()` in
      `shared/src/server/hubLock.ts`. Every till write route in the cloud calls
      it after the caller is checked and before anything is written: checks
      POST/PATCH, tickets PATCH (both the front's pickup and the kitchen's
      bump), and drawer POST/PATCH. It answers 409, naming the branch and the
      hub.
    - It follows a check, ticket or shift id to that document's branch. A
      document that is not there is left for the write itself to refuse.
    - **An unpaired hub no longer locks.** Revoking a hub in Settings → Café
      Hubs opens the online till again.
    - **On the hub itself nothing is refused**, since there it is the master.
      `onHub` is a parameter, because `verify:hub-sync` runs its "cloud" as a
      hub store with `BIG_CMS_HUB_DB` set.
    - **A new till write route must call it.** `verify:hub-sync` reads the
      route files and fails when a write route does not lock the right thing
      (`branch`, `checkId`, `ticketId`, `shiftId`) before its first write.
    - **The screens only say so.** `useHubOnly()` asks `GET
      /api/pos/hub-lock` when a screen opens and every minute after.
      `HubOnlyBanner` puts an amber "View only" notice on the floor, counter,
      check, kitchen display and drawer. **The banner has not been looked at
      in a browser:** it shows only on the online till, and that needs a real
      Firebase sign-in.
    - 14 mutations, all caught by name. "Any hub locks every branch" first
      survived: `branchHub()` already queries by branch, so the check in
      `activeHubFor()` was only proved once a test handed it another
      branch's row directly.
  - **When the counter PC is out of action, the branch trades on the online
    till** (owner's decisions S21–S23, 15 Sep 2026). The rules are
    `shared/src/hubFallback.ts`; the cloud's side is `hubDevices.ts`, the hub's
    `hubSync.ts`.
    - **An admin switches it, by hand** (S21): "Trade online" on the hub's card
      in Café Hubs (`PATCH /api/admin/hubs { action: 'online' }`,
      `startOnlineTrading()`). Never automatic: the cloud cannot tell a broken PC
      from a café whose internet is down while the hub trades, and phones on
      mobile data would then trade online at the same time. `onlineSince` on the
      hub row takes the lock off (`hubLocksBranch()`), at once.
    - **What the hub sends up meanwhile is held for a manager** (S22). A push
      from a hub whose branch trades online is validated as always, then written
      to `hubHeldItems` (server-only, no rule) instead of applied: a document as
      it stands (sent again after a change, it waits again with the new version),
      a movement once, and not at all if the cloud applied it before the switch.
      Activity is written as usual, as history. The push answers `tradingOnline`,
      and **the hub stops taking orders at once**: `followTradingOnline()` sets
      `hubMeta/device.tradingOnline`, and `refuseWhileHubbed()` on a hub refuses
      every till write while it is set, with a notice on the hub's screens and
      its `/pos/hub` page.
    - **Held Hub Sales** (`/admin/settings/hubs/held`, gated on `endOfDay`, the
      people who do the cash-up) lists each item with what the cloud has now.
      Apply writes the hub's version, or the movement once through the same
      marker a push uses; Dismiss leaves the cloud alone. Decided once; a manager
      decides only for their own branches. Applying still runs `pushProblem()`.
    - **Handing back** (S23, `handBackToHub()`) is refused until the hub has been
      in touch with nothing left unsent SINCE the switch (`caughtUpAt`), there is
      no open check and no open drawer shift for the branch in the cloud, and
      nothing from the hub waits. The hub reports `sent` and `latest` on every
      pull; changes with nothing to send (a sign-in between the push and the
      pull) count as sent, or they would hold the hand-back back a whole sync.
      **A hub still switched
      off may hold sales it never sent; handed back first, it would send them up
      as the master, over the online till's checks.** Switching online again
      clears `caughtUpAt`.
    - **Handed back, the hub starts clean**: on hearing, `clearTrading()` removes
      its checks, tickets, shifts, drawer and movements (activity stays), and
      only then trades again. Removals are never sent up.
    - `verify:hub-sync` runs it all against a Firestore-shaped cloud and the
      hub's real sync over a fake connection: 51 more assertions. 31
      mutations: 30 caught, two of them only by the run stopping. Three first
      survived and got tests: a hub flag of `false` read as online, a held
      movement the cloud already had applied again, and a sign-in between push
      and pull counted as unsent. **"A new spell online keeps the old caught-up"
      survives, and should:** handing back clears `caughtUpAt` as well, and
      `handBackProblem()` refuses a caught-up older than the switch anyway.
    - **Checked on the built hub, 15 Sep 2026**, against a fake cloud on this
      PC. Told the branch traded online, the hub's first sync set the flag, its
      pull reported `sent=34&latest=34`, and `/pos/hub` showed the notice. Told it
      was handed back, it cleared a stale open check put in its database for the
      test (the removal logged, never sent), kept its activity, and the notice was
      gone.
    - **Not looked at signed in:** Café Hubs' new buttons and Held Hub Sales.
  - **Phones reach the hub on the café wifi encrypted, through the app, never
    over plain http** (owner's decision S11, 15 Sep 2026). On plain http, a
    signed-in session and the Firebase token behind it cross the wifi in the
    clear. Anyone on that network could copy them and take payments as that
    person until 05:00.
    - **The hub server still listens on 127.0.0.1 only.** `desktop/hubLan.js`
      puts an encrypted door in front of it: TLS on `hubLanPort` (3443) with
      the hub's own certificate, passing bytes through to the server, so the
      change feed's stream works. It opens once the server answers and closes
      on quit.
    - **Off by default** (`"hubLan": true` in `config.json` turns it on), so
      nothing listens on the network until a café sets phones up. Windows asks
      once whether to allow it through the firewall, and a person answers.
    - **The certificate is made with `node:crypto`, no package**: P-256,
      self-signed, ten years, for a TLS server only, starting a day early for a
      phone whose clock runs ahead. No authority signs a certificate for an
      address like 192.168.1.20, so no browser trusts it. **The app trusts
      exactly this certificate, by SHA-256 fingerprint.** It is kept in the hub
      folder and made again only when missing, damaged, or within 30 days of
      running out, because a new one means every phone pairs again.
    - **The counter screen's QR is the pairing hand-off.** `/pos/hub` shows,
      once paired, `bigcms-hub:https://<private address>:3443#sha256=<hex>`
      for each private IPv4 address the PC has (`shared/src/hubNetwork.ts`,
      `hubLanStatus()`). `parseHubLink()` is the app's reading of it: only
      https, a private address with no path or login, and a whole fingerprint
      count.
    - **Checked on a dev hub, 15 Sep 2026**, paired with a fake cloud on this PC
      so nothing reached a real project. The hub status named this PC's real
      wifi address. Through the door, a request reached the real POS server
      (401 as JSON) over TLS 1.3, presenting exactly the fingerprint on the page.
      Plain http on the door's port got no answer. Once paired, the page drew
      the QR, and sampling its 41×41 squares gave the same grid `qrcode` makes
      from the hub link. So the QR says exactly that link. The door was bound to
      127.0.0.1 for the check, so Windows asked nothing, and **no phone has
      connected yet**: there is no app.
    - 19 mutations, all caught by name. "The certificate is an authority"
      first survived: Node's `x.ca` reads false for an authority that lacks
      the right to sign certificates, so the test now checks the certificate's
      own bytes. `desktop/main.js` wires it up and is not under test (Electron);
      the decisions it applies are.
    - `verify:desktop` makes a real certificate and runs a real handshake
      through the door. An ordinary client is refused
      (`DEPTH_ZERO_SELF_SIGNED_CERT`), while the pinned one gets through.
      `verify:hub-sync` asserts the addresses and the QR text.
  - **The Android staff app is `phone/`** (Capacitor 8.5.2, outside the npm
    workspaces like `desktop/`). It pairs with a hub by that QR, or by pasting
    its link, and then opens the hub's own `/pos` pages in its WebView.
    [phone/README.md](./phone/README.md) has the build steps.
    - **Trust is native and narrow.** `HubPin.java` is plain Java, tested on
      the JVM by `HubPinTest`. `HubWebViewClient.onReceivedSslError` accepts
      a refused certificate only at the paired hub's exact origin, and only if
      its SHA-256 is the pinned one. Every other certificate error is still
      refused. `HubPinPlugin.shouldOverrideLoad` lets only the paired hub's
      pages load in the app.
    - **The app's page reads the QR with `parseHubLink()` from
      `shared/src/hubNetwork.ts`, bundled by esbuild, not copied.** The plugin
      checks the link again before storing it.
    - **Only the app's own page can pair.** Capacitor exposes plugins to the
      app's origin, not the hub's, and a hub page was checked to have no
      bridge at all.
    - **The build needs a Java 21 JDK**, not Android Studio's bundled Java 25.
      Capacitor's Gradle 8.14.3 cannot run on 25. Gradle 9.6 and later removed
      an internal API that the Android Gradle plugin 8.13 uses. The QR scanner
      plugin asks for a Java 21 toolchain. Two more traps:
      - `local.properties` needs forward slashes, because a backslash is an
        escape there.
      - PowerShell 5.1's `Set-Content -Encoding utf8` writes a byte-order mark
        that Gradle refuses in a `.gradle` file.
    - **minSdk is 26** (Android 8), because the scanner's library needs it.
    - **Checked on an Android 37 emulator, 15 Sep 2026**, against the built
      hub with its door, paired with a fake cloud.
      - A link with the wrong fingerprint was refused at the handshake
        (`net_error -202`), and the app stayed on its own page.
      - The right one opened `https://10.0.2.2:3443/pos/login` as a secure
        context, marked as a hub, with its scripts running.
      - Not run: a real phone on the café wifi, a real camera scan, and
        signing in through the app.
  - **Phone sign-in, the servers' side** (owner's decisions S12–S14, 15 Sep
    2026): only fingerprint or face may unlock the key (never the phone's PIN);
    a phone is registered once, online, by the staff member's normal sign-in;
    a key sign-in lasts until 05:00. The rules and the signed messages are
    `shared/src/staffKeys.ts`, pure, so the app signs exactly what the hub
    checks.
    - **Registering is the cloud's** (`POST /api/staff-keys`,
      `enrolStaffKey()` in `shared/src/server/staffKeys.ts`). The Firebase
      sign-in on that route is the cloud checking the password itself. The
      phone sends a P-256 public key as base64 SPKI, which is what Android's
      Keystore gives, and a signature over `enrolMessage(uid, keyId)`, proving
      it holds the private key. `staffKeys/{sha256 of the key}` is server-only,
      with no rule, so no rules deploy.
      - At most 3 phones per person.
      - Sending the same key again is an answer, not an error.
      - A key already on somebody else's account is refused.
      - A removed key stays removed.
      - `DELETE` removes one: its owner, or an admin.
    - **Hubs pull the keys** (`pullSpec` gains `staffKeys`): only keys in use,
      of people still staff, and only `uid`, `publicKey` and `deviceName`. A
      removed phone or a leaver's leaves the snapshot, so the hub deletes it.
    - **Signing in is the hub's, with no internet**
      (`POST /api/hub/key-signin`, `shared/src/server/hubKeySignIn.ts`).
      - `challenge` gives a one-time 32-byte nonce for a registered key, valid
        60 seconds, stored hashed. There is one outstanding per key, so asking
        again replaces it.
      - `signin` checks the signature over `signInMessage(hub fingerprint,
        keyId, nonce)`, then opens a hub session with the PULLED staff record's
        role.
      - **The challenge is used up before the signature is checked**, so a
        wrong answer cannot be retried against it.
      - **The message names the hub's own certificate fingerprint**, the one
        the phone pinned (S11). A signature made for a machine pretending to be
        the hub fails at the real one.
      - A challenge given to one phone cannot be answered by another, and a key
        record holding a key other than the one its id names signs nobody in.
      - Every refusal says the same thing (401).
      - An account no longer staff is refused (403), and a hub with no café-wifi
        door signs no phone in (503).
    - `verify:hub-sync` makes real P-256 keys in Node and runs registering,
      removing, the pull and the hub's sign-in, including every refusal above.
      17 mutations, all caught by name. "Any elliptic curve is taken" first
      survived: the wrong-curve keys came with a nonsense proof, so the proof
      refused them, not the curve. Each wrong key now brings a genuine proof
      made by itself. Two more tests went in before the run, because nothing
      would have caught another registered phone answering a challenge, or a
      key record holding a key its id does not name.
    - **Not built yet:** the phone's side (a Keystore key unlocked only by
      strong biometrics, registering through the app, and handing the session
      to the till page), the manager fallback (S6), and a list of phones in
      admin. Registering does not yet prove the key lives in secure hardware;
      Android key attestation would.
  - **Phone sign-in, the phone's side** (`phone/`).
    - **The key:** `HubKeys.java` makes a P-256 key in the Android Keystore
      that only `BIOMETRIC_STRONG` unlocks, for each use, never the phone's
      PIN (S12). Adding a fingerprint to the phone invalidates it, so
      somebody who learns the PIN cannot enrol their own finger and sign in.
      `HubPinPlugin.sign()` shows the prompt with the signature as its
      CryptoObject.
    - **Requests:** `HubHttp.java` makes the app's requests natively.
      - To the hub, it trusts only the pinned certificate
        (`HubPin.certificateMatches`), the same trust the WebView gives it.
      - To Firebase and the cloud, it uses ordinary https.
      - The page never fetches across origins.
    - **Registering (S13):** the app asks the hub for its cloud and the public
      Firebase API key (`GET /api/hub/phone-setup`, over the pinned
      connection).
      - The email and password go to Firebase's `signInWithPassword`, and the
        password is never kept.
      - The phone makes its key and signs `enrolMessage` after the fingerprint.
      - The cloud's `POST /api/staff-keys` stores the key.
    - **Signing in:**
      - The app gets a challenge, signs `signInMessage` after the fingerprint,
        and signs in.
      - It then opens `/pos/login#key-session=<token>`.
      - **The till page takes the session from the fragment** (`tokenFromHandoff`
        in `shared/src/staffKeys.ts`, `adoptHubSession()`). It removes the token
        from the address and asks `GET /api/hub/session` who it is, storing what
        the hub says, never what the address said.
    - **Checked on an Android 37 emulator, 15 Sep 2026**, with a fingerprint
      enrolled by the emulator's own sensor. The hub was the built POS with
      the key sign-in routes, paired with a fake cloud.
      - **Setup:** the app made its Keystore key (`strongBiometrics` true). Its
        public key and a test barista record were put into the hub's database
        by a script, as a pull would.
      - **Enrolled finger:** it signed in and landed on
        `https://10.0.2.2:3443/pos` with a session for that barista, 10 hours
        left to 05:00. The fragment was gone from the address. The till said
        "Point of Sale is switched off" only because the fake cloud sends no
        feature switches.
      - **A finger never enrolled, then Cancel:** nothing unlocked, and the app
        stayed on its own page saying so.
      - Android hides the biometric prompt from screenshots, so the prompt
        was not looked at.
      - **Not run:** registering through the app, which needs a real
        password typed into it, and a real phone on the café wifi.
  - **Staff Phones** (`/admin/settings/phones`, admin only, in `ADMIN_NAV`
    beside Café Hubs) lists every registered phone: whose it is (name, else
    email, else account id), which phone, when it was registered, and whether
    it was removed. In use comes first, and the key itself is never shown.
    - Remove, after a confirmation, calls `revokeStaffKey()` through
      `admin/app/api/admin/staff-phones`. It is logged under "Staff Phones".
    - A removed phone stops signing its owner in at each hub's next pull, and
      cannot be added back; the owner registers the phone again.
    - `listStaffKeys()` is asserted in `verify:hub-sync`. **The page has not
      been looked at signed in.**
  - **Staff first names** (owner's decisions S15 and S18, 15 Sep 2026), for the
    manager fallback: a manager must see who is asking.
    - **Before this, staff accounts had no name at all**: the Staff Accounts
      form saved only email, role and branches. An admin now types a First
      name there, for new and existing accounts.
    - **Stored in `staffProfiles/{uid}`, server-only, with no Firestore rule, so
      no rules deploy.** Only `/api/admin/accounts` writes it, and a change is
      logged with before and after. **Never on `users/{uid}`**:
      `touchesPrivilegeFields()` does not cover a name, so its owner could edit
      it, and a manager approving by name must not be shown a name the person
      chose for themselves.
    - The page reads names through `GET /api/admin/accounts?names=1`
      (`loadStaffFirstNames()`).
    - **A hub pulls only the first name**, added to each staff record in
      `buildPullSnapshot()`. No profile document travels, and no email or phone.
    - `staffLabel()` names somebody with no first name by their role ("a
      barista").
    - `readFirstName()` makes one short line of it.
    - Asserted in `verify:hub-sync`. The Staff Accounts page has not been looked
      at signed in.
  - **The manager fallback** (owner's decisions S6, S15–S17), for a phone with
    no fingerprint or strong face unlock. The rules and the signed message are
    `shared/src/staffApprovals.ts`; the hub's side is
    `shared/src/server/hubApprovals.ts`, behind `/api/hub/approvals` (hub
    only, with no session in front of it).
    - **Asking.** The phone lists the staff the hub pulled, by first name
      (`view=people`, first names only).
      - The staff member chooses themselves and asks.
      - The hub keeps the request for 5 minutes, one waiting per person, and
        gives the phone a secret to collect with. It stores only the secret's
        hash.
    - **Approving (S16).** A manager opens "Approve a sign-in" in their own
      staff app (`view=waiting`, first name and phone name) and approves with
      their fingerprint.
      - Their phone signs `approveMessage(hub fingerprint, request id, key id,
        nonce)` over a challenge from the same `issueChallenge()` that sign-in
        uses.
      - `consumeChallenge()` and `verifiedKey()` are shared with
        `signInWithKey()`, so the two cannot drift.
      - The approver's PULLED staff record must say manager or admin, and
        nobody approves their own sign-in (`approvalProblem()`).
      - The approval is logged under the approver with both first names and the
        phone.
      - A manager's session left open on a counter approves nobody: approving
        is a fresh fingerprint signature, not a session.
    - **Collecting (S17).** The asking phone polls `collect` with its secret.
      Once approved, the request is marked collected in the same transaction
      and a session is made THEN, for the person approved, until 05:00. No
      token ever sits waiting in the hub, and collecting twice gets nothing.
      Somebody no longer staff by collection time gets no session.
    - `verify:hub-sync` runs all of it with real P-256 keys:
      - a barista approving
      - an approval signed for another hub or another request
      - a challenge the hub never gave
      - a demoted manager
      - approving twice or too late
      - the wrong secret
      - the session made out for the manager instead
      - approving your own sign-in
    - 21 mutations, all caught by name, including three for turning a request
      down. Two first survived: nothing signed an approval over a challenge the
      hub never gave, and nothing had a demoted manager approve. Two more ran
      against nothing (their anchors had moved when approving and denying became
      one path) and were re-anchored and caught.
    - **Checked on the Android 37 emulator, 15 Sep 2026**, against the built
      hub, with Rana (manager, registered key) and Sam (barista, no phone) as
      pulled records.
      - Sam chose his name from "Rana, Sam" and asked. The waiting screen
        showed.
      - Rana's "Approve a sign-in" listed "Sam wants to sign in on Google
        sdk_gphone16k_x86_64". She approved with the emulator's fingerprint.
      - The asking app collected and opened `https://10.0.2.2:3443/pos` as Sam
        (barista), 10 hours to 05:00, with the fragment gone.
      - Both roles ran in one app on one emulator, since the rules care about
        the accounts, not the devices.
      - The hub's activity log, read straight from its database afterwards,
        said "Rana approved Sam's sign-in on Google sdk_gphone16k_x86_64 (no
        fingerprint on that phone)" and "Signed in to the till with a
        manager's approval".
  - **A manager can turn a request down** ("Turn down" beside Approve), with
    the same proof as approving: a fingerprint signature over `denyMessage()`.
    - `denyMessage()` has its own label, so an approval's signature is never a
      refusal, and a refusal's never an approval.
    - Approving and denying go through ONE checked path (`answerRequest()` in
      `hubApprovals.ts`), so the two cannot drift apart. The same rules apply:
      a manager or admin, never their own request, still waiting.
    - Nobody else on the café wifi can refuse somebody's request.
    - The asking phone is told "denied", and a turned-down request cannot then
      be approved.
    - Logged under the manager with both names.
    - **Checked on the emulator, 15 Sep 2026.** The steps:
      - Sam asked.
      - Rana's list showed "Approve Sam with my fingerprint" and "Turn down",
        and she turned it down with the emulator's fingerprint.
      - The list emptied, and the asking app stopped waiting.
      - The hub's log said "Rana turned down Sam's sign-in on Google
        sdk_gphone16k_x86_64".

      The asking app first said "That request is closed", the same words as
      for a request already used. It now says a manager turned it down.
  - **Kitchen screens** (owner's decision S19, 15 Sep 2026). A shared kitchen
    tablet running the staff app taps "Use this device as a kitchen screen".
    A manager approves it with their fingerprint through the same approval
    flow, and it opens the kitchen display until 05:00, approved again each
    day.
    - **The session belongs to the screen, not a person**: `screen:<request
      id>`, the kitchen crew role, the hub's branch, and the `kds` scope,
      stored on the session (`hubSession.ts`) and handed back by `GET
      /api/hub/session`.
    - **The scope, not the role, is the boundary.**
      - `requireSection()` refuses a `kds`-scoped caller every section but
        `kds`, whatever the role would allow.
      - `/api/hub/query` refuses it every query but tickets, the menu and
        settings (`allowedForScope()`, `KITCHEN_SCREEN_QUERIES` in
        `queries.ts`): never a check, a shift, a receipt or the shop.
      - `verify-backend` reads the route and fails if that check does not come
        before the query runs.
      - Receipt auto-printing therefore does not work from a kitchen screen,
        on purpose.
    - **The till sends a scoped session to the kitchen display**: the sign-in
      hand-off lands on `/pos/kds`, and `useTillAccess()` sends every other POS
      page there.
    - **Checked on the emulator, 15 Sep 2026**, against the built hub. The
      tablet asked. Rana's list showed "A kitchen screen wants to sign in on
      Google sdk_gphone16k_x86_64", and she approved it with the fingerprint.
      - It landed on `/pos/kds` as `screen:…`, kitchen crew, scope `kds`, 9
        hours to 05:00.
      - With its token, station tickets answered 200; open checks and the
        open shift 403; opening a table 403, "A kitchen screen can use the
        kitchen display only".
      - Sent to the floor, it came back to `/pos/kds`.
    - 12 mutations, all caught. "A screen request is read as a person" was
      caught by the run stopping, on an invalid users/ path, rather than by a
      named assertion.
  - **A phone is checked when it registers** (owner's decisions S20, 15 Sep
    2026), with Android key attestation: Google's signed statement about where
    the key lives and what unlocks it. **A key not in secure hardware is
    refused; so is an unlocked or rooted phone; and when Google's list of
    compromised keys cannot be fetched, registering waits.** A refused phone
    uses the manager's approval.
    - **Flow:** the app asks `POST /api/staff-keys { action: 'challenge' }` for
      a one-time 32-byte challenge (5 minutes, stored hashed in
      `staffKeyChallenges`, server-only, no rule). It makes a NEW key with
      that challenge in its attestation and sends the Keystore's certificate
      chain with the key and proof. `{ action: 'check' }` first asks whether a
      key the phone already holds is registered to this person, so a lost reply
      does not cost a second key.
    - **The chain** (`readAttestedChain()` in `server/keyAttestation.ts`):
      each certificate signed by the next, the last one self-signed with a
      Google root's public key, the first certifying the key being registered.
      The roots are pinned by public key (Google's RSA root and its ECDSA root
      of 1 Feb 2026), and `verify:hub-sync` pins their hashes.
      **The extension must be in the first certificate and in no other**: a
      genuine attested key can sign a certificate of its own saying anything,
      and that forgery sits under a certificate carrying the real statement.
    - **The rules** (`attestationProblem()` in `shared/src/keyAttestation.ts`,
      pure, with its own DER reader) read the HARDWARE-enforced list only:
      secure area or StrongBox for both the statement and the key, made on the
      phone, P-256 for signing, a fingerprint required, never the PIN, for each
      use, a locked bootloader with a verified system, and, from the software
      list, exactly the staff app's package. A tag given twice is not read at
      all. **The emulator writes everything into the software list**, which is
      exactly what those rules refuse.
    - **Google's list** (`createStatusList()`) is kept for its Cache-Control,
      at least an hour and at most a day. Every entry refuses, suspended too;
      serials are compared lowercase with no leading zeros. Out of date and
      unfetchable is a 503. Validity dates are NOT checked: Google says
      expired factory chains stay trustworthy unless listed, and the fresh
      challenge already proves the chain was made just now.
    - **The challenge is used up before the statement is judged**, so a refused
      phone starts again. The key record keeps `attestation: { securityLevel,
      osPatchLevel, verifiedAt }`, and **a hub pulls only keys that have one**.
    - The signing certificate of the app is not checked yet: there is no release
      signing key. Add its digest to the rules when there is.
    - **Checked against the emulator's real chain, 15 Sep 2026**, captured
      from the app's new `createKey({ challenge })`. The code read it: version
      400, the challenge and `com.bigcms.staff` matched, fingerprint only
      (`userAuthType` 2) with no timeout. It was refused as a key in software,
      and, against Google's roots, as a root Google does not vouch for (the
      emulator's is "Droid Unregistered Device CA, Google Test LLC"). **An
      emulator cannot register any more.** No real phone has registered.
    - `verify:hub-sync` builds a stand-in root, batch certificate and key
      certificate byte by byte, with the extension as a phone writes it, and
      runs every refusal: 61 more assertions. 37 mutations, all caught; three
      only by the run stopping (the challenge read from the wrong field, a high
      tag number misread, the list fetched every time). "A key in software is
      taken" first survived: the only software case also put the key itself in
      software, so the key's own level refused it. A statement made in software
      claiming a hardware key is now its own test.
  - **Signing in on the counter PC itself, with your own phone** (owner's
    decisions S24–S25, 15 Sep 2026). Before this the counter PC signed in only
    with email and password, which the hub checks with Google, so a counter PC
    restarted during an outage could not be signed in at all.
    - **Tap your name on the counter's sign-in screen**
      (`CounterSignIn` in `pos/app/pos/login/page.tsx`, shown only when the page
      is on the counter PC itself). The hub keeps a request for two minutes and
      the screen shows a **four-digit code**.
    - **In your own staff app, "Sign in the counter PC"**: type the code and
      confirm with your fingerprint. The phone signs
      `counterSignInMessage(hub fingerprint, code, key id, nonce)`
      (`shared/src/counterSignIn.ts`), with its own label, over a challenge
      from the same `issueChallenge()`. The hub approves only the key owner's own
      waiting request with that code (`approveCounterSignIn()` in
      `server/hubCounterSignIn.ts`); the counter collects the session with its
      secret. Route: `/api/hub/counter-signin`.
    - **Why a code:** anyone on the café wifi can start a request in somebody's
      name. The code ties the fingerprint to the request on the screen in front
      of that person, so nobody approves a request started elsewhere blind. The
      ask is also refused unless its Host is localhost (`isCounterHost()`), which
      keeps it off phones but is not the proof; the code is. Codes and secrets
      are stored only as hashes.
    - **15 minutes without a tap ends it (S25)**, and 05:00 at the latest. The
      session carries `idleMs` and `lastActiveAt`; `callerFromHubToken()` refuses
      it once idle, whatever the page does. The till reports taps (pointer, key,
      wheel) with `PATCH /api/hub/session` at most every 30 seconds
      (`TOUCH_EVERY_MS`), and `touchHubSession()` writes at most that often.
      **Only taps count:** background requests (the change feed, the one-minute
      hub-lock check) never keep a counter session alive. The page signs itself
      out when the limit passes (`followIdle()` in `backend/hub.ts`, run for
      every page that watches the session). A phone's own sign-in has no idle
      limit.
    - `verify:hub-sync` runs it with real P-256 keys: a phone on the wifi
      starting one, a wrong code, another person's phone with the right code, a
      phone sign-in, approval or other hub's signature offered instead, a late
      code, the wrong secret, collecting twice, a leaver at approval and at
      collection, and the idle rules, including taps closer than 30 seconds:
      32 more assertions. 24 mutations, all caught by name. The first try at "a
      leaver approves" did not compile, which proves nothing; rewritten, it
      survived until a test had a demoted account's phone approve.
    - **Checked on the built hub with the Android 37 emulator, 15 Sep 2026.**
      The counter's sign-in screen (the browser at `localhost:3004`) listed
      "Rana, Sam"; tapping Rana showed a code. Typed into the app with the
      emulator's fingerprint, the phone said the counter signs in, and within
      the counter's two-second poll it landed on `/pos` as Rana with a 15-minute
      idle limit. The hub logged "Rana approved signing in on the counter PC with
      their fingerprint" and the sign-in. With the session's last tap moved 16
      minutes back in the hub's database, asking who it is and a tap both got
      401, and the till went back to its sign-in page. The first attempt was
      refused 401 because the app still named the key replaced during the S20
      check; that was the test's setup, and the refusal was the right answer.
  - **Not built yet:**
    - a real phone or tablet in a café

## The host's CDN caches prerendered pages for a year

Next sends a prerendered page with `Cache-Control: s-maxage=31536000`, and
Hostinger's CDN (`server: hcdn`) honours it. On 14 Sep 2026 the live POS floor
was several deploys old while every push had gone out. **The POS and admin root
layouts `await connection()`**, so their pages render per request and answer
`no-store`. The service worker is unaffected: the Cache API stores what it is
given whatever the header says. Copies already cached stay until they are
purged in Hostinger's panel once. The customer site (`web/`) still prerenders,
so its pages have the same year-long edge cache. That was not changed without
asking.

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

    **On a café hub, the counter PC prints itself** (owner's decision S28,
    15 Sep 2026; printers not chosen yet). Transport `network`: a private IPv4
    address on the café network, port 9100 unless given (`readPrinterAddress()`
    in `printing.ts`; saving refuses anything else). The hub follows its own
    commits (`startHubPrinting()` in `server/hubPrinting.ts`, started from
    `pos/instrumentation.ts`): a ticket just sent (`status: 'new'`, within ten
    minutes) whose station prints from the hub, and a check just closed with its
    `receiptNumber` when receipts on close are on, each become ONE job in
    `hubPrintJobs` under the ticket's or check's id (`ticketJob()`,
    `receiptJob()` in `shared/src/hubPrinting.ts`). A job is laid out with
    `ticketToText()` / `receiptToText()` and `receiptOptionsFor()` (moved to
    `shared/src/receiptOptions.ts` so the till and the hub cannot drift), turned
    into ESC/POS by `escposJob()` (`shared/src/escpos.ts`: init, PC437, the text
    made one ASCII character per character so columns stay aligned, feed, partial
    cut) and sent over TCP, one job at a time. The printer is read as configured
    when the job runs; a failure is tried three times (10 s, 30 s) and then left
    failed with its reason, never thrown into a send. The window keeps a restart,
    or a printer switched on later, from printing the backlog. The KDS skips
    network printers and `shouldPrintReceiptHere()` is false for them, so nothing
    prints twice. `/pos/hub` lists the network printers, today's count, failures
    and a Test page button (`/api/hub/printing`, counter PC only).
    **Not run against a real printer**: `verify:hub-sync` sends real bytes over a
    real socket to a stand-in on this PC. 23 mutations: 22 caught by name. "A
    failed job is tried forever" survives, and should: `runPrintJob()` stops at
    `PRINT_ATTEMPTS` on its own, and the retry delays list has only two entries.
    Writing the accent range as `\u` escapes through the editor put the real
    combining characters in the file, invisible, and a mutation anchor could not
    find them; the escapes are back.

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
    the service worker keeps its HTML and chunks once loaded. It is rendered per
    request since 14 Sep 2026 (see the CDN note), which the worker does not mind:
    the Cache API stores what it is given whatever the header says.
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
