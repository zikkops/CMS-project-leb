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
  *Done: sidebar groups fold (a button with aria-expanded per section), the open ones are remembered per browser (admin_nav_open), the current page's section always opens, and "Find a page…" filters every page by name, description and section through filterNav() (asserted in verify:admin-nav). Lint- and type-clean; not looked at signed in, since the sidebar draws only for a signed-in account. Amended 24 Sep 2026 (owner's request): a search needs NAV_SEARCH_MIN (3) letters before it narrows anything, since one or two letters match most of the menu and the list heaves about while somebody is still typing. The rule is in filterNav(), so the sidebar and the Ctrl+K finder cannot disagree about when a search has begun; under the minimum the menu is WHOLE, not empty; spaces are not letters; and both screens say how many letters are still wanted rather than silently ignoring the typing. Five mutations caught by name.*
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
- [x] **T3.7 Email a receipt** through the existing `server/email.ts`. The
  address is typed at the till and not stored unless the customer is a member.
  *Done: Behind a new emailReceipts switch (requires pos, off). The receipt page has 'Email it': type the address, Send; 'Used for this receipt only. It is not kept.' POST /api/pos/receipt-email (pos section, hub lock): shared/src/server/receiptEmail.ts builds the same text the printer gets (buildReceipt + receiptToText, 42 columns) and sends it through server/email.ts; the address is never stored or logged (the log says which receipt, not where), at most 3 sends per check (receiptEmails count), and with no mail key (every hub: its environment is an allowlist) it answers 'Email is not set up on this till. Print the receipt instead.' shared/src/receiptEmail.ts readReceiptEmail() refuses a phone number, a name, two addresses, spaces, over 254 characters. verify:receipt 99 (+5), verify:hub 125 (+3, with the test's environment stripped of any mail key so nothing can be sent). Seen on the offline dev hub: Email it → an address → the not-set-up answer. Not run: a real send, deliberately (no mail to real addresses from here); needs RESEND_API_KEY and RESEND_FROM on the POS host.*
- [x] **T3.8 Service charge** (owner): the rate, whether it is
  optional, and whether VAT applies to it. A line on the check, the receipt
  and the export.
  *Done: Behind a new serviceCharge switch (requires pos, off), at serviceChargeRate in Business Settings (new field 'Service charge', 0–30%, default 0). OWNER TO CONFIRM (safe defaults used): the rate is copied onto a check when it opens (a later change re-prices nothing open); charged on what is left after every discount, never on a discount; inside net, so VAT is extracted from it like the prices, and payment, splits, the drawer and End of Day follow; a manager can take it off a check before any payment (kept as rate 0 with who, logged); loyalty points are on the food, not the service. checkTotals() gains service (serviceRate() ignores anything not a sensible fraction, so a stray 10 for 10% charges nothing); shareForLines() carries a share of it; the receipt prints 'Service 10%' above the total; the export has a Service column on checks and days. verify:checks 161 (+5), verify:receipt 101 (+2), verify:payments 157 (+3, seats and people still sum to the bill), verify:export 65 (+3, VAT out of the whole bill), verify:hub 131 (+6: off → none, on → copied, setting changed later → unchanged, taken off, twice refused, barista refused). Seen on the offline dev hub: a new table 77 carried rate 0.1, Caesar Salad showed '$10.18 incl. $0.93 service (10%)', Check options → 'Take off the 10% service charge' → $9.25. The settings field has not been seen signed in.*
- [x] **T3.9 Tips on card** (owner): a tip field on a card payment.
  It feeds the tips pool, and the drawer is untouched.
  *Done: Behind a new cardTips switch (requires payments, off). OWNER TO CONFIRM (safe defaults used): the tip is in dollars on a dollar card only, and goes into the same pool as the jar. The pay sheet shows 'Tip on the card' for Card $ and says what to charge ('$9.25 for the bill and $2.00 to the tips pool'); the paid list shows '+ $2.00 tip'. The tip is its own field on the payment (tipUsd), never part of amount, so the balance, change and drawer are exactly as without it; tipProblem() refuses cash, lira cards, negatives, fractions of a cent, and absurd tips; the server refuses a tip with the switch off. drawerTotals() reports cardTips beside the drawer; daySystem() adds the day's; End of Day shows 'Plus $X tipped on cards at the till' and the server stores cardTipsUsd on the report when it is saved (never typed); the tips page's pot is the jar plus card tips. Also fixed on the way: End of Day's tips preview said 'After 11% deduction' whatever the setting was (the dead-constant bug CLAUDE.md warns about); it reads tipsDeductionRate now. verify:payments 166 (+9), verify:hub 132 (+1). Seen on the offline dev hub: table 77 paid by card $9.25 + $2.00 tip, Paid in full. The End of Day and tips pages have not been seen signed in.*
- [x] **T3.10 Par levels and low-stock alerts** on supplies. A dashboard tile
  (T2.17) and a filter on the supplies page.
  *Done: shared/src/stockLevels.ts: a branch's level is its own (supplies/{id}.par.<branch>) or else the existing threshold every branch uses; 0 is a real level; low below it, out at nothing or less; lowStock() lists out first, then furthest below, with what brings each back to its level. The supplies page: the inline 'min' now edits the level at the branch being looked at ('Main min' when it has its own; blank goes back to the minimum; PATCH /api/admin/inventory { action: 'par' }, setPar()), every low/out badge and count uses it, and a 'Low stock only · N' filter, which ?low=1 opens. The dashboard's Today strip has a Low stock tile (supplies section and module) with the count, how many are out and the first names, linking to /admin/supplies?low=1. verify:delivery-math 44 (+9). Run read-only on the demo project: 40 supplies, 22 low at Main, 18 of them out. Neither page seen signed in.*
- [x] **T3.11 Hold and fire courses.** Lines already carry `course`, but Send
  fires everything. Add "Send drinks now, hold mains", then "Fire mains", with
  the KDS showing held courses.
  *Done: Behind a new holdAndFire switch (requires kds, off). Held by STATION, not course: the owner took courses off the order screen on 14 Sep 2026 (new lines carry course: null), so 'send drinks now, hold mains' is 'Send the drinks, hold the food' (Kitchen and Sweets held), then 'Fire the food now (Kitchen)'. OWNER TO CONFIRM that holding by station is what they want. A new ticket status 'held': sendCheck(…, hold) makes the held stations' tickets held (heldStationsFor() holds only stations this Send has), the check records heldStations; fireHeld() turns them new with sentAt NOW, so the kitchen's timer and the printers start when the food is wanted. The kitchen cannot move a held ticket (advanceTicket refuses; its Back button is hidden); the kitchen screen shows it grey, 'Held: do not start until the front fires it', with a 'N held' badge; no printer prints it until fired (the hub prints 'new'; useAutoPrint leaves held out of its ids). The order screen offers the hold only when a Send mixes drinks and food. verify:checks 166 (+5), verify:hub 140 (+8: switch off refused, bar now/kitchen held, the kitchen cannot start it, fired timed from now, nothing held after, firing twice refused), verify:hub-sync 405 (+1, a held ticket is not printed). Seen on the offline dev hub: table 78, Americano and Caesar Salad → 'Sent — Kitchen ×1 (held), Bar ×1'; the Kitchen screen showed it HELD with no Start; 'Fire the food now (Kitchen)' → 'Fired — Kitchen'.*
- [x] **T3.12 Clock in / clock out** from the phone app, signed with the
  fingerprint, plus a timesheet page. Wages and labour % come after, and are
  (owner): who sees pay rates.
  *Done: Clock in / clock out from the staff app's Sign in card ('Clock in', or 'Clock out (in since 08:02)'), with the fingerprint: the phone signs clockMessage() (its own label, naming this hub's certificate, the challenge and in or out) over a challenge from the same issueChallenge() sign-in uses; server/hubClock.ts clockWithKey() uses the challenge up before the signature, needs the key its id names and a pulled staff record, refuses the same direction twice, and records timeEntries on the hub for its branch; POST/GET /api/hub/clock (hub only), logged. A hub sends clock-ins up with its trading (PUSHED_COLLECTIONS, own branch only), writes them straight through even while its branch trades online (not trading, never held), and keeps them through a hand-back. /admin/reports/timesheet (End of Day section): hours by person and every shift (café day, in, out, hours; still in; over 16 hours flagged), and clock-outs with no clock-in listed apart; timesheet() in shared/src/timeClock.ts. NOT built, as the item says: wages and labour %, waiting for the owner's answer on who sees pay rates. verify:hub-sync 413 (+8: in, twice refused, a sign-in signature is not a clock, in is not out, another hub's refused, out, pushed as own branch), verify:reports 49 (+8). Not run: the phone's button on a device (it needs a registered key) and the timesheet page signed in.*
- [x] **T3.13 Waitlist** beside reservations.
  *Done: Behind a new waitlist switch (Front of House, requires tableReservations, off). /admin/tables/waitlist beside Table Reservations (same section and people): add a party (a name to call, how many, what they were told, a note; no phone number is kept, since nothing texts anyone), then Seated or Left, with an undo; waiting first come first with their place, minutes waited in red once past the quote, today's average wait, refreshed every 20 s so a second screen at the door agrees. Today only, the café's day. Server-only collection waitlist (no Firestore rule, no rules deploy) behind /api/admin/waitlist; adding goes through postOnce so a double Save adds one party; branch scoping as everywhere. Rules in shared/src/waitlist.ts; verify:reports 57 (+8). The page has not been seen signed in.*
- [x] **T3.14 Ingredient stock transfers** between branches (today only retail
  `products` move).
  *Done: /admin/supplies/transfer ('Move Stock Between Branches' in Stock & Ordering): pick from and to (branches that hold ingredient stock), type how much of each item, Move. shared/src/server/supplyTransfer.ts transferSupplies(): the product transfer's rules for supplies' quantity.<branch>, in each item's purchase unit, fractional to three places; every line or none; on-hand read and checked inside the transaction, never the screen's copy; a request marker in stockTransfers so a retried Move moves nothing twice (postOnce). POST /api/admin/supply-transfer: supplies section and a manager or admin (the section is open to baristas and kitchen crew for counting; OWNER TO CONFIRM), logged with the stored names. verify:hub 146 (+6: 2.5 L moved, sent twice moves once, too much refused naming the item and nothing moved at all, missing refused, bad requests refused). The page has not been seen signed in.*

---

## Tier 4: making sections easy to add (structural, still no data change)

Do these after T0.1, which protects them.

- [x] **T4.1 POS tile registry.** Add `POS_TILES` (label, icon, colour, route,
  feature, section) and filter it the way the admin nav is filtered. Adding a
  till screen then means adding one entry. Today the tiles are hand-written
  JSX in `pos/app/pos/page.tsx`.
  *Done: pos/app/lib/posTiles.ts: POS_TILES (key, label, sub, icon, colour, href, feature, section) and visibleTiles(role, flags), filtered as the admin nav is: the feature on, and a role that opens the section. The floor renders its big boxes from it; the five hand-written NavTile lines and their per-tile feature switches are gone. Adding a till screen is one entry. verify:sections gains a check (6 assertions): every tile's href is a real pos page, its section and feature exist, no key twice; breaking a route on purpose failed it by name. Today's roles see what they saw (everyone with the till also has the kitchen display). Seen on the offline dev hub: Counter, Closed, Kitchen display, Drawer, and no Allergens with food safety off, as before.*
- [x] **T4.2 One `SECTIONS` registry.** Label, roles and feature are declared
  in one place in `roles.ts`, with `SECTION_ACCESS`, `SECTION_LABELS` and
  `features.sections` derived from it. Today one section has three names
  ("Goods Receiving", "Receive a Delivery"…).
  - Keep reference equality: derive once, and re-export the same arrays
    (`useRequireRole()` finds a section by reference).
  *Done: Done 21 Sep 2026. `SECTIONS` in shared/src/roles.ts declares each section's roles, label and feature on one line. `SECTION_ACCESS` is derived from it, with each value the entry's own roles array, so reference equality holds. `SECTION_LABELS` is derived there too and re-exported from adminAuth.ts as the same object. `featureForSection()` reads the registry, and features no longer carry `sections` lists. verify:features now checks that every section names a real feature and has a label: 22 sections read, and a mutated feature name was caught. docs/adding-a-section.md updated.*
- [x] **T4.3 `npm run new:section <key>` scaffolder.** It writes the registry
  entry, the admin page stub (with `PageHeader`, `useRequireRole`), the API
  route stub (with `requireSection`, `toResponse`, `runtime = 'nodejs'`), the
  nav entry and a verifier stub. The last step prints what is left by hand
  (the rules). Built on T2.1, T4.2 and T0.1.
  *Done: Done 21 Sep 2026. `npm run new:section -- <key>` (scripts/new-section.mjs) writes the SECTIONS entry, a new FEATURES entry that is off by default (or uses --feature), the nav item under --nav with that section's icon, the admin page stub (PageHeader, useRequireRole, startLoad), the route stub (requireSection, the feature switch, toResponse, runtime nodejs), a pure rules file, and a verifier with its npm script. It then prints what is left by hand: the TODO wording, the rules (with the matching can() roles), indexes, till tile and hub collections. It works everything out before writing anything, and it refuses an existing key, an existing file or an unknown feature, role or nav section. Tried as stockTakes: tsc for admin and shared, lint, verify:features, verify:sections and verify:admin-nav all passed, and the new verifier ran 2 passed. The trial was then removed.*
- [x] **T4.4 Theme tokens.** Move hard-coded colours (`#0a0a0a`,
  `rgba(255,255,255,…)`) into CSS variables, one app at a time. It is the
  groundwork for a light theme, and for a client's own colours without code
  changes.
  *Done: Done 21 Sep 2026, for all three apps. brandCss.ts gains three theme tokens: `--overlay-rgb` (255, 255, 255; a light theme sets 0, 0, 0), `--surface-deep` and `--on-accent`. A codemod moved every literal white tint and #0a0a0a in web, admin and pos app code onto them: 952 tints across 106 files, plus 15 near-blacks. Text on a chip became on-accent; backgrounds became surface-deep. The manifest and the POS icon are left alone, because they are not CSS. verify:brand now fails on the literal in app code (checked by putting one back). The tokens are in one place but not yet brand-configurable. In the browser on the web app, the tinted declarations computed to the same rgba(255, 255, 255, a) as before. shared/src has one canvas fillStyle, which cannot read a variable and was left alone.*
- [x] **T4.5 Split the biggest admin pages** into `_components/` using the UI
  kit: menu (1,034 lines), end-of-day (1,034), supplies/receiving (986),
  products (985), events (940), weekly-orders (872). One page per session,
  with no behaviour change.
  *Done: Done 21 Sep 2026, one commit per page, no behaviour change. menu went from 1,035 lines to 427, end-of-day from 1,044 to 453, supplies/receiving from 989 to 538, products from 986 to 250, events from 941 to 292 and weekly-orders from 866 to 209. Each page now keeps its state and handlers, and its sections, forms and modals live in its own _components/ folder as props-only components. useIsMobile is still copied per file, as CLAUDE.md asks. Every moved block was checked against the original. Passed: tsc, eslint, verify:admin-nav, verify:sections, verify:brand, and `npm run build:admin` (exit 0). Not looked at signed in: the admin pages need a real sign-in.*
- [x] **T4.6 `useIsMobile` from one place** (owner). CLAUDE.md
  deliberately keeps a copy per file ("copy it in; don't refactor existing
  files to share it"). There are 62 copies, with breakpoints of 768 and 880.
  Only if the owner lifts that rule. It is a codemod plus one breakpoint.
  *Done: Closed by default, 21 Sep 2026: NOT refactored. OWNER TO CONFIRM. CLAUDE.md's rule to copy useIsMobile into each file stands until the owner lifts it, and the item says only if they do. Inventory at HEAD: 63 copies across the apps. The default breakpoints are 768 (59 copies), 900 (2), 880 (1) and 640 (1). If the rule is lifted, the codemod is: one `useIsMobile(breakpoint = 768)` in shared/, a check of the four odd breakpoints (the till's 900 is deliberate, see POS look and feel), and a verifier that fails on a new local copy.*

---

## Tier 5: higher risk (data models, permissions, the hub's database, rules)

Each needs its own plan note in the vault first, and the owner's answers.

- [x] **T5.1 Manager approval for voids of sent food and for refunds**
  (owner). Today `voidLine()` and `refundCheck()` accept any till role,
  barista included. This is the biggest cash-fraud gap. The same fingerprint
  approval the hub already uses for sign-in is the natural fit on a hub. Online,
  it is a manager's session. Covered by `verify:checks` and `verify:hub-sync`
  cases.
  *Done: Done 21 Sep 2026, safe default. OWNER TO CONFIRM. Voiding a line already sent to the kitchen, and refunding a closed check, now need a manager or an admin (`reversalRefusal()` in shared/src/checks.ts). They do it from their own session, as discounts already work: online that is their sign-in, and on a hub their phone's or the counter's sign-in. voidedBy and refundedBy record who. A line never sent can still be struck off by anyone, so a mis-tap needs no manager. voidLine() judges from the stored line, not the request. The till shows the reason in place of the void reasons and the Refund button. Not built: a barista asking and a manager approving by fingerprint on a hub, which is the natural next step (the approval flow already exists for sign-in). Covered by verify:checks (8 cases) and verify:hub (a barista's void of sent food and refund refused with 403, the line still sent, the check still closed, and an unsent line still voidable).*
- [x] **T5.2 Trim the hub's change log.** `changes` is never deleted from
  (`hubStore.ts`), so it grows forever. Keep what has not been sent up plus a
  window (e.g. 7 days). Watch that a change feed or `readyToLeaveHub()` never
  reads past the trim.
  *Done: Done 21 Sep 2026. After every successful push, the hub deletes change-log rows up to where it has sent (`pushedSeq`) that are more than 7 days old. It always keeps the newest row, so lastSeq() never goes backwards; the rule is `changeLogTrim()` in shared/src/hubSync.ts and the delete is `HubStore.trimChanges()`. Nothing unsent is ever trimmed, so an unpaired hub, or one offline for a month, keeps everything. Pushing and readyToLeaveHub() both read forwards from pushedSeq, so they never reach a trimmed row. Screens only compare sequence numbers. AUTOINCREMENT means a trimmed number is never reused, and a document's version is its own column, so transactions are unaffected. Covered by verify:hub (8 cases on a real SQLite file: unsent kept, trimmed up to the place, newest kept, next number new, versions kept, recent kept) and verify:hub-sync (5 cases, 418 passed).*
- [x] **T5.3 Index and bound the hub's queries.** Only `==` filters and
  `branch` reach SQL today. `array-contains`, ranges, order and limit happen in
  JavaScript over every row. So X/Z readings (`shiftIds array-contains`) and
  "open checks" parse every check ever stored, twice in a transaction. Add JSON
  indexes for the till's 14 query shapes, and push `limit`/order into SQL where
  `runHubPlan()` agrees with `runPlan()`. Tested with `verify:hub` on a hub file
  seeded with a year of checks.
  *Done: Done 21 Sep 2026. Two expression indexes: (collection, branch, status) and (collection, checkId), matching runQuery()'s expressions exactly. SQLite now narrows `in` and `array-contains` on plain values, and a range on a Timestamp by its whole seconds; before, only `==` was narrowed. Every filter is still checked in JS afterwards, so a narrowing can only let an extra row through, never hold a match back. Order and limit stay in JS, because Firestore orders across types and a Timestamp is an object in the JSON, which SQLite's ORDER BY cannot reproduce. T5.4 (archiving) is what bounds a year of closed checks. Tested in verify:hub on a hub file seeded with 6,007 checks. Open checks decoded 5 rows, found through the new index (EXPLAIN QUERY PLAN). A shift's X/Z query decoded only its 16. Today's closings decoded a day, not a year. The closed-checks screen over the year took 33 ms. Every answer was compared with the seed. Two mutations were caught: the array narrowing, and a strict comparison on seconds, which was caught only after adding a same-second case.*
- [x] **T5.4 Archive closed trading off the hub.** Closed checks and tickets
  already in the cloud and older than N days leave the hub database. Follows
  T5.2.
  *Done: Done 21 Sep 2026. After each successful sync, a hub deletes its own copies of closed and refunded checks, and of bumped and cancelled tickets, once the cloud has their last write (version at or below pushedSeq) and they are more than 60 days old. A refunded check is dated by the later of its closing and its refund. The rule is `archivable()` in shared/src/hubSync.ts; the delete is `archiveTrading()`, at most 400 a run. It never touches an open check, a ticket still on a pass or held, or anything unsent. Deletions are never sent up, so the cloud keeps the books. Trade-off: while a branch is hubbed the online till is view-only, so a refund of a check older than 60 days is not possible until hand-back. Covered by verify:hub-sync (11 rule cases and a real store, 433 passed).*
- [x] **T5.5 Order types: dine-in, takeaway, delivery, and named tabs.** This
  drops the one-open-check-per-table rule for non-table orders. It touches
  `openCheck`, the floor, the counter, the KDS header and the export. (owner):
  the types and their names.
  *Done: Done 21 Sep 2026, safe default. OWNER TO CONFIRM the types and their names. Checks now have `orderType`: dine-in, takeaway, delivery or tab. A check with no type (every older one) is dine-in. The rules are in shared/src/checks.ts: ORDER_TYPES, orderTypeOf, checkLabel, orderOpenProblem and readOrderName. Takeaway, delivery and tab have no table: tableId '' and tableNumber 0, with an optional name, which is required for a tab. They skip the one-open-check-per-table rule, so several can be open at once, and the till's openId makes a retried open the same order. They cannot be moved to a table. Everything that names a check goes through checkLabel(), so nothing shows 'Table 0': the floor tiles and open sheet (order-type chips and a name field), the check page and pay sheet, the closed list, the counter, the KDS header and printed ticket (tickets carry an `orderLabel` snapshot), the ready panel, the hub page, the receipt ('Order: Takeaway: Rana'), the activity log wording and the fallback text. The sales export gains an Order column. The counter still opens tables only, including offline; it shows orders opened on the floor. Covered by verify:checks (12 cases) and verify:hub (two takeaways at once, stored shape, replayed tab, refusals, no move, the ticket's label). export, receipt, counter, printing, offline, payments and reports all still pass. Not looked at in a browser yet.*
- [x] **T5.6 Move items between checks, and merge tables.** A new check
  action, with totals, payments and the drawer kept whole. It must be safe to
  send twice (a `batchKey`, as Send has).
  *Done: Done 21 Sep 2026. PATCH checks gains two actions. `moveLines` moves chosen items to another open check at the branch, as they are (sent or not, with their discounts), stamped with movedFrom, movedBy and movedAt. `merge` moves every item still standing, adds up the guests, and closes the check as cancelled with `mergedInto`, keeping its voided lines. The rules are moveProblem() in shared/src/checks.ts. Money stays whole: nothing moves off a check with a payment on it, a check may receive items when it has payments, and items move only between two staff meals or two ordinary checks. It is safe to send twice: every moved line carries the move's key (moveAlreadyApplied()), and a merge already done is an answer. Both are logged. The till's check page has 'Move items to another check' and 'Merge into another check' (MoveItemsSheet.tsx), and after a merge it goes to the other check. The hub lock covers both, because the other check is at the same branch. A kitchen ticket already sent keeps the table it was sent from. Covered by verify:checks (12 cases) and verify:hub (a move and its retry, a merge and its retry, the payment refusal).*
- [x] **T5.7 Loyalty on a hub.** Today points are silently not credited when a
  check closes on a hub (no customer records there, and `transactions` is not
  pushed). Either queue the credit and push it up, or say at the till that
  points are credited when back online. (owner): which.
  *Done: Done 21 Sep 2026, safe default: the till says so. OWNER TO CONFIRM (the alternative is to queue the credit and push it up). A hub holds no customer records, so setLoyaltyCustomer() refuses there with 409: 'Loyalty points are not collected on the café hub. Tell the customer this visit earns no points.' That is checked before the loyalty switch, so a code is never taken and then silently not credited at close. On a hub, the check page shows that sentence in place of 'Add loyalty customer'; hub mode is read through useClientValue(onHub), so there is no hydration mismatch. Covered by verify:hub. Queuing credits for the cloud would need `transactions` pushed and the member code resolved in the cloud, which is a bigger change that waits for the owner.*
- [x] **T5.8 Warn when an export is cut short.** `salesExport.ts` and
  `foodCost.ts` stop at 20,000 checks with no warning. Query per branch, and
  say so when the cap is hit.
  *Done: Done 21 Sep 2026. The sales export, the reports (voids, mix, hourly) and the theoretical food cost all read at most EXPORT_CHECK_CAP (20,000) checks, oldest first. They now return `cutShort: { cap, completeThrough }` when they hit it (exportCutShort() in shared/src/salesExport.ts). The last day read may be cut part-way, so the answer is whole only through the day before. The export page, each report page (CutShortNote in the admin UI kit) and the Food Cost Report say so: complete only through that day, so ask for a shorter range or one branch. NOT done: a query per branch, which needs a composite (branch, closedAt) index, and an index deploy is its own approved step. With the warning, a cut-short range can no longer pass for a complete one. verify:export has 5 new cases (70 passed); reports and recipes still pass.*
- [x] **T5.9 Log after a committed sale without failing it.** `logActivity`
  runs after the transaction. If it throws, the till shows an error for a sale
  that happened. Catch it, and report it through `reportError()`.
  *Done: Done 21 Sep 2026. The fix is in the server logger itself (shared/src/server/activityLog.ts), so every caller is covered: writeLog() never throws. Every route logs after its write has committed, so an entry that fails to write no longer turns a closed sale into an error on the till. The failure is filed through recordError(), the server side of reportError(), into /admin/errors as 'Activity log entry not written (<section>)': one report per kind, counted, redacted as always. If that fails too, it goes to the server log. Each app's next.config sets BIG_CMS_APP so the report is filed under the right app. Covered by verify:hub (an entry that cannot be written does not throw, is filed once, and a repeat counts on the same report); verify:errors still passes.*
- [x] **T5.10 Generate the rules' role lists from `SECTIONS`.** The role
  arrays in `firestore.rules` are written by hand. Generate the helper block
  between marker comments. **A rules deploy goes out one collection at a time
  with approval** (CLAUDE.md, Firestore rules).
  *Done: Done 21 Sep 2026, NOT deployed. `npm run rules:generate` (scripts/generate-rules.mjs, with the pure generateRulesBlock() in scripts/rules-helpers.mjs) writes the section helpers in firestore.rules from SECTION_ACCESS, into a block between BEGIN and END GENERATED markers. A helper is generated only for a section a rule actually calls (comments ignored), so an uncalled helper cannot come back. `--check` exits 1 when the file is stale. verify:sections fails when the block is not what the generator writes; this was checked by hand-adding a role, which failed both rules checks. The regenerated file has the same 8 helpers with the same role lists (compared line by line), only reordered to SECTIONS order, and every rule outside the block is unchanged. rules:live will show that textual difference until the next approved deploy, which changes no permission. docs/adding-a-section.md step 7 and CLAUDE.md updated.*
- [x] **T5.11 Scheduled backups of the cloud and the hub.** A managed daily
  `gcloud firestore export` (needs billing and a bucket, set up by the owner),
  and a nightly copy of `pos.db` on the counter PC (SQLite `VACUUM INTO`),
  keeping 7.
  *Done: Done 21 Sep 2026 for the hub. OWNER TO CONFIRM and set up the cloud side. Hub: the POS server copies pos.db once a café day into backups/ beside it (pos-YYYY-MM-DD.db) and keeps 7. The copy uses SQLite VACUUM INTO (HubStore.backupTo()), so it is consistent while trading; it is written as .part and then renamed. It is checked a minute after start and every hour, from pos/instrumentation.ts. Only files of exactly that name are ever deleted. The rules are hubBackupPlan() in shared/src/hubBackup.ts. verify:hub checks the plan (4 cases) and makes a real copy of a hub file, which read back with every document. Cloud: a managed daily export needs billing and a bucket, so it is not set up. docs/scheduled-backups.md gives the owner the gcloud steps (Firestore scheduled backups, or an export to a bucket) and a quarterly restore drill; nothing was run against a project.*
- [x] **T5.12 Menus by time of day and happy-hour prices.** A price rule by
  day and time, judged in the café's zone on the server when the line is
  added.
  *Done: Done 21 Sep 2026. A menu item may carry serving `hours` and up to six `priceRules`, each with days, a from and to time, a price and a name. Windows may run past midnight. The rules are in shared/src/timePricing.ts: inWindow, priceAt, servedAt, and readers that refuse bad input and read stored data safely. When a line is added, the server judges it on the café's clock (zonedParts in BRAND.locale.timezone): the first matching rule sets unitPrice and is named on the line as `priceRule`, and an item outside its hours is refused with 409. An order recorded after an outage is priced at the time it was taken and is never refused for hours. The till's menu hook applies the same rules each minute, so tiles show the happy-hour price (with the usual one struck through) and grey out items not served now, on the check screen and the counter. The admin item form has a 'Served' and a 'Price by time' editor (TimeRulesEditor.tsx), and /api/admin/menu validates both, refusing rather than guessing, and leaves them alone when an older form does not send them. Hubs pull the fields with the item. Covered by verify:checks (19 cases, including the Friday-night-into-Saturday window) and verify:hub (happy-hour price charged and named, out-of-hours refused, outage order recorded). Not looked at signed in.*
- [x] **T5.13 Combos and meal deals.** They touch recipes, the KDS, splits
  and reports, so they come last among menu features.
  *Done: Done 21 Sep 2026. A menu item with `comboOf` (two to six other items) is a combo. When it is added, the server writes the combo as one line at its own price with no station, and each part as a $0 line with `comboOf` naming the combo's line, its own station and its own recipe snapshot. The rules are in shared/src/combos.ts. That keeps the rest of the till unchanged: the kitchen gets each part at its own station (the combo makes no ticket); the bill, VAT, splits and the drawer see the combo price once; stock moves per part through the existing recipe path; the product mix counts the combo sold and the parts made at $0. A combo is voided whole, and a part may not be moved without it (withComboParts, partWithoutCombo). The check screen shows the parts indented as 'in combo', and the receipt lists them under the combo with no price. The admin item form has a 'Combo of' picker, and /api/admin/menu refuses a combo that contains itself, nests, names an item that is gone, or includes an item with a required option choice; the till refuses that last case too, because nobody would be asked the choice. Covered by verify:checks (12 cases), verify:hub (expand, bill, stations, no move alone, void whole, required-choice refusal) and verify:receipt (parts under the combo, no priced part). Not looked at signed in.*

---

## Tier 6: signing staff in and out (added 21 Sep 2026)

How staff sign in today:
- **Online till:** Firebase email and password, typed on every device.
- **Café hub:** staff unlock their own phone with a fingerprint, or a manager
  approves. The counter PC shows a four-digit code, typed into the staff app.
  A hub session lasts until 05:00.
- **Signing out:** only a small Sign out button on the floor
  (`pos/app/pos/page.tsx`). Nothing on the counter, the check screen or the
  kitchen display, and no way to end a session from anywhere else.
- **Clock in and out** (T3.12) is a separate step in the staff app.

The goal is a sign-in that takes one scan, and a sign-out that happens
reliably at the end of a shift and whenever a shared device changes hands.

**A QR code is shown by the device being signed in, and scanned by the phone
of the person signing in — never the other way round.** A code shown by the
device lives two minutes, works once, and needs a fingerprint or a signed-in
phone to answer it, so a photo of it is worthless. A code a person carries (a
printed badge, a QR on a lanyard) is a password anyone can photograph; see
T6.8.

Every task keeps the existing rules: codes and secrets stored only as hashes,
one refusal for every kind of wrong answer, the approval signed over a
challenge from `issueChallenge()`, and logged under the person. Each adds its
cases to `verify:hub-sync` (or a new verifier for the online till), with
mutations caught by name, and is checked on the emulator against a built hub.

- [x] **T6.0 The owner's answers first** (owner). Answer and record these
  here before T6.3 onwards.
  *Owner's answers, 21 Sep 2026:*
  - **Signing in clocks you in, and signing out clocks you out.** So T6.6 is
    decided and is no longer an owner task.
  - **A photo of a code is useless anyway**, because signing in at a hub needs
    the café wifi. That holds for T6.3. T6.4 (the online till) is not tied to
    the wifi, so there the code's two minutes, single use and the approving
    phone's own sign-in do that job.

  Defaults taken 21 Sep 2026 under the owner's "do them as you see fit and
  we fix it", each **OWNER TO CONFIRM**:
  - **Shared devices:** the counter PC (a hub's own screen), a kitchen screen
    session, and any online-till browser switched to "This is a shared
    device" (T6.7). Every other device is one person's phone.
  - **The online till gets scan-to-sign-in too** (T6.4): a café without a hub
    is exactly where a password is typed on a shared screen.
  - **Idle limit on shared online devices: 15 minutes**, the counter PC's
    (S25), so there is one rule to explain.
  - **Printed badges: no** (T6.8).
  *Done: Defaults recorded, OWNER TO CONFIRM: shared = counter PC, kitchen screen, online-till browser marked shared (T6.7); online till gets scan-to-sign-in (T6.4); idle limit 15 min on shared online devices; no printed badges (T6.8).*
- [x] **T6.1 Sign out from every till screen, and one sign-out for all.**
  Today only the floor has the button. Put it on the counter, the check
  screen's actions, the kitchen display (for a person, not a kitchen screen
  session) and the drawer, all through one `signOut()` that:
  - ends the hub session (`DELETE /api/hub/session`) or the Firebase sign-in
  - clears the stored session
  - lands on the sign-in page

  If the device holds unsent lines or a queued outbox, say so first; that
  must never block signing out. Low risk: no data change.
  *Done: SignOutButton (pos/app/lib/SignOutButton.tsx) on the floor, counter, check screen, kitchen display and drawer; one signOutHere(): warns about unsent lines / queued or stuck outbox (signOutWarning(), never blocks), backend().signOut() (hub DELETE session or Firebase), plain load to /pos/login. Hidden for a kitchen screen session. verify:counter 52. Not looked at signed in.*
- [x] **T6.2 "Switch user" on a shared device.** Signing out of a shared
  device goes straight to a sign-in screen that lists the staff (first names,
  as the counter already does), so the next person taps their name and scans
  (T6.3). A screen that says who is signed in, large, on every page of a
  shared device, so nobody takes an order under someone else's name.
  *Done: SignedInStrip in a new /pos layout: on a shared device (hub counter PC, or an online browser with the new 'Shared device' switch on the floor, sharedDevice.ts) every till page says 'Signed in: <first name>' large with Switch user (= signOutHere, warning first). Hub session routes now return the pulled first name; backend().signedInAs() on both backends; personLabel() names nobody for a kitchen screen. Switch user lands on the counter's name list (hub) or the scan sign-in (online, T6.4); staff names are never listed to a signed-out online browser. verify:counter 55. Not looked at signed in.*
- [x] **T6.3 Scan to sign in at the counter PC** (hub). The counter's sign-in
  screen shows a QR beside the four-digit code.
  - The QR encodes the hub's fingerprint, the request id and the code
    (`bigcms-signin:…`).
  - The staff app scans it with the camera plugin it already has, and the
    fingerprint signs the existing `counterSignInMessage()`. Nothing new to
    trust, and no code to type.
  - The code stays as the fallback when the camera will not read.
  - The QR is redrawn with each new request (two minutes), and
    `parseSignInLink()` refuses anything but this hub's fingerprint.
  - Also a **"scan to sign in" start from the phone**: tapping your name
    becomes optional, because the scan says who you are.
  *Done: Counter sign-in screen: 'Scan to sign in' (no name needed) and a QR beside the four-digit code (bigcms-signin:v1:<hub fp>:<request>:<code>, signInLink()/parseSignInLink() in counterSignIn.ts). Hub: open requests (one at a time) claimed by the approving key's owner; a scanned approval names its request and must be this person's own or open. Staff app: 'Scan the counter' signs the existing counterSignInMessage(); the typed code stays the fallback. verify:hub-sync 444, 4 mutations caught. Not run on the emulator or a real phone.*
- [x] **T6.4 Scan to sign in on the online till** (owner, from T6.0). For
  cafés without a hub, a shared browser device shows a QR instead of an email
  and password.
  - The device asks the cloud for a request (`POST /api/staff-signin`, a
    random id plus a collect secret the device keeps). The QR shows the id.
  - The staff member's own phone, already signed in to the staff site or the
    staff app, scans it and approves. The approval route checks their Firebase
    token and that they are staff (`requireStaff()`).
  - The device collects a Firebase custom token for that person
    (`adminAuth().createCustomToken(uid)`) and calls
    `signInWithCustomToken`. Their claims come with the account, so roles and
    grants work unchanged.
  - Two minutes, one use, stored hashed, and logged.
  - **Server-only collection, no Firestore rule, so no rules deploy.**
  - The device never sees a password, and the phone never sees the device's
    secret.
  *Done: Online till: 'Show a code to scan' on the sign-in page (cloud only); QR = /pos/approve#r=<id> (id in the fragment), four check digits from the id on both screens; the staff member's signed-in phone approves on /pos/approve (requireStaff); the device collects a one-use Firebase custom token (createCustomToken) and signInWithCustomToken. /api/staff-signin: ask capped at 2,000 a day (unauthenticated), body capped before parsing, secrets hashed, 2 minutes, one use, logged; staffSignInRequests server-only, no rule, no rules deploy; 404 on a hub. verify:hub-sync 458, 4 mutations caught. Not run live.*
- [x] **T6.5 See where you are signed in, and end it from anywhere.**
  - The staff app lists your live sessions: counter PC, kitchen screen, or
    another phone, with when each started. You can end any of them.
  - The hub page (`/pos/hub`) and a new admin page list everyone signed in at
    each hub, so a manager can end one. For example: somebody went home still
    signed in on the counter.
  - `hubSessions` gains a readable label (device, started, last tap). The
    token stays hashed.
  - Ending a session is logged.
  *Done: Hub sessions carry a device label (Counter PC, the phone's name, Kitchen screen, Browser on the café wifi); listHubSessions()/endHubSessionById() by the token's hash. /api/hub/sessions: your own, or everyone's for a manager/admin or the counter PC; end by POST, logged. /pos/sessions page (also what the staff app shows), Sessions button on the hub floor, list with End on /pos/hub. Cloud: the hub reports sessions each sync (/api/hub-sync/sessions); Café Hubs shows them with End, which the hub carries out at its next sync. verify:hub-sync 470, 4 mutations caught. Not looked at signed in.*
- [x] **T6.6 Signing in clocks you in, signing out clocks you out** (owner's
  answer, 21 Sep 2026). There is no separate step and no prompt. It writes the
  existing `timeEntries` through the same path as `clockWithKey()`, so the
  timesheet (T3.3) sees it:
  - A second sign-in on another device while already clocked in does not clock
    in twice (`nextDirection()`).
  - Signing out of one device while signed in on another does not clock out
    until the last session ends.
  - A kitchen screen session (`screen:…`) is a device, not a person, and never
    clocks anyone. The 05:00 expiry stays as the backstop. A person still clocked in
  at 05:00 is flagged on the timesheet as "no clock-out", never clocked out
  silently at a guessed time.
  *Done: Every hub sign-in (startHubSession) clocks its person in unless already in; ending a session (sign-out, ended by id, ended from admin) clocks out only when it was the person's last live session; a kitchen screen never clocks. sessionClockAction() in timeClock.ts is the rule; sessionClock.ts writes the same timeEntries as clockWithKey() (via: sign-in / sign-out), never throwing into a sign-in. 05:00 expiry is not a sign-out: the open shift shows as 'no clock-out' on the timesheet and Labour. Hub only (the online till has no timeEntries). verify:hub-sync 476, 4 mutations caught.*
- [x] **T6.7 Idle sign-out on shared online devices.** A per-device "This is a
  shared device" switch on the online till (remembered in localStorage), with
  the idle rule the counter PC already has (S25, `followIdle()`), at the limit
  from T6.0. Only taps count, never background requests. Personal phones keep
  their sign-in.
  *Done: Shared online device (the T6.2 'Shared device' switch on the floor, remembered in localStorage): signs out after 15 minutes without a tap (T6.0 default, the counter PC's limit), no question asked; taps = pointer/key/wheel, shared across tabs; background requests never count. sharedIdleDue() in signOut.ts, the watcher in SignedInStrip on every page; a hub's counter PC keeps its server-side S25 rule; personal phones keep their sign-in. verify:counter 59.*
- [x] **T6.8 Printed staff badges: not built unless the owner asks** (owner).
  A static QR on a card or lanyard is a password anyone can photograph, and it
  cannot tell who is holding it. If the owner wants badges anyway:
  - a badge only ever narrows the list to one person, and the PIN (or the
    phone's fingerprint) is the proof
  - each badge is revocable, from Staff Phones
  - it never signs anyone in on a hub on its own

  Record the decision here either way.
  *Done: Decided: no printed badges (T6.0 default, OWNER TO CONFIRM). A static QR is a password anyone can photograph; nothing built.*

---

## Tier 7: reporting the accountant can rely on (added 21 Sep 2026)

The owner's request: every number that needs reporting, checked against
common accounting practice. Each report works for **one branch or all
branches (with a column per branch and a consolidated total), for one day or
any range between two dates**.

**What exists today** (sweep of 21 Sep 2026):
- **Sales Export** (`/admin/exports`): days, checks and payments, with branch
  and range, and an XLSX download.
- **Product Mix, Voids & Discounts, Hourly Sales and Timesheet**
  (`/admin/reports/*`): range pickers, but no download.
- **Food Cost Report:** a range.
- **EOD History, Daily Summary, Tips, Daily Inventory History:** a single day,
  or a list, with no range and no download.
- **Drawer X/Z:** on the till only.

Each of these was built on its own, and several use their own words for the
same number.

**The standards this tier follows.** These are general practice, not a
particular country's law; T7.0 confirms the Lebanese specifics.
- **Revenue is IFRS 15:** recognised when the check closes.
- **Net sales** = gross sales − discounts − comps − refunds, **excluding VAT**.
- **VAT is output tax**, extracted from VAT-inclusive prices at each check's
  own rate.
- **Tips are a liability** owed to staff, never revenue.
- **Service charge** is its own revenue line.
- **A refund belongs to the period it happens in**, as a credit note against
  its original receipt. The original sale is never rewritten.
- **Inventory is valued at weighted average cost.**
- **Receipt numbers are audited for gaps and duplicates.**
- **Every figure reconciles to another:** sales to payments to the drawer.

Principles for every task here:
- **One reading of the checks.** Every report reads through the export's
  `readClosedChecks()` (café day, padded window), so two reports can never
  disagree about which day a check belongs to.
- **One definitions module:** a new `shared/src/reportDefinitions.ts`, pure.
  A report names its figures from it and never re-derives them.
- **Every report downloads as CSV and XLSX.** Each file carries a header block:
  business, branch(es), period, currency, generated at, and the definitions
  version.
- **Every task adds its cases to `verify:export`** (or a new
  `verify:accounting`), with mutations caught by name. The run on
  `npm run seed:pos` data is part of the check, not optional.

- [x] **T7.0 The reporting audit, written down.**
  Produce `docs/reporting.md`:
  - every figure the system reports: where it is computed, its definition,
    which reports show it, and whether it reconciles
  - every gap against the standards above

  *Owner's answers, 21 Sep 2026:*
  - **Journal format: plain CSV.** One row per line, with these columns:
    - date, journal number, branch
    - account code, account name, description
    - debit USD, credit USD, debit LBP, credit LBP
    - the source (receipt, shift, delivery)
  - **Both lira and dollars** on every report and download. LBP is shown at
    each check's own `billRate`, and at the business rate only where no check
    rate exists (a delivery keeps its own rate). Totals are summed in each
    currency, never converted after the fact.
  - **Labour cost: yes.** An admin panel sets each person's hourly rate and
    tip weight (T7.18).

  *Defaults, to be corrected by the owner or the accountant:*
  - **Fiscal year:** the calendar year (1 January). A period locks by being
    closed (T7.17): later changes show as post-close adjustments and never
    rewrite what was sent.
  - **Service charge is subject to VAT.** VAT is worked out of the check total
    including the service charge, and the VAT report shows the service
    charge's share on its own line, so a different ruling is one switch.
  - **Chart of accounts:** a default set of generic codes, for example 1000
    cash, 1010 card clearing, 1200 inventory, 2100 VAT output, 1400 VAT input,
    2200 tips payable, 2300 loyalty liability, 4000 sales by category, 4500
    service charge, 4900 discounts, 5000 cost of goods sold. They are editable
    on an admin "Accounting codes" page, stored in `appSettings/accounting`
    behind a route, so the accountant can put their own numbers in without a
    code change.
  *Done: Done 21 Sep 2026: docs/reporting.md. It lists every reported figure with where it is computed, its definition, how it is dated and which currency and branch it covers. It also sets out 30 gaps against the definitions, each with its evidence and the task that fixes it, and 14 reconciliations marked holds, breaks or cannot be checked. The owner's answers and the defaults are recorded above. The audit found a real bug, now fixed (commit 736da7a): End of Day saves threw away expense and income lines (no name, $0) and every attendee's shift, so an Off day earned a tips share. The demo project's 7 reports were scanned read-only and none was affected; reports in any other project saved since 29 Aug should be checked. Other findings for the tasks: Food Cost 'Till sales' is drawer cash, and a day saved from the form counts twice; card taken in lira drops out of the export; there are two day rules (midnight for sales, 10:00 for drawers and End of Day); and combos push theoretical food cost up.*
- [x] **T7.1 One period and branch picker for every report.** Promote
  `ReportRange` (`admin/app/admin/reports/ReportRange.tsx`) to the admin UI
  kit:
  - one day or a from–to range
  - quick picks: today, yesterday, this week, last week, this month, last
    month, this quarter, and the same period last year
  - one branch, several, or all

  The server takes `branch` as a list, or `all`. With several, every report
  answers with a column per branch and a consolidated total that is the sum of
  the columns, never a separate calculation. Move EOD History, Daily Summary,
  Tips and Daily Inventory History onto it. "Today" and every day boundary is
  the café's day in `BRAND.locale.timezone`.
  *Done: Done 21 Sep 2026 for the reports and the export; the End of Day pages and downloads are split into T7.1b. The picker is now admin/app/components/ui/ReportRange.tsx: quick periods (today, yesterday, this and last week, month and quarter, year to date, last year), one day or a range, and one branch, several (chips) or all. The rules are in shared/src/reportPeriods.ts: quickRange, sameRangeLastYear and dayCount, with ISO weeks starting Monday and the calendar fiscal year, plus readBranchList. The server reads a branch list through requestedBranches(), where one branch that is not the caller's refuses the request with 403; the export, loyalty export, food cost and every report use it. With several branches, each report returns a total per branch, and BranchTotals shows them with an 'All' row that is their sum. That is on Voids & Discounts, Product Mix, Hourly and Timesheet; the Sales Export page uses the picker too. The export page's claim that a 01:30 sale belongs to the night before was wrong (docs/reporting.md, gap 5) and now says the calendar day. Covered by verify:export (14 period and branch cases) and verify:reports (Main + Second = all, for voids and the mix). Not looked at signed in.*
- [x] **T7.1b The End of Day pages and downloads onto the picker** (split from
  T7.1, 21 Sep 2026).
  - Move EOD History, Daily Summary, Tips and Daily Inventory History onto
    `ReportRange` (`admin/app/components/ui/ReportRange.tsx`), with one
    branch, several or all, and `BranchTotals` under each.
  - Give Product Mix, Voids & Discounts, Hourly and Timesheet a CSV and XLSX
    download with the header block (business, branches, period, currencies,
    generated at, definitions version).
  - Decide the café day (docs/reporting.md, gap 5): sales use the calendar
    day and drawers and End of Day the 10:00 cash-up day. Record the choice
    here, show it on every report, and make the reports that sit side by side
    use the same one.
  *Done: Done 21 Sep 2026. Downloads (part 1, commit 9b8c58f): Product Mix, Voids & Discounts, Hourly and Timesheet have CSV and Excel downloads. Every file opens with the header block (shared/src/reportFile.ts: business, report, branches, period, currencies, day rule, when, definitions version). CSV cells that look like formulas are defused. The café day is decided and recorded in shared/src/reportDefinitions.ts and docs/reporting.md: sales, VAT and accounting use the calendar day on the receipt, and counting cash uses the cash-up day and is reconciled per shift. Part 2: EOD History, Daily Summary, Tips and Daily Inventory History are on ReportRange, with BranchTotals and downloads: History and Summary for any range, Inventory History with a range table above its calendar, Tips split per branch over the chosen range with each day's tip weight. verify:export has the file cases. The pages were not looked at signed in.*
- [x] **T7.2 Longer ranges without a silent cut.** `MAX_RANGE_DAYS` (100) and
  the 20,000-check read cap stop a year's report. Read the range in café-day
  chunks and add them up, so a fiscal year (or last year for comparison) works
  and the cap warning (T5.8) never fires on an ordinary request. Keep a hard
  upper bound, stated on screen.
  *Done: Done 21 Sep 2026. Every report read goes through readInChunks() (shared/src/server/salesExport.ts): the sales export and its refunds, food cost, the loyalty ledger (transactions, and redemptions by both fields) and the timesheet. It reads a month of café days at a time (rangeChunks() in reportPeriods.ts), each piece with the padded window and its own 20,000 cap. Overlapping padding keeps each document once. If any piece meets its cap, the answer is whole only through the day before the earliest cut, and the page says so. The loyalty and timesheet reads used to cut short silently; they now warn too. A report may cover up to 460 days (MAX_REPORT_DAYS, a year and a quarter, so last year can sit beside this one), and a longer request is refused with that number. Covered by verify:export (chunks cover a year with no day missed or repeated) and verify:hub (400 days read in monthly pieces: every document once, nothing cut).*
- [x] **T7.3 The sales summary report**, the one an accountant asks for
  first. A new `/admin/reports/sales`, per branch and consolidated:
  - gross sales, then staff meals, item discounts, check discounts and comps,
    each shown separately
  - refunds, filed by refund date (T7.4)
  - net sales excluding VAT, VAT output, and service charge
  - total collected, and card tips shown apart as a liability
  - check count, guests, and average check

  Each line's definition comes from `reportDefinitions.ts` and is shown on
  hover. This page must reconcile with the payments report (T7.5) and the
  drawer (T7.7) to the cent, and the verifier asserts that it does.
  *Done: Done 21 Sep 2026. /admin/reports/sales (in ADMIN_NAV under End of Day, gated on endOfDay). The arithmetic is salesSummary() in shared/src/salesSummary.ts, built from the export's own rows, so the summary and the export cannot disagree about one check. It shows gross sales (VAT included), staff meals, item discounts and comps, and check discounts, each on its own line. Then net sales excluding VAT and service; VAT on sales; the service charge with its own VAT line (VAT-able by default, per T7.0); total VAT output; billed, in USD and in LBP at each check's own rate. Then refunds given in the period, with their net sales and VAT reversed (by refund day, T7.4), net sales after refunds, card tips shown apart as owed to staff, checks with no VAT rate counted, and the average check, plus a breakdown by order type. One column per branch and an 'All' column that is their sum. CSV and Excel downloads carry the header block. Export rows now carry cardTips too: a tip on a refunded check stays with staff (gap 27, decided). verify:export has 13 cases, with exact figures for service, service VAT and tips. Read-only against the demo project's last 60 days (422 checks, 3 branches): 421 checks, 16 refunds, $8,529.24 net sales, $936.36 VAT; the total equals the sum of the branches, gross − discounts + service = billed, net + VAT + service = billed, and billed matches the export's days. Not looked at signed in.*
- [x] **T7.4 Refunds in the period they happen** (a correction to today's
  behaviour).
  - The export and the food cost report file a refund under the day its check
    CLOSED (`salesExport.ts` counts a refunded check's net against its close
    day). An accountant records a refund as a credit note on the day it is
    given.
  - Report refunds by `refundedAt`, naming the original receipt and its day.
    The original day's sales stay as they were.
  - A refund spanning two periods then shows in both: a sale in March and a
    refund in April.
  - Waste stays filed with the check, as the food cost report explains, or
    moves too; T7.0 decides and the reason is recorded.
  *Done: Done 21 Sep 2026 for the Sales Export. A refunded check stays a sale on the day it closed: that day's checks, gross, net, VAT and tenders count it, and nothing about the original day changes afterwards. Its refund is a credit row on the day it was given (refundRow(), kind 'refund'). The row carries the sale's figures negated, names the sale's day, and shows what went back by tender (cash less its change, card, from refundOf()). The server reads checks refunded in the period (readRefundedChecks(), ranged on refundedAt alone with the padded window, so no index is needed) beside those closed in it, and buildExport() files each by its own day. The day sheet shows refunds given, their count and 'Refund VAT USD', output VAT reversed in the refund's period; the Checks sheet gains Type and Sale day. A refund from before refundedAt was read is credited on its close day. Decided and recorded in docs/reporting.md: the food cost report's waste stays filed by close day, so it keeps one window with its theoretical cost, and the till's 'Refunds today' reading is unchanged. verify:export: 8 new cases (August keeps the sale, September has the credit and its VAT, payments stay with the sale), and the old expectations were corrected (99 passed).*
- [x] **T7.5 Payments and tenders report.** Per branch and period:
  - cash USD, cash LBP (and its USD value at each check's rate), card, and
    change given
  - card tips separately. Today the export does not show tips at all; T3.9
    recorded them.
  - refunds by tender

  It must reconcile with the sales summary: collected − change − tips = the
  checks' net plus VAT plus service.
  *Done: Done 21 Sep 2026. /admin/reports/payments (in ADMIN_NAV under End of Day, gated on endOfDay). The arithmetic is tenderSummary() in shared/src/tenderSummary.ts, built from the export's own payment and refund rows. It shows cash in USD and in LBP as handed over, as change given and as kept; card in USD and in LBP, never converted; card tips apart, owed to staff; refunds by tender on the day they were given; and checks closed with no payment recorded. The reconciliation, applied to bills (each payment's applied lira at its check's rate) against billed on paid checks within the lira rounding, is stated under the table in words and in red when it fails. Tips never enter it. One column per branch and 'All', their sum; a CSV and Excel download. The export gains a Card LBP column (card in lira used to be dropped, gap 8) and a Card tip column on the payments sheet. FiguresTable.tsx is the shared figures-by-branch table. verify:export: 10 cases, including that a tip counted as a sale would not reconcile. Read-only on the demo project's last 60 days: 415 payments; $4,594 and 223,074,000 LBP kept in cash; $2,272.50 card; $111 cash and $52.50 card refunded; applied $9,359 = billed on paid checks $9,359 exactly; 6 checks with no payment. Not looked at signed in.*
- [x] **T7.6 VAT report**, for the VAT return. Per branch and period:
  - taxable sales and VAT output, per rate. Checks keep their own `vatRate`,
    so a mid-quarter rate change shows as two lines.
  - zero-rated and exempt sales, if any
  - refunds' VAT reversed in their own period
  - service charge's VAT, per T7.0
  - input VAT from received deliveries (`deliveries` store their VAT), so the
    net VAT position is on one page

  A check from before rates were recorded contributes nothing and is counted
  in a "no rate recorded" line, never guessed.
  *Done: Done 21 Sep 2026. /admin/reports/vat (in ADMIN_NAV under End of Day). The rules are in shared/src/vatReport.ts. Output VAT is one line per rate the checks closed at, so a mid-period change shows as two lines, with net sales, VAT on sales, service net and VAT on service (VAT-able by default). Checks with no rate recorded get their own line: billed with no VAT, never guessed. Refunds reverse VAT at their own rate, in the period they were given. Input VAT comes from received and disputed deliveries, not drafts, at each delivery's own rate; one invoiced in lira is converted at its own exchange rate (readReceivedDeliveries() in shared/src/server/receivedDeliveries.ts). Net VAT = output − reversed − input. Per-branch totals and 'All' as their sum, and a CSV and Excel download (position, output, refunds, input). verify:export: 9 cases, including that output VAT equals the sales summary's. Read-only on the demo project's last 60 days: 419 checks at 11% with $936.36 output VAT, 2 checks with no rate recorded, $29.29 reversed on refunds, 3 received deliveries with $114.10 input VAT, net $792.97; output matches the sales summary. Not looked at signed in.*
- [x] **T7.7 Cash-up and drawer report.** Per branch and period:
  - every shift: float, cash in, change, cash refunds, paid outs and pay ins
    (T3.1), safe drops, expected, counted, and over/short, in each currency
    and never netted at a rate
  - the day's End of Day figure beside it

  Z closes listed with their number and who closed them. Moved to admin from
  the till, where it is today only as a single shift.
  *Done: Done 21 Sep 2026. /admin/reports/cash-up (in ADMIN_NAV under End of Day). The rules are in shared/src/cashUpReport.ts and the read in shared/src/server/cashUp.ts: drawer shifts and End of Day reports by cash-up day, each a single-field string range, so no index is needed. Every shift shows its float, cash in, change, cash refunds, paid out, paid in, to the safe, should hold, counted and difference, in dollars and lira separately and never netted. It also shows card and card tips (not in the drawer), who opened and closed it, and its note. A shift still open shows its live figure (shiftTotals) and no count. A Z is named by branch, cash-up day and opening time ('Main 2026-09-20 17:02'). That is unique because one shift is open per branch, and it needs no counter, which a hub handed back and cleared would restart. By cash-up day, the shifts' should-hold and counted sit beside that day's End of Day count, worked out from its stored note counts with countedCash(). Per-branch totals with 'All' as their sum, and a CSV and Excel download (shifts, days). Cash reconciles per shift, as decided in T7.1b. verify:export: 7 cases; verify:hub: a real shift opened, counted and closed is read back with its count, for the branch asked. Not looked at signed in.*
- [x] **T7.8 Product and category sales with cost and margin.** Extend
  Product Mix with:
  - net sales excluding VAT per item and per category, and quantity
  - theoretical cost from the recipe snapshots, with gross margin and margin %
  - combos shown as sold, with their parts beneath (T5.13)

  An item with no costed recipe shows its sales, a blank cost and "not
  costed", never $0 cost and 100% margin. Coverage is shown, as the food cost
  report does.
  *Done: Product Mix now has net sales before VAT and service, recipe cost from each line's snapshot, gross margin and coverage, by item and category; an item nobody could cost reads 'not costed', never $0. Combos: foldComboParts() costs parts on the combo line (gap 18), used by the mix and the Food Cost Report. verify:reports 72, verify:recipes 136. Demo reconciled: cost $1,168.74 in both.*
- [x] **T7.9 Discounts, comps, voids and refunds, with who approved.** Extend
  Voids & Discounts:
  - by reason, by staff member, and by approver (T5.1's manager)
  - whether the food had been sent

  Totals per branch and period, and a download. This is the exception report
  auditors look at.
  *Done: Voids & Discounts is now the exception report: who rang each voided item up and who struck it off, approval (manager, not needed, not by a manager, not recorded) from voidedByRole/refundedByRole now stamped on the server, refunds given in the period on their refund day, sales at a price rule, an unapproved count, per branch and in the download. verify:reports 84, verify:hub 220.*
- [x] **T7.10 Receipt sequence report.** For a period and branch, every
  receipt number issued, in order:
  - **gaps** (on a hub, numbers skipped in a block are expected, and are named
    with the block)
  - **duplicates**, which must be none
  - numbers issued with no check

  The audit trail that proves no sale went missing.
  *Done: /admin/reports/receipts: every number in the period, per café year, across all branches (other branches counted, not shown): on a check or retail sale, wholesale, issued with no record, skipped in a hub block (named), before the log, missing; duplicates listed. issueInvoiceNumber() (cloud and hub) and createPurchaseOrder() now write receiptLog/{year}-{seq} in the same transaction, with what it was for. verify:export 155, verify:hub 221; mutations caught by name.*
- [x] **T7.11 Labour report.** From the timesheet (T3.12, T6.6), per branch
  and period:
  - hours per person and in total
  - shifts with no clock-out, flagged
  - labour cost, from each person's hourly rate as it stood on the day
    worked (T7.18)
  - labour cost as a share of net sales, per branch and day

  Tips per person from the tips split, and hours × rate + tips = what each
  person is owed for the period, for payroll.
  *Done: /admin/reports/labour (admin only): hours per person and total, open or over-16h shifts flagged, pay at each person's rate on the day worked (not priced, never $0; LBP rates in LBP), tips from the per-branch split at each day's weight, owed = pay + tips per currency, labour % of net sales per branch and day. Gap 16: EOD reports keep tipsDeductionRate from first save; distributeTipDays() uses each day's rate (tips page too). Gap 17: peopleOf() from in-range shifts. verify:tips 65, verify:hub 222.*
- [x] **T7.12 Inventory valuation and movement report.** Per branch, at a
  date:
  - stock on hand × weighted average cost = inventory value
  - over a period: opening + received (deliveries) − used (theoretical, from
    sales) − waste ± transfers (T3.14) ± count adjustments = closing, with
    the variance between theoretical and counted

  This gives cost of goods sold for the period the way an accountant computes
  it: opening + purchases − closing.
  *Done: /admin/reports/inventory: per supply and branch, opening = last submitted count before the period, closing = last in it; received (stockAppliedAt day), transfers (all now recorded in stockTransfers with unitCostUsd), used and waste from recipe snapshots; expected, difference and COGS (opening + purchases ± transfers − closing) at each snapshot's own cost, unknown never $0; stock value now. Per-branch average cost left as a data-model change (gap 20). verify:recipes 151.*
- [x] **T7.13 Purchases report.** Received deliveries per supplier, branch
  and period, with invoice number, net, input VAT, total, currency and rate.
  It reconciles with the weekly orders' fulfilment, and feeds T7.6's input VAT
  and T7.12's purchases.
  *Done: /admin/reports/purchases: every received delivery (the VAT report's own rows) per supplier and branch, invoice number and date, net / VAT / total in own currency plus USD and LBP (USD invoices in lira at the business rate, marked), deliveries with no date or no order counted; weekly orders booked against, arrived in full / in part / not yet across every delivery for the order. Supplier invoice date added to receiving (gap 21). verify:export 164, verify:delivery-math 46, verify:hub 224.*
- [x] **T7.14 Loyalty liability.** The points ledger (`loyaltyExport.ts`) as a
  report with the picker: points issued, reversed and redeemed, and the
  outstanding balance at the period's end, valued at the redemption rate if
  the owner sets one (T7.0). Points are a liability, like tips.
  *Done: /admin/reports/loyalty (gated loyalty): issued, reversed and spent per branch, each movement on its own day; what the whole scheme owes at each end, worked back from today's balances through the ledger; valued at the new Business Settings 'Value of a loyalty point' (pointValueUsd, 0 = not set, OWNER TO CONFIRM a value). Gap 19: a reversal is its own movement on reversedAt, the issue stays on its day. verify:export 173.*
- [x] **T7.15 The accountant's journal export** (plain CSV, T7.0). One
  download per period and branch, as double-entry journal lines mapped to the
  chart of accounts:
  - debit cash, card clearing and tips payable
  - credit sales by category, service charge, VAT output and tips payable
  - discounts as contra-revenue
  - refunds as reversing entries on their own date
  - optionally, COGS and inventory from T7.12

  Every journal balances (debits = credits), and the verifier asserts it on
  seeded data.
  *Done: /admin/reports/journal: sales journal per day and branch, refunds journal on the refund day (reversing, tip stays with staff); Dr cash USD / cash LBP (kept net of change) / card clearing (+tips) / discounts, Cr sales by category (price before discount, ex VAT) / service / VAT output / tips payable, rounding per currency, unpaid checks to 'Till receipts not itemised'. Each check balances in USD and LBP. Plain CSV download. Account codes at /admin/settings/accounts (defaults OWNER TO CONFIRM). Demo: 111 journals, 437 checks, all balanced. COGS/inventory not journalled (optional). verify:export 190.*
- [x] **T7.16 The reconciliation check.** One page, and one verifier, that
  runs a period and branch through every report above and proves they agree:
  - sales summary = sum of product mix = the export's days
  - payments = the drawers' cash + card
  - VAT report = the sales summary's VAT
  - journal debits = credits

  Any difference is listed, never rounded away. Run it on seeded data in CI,
  and show it at the top of the reports section, so a mismatch is seen before
  the accountant sees it.
  *Done: /admin/reports/reconcile (first in the reports) and npm run verify:reconcile: every report over one period, each pair compared to the cent (export days = sales summary; mix = summary on closed checks; VAT report = summary; payments = bills within lira rounding; drawers = payments taken into them per currency; journal debits = credits and its VAT = VAT report; closed checks with no receipt number = none). Verifier runs a generated 288-check history built with applyPayment/drawerTotals, and proves tampering is caught. Demo: found one closed check with no receipt number ($7.75) counted by the mix only; mix now counts numbered checks, the check is named.*
- [x] **T7.17 Period close.** An admin closes a period
  once it has been handed to the accountant:
  - its reports are stored as issued (the numbers and the definitions version)
  - anything that later changes a closed day (a late refund, a held hub sale
    applied) is shown against the closed figures as a post-close adjustment,
    never silently changing a report already sent

  *Done: /admin/reports/periods: an admin closes a period (every branch); each café day and branch is stored as issued (sales summary figures) with REPORT_DEFINITIONS_VERSION in periodCloses (server-only). Not locked: adjustments() compares issued with now; Sales Summary and VAT report show post-close adjustments for closed days; 'Check for changes' per period. No overlap, today not closable, a late refund files on its own day. verify:export 201, verify:hub 227.*
- [x] **T7.18 Staff pay panel: hourly rate and tip weight per person** (owner's
  request, 21 Sep 2026). An admin-only page (`/admin/settings/staff-pay`, in
  `ADMIN_NAV` under Administration) listing every staff member by first name,
  where an admin sets:
  - **Hourly rate**, with its currency (USD or LBP), used by the labour report
    (T7.11).
  - **Tip weight**, how much one shift of theirs counts in the tips split:
    1.0 by default, 0.5 for a trainee, 1.25 for a supervisor. `tips.ts` then
    splits the pot by shift points × weight, still to the cent by largest
    remainder.

  Rules:
  - **Every change takes effect from a date and keeps its history.** Last
    month's labour cost and tips are computed with last month's rate and
    weight: the VAT rule again. A period already worked out keeps the numbers
    it was worked out with.
  - **Stored server-only** in `staffPay/{uid}` (a list of `{ from, hourlyRate,
    currency, tipWeight, setBy }`), behind `/api/admin/staff-pay`, with no
    Firestore rule and so no rules deploy. Never on `users/{uid}`, which its
    owner can edit, and never pulled to a hub: pay is not the till's business.
  - Admin only (`useRequireRole(['admin'])`), not a section key, because pay
    is not a permission handed out for a shift. Every change is logged with
    before and after, under "Staff pay".
  - A weight of 0 takes that person out of the tips. A missing or nonsensical
    value is 1.0 for the weight and "no rate" for pay, never $0, so the labour
    report says "rate not set" rather than showing free labour.
  - The tips page shows each person's weight beside their points, and the
    period keeps the weights it used.

  Covered by `verify:tips` (weights, history, sums to the pot) and the labour
  cases in `verify:export`.
  *Done: Done 21 Sep 2026. Staff Pay (`/admin/settings/staff-pay`, admin only, in ADMIN_NAV under Administration beside Staff Phones) lists every staff account by first name, with today's hourly rate (USD or LBP) and tip weight. An admin changes them from a chosen day, and the history is kept and shown. The rules are in shared/src/staffPay.ts: readPayEntry refuses a bad value instead of saving a default, and payOn, hourlyRateOn and tipWeightOn read what was in force on a day. An empty rate is 'not set', never $0. Stored server-only in `staffPay/{uid}` behind /api/admin/staff-pay, with no Firestore rule (so no rules deploy), never on users/{uid} and never pulled to a hub. Changes are logged with before and after, under 'Staff pay'. The tips split (tips.ts) now uses shift points × weight, taking each day at that day's weight, still summing to the pot to the cent. Weight 0 is out of the tips and gets no leftover cent, and a nonsense weight counts as 1. The tips page reads the weights (without rates, via ?weights=1 gated on endOfDay) and matches attendance names to staff by email or a unique first name; a guest counts at 1. It shows 'Weighted points', and if the weights cannot be read it says everybody counts at 1. Covered by verify:tips (20 new cases, 46 in all; removing the weighting was caught) and verify:hub (history, the log's before value, weights without rates, refusals). The pages were not looked at signed in.*

- [x] **T7.19 Graphs on the reports, and a metrics explorer** (owner's
  request, 22 Sep 2026). Two halves:

  - **Charts on the reports.** An inline-SVG kit at
    `admin/app/components/ui/Charts.tsx` (`BarChart`, `LineChart`), in the
    same hand-written style as the rest of the admin controls, drawn on the
    reports where a shape says something a column of numbers does not.
  - **`/admin/reports/metrics`**: every figure the reports work out, listed
    with a search box and category chips, switched on and off one at a time,
    over the same range picker as every other report.

  Rules:
  - **The page works nothing out.** Every figure comes from the server, from
    the same function the report of that name uses, so the explorer and the
    report can never print different answers to one question.
  - **Only the groups the chosen metrics belong to are read.** Ticking net
    sales runs the sales export; it does not also run the inventory and
    labour reads to fill in figures nobody asked for.
  - **Pay is admin-only, and is dropped rather than refused**, with a line
    saying so: a saved choice a manager cannot change would otherwise make
    the page useless to them.
  - **One value axis, never two.** Two measures of different size are two
    charts. Series colours are `--chart-1…6` in fixed order, never cycled,
    never the brand hues.
  *Done: Done 22 Sep 2026. shared/src/metrics.ts is the list: 62 metrics in 10 groups, each with a unit, a help line and whether it moves daily, plus searchMetrics(), groupsNeeded() and allowedMetrics(). shared/src/server/metrics.ts runs only the reads those groups need and answers { values, days, byBranch, refused }; the route is report=metrics on /api/admin/reports, gated on endOfDay with MAX_METRICS of 40. The page has the search box, the category chips, per-metric tick boxes remembered per browser (through useClientValue, not a setState in an effect), tiles, a LineChart per daily metric and a BarChart per branch, and the same downloads as every other report. Charts.tsx is the kit: --chart-1…6 were chosen by running the dataviz validator against this surface (#0F0F11) rather than by eye — the brand hues failed its lightness band and chroma floor, so the tokens are deliberately not them. Charts went on Sales Summary, Payments, VAT, Cash-up, Purchases, Inventory, Loyalty, Labour, Product Mix and Voids & Discounts; Hourly already had one. labourPercentOf() was exported so the labour chart folds branches with the report's own arithmetic instead of averaging percentages. 16 new cases in verify:reports (101 in all); 6 mutations to the metrics rules, all caught by name.*

- [x] **T7.20 POS Layout: what each branch's till shows** (owner's request,
  24 Sep 2026). A café that does not sell desserts at one branch had no way to
  take them off that till. The three switches that existed each answer a
  different question — `available` (on the menu at all, website AND till),
  `soldOut.<branch>` (run out today, gone again at 05:00) and `hours` (served
  between these times). None says "this branch's till never shows this".

  Owner's decisions: **one layout per branch**, and **show/hide only** — no
  reordering, since the menu page already decides order.
  *Done: Done 24 Sep 2026. /admin/menu/pos-layout, under Menu & Recipes as a setup page, gated on SECTION_ACCESS.menu (no new section key). Tick a category to hide the whole of it, or single dishes; a branch picker for anyone with more than one, and the page refuses to let somebody configure a branch they are not assigned to. The rules are shared/src/posLayout.ts, pure, with verify:pos-layout (18 cases, 7 mutations caught by name). Stored as `posHidden.<branch>` on menuCategories and menuItems — the same place and shape soldOut uses, and for the same reasons: the till already reads the menu live, both collections are already world-readable, and a café hub already pulls both, so there is no new collection, no new query, NO FIRESTORE RULE TO DEPLOY and nothing to add to the hub's pull. The stored list is what is HIDDEN, never what is shown, so a dish added tomorrow appears on the till by itself. Hiding a category hides its dishes; a dish whose category does not exist is left alone rather than made to vanish. It decides what is SEEN, not what may be SOLD: the server still enforces available and soldOut, and nothing here touches a check that is already open — a dish hidden mid-service stays on the order it is already on, and a sent line still cooks, prints and is paid for. The till applies it in usePosMenu(branch), so the order screen and the counter cannot disagree; with no branch given nothing is hidden, because a screen that does not know where it is must not guess what to leave out. A save sends the whole state and writes only what moved, so two people with the page open cannot half-apply each other's work and a repeated save does nothing. Logged under "POS Layout" with the counts. The page has not been looked at signed in.*

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
