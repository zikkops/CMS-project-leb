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
| `users` | 3 | provisioned by hand |

To remove the POS history: `npm run seed:pos -- --clear --apply`. It removes
exactly what it wrote (`seeded: true`) and nothing else. To put it back you
need a fresh receipt block above the counter — the script tells you which.

**Turn the money on, for testing only.** Most of Phase 04 is behind the
`payments` feature switch, which is **off**. In Settings → Features, turn
`payments` on for this pass — the Drawer link only appears when it is on, and
the pay sheet is unreachable without it. **Turn it off again before any
pilot**, because off is what makes the pilot safe.

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

### Receiving and food cost — `/admin/supplies/receiving`, `.../report`
- This chain was closed in September against seeded data; it should still read
  a food cost percentage rather than a dash.

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

---

## When something looks wrong

1. `/admin/errors` first — if a screen threw, it is there with a count.
2. `npm run rules:live` — a rule that is written but not deployed looks exactly
   like a rule that is wrong. This is the second-commonest cause.
3. `npm run verify:all` — twenty checks, about thirty-five seconds. If the
   arithmetic is wrong, this says so; if it passes, the bug is in what was
   handed to the arithmetic, which is where the last three bugs were.
4. Write it down with the screen, what you did, and what you expected. A
   sentence now beats a memory next week.
