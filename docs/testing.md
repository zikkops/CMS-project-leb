# Testing everything

A walkthrough of what can be exercised today, what data is already there, and
what each screen should show. Written to be worked through in order; most of it
takes an afternoon.

This is **not** the pilot. [docs/pilot.md](./pilot.md) is the pilot — a real
service with real customers. This is the sit-down pass before it.

---

## Before you start

**Know which project you are in.** `npm run check:env` prints it. Everything
below assumes the demo project (`cms-project-f7e15`), where breaking things
costs nothing.

**What is already seeded**, as of the last run:

| Collection | Count | From |
|---|---|---|
| `checks` | 419 | `seed:pos` — 30 days, 3 branches, with payments |
| `drawerShifts` | 90 | `seed:pos` — one per branch per cash-up day |
| `errorReports` | 5 | posted deliberately at `/api/errors` |
| `menuItems` | 16 | `seed:demo` |
| `products` | 26 | `seed:demo` |
| `recipes` | 15 | `seed:recipes` — every dish but the Club Sandwich, which has none on purpose |
| `supplies` | 40 | `seed:demo`; 23 carry recipe conversions from `seed:recipes` |
| `users` | 3 | provisioned by hand |

The 415 seeded checks also carry what each line's recipe took, written by
`seed:recipes` — the snapshot a till takes when an item is added.

To remove the POS history: `npm run seed:pos -- --clear --apply`. It removes
exactly what it wrote (`seeded: true`) and nothing else. To put it back you
need a fresh receipt block above the counter — the script tells you which.
`npm run seed:recipes -- --clear --apply` removes the recipes, the conversions
it filled and the snapshots, and nothing it did not write.

**Turn the money on, for testing only.** Most of Phase 04 is behind the
`payments` feature switch, which is **off**. In Settings → Features, turn
`payments` on for this pass — the Drawer link only appears when it is on, and
the pay sheet is unreachable without it. **Turn it off again before any
pilot**, because off is what makes the pilot safe.

**Ingredients leaving stock is a switch too.** "Deduct Ingredients on Sale"
in Settings → Features, which needs the POS and supplies on. It is **off**, and
it governs only the till: recipes, costing and theoretical food cost all work
without it.

---

## The admin panel

### Sales export — `/admin/exports`
The one with the most behind it.

- Pick **Sales & VAT**, last 30 days, all branches, Read the range.
- Expect roughly **397 sales, $8,976, $888 of VAT, 16 refunds** — the figures
  will differ as the seeded window rolls, but the shape should match.
- **Look at the day rows.** Days should be café days: a check closed at 01:30
  belongs to the night before. 101 of the seeded checks closed after local
  midnight, so this is well exercised.
- Refunds have their **own column** and are never netted into sales.
- Download the Excel. Three sheets: by day, every check, every payment. Open it
  and check the columns are readable and the numbers match the screen.
- Switch to **Points & redemptions** and read the same range. Points issued
  should be per person, not per transaction — the sheet shows both the
  per-person figure and the headcount.

### What broke — `/admin/errors`
- Five demo faults, one row each, with counts. One should read `count: 2`.
- **There may be a sixth, and it is a real one.** A `formatUsd is not defined`
  from `/menu` was recorded on 12 Sep while the price fix was mid-edit — a
  genuine render failure caught by the error boundary and reported without
  anybody asking it to. Unlike the five demo faults, nothing posted that on
  purpose, so it is the best evidence in the system that the pipeline works.
  Safe to leave or delete.
- Open a stack. Confirm no email address, token or query string appears
  anywhere — they are scrubbed before storage, not at display.

### End of day and tips — `/admin/end-of-day`, `/admin/end-of-day/tips`
- The tips calculator now reads the **configured** deduction. Change
  `tipsDeductionRate` in Settings → Business, come back, and the header
  percentage and every payout should move. That was broken until today.
- Check the staff payouts **add up to the net pot exactly**. They should, to
  the cent.
- With `payments` on, End of Day's "system" figure comes from the day's drawer
  shifts rather than being typed. The field goes read-only.

### Recipes & Costing — `/admin/menu/recipes` (admin only)
- Fifteen dishes should show a cost; the Club Sandwich none. **A Latte costs
  $0.59** on the seeded conversions, a Caesar Salad $2.83, a Margherita $1.28.
- Beside every ingredient the quantity shows in both units — "18 g = 0.018 kg".
  That line is the defence against a wrong conversion, so read a few.
- Lemons are set to a 45% yield in Supplies, so **120 g of lemon takes 0.267 kg
  off the shelf**. That is trim working, not a typo.
- Sign in as a manager: the page should refuse. Dish cost is margin.
- In **Supplies**, open Coffee Beans: recipe unit g, 1,000 per kg. Try to delete
  it — refused, because recipes use it.
- **Suggested prices.** Each costed dish also says what it should sell for at
  the target margin: 80% for anything from the bar, 70% for food and sweets,
  both editable in Settings → Business. Expect **Lemonade, Soft Drink,
  Sparkling Water and the Caesar Salad** flagged as priced below it (Caesar
  Salad: suggested $10.50 against $9.25). Most others suggest far less than
  they sell for — a Margherita $4.75 against $11 — because the demo recipes
  list only the main ingredients. A suggestion is only as good as the recipe.
- The same suggestion sits under each price on **`/admin/menu`**, and under the
  price field when editing, with **Use it**. Signed in as a manager, neither
  appears: a suggested price at a known margin gives the cost away.
- Change a target margin in Settings → Business, come back, and every
  suggestion should move.

### Receiving and food cost — `/admin/supplies/receiving`, `.../report`
- This chain was closed in September against seeded data; it should still read
  a food cost percentage rather than a dash.
- **Theoretical food cost** sits in a second row. Set **All branches, 14 Aug →
  13 Sep 2026** and expect **16.3%**, recipe cost **$1,168.74**, POS sales before
  VAT **$8,165.32** over **400 closed checks**, on **87.9%** of POS sales.
- A warning should say **63 sold lines have no recipe** — the Club Sandwiches.
  They are left out of the percentage rather than counted as free, which is why
  the figure says how much of sales it covers.
- Compare the two **percentages**, not the dollars: actual is goods received
  against the end-of-day till figure, theoretical is recipes against the POS
  checks before VAT.
- **Waste** sits under that. The seeded checks have none, so it should say
  nothing was recorded — not show $0.00. After the till walkthrough below (a
  void as made wrong), set the range to today: it should appear under **Made
  wrong** with what its ingredients cost, and as a share of POS sales.

### Food safety — `/admin/food-safety` (needs the module on)
Settings → Features → **Food Safety**, which is **off** by default. Nothing is
seeded, so start in settings.

1. **`/admin/food-safety/settings`** as admin: add a fridge, a freezer and a
   hot-holding unit to Main. The limits show the UK defaults with a note on
   Lebanon's checklist. Type **80** for the chilled limit and save — it should
   be refused by name, not quietly saved as 8.
2. **The diary** as a barista or kitchen crew: answer the opening checks. Mark
   one **Not done** — a note box appears. Log readings: **4** on the fridge
   (teal), **7** (amber, adjust the unit), **9** (red) — a 9 will not save
   until you say what was done about it. Mark the freezer out of use: it asks
   why.
3. As a **manager**: the day lists what still stops the signature, in order.
   "Not done, with a note" does not block it — only an unanswered check, a
   missing reading or a breach with nothing said. Answer the closing checks,
   save, and **Sign as supervised**.
4. Change a reading on the signed day: as a barista it is read-only; as a
   manager it asks for a reason and keeps what the day said before.
5. Open yesterday as a barista (allowed — closing checks after midnight) and
   the day before (read-only). **History** should show the signed day, and
   earlier days in the range as **Missed**.
6. Change a limit in settings: the signed day is still shown against the limit
   it was signed with.
7. **Allergen Chart** (`/admin/food-safety/allergens`): with nothing done yet,
   **every dish should read Not verified in red** — never a clean row. That is
   the point, not a bug.
8. In **Supplies**, open Whole Milk → Allergens → **Checked**, tick Milk, save.
   Open Coffee Beans → **Checked**, tick nothing, save ("contains none").
   In **Recipes & Costing**, open the Latte: it should say not verified because
   nobody confirmed the recipe is complete. Tick the confirmation and save. The
   chart should now show the Latte as containing Milk, verified — and Vanilla
   syrup (unchecked) listed against the syrup option as not verified.
9. Change an ingredient quantity in the Latte recipe: the confirmation tick
   clears before you save.
10. **On the till** (`pos.`, module on): the floor has an **Allergens** button.
    Pick **Milk** under "The customer can't have": the Latte is under
    **Contains milk**, and a dish nobody has checked is under **Can't be
    sure**, never under free.
11. Open a table. Next to **Menu**, turn on **Allergens**: every tile shows its
    chips, or a red **Not verified**. Leave it on and reload; it stays on for
    this device.
12. Tap the Latte and choose oat milk: the box says what the drink contains
    *with these options* and changes as you tap. To see the trap, give the
    Latte an "add cream" option whose supply carries milk, and choose oat and
    cream together. It must still say **Milk**.
13. **Only admins set allergens.** Sign in as a barista or manager, open Whole
    Milk in Supplies, untick Milk and save: you are told it is waiting for an
    admin. The item shows **Allergen change waiting**, and the chart and the
    till show every milk dish as **Not verified**, still listing Milk. Sign in as
    an admin: the Supplies page lists the waiting change. **Reject** it and the
    dishes are verified again with Milk. Repeat, **Accept**, and check
    `/admin/logs` shows before and after under Allergens.
14. **Options.** On a verified dish with an option that has no recipe change,
    the Recipes page says it is not verified with that option, and so does the
    till when the option is chosen. Tick **Adds no ingredient** for it, save,
    and choosing it verifies.
15. **Corrections before signing.** On today's diary, record a fridge at 9 °C
    with an action and save, then change it to 4 °C and save. The day shows
    **Corrected after it was first entered**, with 9 °C and who entered it.
    With the module switched off, `/api/admin/food-safety` answers 404.

### Daily counts — `/admin/supplies/daily`, `.../history`
- Submit a count, then open it in the history: **Expected, Counted, Variance
  and Value** per supply, with totals. Counts from before 14 Sep have no expected
  figure and say so rather than showing NaN.

### The rest
Products, weekly orders, wholesale, loyalty approvals and redemptions, events,
table reservations, media, users, activity log. All predate this work and all
have seeded data.

---

## The till

### Floor and a check — `/pos`
- Open a table, add items with modifiers, set a seat and a course, Send.
- The right station should see the ticket at `/pos/kds` and be able to clear it.
- Add a **retail product** to the same check — that is the differentiator, and
  it comes off a different stock model.

### Ingredients leaving stock (needs "Deduct Ingredients on Sale" on)
Use the branch that holds stock — Main in the demo. Note Coffee Beans and Whole
Milk in Supplies first.

1. **Turn the switch on before adding anything.** What an item takes is recorded
   when it is added, so a line added while the switch was off moves nothing
   even if it is sent afterwards.
2. Add a **Latte, Large, with an Extra shot**, and Send. Coffee Beans should
   drop by **0.036 kg** and Whole Milk by **0.34 liter**. Coffee Beans starts at
   0 in the demo, so it goes negative — allowed on purpose: the café sold the
   coffee, and a till that refuses a sale over a stock figure is worse.
3. Void one item with a **never-made reason** (changed their mind): its
   ingredients come back. Void another as **made wrong**: they stay gone. The
   reason picker says which will happen before you confirm — "ingredients go
   back into stock" or "ingredients recorded as waste". What the waste cost appears
   on the Food Cost Report under Waste, for the day the check closes.
4. Close a check, then refund it from `/pos/closed`. The panel asks **why** now,
   and the answer decides the same thing — returned or wasted, retail products
   included.
5. **Turn the switch off again** afterwards.

### The counter — `/pos/counter`
The single screen built for outages.

- Tick **"This is the counter device"** at the bottom. That registers the
  service worker; nothing else does.
- Ring items up. Notice the total says **"Rung up"** and shows anything not yet
  sent as a separate "Not rung up yet" line — money is taken against what is on
  the check, never what is on the screen.
- **Take is refused while anything is un-rung**, and says why. That is a fix
  from today: taking payment against drafts would have refused a card on the
  server and stuck the whole queue.

### The offline drill — the one that matters
1. With the counter device marked and the page loaded, turn the wifi off.
2. Reload the page. It should still open — that is the service worker.
3. Open a table, ring items up, take a cash payment. Each action should show as
   waiting.
4. Turn the wifi back on. The queue should drain, in order.
5. Check the table on another device: the items are there, recorded as already
   made, with **no kitchen ticket** — the kitchen cooked them from a spoken
   order during the outage, so a ticket now would be a second order.

Nothing in this drill has ever been run. It is the single property that chose
this database, and twenty minutes will tell you more than any test I can write.

### Drawer — `/pos/drawer` (needs `payments` on)
- Ninety seeded shifts are closed already; the screen shows the open one, so
  open a shift with a float to see it live.
- X reading mid-shift, Z close with a note-by-note count. Expected against
  counted, **per currency, never netted at a rate**.
- Four seeded shifts are deliberately counted one $5 note short, so the
  over/short display has something real in the history.

### Closed checks and receipts — `/pos/closed`
- Thirty days of closed checks. Open one and view its receipt.
- The receipt should show a real date and time — not "NaN-NaN-NaN", which is
  what a Timestamp read as a string produced on every receipt once.
- It should show the rate that check was settled at, not today's.

---

## The customer site

Menu, shop and search, events, branches, sign-in, profile. On the profile, the
**member QR** is what the till scans to attach a customer to a check — worth
testing end to end with the loyalty feature on: scan it at
`/pos/check/[id]`, close the check, and the points should land immediately.

---

## Changed on 14 Sep and never seen signed in — look at these

All of it is behind a sign-in, and none of it has been looked at by somebody
signed in. It compiled, passed every verifier, and the figures were checked
against the demo documents from a script; that is not the same as having seen
the screens.

- **Recipes & Costing** and the recipe fields on the Supplies form.
- **The theoretical row on the Food Cost Report** — the figures above.
- **The daily count history**, rewritten.
- **The refund panel** on `/pos/closed`, and the hint on the void picker saying
  whether an item's ingredients go back or are waste.
- **Nothing on the till side of recipes has run against the database** — the
  snapshots on the seeded checks were written by a script, not rung up. The
  walkthrough under "Ingredients leaving stock" is the first time it will.

## Changed on 13 Sep and never seen in a browser — look at these

Everything else changed that week was checked in a running page. These were
not, because each renders only for somebody signed in, and nobody signed in
to check. They compiled and passed every verifier; that is not the same as
having been looked at.

**As a signed-in customer:**
- **`/customer/submit-check`** — submit a check and read the confirmation
  card. It should show **one** "Points Pending" row. It used to show two — the
  same award under two names.
- **`/customer/redeem`** — the success message should say points will be
  deducted, not coins; with a balance below an item's cost, the button should
  read "Not enough points".
- **The profile page's empty points history** should say "You haven't earned
  any points yet".

**As admin, under Loyalty:**
- **Customers → edit a customer's balance** — the two fields should read
  **"Lifetime total (sets tier)"** and **"Balance (spendable)"**. This is the
  one worth a careful look: "Reset to 0" beside the first demotes a customer's
  tier, and it used to be labelled "XP".
- **Redemption items** — the column says "Points" and the form says "Point
  Cost".
- **Redemptions** — each request shows "Point Cost".

**As a signed-in customer with no username or display name** (a fresh
email/password sign-up is the easy way to get one): the navbar should read
"Welcome, " followed by the part of their email before the @. It used to say
"Welcome, Adventurer".

---

## Known gaps — not bugs

- **The counter screen has no modifiers and no retail.** It is the fast path;
  the full check screen has both.
- **Closing needs a connection.** A receipt number is issued by the server on
  purpose, so two tills can never print the same one.
- **Only the counter device works offline**, and only once marked. A waiter's
  phone that loses wifi says so and stops.
- **Printing beyond a browser print is not built.** `epos` and `cloudprnt`
  return a reason rather than pretending; choosing hardware is one `case`.
- **Card payments are recorded, not taken.** The card machine is separate.
- **Oat, almond and soy milk take nothing different.** The demo has no plant
  milks in supplies, so those options have no replacement set up. A café that
  stocks them adds one on the Recipes page.
- **Being out of stock never stops a sale** (owner's decision). Stock goes
  negative, and the count puts it right.

---

## When something looks wrong

1. `/admin/errors` first — if a screen threw, it is there with a count.
2. `npm run rules:live` — a rule that is written but not deployed looks exactly
   like a rule that is wrong. This is the second-commonest cause.
3. `npm run verify:all` — twenty-one checks, about forty-five seconds. If the
   arithmetic is wrong, this says so; if it passes, the bug is in what was
   handed to the arithmetic, which is where the last three bugs were.
4. Write it down with the screen, what you did, and what you expected. A
   sentence now beats a memory next week.
