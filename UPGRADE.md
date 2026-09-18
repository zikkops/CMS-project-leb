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
- [x] **T2.2 Admin UI kit, part 2**: `DataTable` (sortable header, empty
  state, search box) and `ConfirmDialog` + `useToast`. This replaces 30 native
  `confirm()`/`alert()` calls, one page at a time.
  *Done: DataTable (search box, sortable columns with aria-sort, empty and no-match states), useConfirm() (a dialog in the page's style; Escape and the backdrop say no) and useToast() in the kit. Manage Users' revoke uses them instead of confirm() and alert(). Checked on a temporary preview page: sorting, search, the dialog, Escape, the toast. The other 28 confirm/alert calls move as their pages are touched.*
- [x] **T2.3 POS `Sheet` wrapper** in `posUi.tsx`: `role="dialog"`,
  `aria-modal`, Escape, focus handling. It keeps the modifier sheet's choices
  when the backdrop is tapped (today a stray tap throws them away).
  *Done: Sheet in posUi.tsx: role=dialog, aria-modal, a label, Escape closes, focus goes in (the autofocus field first) and back; backdropCloses={false} for the dish options; onSubmit makes it a form; center for a wide screen. All six order-screen sheets and the floor's Open a table use it. Checked on the test hub: Check options (labelled, focus in and back, Escape), the options sheet kept 'Large' through a backdrop tap, and Open a table focuses its number field and closes on Escape. PaySheet keeps its own overlay, moving with T2.4.*
- [x] **T2.4 PaySheet, DiscountSheet, CustomerSheet, receipt, login and hub
  on `PosButton`/`Chip`.** They still use their own 40–48px constants (under
  the 44px floor for chips), 0.64–0.82rem text, faded-teal disabled states,
  and two solid teal buttons at once. One or two screens per session.
  *Done: PaySheet, DiscountSheet and CustomerSheet are Sheets built from PosButton/Chip (tenders with cash/card icons, 44px+ everywhere, readable labels, one loud button at a time: Scan code is neutral, Add is the action); the receipt page's Print and widths and the hub page's Test page too. The login page was done in T1.12. Checked on the test hub: the receipt page and the discount sheet.*
- [x] **T2.5 Native prompts become sheets.** `window.prompt` is used for
  kitchen notes and the "Other" void reason (`check/[id]/page.tsx`). It is
  tiny on touch screens and blocked by some kiosks.
  *Done: TextSheet (a Sheet with a textarea; Enter saves, Escape cancels) for the kitchen note and the "Other" void reason, which needs words before "Void it" lights up. Checked: the note sheet opened focused, took "nut allergy" and Enter put it on the line.*

### Till flows

- [x] **T2.6 Pay is one tap, and teal.** Today it is Check options → "Take
  payment and close", painted red, about ten taps from table to closed. When
  nothing is waiting to send, the teal Send slot becomes **Pay** and opens
  PaySheet.
  *Done: with lines on the check, all sent and nothing in progress, the teal Send slot becomes Pay (payments on) or Close (off) and opens the sheet directly; Check options' own button is teal, no longer red. Checked on the test hub: table 68 showed Close, and closing took two taps.*
- [x] **T2.7 After closing, show the receipt**, not the floor. The "Close &
  issue receipt" button turns teal.
  *Done: closing goes to the receipt, which now links "← Floor" and "The check"; PaySheet's Close & issue receipt is teal (T2.4). Checked: after Close, /pos/check/…/receipt.*
- [x] **T2.8 Unsent items survive leaving the screen.** Drafts live only in
  `useState`, although the header comment says otherwise. Keep them in
  localStorage per check, and confirm "Floor" while drafts exist.
  *Done: drafts and the key of a send in progress are kept in localStorage per check (pos-drafts-<checkId>) and restored on return; Floor with unsent items asks "Leave for the floor" / "Stay and send". Checked: a Brownie added to table 25, Floor, leave, a full reload of the check: it was back, "On this device — not sent".*
- [x] **T2.9 Counter can fix a mis-tap.** Lines need −/+/Remove (reuse
  `DraftRow`). Confirm before switching tables with unsent items; today they
  are wiped silently.
  *Done: unsent counter lines have −, + and Remove (icon buttons with names), and choosing another table with unsent items asks "Drop and switch" / "Stay here". Checked on the test hub: an Iced Latte went 2× → 1× and switching tables asked.*
- [x] **T2.10 Counter closes in place.** "Paid in full — close it…" jumps to
  the full check screen. Close there when online.
  *Done: paid in full and online, the counter closes the check itself (closeCheck) and opens the receipt; a refusal is said in place. Type-checked; not exercised, because the scratch hub has payments switched off, and "paid in full" needs payments.*
- [x] **T2.11 Draft lines show option prices.** Unsent lines use the base
  price and ignore priced options until Send (`check/[id]/page.tsx`,
  `addDraft`/`draftTotal`).
  *Done: the options sheet hands addDraft() the base price plus the options' prices, so an unsent line and the running total show it (display only; the server prices from the ids). Checked: Americano + Large read $4.50 before Send.*
- [x] **T2.12 Ready panel doesn't cover the floor.** Cap it at about 40% of
  the screen, with scrolling. "Picked up" becomes a neutral button, with a
  5-second Undo.
  *Done: the ready list scrolls inside 40% of the screen, Picked up is neutral, and a tap waits 5 s with "Picked up · Undo" before it is recorded (leaving the screen records what is waiting). Checked on the test hub with 11 ready plates: the cap was 316px of 790, Undo put the card back, and a tap left alone was recorded after 5 s (11 → 10).*
- [x] **T2.13 Split the order screen file.** `check/[id]/page.tsx` is 1,319
  lines. Move `MenuPicker`, `CategoryTile`, `ItemTile` and `ModifierSheet`
  into their own file. It is a pure move, so it goes before T2.6.
  *Done: MenuPicker, CategoryTile, ItemTile, TileImage, TileLetter and ModifierSheet moved unchanged to check/[id]/MenuPicker.tsx (376 lines); page.tsx went from 1,434 to 1,079 lines. Checked: the menu, a category and a dish's options still open.*

### Admin, modern shell

- [x] **T2.14 Collapsible sidebar with a filter box.** 10 sections and 54
  items, all open. Save the open state per browser, and open the current
  section automatically.
  *Done: sidebar groups fold (a button with aria-expanded per section), the open ones are remembered per browser (admin_nav_open), the current page's section always opens, and "Find a page…" filters every page by name, description and section through filterNav() (asserted in verify:admin-nav). Lint- and type-clean; not looked at signed in, since the sidebar draws only for a signed-in account.*
- [x] **T2.15 Ctrl+K command palette.** Search every page the user can open,
  built from the already-filtered `ADMIN_NAV` (label, desc). This is the single
  biggest "modern" win, and it scales to any number of sections.
  *Done: CommandPalette.tsx, opened with Ctrl+K / ⌘K from any admin page: it searches the pages this person can open (visibleNav) through filterNav(), with arrow keys, Enter and Escape, and listbox roles. Checked on a temporary preview page with the full list: "hub" gave Held Hub Sales and Café Hubs, ↓ then Enter went to /admin/settings/hubs.*
- [x] **T2.16 Standard page header with breadcrumbs.** `PageHeader` shows
  "Section › Page" and the page's actions, from `sectionForPath()`. The guide
  strip folds into it as a small "?" rather than a big box.
  *Done: above every admin page, folded by default: a breadcrumb "Section › Page" (aria-current) and a small "?" that opens the section guide, which is remembered per browser as before; the kit's PageHeader takes its section from sectionForPath() when a page gives none. Lint- and type-clean; the shell was not looked at signed in.*
- [x] **T2.17 A "Today" strip on the dashboard.** Four to six tiles:
  - sales so far;
  - end of day submitted or not;
  - held hub sales waiting;
  - new error reports;
  - unsigned food-safety day;
  - low stock (once T3.10 exists).

  Every tile comes from an existing route. Today the dashboard is a second
  copy of the sidebar.
  *Done: TodayStrip (admin/app/components/admin/TodayStrip.tsx) above Needs attention: sales so far (exports/sales for today), end of day per branch for the cash-up day, held hub sales (only when some wait), food safety days unsigned this past week (history's missed), and new error reports (first seen in 24 h, admins). A tile the person cannot open or whose module is off is not drawn; one that cannot be read says so, never a zero. Low stock waits for T3.10. Checked on a preview page signed out (every tile's failure path, 4 across at 1280px, 1 column at 375px, no sideways scroll); not seen signed in.*

### Counter PC and phones

- [x] **T2.18 Phones on/off in the setup screen.** Staff phones currently
  need `"hubLan": true` typed into `config.json`, and the hub page hides the
  phone section without saying why.
  - Add `configWithSetting()` beside `configWithMode()` in
    `desktop/policy.js`, with a `setup:phones` IPC (checked with
    `isSetupPage()` like the others).
  - Add a "Staff phones on the café Wi‑Fi: On / Off" switch in `setup.html`,
    which restarts the app.
  - When it is off, the hub page says how to turn it on.
  - Asserted in `verify:desktop`.
  *Done: configWithSetting(raw, key, value) in desktop/policy.js changes only what SETUP_SETTINGS lists (hubLan, a boolean), keeping every other setting; setup:phones in main.js (isSetupPage-checked) writes it and starts the app again; setup:current reports phones. setup.html shows a Staff phones On/Off switch on a café hub only (aria-pressed). With phones off, /pos/hub says so and how to switch them on. verify:desktop 115 (+6): other keys and values refused, and every setup: handler's first line refuses a caller that is not the setup page. Checked: smoke:setup (the bridge answers phones), and the screen with a stubbed bridge in a browser (Off marked, On asks, disables, says starting again). The hub page's off message seen on a dev hub. Not run: the switch on an installed app.*
- [x] **T2.19 Firewall rule at install, and a Public-network warning.** An
  NSIS `customInstall` adds an inbound allow rule for TCP 3443 on private and
  domain profiles. The hub page shows "Windows treats this network as Public,
  so phones are blocked" with the fix. (owner): whether the installer may
  add a firewall rule.
  *Done: The Public-network warning is built; the firewall rule is not, as the safe default for the (owner) question. Why: the installer is per user (perMachine false), so it has no admin rights, and a firewall rule needs them; making it per machine would put a UAC prompt in front of every silent update (S27). Owner to confirm, or choose a per-machine installer. The warning: while phones are on, desktop/main.js asks Windows every minute (Get-NetConnectionProfile, parsed by publicNetworkAliases() in policy.js) and writes the Public adapters to network.json beside the hub database; hubLanStatus() reads it (readPublicNetworkAliases(), stale after 5 min = not known) and names the door addresses on it (addressesOnPublicNetwork() in hubNetwork.ts); /pos/hub shows an amber warning with the fix under Details. verify:desktop 119 (+4, including this PC's real answer), verify:hub-sync 396 (+5). Seen on a dev hub with this laptop's real Wi-Fi, which Windows does call Public. Not run in the packaged app.*
- [x] **T2.20 Phone app screens, one card per state.** Pair → Register → Sign
  in, with the rest under "More" and the address/fingerprint under "Hub
  details". Today the paired screen shows nine equal buttons and a
  95-character fingerprint. Use the brand fonts and logo.
  *Done: phone/www/index.html rebuilt as one card per state: a step strip (Pair, Register, Sign in; done ticked, current marked aria-current=step), then only that step's card with one main button: Scan the hub's code (paste a link folded under it), Register this phone (Ask a manager as a quiet link), or Sign in with your fingerprint plus Sign in the counter PC. Approve a sign-in, kitchen screen, open the till, register again and ask a manager (moved there by show() once registered) are under More; the address, the fingerprint, re-scan and Forget under Hub details. Messages sit under the steps and scroll into view. The brand: the cup logo drawn from the app icon, Bree Serif headings and Inter body bundled in www/fonts (OFL, 58 KB, no network), #4A8DB7 as the main colour. verify:phone 19 (+6): every id app.ts looks up is on the page, no id twice, fonts local, nothing fetched from the internet. Checked in a browser at phone width with the real app.ts bundled against a stand-in plugin, in all three states. Not run on the emulator or a phone; the APK on the Desktop is the old screen until it is rebuilt.*

---

## Tier 3: new restaurant features (additive, each behind a switch)

Each is a new feature key in `features.ts` (off by default), so turning it on
is the owner's choice per café. The order is what a restaurant misses first.
All money arithmetic goes in a pure `shared/src/*.ts` with its own verifier
cases, as the rest of the till does.

- [x] **T3.1 Paid-outs, pay-ins and safe drops on the drawer** (owner):
  who may, which reasons. Today the drawer knows only sales and refunds
  (`shared/src/drawer.ts`), which matters for Lebanese cash handling. The
  expected cash follows, per currency, and appears on the X/Z readings and End
  of Day.
  *Done: Behind a new drawerMovements switch (requires payments, off). shared/src/drawer.ts: MovementKind paidOut/payIn/safeDrop, MOVEMENT_REASONS, movementProblem(), and drawerTotals() takes movements: expected = float + cash − change − refunds − paid out − safe drops + paid in, per currency, never converted; totals gain paidOuts/payIns/safeDrops (optional, so older stored totals read as zero). shared/src/server/drawer.ts recordMovement(): on the open shift's own document (so a hub sends it up with the shift), inside a transaction, only while open, and a movement id sent twice is recorded once; X, Z and End of Day's system figure all include them. POST /api/pos/drawer { action: 'movement' }: the switch, hub lock, logged. The drawer screen: Cash in or out (a sheet: kind, reason, dollars, lira, note) and the X reading lists each one. OWNER TO CONFIRM (safe defaults used): managers and admins only; reasons Supplier paid in cash / Café supplies bought / Staff advance / Other (note needed) for paid-outs, Float topped up / Change brought from the safe or bank / Other for pay-ins. verify:payments 154 (+12), verify:hub 114 (+4: sent twice, X reading, bad reason, closed shift). Seen on the offline dev hub: a barista's pulled record was refused with the message, a manager's 2.50 paid-out made the X reading 7.50 and listed it.*
- [x] **T3.2 Void and discount report**: by day, staff and reason, from the
  lines and the activity log. It pairs with T5.1.
  *Done: /admin/reports/voids (End of Day section, endOfDay access, in ADMIN_NAV): totals, voids and discounts by reason and by person, by day, and every void and discount with search. shared/src/salesReports.ts voidDiscountReport(): a void is worth its price with options × quantity (grossLineTotal is 0 for it on purpose); an item discount is what it took off after the staff rate; the whole-check discount and staff meals come from checkTotals(), so they stack as the bill does; the day is the café's (closedAtParts). Who voided: voidLine() now stamps voidedBy/voidedByEmail/voidedAt on the line; older voids read 'Not recorded' rather than being guessed from the activity log. GET /api/admin/reports?report=voids reads through readClosedChecks(), pulled out of the export's own read so the two cannot disagree. verify:reports (new, 19). Run read-only over the demo project's 422 closed checks of the last 60 days: no errors, and no voids or discounts in the seeded history, so nothing to show there. The page has not been seen signed in.*
- [x] **T3.3 Product mix report**: best sellers by count and revenue, and by
  category. The data is already on closed check lines.
  *Done: /admin/reports/mix (End of Day section, endOfDay access): by category and by item, best sellers first, with count, revenue and a share bar; search. productMix() in shared/src/salesReports.ts: closed checks only (refunded and cancelled sold nothing), voided lines are not sales, an item's revenue is after the staff rate and its own discount, whole-check discounts are shown apart because they belong to no item, items grouped by what they are (source:refId) and named as last sold, category from the current menu (Retail for products, 'No longer on the menu' when gone). GET /api/admin/reports?report=mix. verify:reports 30 (+11). Run read-only on the demo project: 406 closed checks of 422 (16 refunded left out), 2,006 items, $9,177.85, four categories (Food 42.1%), shares summing to 1. Not seen signed in.*
- [x] **T3.4 Hourly sales, with the same day last week.** Café time zone,
  through the export's own day rules.
  *Done: /admin/reports/hourly (End of Day section, endOfDay access): pick a day; takings per hour beside the same weekday a week before, the busiest hour, the change, a grouped-bar chart (HourChart.tsx: the day in teal, last week recessive grey, legend, hover readout per hour, one axis, recessive grid, sized to its own width so text stays 11px) and the same figures as a table. hourlySales() in shared/src/salesReports.ts: café day and café hour (closedAtParts and the zone's clock), a check counts at the hour it closed for its net, refunded checks were still sales that day (the export's rule), cancelled never were; dayBefore() is calendar arithmetic. The chart draws 05:00 round to 04:00 so a night past midnight sits together; the data is unchanged. GET /api/admin/reports?report=hourly reads the eight days in one go. verify:reports 41 (+11, including 22:30 UTC as 01:30 the next café day and a week across a month end). Run read-only on the demo project for 5 Sep: 19 checks $425 against 17 checks $429.25 on 29 Aug; the chart was drawn with those figures on a preview page. Not seen signed in.*
- [x] **T3.5 86 from the till.** A manager marks a dish unavailable on the
  order screen. Per branch (today `available` is one switch for every
  branch), and it works on a hub offline.
  *Done: Behind a new soldOut switch (requires pos, off). A manager taps 'Mark sold out' above the menu on the order screen, then taps dishes to mark them sold out at this branch today, or back on; a sold-out dish is greyed with 'Sold out today' and cannot be tapped, on the order screen and the counter. Stored as menuItems/{id}.soldOut.<branch> = the café day (shared/src/soldOut.ts: the day turns at 05:00, so it clears itself by morning and needs no un-marking), because the till already reads the menu live and menu items are readable: no new query and no Firestore rule to deploy. The server refuses a sold-out dish in addLines() inside its transaction (409, named), except orders made offline, which the kitchen already made. POST /api/pos/sold-out: the switch, managers and admins, the hub lock, logged. On a hub it runs on the hub's own menu with no internet, and pulls keep it: pullSpec keepLocal ['soldOut'] on menuItems, with holdLocalFor() now keeping every kept field except product stock, which still follows its movements. verify:checks 156 (+5, the 05:00 turn), verify:hub 120 (+6, marked/refused/made-offline/back on/expired), verify:hub-sync 399 (+3, a pull never clears it). Seen on the offline dev hub: Mark sold out, Fries tapped → 'Fries, sold out today' live, disabled out of marking, tapped again → back on; no React style warnings after replacing the tile's border shorthand.*
- [x] **T3.6 Reprint a kitchen ticket** from the check, and from `/pos/hub`
  for network printers.
  *Done: Check options → 'Print the kitchen tickets again' (once anything is sent), and on /pos/hub the last ten network-printer tickets of the past 12 hours, each with Print again. Asking adds one to the ticket's reprints (reprintTickets() in shared/src/server/tickets.ts, by check or by ticket, cancelled tickets left out, logged; PATCH /api/pos/tickets { action: 'reprint' } behind the hub lock; the hub page's POST /api/hub/printing, counter PC only). Each count prints once, wherever that station prints: the hub makes job ticket_<id>_r<n> (ticketReprintJob(), any status but cancelled, so a plate already picked up can still be reprinted), and a 'Print here' screen sees a new print id <id>#r<n> (printIdsOf(); nextPrintBatch() already prints an id once and absorbs old ones on opening). The paper says '** REPRINT, NOT A NEW ORDER **' under the table. Known limit: a 'Print here' screen only has the tickets still on its pass, so in cloud mode a ticket already picked up reprints only on a hub's network printer. verify:printing 76 (+6), verify:hub-sync 404 (+5), verify:hub 122 (+2). Seen on the offline dev hub: the button on table 52 answered 'The ticket is printing again (Bar), marked as a reprint.' No network printer configured there, so the hub page list and real paper were not seen.*
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
