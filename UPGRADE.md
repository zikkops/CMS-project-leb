# Upgrade checklist

An audit of the till, the admin panel, the staff phone app, the counter PC app
and the restaurant back end, turned into tasks. Written 18 Sep 2026, after the
first real café setup (16 Sep). **No code was changed to write it.**

The owner's goals it answers:

1. The UI/UX as easy as it can get.
2. What a restaurant back end still needs.
3. The phone app intuitive.
4. The software modern, and able to hold a lot of sections.
5. Adding a section easy.

## How to use this list

- **Ordered by risk, safest first.** Tier 0 changes no behaviour at all. Tier 5
  changes data models, permissions or security files. Work top-down: the early
  tiers build the pieces the later ones use (the shared UI kit, the section
  checks).
- **Each task is one session.** If one grows, split it here before starting.
- **Every task ends with the ritual in CLAUDE.md**: `npm run verify:all`, plus
  `npm run build` when an app is touched. For anything visual, look at it in a
  browser. Tasks that touch the hub are also checked on a built hub, and phone
  tasks on the emulator.
- **(owner)** marks a task that needs the owner's decision before it starts.
  Ask, record the answer beside the task, then build.
- File references are where the problem was found on 18 Sep. Line numbers
  drift, so re-read before editing.

---

## Open bug (investigate first)

- [x] **B1. Items would not Send on the hub with the internet cut** (16 Sep, in
  a café). **Done 18 Sep.** Reproduced on the built hub over a copy of the café
  laptop's database, with every outside lookup and connection made to hang (a
  router with no line): the server answered in 15 ms and the order sent. The
  cause was the phone layout: a `PosButton` with `grow` could not shrink
  below its text, so on a 360px phone the order screen's bar ran off the
  screen with **Send half outside it**. Now `grow` buttons may shrink
  (`posUi.tsx`), and on a phone the two secondary buttons put the icon above
  the word. Checked at 360px: the bar fits and Send works with the hub offline.
  The floor, counter, closed, KDS and hub pages have no sideways scroll either.

---

## Tier 0: no behaviour change (checks, docs, tooling)

- [x] **T0.1 A section consistency verifier**: `scripts/verify-sections.mjs`,
  picked up by `verify:all`. It fails when:
  - an admin page's `useRequireRole(...)` does not pass `SECTION_ACCESS.<key>`
    (a copied array silently breaks grants and the module switch);
  - a `can('k', [...])` role list in `firestore.rules` differs from
    `SECTION_ACCESS.k`;
  - a nav `access` is neither a `SECTION_ACCESS` value nor `ADMIN_ONLY`;
  - a collection in `pullSpec()` or `PUSHED_COLLECTIONS` is not claimed by
    some feature in `features.ts`;
  - an `admin/app/api/admin/**` route has no `requireSection`/`requireRole`.
  *Done: `npm run verify:sections` (5 checks, 5 of 5 mutations caught). It found and fixed the Weekly Order Log page passing its own role list, and claimed modifierGroups, appSettings, staffKeys, drawerShifts and branchDrawers in features.ts.*
- [x] **T0.2 Document "adding a section"**: a short `docs/adding-a-section.md`.
  It lists every file touched today (7 minimum, about 12 with a POS tile, hub
  sync and a badge), which ones a verifier enforces, and the order. Link it
  from CONTRIBUTING.md. It is the baseline the Tier 4 registry work replaces.
  *Done: docs/adding-a-section.md, linked from CONTRIBUTING.md.*
- [x] **T0.3 Version shown and bumped for every café build.** Two different
  builds both said 0.1.0, and the auto-updater never replaces 0.1.0 with 0.1.0.
  Add a check to `npm --prefix desktop run dist`: refuse to build when
  `desktop/dist/updates/latest.json` already has this version. Make the
  installer's file name come only from `artifactName`, and add a README line
  saying to delete old installers.
  *Done: scripts/check-desktop-version.mjs runs first in `npm --prefix desktop run dist` and refuses a version not higher than the last signed release (`releaseVersionProblem()` in update.js, asserted in verify:desktop). It removes old-named installers from desktop/dist. README and desktop-updates.md say so. Showing the version on screen is T1.25.*
- [x] **T0.4 Phone and counter setup notes in the READMEs**:
  - use the app, not a browser, for the hub page;
  - the first start takes 20–30 s;
  - reserve the counter PC's address in the router;
  - Public vs Private network;
  - iPhones are not supported yet.

  Fold in what the 16 Sep setup taught (`desktop/README.md`,
  `phone/README.md`).
  *Done: desktop/README.md "Setting it up at a café" and phone/README.md "At a café".*
- [x] **T0.5 Retire old instructions.** POS pages say "Settings → Features" and
  "Staff Accounts". The nav calls them "Modules" and "Manage Users"
  (`pos/app/pos/page.tsx`, `kds/page.tsx`, `allergens/page.tsx`). They also say
  "ask a manager to grant you…", but only an admin can grant. Correct the
  words only.
  *Done: the floor, KDS and allergens messages now name Settings → Modules and Manage Users, and say an admin gives access (only an admin can).*

---

## Tier 1: low risk, one screen at a time (wording, states, small fixes)

### Till (`pos/`)

- [x] **T1.1 Friendly loading instead of blank.** Seven pages return `null`
  while the sign-in is checked (floor, check, closed, drawer, kds, allergens,
  receipt). Add one shared "Loading…" line in `posUi.tsx`.
  *Done: PosLoading in posUi.tsx, on the floor, check, receipt, closed, drawer, KDS and allergens pages.*
- [x] **T1.2 Enter submits the number fields.** Open table, Move table and the
  counter's table box are not in a `<form>`, so "7 ⏎" does nothing on a PC.
  *Done: the floor's and counter's Open a table and the check's Move sheet are forms; the main button is type=submit (PosButton gained type).*
- [x] **T1.3 Opening a table that is already open goes to its check**, instead
  of an error (`pos/app/pos/page.tsx`, the counter).
  *Done: the floor and the counter go to (select) the open check instead of asking the server.*
- [x] **T1.4 Guest count 1–8 plus a stepper.** The chips are
  `[1,2,3,4,5,6,8]`, with no 7 and no 9+ (floor and counter).
  *Done: chips 1–8 plus a shared Stepper (posUi.tsx) up to 60, floor and counter. Buttons sharing a bar now have tighter sides, so their word fits at 366px.*
- [x] **T1.5 Offline sign-in message.** On a hub with no internet, email
  sign-in says "That email and password did not match". Detect
  `isNetworkFailure()` and say "No internet. Sign in with your phone above."
  (`pos/app/pos/login/page.tsx`).
  *Done: a network failure on email sign-in says there is no internet (on a hub: sign in with your phone), not that the password is wrong.*
- [x] **T1.6 Broken menu pictures fall back to the letter.** Pictures are
  remote (imgbb, unsplash), so offline tiles are blank or broken. Add
  `onError` on the tile `<img>` to show the first-letter tile
  (`check/[id]/page.tsx`, counter).
  *Done: TileImage on the order screen's category and item tiles falls back to the icon or first letter when the picture fails; checked by breaking one picture's address (Americano showed A).*
- [x] **T1.7 Shorter error messages.** The Send network error is 45 words.
  Server strings (`err.message`, the hub's `pushError`/`lastError`) are shown
  raw. Use one sentence, with a "Details" toggle for the rest.
  *Done: ErrorNote and splitMessage in posUi.tsx: the first sentence, the rest under Details. The Send errors lead with what to do. The hub page shows each sync problem once (the pull and push errors were the same sentence twice).*
- [x] **T1.8 Plainer counter labels.** "Record — the kitchen is here" becomes
  "Save order (offline)". "not rung up" becomes "Not sent".
  *Done: "Save order (offline)" and "Not sent" on the counter.*
- [x] **T1.9 Teal is only for the main action.** It is currently used for:
  - the Readings border;
  - the branch name;
  - the counter's Online pill and "counter device" box;
  - the change boxes (counter, PaySheet).

  Use neutral, or green for status.
  *Done: GOOD (#22C55E) in posUi.tsx for online, paid, change and the counter-device box; the branch names and the Readings button are neutral; teal is left to main actions and selection.*
- [x] **T1.10 Kitchen display tile follows the KDS switch.** It shows even
  with KDS off (`pos/app/pos/page.tsx`, the `NavTile` for `/pos/kds`).
  *Done: the floor's Kitchen display tile shows only with KDS on.*
- [x] **T1.11 Hub page has a way back and a timeout.** "Looking…" forever when
  the hub never answers. The only link is "Back to sign in"; add "Go to the
  till". Put **Sign out** on the floor; the till has none today.
  *Done: the hub page says the hub is not answering after 20 s instead of "Looking…" forever, and links "Go to the till" and "Sign in". The floor has Sign out (PosBackend.signOut(), cloud and hub); checked on the test hub: it lands on sign-in with the session gone.*
- [x] **T1.12 Login page, two clear cards.** "With your phone" and "With
  email", with visible labels on the inputs. Show "Loading staff…" or "No
  staff on this hub yet" instead of an empty grid.
  *Done: the sign-in page is two titled cards, "With your phone" and "With your email", with visible labels, PosButtons, ErrorNote, and "Loading staff…" / "No staff on this hub yet…" instead of an empty grid. On the hub, the email card says it needs the internet.*
- [x] **T1.13 Labels and aria.** Add `htmlFor` on labels, and aria-labels on
  table tiles saying their state (open, free) and on icon-only buttons.
  *Done: floor tiles read out table, total, how long since sent and what is unsent; counter tiles say whether the table is on the server and what waits; the table-number inputs are labelled (htmlFor or aria-label) and the guest chips are a labelled group. Icon-only PosButtons already carry their label.*

### Admin (`admin/`)

- [x] **T1.14 Dashboard honours revoked sections.** `admin/app/admin/page.tsx`
  calls `hasSectionAccess()` without `sectionRevocations`, while the sidebar
  (`AdminShell.tsx`) passes them. Add `visibleNav(role, grants, revocations,
  flags)` to `adminNav.ts` and use it in both.
  *Done: visibleNav() and navItemVisible() in adminNav.ts are the one answer for the sidebar and the dashboard, revocations included; verify:admin-nav asserts who sees what (6 more checks, 4 of 4 mutations caught).*
- [x] **T1.15 Remove the dashboard's second top bar.** "View Site" and "Sign
  Out" are duplicated from the sidebar.
  *Done: the dashboard's own View Site / Sign Out bar is gone (the sidebar has both); the date moved under the greeting.*
- [x] **T1.16 Group the permission grid.** `/admin/users` shows 22 grant boxes
  in `Object.keys` order. Group them under their nav sections.
  *Done: sectionGroups() in adminNav.ts groups the 22 grants under the sidebar's sections, in its order, the till's own under Other; Manage Users shows them grouped; verify:admin-nav asserts each is offered once.*
- [x] **T1.17 First name required for staff accounts.** The counter's sign-in
  list and manager approvals showed "barista", "admin". Make the field
  required for new staff, and show "(no name — set in Users)" where it is
  missing.
  *Done: creating a staff account now needs a first name (form and route); Manage Users marks accounts with none in amber; the counter's list says "An admin (no first name yet)" (a/an fixed). Also found and escaped raw control characters in staffProfiles.ts and staffKeys.ts, and raw byte-order marks in two CSV exports.*

### Phone app and counter PC

- [x] **T1.18 Friendly phone errors.** Staff saw "failed to connect to
  /192.168.68.148 (port 3443) from /10.32.155.185 … after 15000 ms". The fix:
  - Map exceptions to codes in `HubPinPlugin.java`/`HubHttp.java`
    (`ConnectException`, `SocketTimeoutException`, `NoRouteToHostException` →
    `UNREACHABLE`; `SSLHandshakeException` → `WRONG_HUB`), and codes to
    messages in `phone/src/app.ts`. Lower the connect timeout to 5 s.
  - Messages:
    - "Can't reach the café hub. Check this phone is on the café Wi‑Fi (not
      mobile data) and the counter PC is on."
    - "This isn't the café hub this phone was set up with. If the counter PC
      was reinstalled, scan its new code."
    - "Registering needs the internet once. Check this phone's internet, then
      try again."
    - "Couldn't read the code. Hold the phone about 20 cm from the screen, or
      paste the link."
    - "Sign-in cancelled."
  *Done: HubHttp.classify() in Java gives UNREACHABLE / WRONG_HUB / OFFLINE (JVM-tested, HubHttpTest), a closed fingerprint prompt is CANCELLED, the connect timeout is 5 s; shared/src/phoneMessages.ts turns codes into the words above and every catch in phone/src/app.ts uses it; npm run verify:phone (13 checks; it caught 'toString' being read as a code).*
- [x] **T1.19 Hub pages that fail show the app's page**, not Chromium's error
  (`HubWebViewClient.onReceivedError` → the app page with `?error=unreachable`).
  *Done: HubWebViewClient sends a hub page that fails to load (or answers with another certificate) back to the app's page with ?error=unreachable / wrong_hub, which says why. On the Android 37 emulator: an address with nothing listening and a stand-in server with another certificate each came back to the app with the right sentence.*
- [x] **T1.20 Honest Forget wording, and re-scan without forgetting.**
  - Say "Your fingerprint registration is kept."
  - Add "Scan the hub's code again" to the paired screen. When the
    fingerprint matches, only the address is updated. That survives the
    counter PC getting a new address from the router.
  *Done: Forget now says the registration is kept (checked on the emulator); "Scan the hub's code again" on the paired screen updates only the address when the certificate matches, and asks before switching to a different hub.*
- [x] **T1.21 Wait for the hub after registering.** Poll every 15 s and show
  "Getting the hub ready for this phone… (up to 2 min)", instead of letting
  the first fingerprint sign-in fail.
  *Done: after registering, the sign-in button waits ("Getting the hub ready…"), asking the hub every 15 s for up to 3 minutes whether it knows the key. Not run end to end: an emulator cannot register (S20); needs a real phone.*
- [x] **T1.22 Registration wording.** "Be on the café Wi‑Fi with internet
  working. You only do this once."
  *Done: the registration form says to be on the café Wi-Fi with the internet working, once.*
- [x] **T1.23 QR on the right network adapter.** `lanAddresses()`
  (`shared/src/hubNetwork.ts`) sorts every private address. A WSL, Hyper‑V or
  VirtualBox adapter can win. Skip virtual adapters, prefer Wi‑Fi/Ethernet,
  and label a QR per address.
  *Done: lanAddresses() skips Hyper-V/WSL/VirtualBox/VMware/Docker/VPN adapters and lists Wi-Fi/Ethernet first (verify:hub-sync: the old fixture had vEthernet's 172.20.0.1 as the first QR); the hub page offers a chip per network when there are several.*
- [x] **T1.24 Explain the first-start wait.** `desktop/offline.html` in hub
  mode says "This usually takes 20–30 seconds. The till opens by itself."
  `setup.html` gets an "Open café hub page (phones, printers)" button.
  *Done: offline.html in hub mode says the first start takes 20–30 s and later 10–20; the setup screen has "Open the café hub page (phones, printers)" on a hub (setup:hubPage, checked with isSetupPage like the others).*
- [x] **T1.25 Show the app version** in the footer of `setup.html`,
  `offline.html` and `/pos/hub`.
  *Done: setup.html and offline.html show "BIG CMS POS x.y.z"; the hub page shows it too, from BIG_CMS_APP_VERSION, which hubServerEnv() passes only as a plain x.y.z (verify:desktop). The setup smoke run reports version 0.1.0.*
- [x] **T1.26 Phone app icon and splash.** They are still Capacitor's
  defaults. Generate them with `@capacitor/assets`.
  *Done: a vector cup on the café's colour (#4A8DB7) as the adaptive icon and the launch screen, replacing Capacitor's default PNGs; scaled into the centre after the Android 12+ launch screen cut the saucer off. Checked on the emulator's home screen and launch screen. Drawn by hand, not with @capacitor/assets: a vector needs no PNG per density, and minSdk 26 draws every icon as adaptive.*

---

## Tier 2: medium, shared pieces and flows (more files, still no data change)

### The UI kit (do these before converting pages)

- [x] **T2.1 Admin UI kit, part 1.** `admin/app/components/ui/` with
  `Button`, `Input`/`Field`, `PageHeader`, `EmptyState`, `Spinner`, written in
  the house style (inline style objects, CSS variables).
  - Today `const inp` is re-declared in 19 files and there are 14 button
    constants.
  - There are 2,501 inline style blocks, `h1` in five different sizes, and 8
    page widths.
  - Convert **one** page as the example.
  *Done: admin/app/components/ui/index.tsx: Page (three widths), PageHeader, Panel, Button (primary/danger/neutral/quiet, dashed when disabled), Field + inputStyle, Loading, EmptyState, ErrorLine. Staff Phones converted as the example. Looked at on a temporary unsigned preview page (removed), since admin pages need a sign-in.*
- [ ] **T2.2 Admin UI kit, part 2**: `DataTable` (sortable header, empty
  state, search box) and `ConfirmDialog` + `useToast`. This replaces 30 native
  `confirm()`/`alert()` calls, one page at a time.
- [ ] **T2.3 POS `Sheet` wrapper** in `posUi.tsx`: `role="dialog"`,
  `aria-modal`, Escape, focus handling. It keeps the modifier sheet's choices
  when the backdrop is tapped (today a stray tap throws them away).
- [ ] **T2.4 PaySheet, DiscountSheet, CustomerSheet, receipt, login and hub
  on `PosButton`/`Chip`.** They still use their own 40–48px constants (under
  the 44px floor for chips), 0.64–0.82rem text, faded-teal disabled states,
  and two solid teal buttons at once. One or two screens per session.
- [ ] **T2.5 Native prompts become sheets.** `window.prompt` is used for
  kitchen notes and the "Other" void reason (`check/[id]/page.tsx`). It is
  tiny on touch screens and blocked by some kiosks.

### Till flows

- [ ] **T2.6 Pay is one tap, and teal.** Today it is Check options → "Take
  payment and close", painted red, about ten taps from table to closed. When
  nothing is waiting to send, the teal Send slot becomes **Pay** and opens
  PaySheet.
- [ ] **T2.7 After closing, show the receipt**, not the floor. The "Close &
  issue receipt" button turns teal.
- [ ] **T2.8 Unsent items survive leaving the screen.** Drafts live only in
  `useState`, although the header comment says otherwise. Keep them in
  localStorage per check, and confirm "Floor" while drafts exist.
- [ ] **T2.9 Counter can fix a mis-tap.** Lines need −/+/Remove (reuse
  `DraftRow`). Confirm before switching tables with unsent items; today they
  are wiped silently.
- [ ] **T2.10 Counter closes in place.** "Paid in full — close it…" jumps to
  the full check screen. Close there when online.
- [ ] **T2.11 Draft lines show option prices.** Unsent lines use the base
  price and ignore priced options until Send (`check/[id]/page.tsx`,
  `addDraft`/`draftTotal`).
- [ ] **T2.12 Ready panel doesn't cover the floor.** Cap it at about 40% of
  the screen, with scrolling. "Picked up" becomes a neutral button, with a
  5-second Undo.
- [ ] **T2.13 Split the order screen file.** `check/[id]/page.tsx` is 1,319
  lines. Move `MenuPicker`, `CategoryTile`, `ItemTile` and `ModifierSheet`
  into their own file. It is a pure move, so it goes before T2.6.

### Admin, modern shell

- [ ] **T2.14 Collapsible sidebar with a filter box.** 10 sections and 54
  items, all open. Save the open state per browser, and open the current
  section automatically.
- [ ] **T2.15 Ctrl+K command palette.** Search every page the user can open,
  built from the already-filtered `ADMIN_NAV` (label, desc). This is the single
  biggest "modern" win, and it scales to any number of sections.
- [ ] **T2.16 Standard page header with breadcrumbs.** `PageHeader` shows
  "Section › Page" and the page's actions, from `sectionForPath()`. The guide
  strip folds into it as a small "?" rather than a big box.
- [ ] **T2.17 A "Today" strip on the dashboard.** Four to six tiles:
  - sales so far;
  - end of day submitted or not;
  - held hub sales waiting;
  - new error reports;
  - unsigned food-safety day;
  - low stock (once T3.10 exists).

  Every tile comes from an existing route. Today the dashboard is a second
  copy of the sidebar.

### Counter PC and phones

- [ ] **T2.18 Phones on/off in the setup screen.** Staff phones currently
  need `"hubLan": true` typed into `config.json`, and the hub page hides the
  phone section without saying why.
  - Add `configWithSetting()` beside `configWithMode()` in
    `desktop/policy.js`, with a `setup:phones` IPC (checked with
    `isSetupPage()` like the others).
  - Add a "Staff phones on the café Wi‑Fi: On / Off" switch in `setup.html`,
    which restarts the app.
  - When it is off, the hub page says how to turn it on.
  - Asserted in `verify:desktop`.
- [ ] **T2.19 Firewall rule at install, and a Public-network warning.** An
  NSIS `customInstall` adds an inbound allow rule for TCP 3443 on private and
  domain profiles. The hub page shows "Windows treats this network as Public,
  so phones are blocked" with the fix. (owner): whether the installer may
  add a firewall rule.
- [ ] **T2.20 Phone app screens, one card per state.** Pair → Register → Sign
  in, with the rest under "More" and the address/fingerprint under "Hub
  details". Today the paired screen shows nine equal buttons and a
  95-character fingerprint. Use the brand fonts and logo.

---

## Tier 3: new restaurant features (additive, each behind a switch)

Each is a new feature key in `features.ts` (off by default), so turning it on
is the owner's choice per café. The order is what a restaurant misses first.
All money arithmetic goes in a pure `shared/src/*.ts` with its own verifier
cases, as the rest of the till does.

- [ ] **T3.1 Paid-outs, pay-ins and safe drops on the drawer** (owner):
  who may, which reasons. Today the drawer knows only sales and refunds
  (`shared/src/drawer.ts`), which matters for Lebanese cash handling. The
  expected cash follows, per currency, and appears on the X/Z readings and End
  of Day.
- [ ] **T3.2 Void and discount report**: by day, staff and reason, from the
  lines and the activity log. It pairs with T5.1.
- [ ] **T3.3 Product mix report**: best sellers by count and revenue, and by
  category. The data is already on closed check lines.
- [ ] **T3.4 Hourly sales, with the same day last week.** Café time zone,
  through the export's own day rules.
- [ ] **T3.5 86 from the till.** A manager marks a dish unavailable on the
  order screen. Per branch (today `available` is one switch for every
  branch), and it works on a hub offline.
- [ ] **T3.6 Reprint a kitchen ticket** from the check, and from `/pos/hub`
  for network printers.
- [ ] **T3.7 Email a receipt** through the existing `server/email.ts`. The
  address is typed at the till and not stored unless the customer is a member.
- [ ] **T3.8 Service charge** (owner): the rate, whether it is
  optional, and whether VAT applies to it. A line on the check, the receipt
  and the export.
- [ ] **T3.9 Tips on card** (owner): a tip field on a card payment.
  It feeds the tips pool, and the drawer is untouched.
- [ ] **T3.10 Par levels and low-stock alerts** on supplies. A dashboard tile
  (T2.17) and a filter on the supplies page.
- [ ] **T3.11 Hold and fire courses.** Lines already carry `course`, but Send
  fires everything. Add "Send drinks now, hold mains", then "Fire mains", with
  the KDS showing held courses.
- [ ] **T3.12 Clock in / clock out** from the phone app, signed with the
  fingerprint, plus a timesheet page. Wages and labour % come after, and are
  (owner): who sees pay rates.
- [ ] **T3.13 Waitlist** beside reservations.
- [ ] **T3.14 Ingredient stock transfers** between branches (today only retail
  `products` move).

---

## Tier 4: making sections easy to add (structural, still no data change)

Do these after T0.1, which protects them.

- [ ] **T4.1 POS tile registry.** Add `POS_TILES` (label, icon, colour, route,
  feature, section) and filter it the way the admin nav is filtered. Adding a
  till screen then means adding one entry. Today the tiles are hand-written
  JSX in `pos/app/pos/page.tsx`.
- [ ] **T4.2 One `SECTIONS` registry.** Label, roles and feature are declared
  in one place in `roles.ts`, with `SECTION_ACCESS`, `SECTION_LABELS` and
  `features.sections` derived from it. Today one section has three names
  ("Goods Receiving", "Receive a Delivery"…).
  - Keep reference equality: derive once, and re-export the same arrays
    (`useRequireRole()` finds a section by reference).
- [ ] **T4.3 `npm run new:section <key>` scaffolder.** It writes the registry
  entry, the admin page stub (with `PageHeader`, `useRequireRole`), the API
  route stub (with `requireSection`, `toResponse`, `runtime = 'nodejs'`), the
  nav entry and a verifier stub. The last step prints what is left by hand
  (the rules). Built on T2.1, T4.2 and T0.1.
- [ ] **T4.4 Theme tokens.** Move hard-coded colours (`#0a0a0a`,
  `rgba(255,255,255,…)`) into CSS variables, one app at a time. It is the
  groundwork for a light theme, and for a client's own colours without code
  changes.
- [ ] **T4.5 Split the biggest admin pages** into `_components/` using the UI
  kit: menu (1,034 lines), end-of-day (1,034), supplies/receiving (986),
  products (985), events (940), weekly-orders (872). One page per session,
  with no behaviour change.
- [ ] **T4.6 `useIsMobile` from one place** (owner). CLAUDE.md
  deliberately keeps a copy per file ("copy it in; don't refactor existing
  files to share it"). There are 62 copies, with breakpoints of 768 and 880.
  Only if the owner lifts that rule. It is a codemod plus one breakpoint.

---

## Tier 5: higher risk (data models, permissions, the hub's database, rules)

Each needs its own plan note in the vault first, and the owner's answers.

- [ ] **T5.1 Manager approval for voids of sent food and for refunds**
  (owner). Today `voidLine()` and `refundCheck()` accept any till role,
  barista included. This is the biggest cash-fraud gap. The same fingerprint
  approval the hub already uses for sign-in is the natural fit on a hub. Online,
  it is a manager's session. Covered by `verify:checks` and `verify:hub-sync`
  cases.
- [ ] **T5.2 Trim the hub's change log.** `changes` is never deleted from
  (`hubStore.ts`), so it grows forever. Keep what has not been sent up plus a
  window (e.g. 7 days). Watch that a change feed or `readyToLeaveHub()` never
  reads past the trim.
- [ ] **T5.3 Index and bound the hub's queries.** Only `==` filters and
  `branch` reach SQL today. `array-contains`, ranges, order and limit happen in
  JavaScript over every row. So X/Z readings (`shiftIds array-contains`) and
  "open checks" parse every check ever stored, twice in a transaction. Add JSON
  indexes for the till's 14 query shapes, and push `limit`/order into SQL where
  `runHubPlan()` agrees with `runPlan()`. Tested with `verify:hub` on a hub file
  seeded with a year of checks.
- [ ] **T5.4 Archive closed trading off the hub.** Closed checks and tickets
  already in the cloud and older than N days leave the hub database. Follows
  T5.2.
- [ ] **T5.5 Order types: dine-in, takeaway, delivery, and named tabs.** This
  drops the one-open-check-per-table rule for non-table orders. It touches
  `openCheck`, the floor, the counter, the KDS header and the export. (owner):
  the types and their names.
- [ ] **T5.6 Move items between checks, and merge tables.** A new check
  action, with totals, payments and the drawer kept whole. It must be safe to
  send twice (a `batchKey`, as Send has).
- [ ] **T5.7 Loyalty on a hub.** Today points are silently not credited when a
  check closes on a hub (no customer records there, and `transactions` is not
  pushed). Either queue the credit and push it up, or say at the till that
  points are credited when back online. (owner): which.
- [ ] **T5.8 Warn when an export is cut short.** `salesExport.ts` and
  `foodCost.ts` stop at 20,000 checks with no warning. Query per branch, and
  say so when the cap is hit.
- [ ] **T5.9 Log after a committed sale without failing it.** `logActivity`
  runs after the transaction. If it throws, the till shows an error for a sale
  that happened. Catch it, and report it through `reportError()`.
- [ ] **T5.10 Generate the rules' role lists from `SECTIONS`.** The role
  arrays in `firestore.rules` are written by hand. Generate the helper block
  between marker comments. **A rules deploy goes out one collection at a time
  with approval** (CLAUDE.md, Firestore rules).
- [ ] **T5.11 Scheduled backups of the cloud and the hub.** A managed daily
  `gcloud firestore export` (needs billing and a bucket, set up by the owner),
  and a nightly copy of `pos.db` on the counter PC (SQLite `VACUUM INTO`),
  keeping 7.
- [ ] **T5.12 Menus by time of day and happy-hour prices.** A price rule by
  day and time, judged in the café's zone on the server when the line is
  added.
- [ ] **T5.13 Combos and meal deals.** They touch recipes, the KDS, splits
  and reports, so they come last among menu features.

---

## Not in this list, on purpose

These are larger than a session and need their own scope note in the vault
before any task can be written:

- an iPhone staff app;
- online or QR ordering at the table;
- delivery platforms (Toters and the like);
- a customer-facing display;
- multi-tenancy and billing (Phase 05);
- the Onboard App (a separate project).
