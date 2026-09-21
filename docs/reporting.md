# Reporting: what the system reports, and where it falls short

UPGRADE.md T7.0. Written 21 Sep 2026, from the code rather than from CLAUDE.md
or memory. Every claim names the file and function it was read from.

It has three jobs:

- list every figure the system reports, where it is computed, and exactly
  what is in it
- measure those figures against the definitions below
- say which reconciliations hold today

**Keeping it current.** A change to any function named here changes this
document in the same commit. When a Tier 7 task closes a gap, it moves the gap
into "What exists today" and marks the reconciliation. Once
`shared/src/reportDefinitions.ts` exists, its version goes at the top of this
file, and the two must agree.

---

## 1. Definitions we follow

These are the Tier 7 standards and the owner's answers of 21 Sep 2026.
*Default* marks a rule for the owner or the accountant to confirm.

1. **Revenue is recognised when the check closes** (IFRS 15). A check's day is
   the café's day in `BRAND.locale.timezone`.
2. **Gross sales** are prices before any discount. **Net sales** are gross,
   less staff meals, item discounts, check discounts, comps and refunds.
   Net sales **exclude VAT and service charge**.
3. **VAT is output tax, extracted, never added.** It is worked out at each
   check's own `vatRate`. A check with no rate recorded adds no VAT and is
   counted on a line of its own.
4. **Service charge is its own revenue line.** *Default:* it is subject to
   VAT, and its share of the VAT is shown on its own line.
5. **Tips are a liability** owed to staff. They are never inside a sales or
   collected figure.
6. **A refund belongs to the period it happens in**, as a credit note against
   its original receipt. The original day is never rewritten.
7. **Inventory is valued at weighted average cost**, per branch.
8. **Every report and download shows both currencies.**
   - LBP is at each check's own `billRate`.
   - The business rate is used only where no check rate exists.
   - A delivery keeps its own `rateUsed`.
   - Each currency is totalled on its own, never converted afterwards.
9. **Receipt numbers are audited** for gaps and duplicates.
10. **Every figure reconciles to another:** sales to payments to the drawer.
11. **Fiscal year** *(default)*: the calendar year. A period locks when it is
    closed (T7.17).
12. **The journal is plain CSV** (owner). One row per line: date, journal
    number, branch, account code, account name, description, debit and credit
    in USD, debit and credit in LBP, and source.
13. **Labour cost is reported**, from each person's hourly rate and its
    history (T7.18, built 21 Sep 2026).
14. **Loyalty points are a liability**, like tips.

---

## 2. Building blocks

Most figures come from a handful of functions.

### `checkTotals()`, `shared/src/checks.ts`

| Field | Definition |
|---|---|
| `gross` | Sum of `grossLineTotal()`: unit price with modifiers × quantity; a void line is 0. **VAT included.** |
| `discount` | **The staff meal**, despite the name (kept from v1). |
| `itemDiscounts` | Managers' comps and % off an item, after the staff meal. |
| `subtotal` | gross − staff meal − item discounts. |
| `checkDiscount` | Whole-check % or amount off the subtotal, capped at it. |
| `service` | `serviceRate()` × (subtotal − check discount), at the rate snapshotted when the check opened. |
| `net` | subtotal − check discount + service. **VAT and service both included:** it is the bill. |

So `net` is what the customer owes, not net sales in the accounting sense.
Every figure below called "net" inherits that.

### Payments, `shared/src/payments.ts`

- `amount` is what was handed over (cash) or charged (card). **A card tip
  (`tipUsd`) is on top of `amount`.**
- `appliedLbp` is the part applied to the bill, at `billRate`.
- `changeUsd` and `changeLbp` are the change given.
- `cardTipsOf()` adds up the card tips.

### Two day rules

- **`closedAtParts()`** (`shared/src/salesExport.ts`) cuts the day at
  **midnight**, café time. The export, the reports, food cost, the timesheet
  and the till's floor readings use it.
- **`cashUpDay()`** (`shared/src/dates.ts`) cuts it at **10:00**. It is stamped
  on a drawer shift when the shift opens, and End of Day defaults to it.

A sale at 01:30 is therefore on the next day in the export, but in the
previous day's drawer and End of Day (gap 5).

### `readClosedChecks()`, `shared/src/server/salesExport.ts`

- It ranges on `closedAt`, padded a day before and two days after, oldest
  first, up to 20,000 checks (`EXPORT_CHECK_CAP`).
- It then narrows to the branches (now a list, T7.1) and to the café days
  asked for.
- A range longer than 100 days (`MAX_RANGE_DAYS`) is refused.
- When the 20,000 cap is hit, the answer is marked as cut short (T5.8).

---

## 3. What exists today

### 3.1 Sales Export, `/admin/exports`

`buildExport()`, `checkRow()`, `paymentRows()` and `dayRows()` in
`shared/src/salesExport.ts`, arranged into sheets by
`admin/app/admin/exports/workbook.ts`. Gated on `endOfDay`, with a from–to
range of up to 100 days. Downloads: XLSX (by day, checks, payments) and a
by-day CSV, **with no header block**. Only checks with a receipt number, closed
or refunded, are included; cancelled and merged checks are not.

**Checks sheet**, one row per check, filed by close day:

| Column | Definition |
|---|---|
| Gross USD | `gross`, VAT included |
| Staff meal, Item discounts, Check discount | as in section 2 |
| Service | inside net |
| Net USD | `net`: **VAT and service included** |
| VAT incl. USD | `vatIncluded(net, vatRate)`, taken out of a total **that includes service**; 0 with no rate |
| Rate / Net LBP | `billRate`, else **today's** business rate |
| Cash USD / Cash LBP | cash `amount`: **handed over, before change** |
| Card USD | card `amount` **in USD only**; a card payment taken in lira is in no column. Tips are left out. |
| Order | the order type (T5.5) |

**Payments sheet:** one row per payment, including those on refunded checks.
**There is no tip column**, so card tips leave the building in no file.

**By-day sheet:**

- Checks, gross, service, net and VAT count **closed checks only**. Refunded
  ones are left out.
- "Discounts" combines staff meal, item discounts and check discounts.
- "Refunded USD" is the net of checks that closed that day and **were since**
  refunded.
- Tenders count closed checks only.

### 3.2 Loyalty export (points ledger)

`shared/src/loyaltyExport.ts`. Gated on `loyalty`.

| Figure | How it is counted | Filed by |
|---|---|---|
| Points issued | points × people, approved transactions only | `createdAt` |
| Points reversed | reversed transactions | **the original `createdAt`** |
| Points spent | `coinCost` of redeemed rewards | `confirmedAt`, else `createdAt` |

Points only: there is no money value and no closing balance. Each read stops
at 20,000 **with no cut-short warning**.

### 3.3 Product Mix, `/admin/reports/mix`

`productMix()` in `shared/src/salesReports.ts`. Covers closed checks only, with
the range picker, per-branch totals and a download (T7.1).

- **Revenue** is `lineTotal()`: VAT included, before the check discount,
  service left out.
- **Net sales** (T7.8) are the line's goods share after every discount,
  whole-check ones included, without service (`goodsShareForLines()`), before
  VAT at the check's own rate, each line to the cent.
- **Cost** is each line's recipe snapshot; **margin** is costed sales − cost,
  over the lines that could be fully costed only, with **coverage** beside it.
  An item nobody could cost reads "not costed", never $0.
- **Category** is the item's category now, not when it sold.
- **Combos** (T7.8): a combo's parts are costed on the combo line
  (`foldComboParts()`) and counted as "made in combos", not sold.

### 3.4 Voids & Discounts, `/admin/reports/voids`

`voidDiscountReport()` reads every check except open ones, **refunded and
cancelled included**, for voids and discounts. With the range picker,
per-branch totals and a download. Since T7.9 it is the exception report.

- **Void value** is the line's price before the void, VAT included.
- **"Voided by"** is `voidedByEmail`. **"Rung up by"** is the line's
  `addedByEmail`.
- **Approval** (T7.9): since T5.1, voids of sent food and refunds need a
  manager's own session, so the person recorded is the approver. The role they
  held is stamped with it (`voidedByRole`, `refundedByRole`) from 21 Sep 2026,
  and `approvalOf()` reads it. Older ones read "Not recorded", never a guess.
- **Refunds** are the checks refunded in the period (`readRefundedChecks()`,
  on `refundedAt`), filed on the day they were given, with the sale's day.
- **Price rules**: what sold at each price rule (T5.12), from closed checks.

### 3.5 Hourly Sales, `/admin/reports/hourly`

One day beside the same weekday a week before. "Takings" is `net` by café
hour, **refunded checks included**.

### 3.6 Timesheet, `/admin/reports/timesheet`

`timesheet()` in `shared/src/timeClock.ts`, from `timeEntries`. Each shift is
filed by the café day of its clock-in; an open shift counts as 0 minutes.

The route pairs clock-ins over the padded window, keeps the shifts that started
in the range, and adds `people` up from those (`peopleOf()`, T7.11).

### 3.6b Labour, `/admin/reports/labour` (T7.11, admin only)

`labourReport()` in `shared/src/labourReport.ts`. Each shift is costed at the
person's rate on the day it started (Staff Pay), in its own currency. No rate
is "not priced", never $0. Open or over-16-hour shifts are flagged and
not costed. Tips are the tips split per branch (each day's deduction, each
shift's weight). Names that match no account are listed apart. Owed = pay + tips,
per currency. Labour % = cost ÷ the sales summary's net sales, with lira
converted at the business rate for that figure only.

### 3.7 Food Cost Report, `/admin/supplies/receiving/report`

**Actual food cost:** cost of goods ÷ till sales.

- **Cost of goods** (`costOfGoodsUsd()`, `shared/src/deliveryMath.ts`) is the
  grand total of posted deliveries in the range, **input VAT included**. That
  is purchases, not stock used.
- **Till sales** (`netSalesUsd()`, `shared/src/endOfDay.ts`) is
  `systemUsd + systemLbp / rate` from End of Day. That is **drawer cash** (float
  in, card out), not sales. The form stores `systemUsd` as `systemLbp ÷ rate`,
  so a day saved from the form is **counted twice** (gap 3).

**Theoretical food cost and waste** (`theoreticalFoodCost()` and
`wasteSummary()` in `shared/src/recipes.ts`, read through
`shared/src/server/foodCost.ts`):

- **Sales side:** menu lines of closed checks, each line's share taking in the
  staff meal, its item discount, and its share of the check discount **and of
  service**, divided by 1 + VAT.
- **Coverage** shows how much of that could be costed.
- **Waste** comes from the stamps on voids and refunds, filed by close day.

### 3.8 End of Day, Daily Summary, EOD History, Tips

One report per branch per cash-up day (the 10:00 rule).

- **System figure:** with `payments` on, `daySystem()` sums each drawer shift's
  expected cash, in LBP at the **current** business rate, card left out.
  Otherwise it is typed in.
- **Difference** (`computeTotals()`): the count converted into one total, plus
  expenses, less income and the system figure. It is **one netted figure shown
  in two currencies**, never a difference per currency (gap 14).
- **"Tips" on the Daily Summary** is the tip jar only; `cardTipsUsd` is left
  out.
- **History** is the 90 most recent days. **Summary** is one day. Neither has
  a range or a download.
- **Tips Calculator:**
  - reads the branch's 400 most recent reports and splits a month into 1–15
    and 16–end
  - the pot is the jar plus card tips
  - takes the deduction at **today's** rate (gap 16)
  - splits by shift points × tip weight: weights added in T7.18, each day at
    that day's weight

### 3.9 Drawer X and Z, `/pos/drawer` (till only)

`drawerTotals()` in `shared/src/drawer.ts`, per currency and never netted:
float, cash taken, change given, cash refunds, paid out, safe drops, paid in,
expected, counted and difference.

- **Card** is the card `amount`. Its count, "N payments", **also counts cash
  payments**.
- **Card tips** are computed but **not shown**.
- **A Z close has no number of its own**, only the shift's document id.
- **Admin cannot see shifts** at all (T7.7).

### 3.10 Till floor readings

`floorReadings()` in `pos/app/lib/floorReadings.ts`:

- **Closed today** is the net of today's checks that were not refunded.
- **Refunds today** is the net of checks **that closed today** and were since
  refunded. A refund given today on yesterday's check is not in it.

### 3.11 Receipts

- **"Subtotal" is `gross`**, not `checkTotals().subtotal`.
- **"Incl. VAT"** is taken out of the total, service included.
- **There is no tip line.**
- **One yearly receipt series** (`issueInvoiceNumber()`) is shared by checks,
  counter retail sales and wholesale orders. A hub draws its numbers in blocks.
- **`/admin/reports/receipts` lists every number** (T7.10, 21 Sep 2026), from checks, retail sales, wholesale orders and `receiptLog`, which `issueInvoiceNumber()` and `createPurchaseOrder()` now write in the same transaction as the number.

### 3.12 Daily Inventory History

One day's count at a time. The variance is counted − expected, in units and
in USD at the cost stored with the count (`countVariance()` in
`shared/src/recipes.ts`). There is no total over a range and no download.

### 3.13 Other stock figures

- **Average cost:** `avgUnitCost` is **one figure per supply for every
  branch**, updated at each delivery by `weightedAverageCost()`.
- **Deliveries:** each keeps its subtotal, input VAT at its own rate, and its
  grand total, filed by `deliveredAt`. No supplier invoice date is stored.
- **Low stock** (`lowStock()`) counts quantities only.

---

## 4. Gaps against the definitions

1. **FIXED for the Sales Export, 21 Sep 2026 (T7.4). Refunds were filed on the day the check closed, not the refund day.**
   - Now: the export reads checks refunded in the period (`readRefundedChecks()`, ranged on `refundedAt`) beside those closed in it. A refunded check stays a sale on its close day. Its refund is a credit row (`refundRow()`, kind `refund`) on the day it was given, naming the sale's day, with what went back by tender. The day sheet counts refunds given and their VAT (`refundVat`). A refund from before `refundedAt` was read is credited on its close day.
   - Still by close day: floor "Refunds today" on the till, and the food cost report's waste (decision in gap 28).
   - Was:
   - `dayRows()` drops a refunded check from its close day.
   - `readClosedChecks()` ranges on `closedAt`, so a refund given today on
     last quarter's check is in no export for today.
   - Floor readings and waste follow the same rule.
   - `refundedAt` is written but nothing reads it.
   - Why it matters: every refund rewrites a past day.
   - Fix: **T7.4**; locking a period is **T7.17**.
2. **The export's refund is not a credit line.**
   - The refunded check is removed from its day's sales, VAT and tenders, and
     "Refunded USD" only reports it.
   - Why it matters: output VAT is reversed silently, on the wrong day.
   - Fix: **T7.4**, **T7.6**.
3. **The Food Cost Report's "Till sales" is drawer cash, and a day saved from
   the form counts twice.**
   - Cost of goods includes input VAT and is purchases, not what was used.
   - The seeded reports store the two fields as halves, which is why the demo
     figure looked right.
   - Fix: **T7.12**, **T7.3**, **T7.16**.
4. **FIXED for the export and admin reports, 21 Sep 2026 (T7.3, T7.5). Card tips appeared in no export and on no admin sales page.** Export rows and payment rows now carry them, and the Sales Summary and Payments & Tenders show them apart. The Z screen on the till still does not (T7.7). Was:
   - The only place they show is End of Day's `cardTipsUsd`, taken when the
     report is saved, so a report saved before its shift closes misses later
     tips.
   - The bank's card settlement is amount + tip, so it never matches "Card
     USD".
   - Fix: **T7.5**, **T7.3**, **T7.15**.
5. **Two day rules, midnight and 10:00.**
   - After-midnight sales sit on the next day in the export, but in the
     previous day's drawer and End of Day. Sales cannot be reconciled to
     cash-ups day by day.
   - CLAUDE.md's line that a 01:30 sale "belongs to the night it was made"
     does not describe the export, which files it on the next calendar day.
   - **Decided 21 Sep 2026 (T7.1b):** sales, VAT and every accounting report
     use the calendar day in the café's zone, the date on the receipt, because a
     receipt is a tax document. Counting cash keeps the cash-up day. Cash is
     reconciled per shift, never per calendar day. Every download says which
     day rule it uses (`DAY_RULE_LABEL` in `shared/src/reportDefinitions.ts`).
   - Fix: **T7.7**, **T7.16**.
6. **Everything called "net" includes VAT**, and the export's includes
   service too.
   - This covers Net USD and Net LBP, Hourly "Takings", "Closed today", and Mix
     "Revenue" (VAT in, service out).
   - An accountant reads "net" as net of VAT.
   - Fix: **T7.3**, with `reportDefinitions.ts`; **T7.8**.
7. **Service charge sits inside sales, and its share of VAT is never shown.**
   - Fix: **T7.3**, **T7.6**.
8. **FIXED 21 Sep 2026 (T7.5). A card payment taken in lira dropped out of the
   export's check columns.** It now has its own Card LBP column, and Payments &
   Tenders shows it. Was: `tenders()` counted card in USD only.
   - Fix: **T7.5**.
9. **Answered by Payments & Tenders (T7.5), which shows cash handed over, change
   and kept, per currency.** The export's cash columns are still what was
   tendered, as their name says. Change
   appears only on the payments sheet, so the day's cash never matches the
   drawer.
   - Fix: **T7.5**, **T7.7**.
10. **The same number goes by different names, and one name covers different
    numbers:**
    - The receipt's "Subtotal" is gross; `checkTotals().subtotal` is not.
    - `CheckTotals.discount` is the staff meal, while "Discounts" in the export
      is all three kinds.
    - "Tips" means the jar on the Summary, but jar + card on the Tips page.
    - "Refunds" goes by close day on the export and the floor, but by refund
      shift on the drawer.
    - "Till sales" and "POS sales before VAT" appear on the same page and mean
      different things.
    - Hourly counts refunded checks and the export does not.
    - Voids & Discounts counts refunded and cancelled checks and the export
      does not.
    - The drawer's "N payments" counts cash payments too.
    - Fix: **T7.3**, **T7.9**, **T7.16**.
11. **Most reports have no range, no branch columns or no download, and no
    download has a header block.** T7.1 (in progress) adds one picker with
    quick periods and several branches, and per-branch totals for the reports.
    - Fix: **T7.1**, **T7.1b**, then every report task.
12. **FIXED 21 Sep 2026 (T7.2). Ranges stopped at 100 days or 20,000 documents.** Every report read (the export, refunds, food cost, loyalty, timesheet) now goes through `readInChunks()`, a month of café days at a time, each piece with its own cap. A report covers up to 460 days (`MAX_REPORT_DAYS`: last year beside this one). The loyalty and timesheet reads now say when they are cut short too. Was: The loyalty and timesheet
    reads hit that limit **without a warning**.
    - Fix: **T7.2**.
13. **Older checks' LBP moves with today's rate.**
    - A check with no `billRate` uses the current business rate.
    - End of Day's system figure is converted at the current rate when read.
    - Fix: **T7.3**, **T7.5**, **T7.17**.
14. **Answered by Cash-up & Drawer (T7.7, 21 Sep 2026), which shows every shift and each day per currency, never netted, with the End of Day count beside it.** The End of Day form itself still nets its Difference into one figure. The drawer refuses
    to do that (`drawerDifference()`).
    - Fix: **T7.7**.
15. **FIXED 21 Sep 2026. End of Day threw away expense and income lines, and
    every attendee's shift, on save.**
    - What happened: `parseEodInput()` read `{ label, amount }` and
      `{ hours, present }`, which the form never sends. Every line was stored
      with no name and $0, and an Off day earned a tips share.
    - Now: the route keeps `{ name, amountUsd }` and `{ name, shift, isGuest }`,
      still reads the old keys, and refuses an unknown shift. `verify:hub`
      checks it.
    - Data: the demo project's 7 reports were scanned read-only and none was
      affected. Reports in any other project saved since 29 Aug 2026 should be
      checked.
16. **FIXED 21 Sep 2026 (T7.11). The tips deduction used today's rate.** Now each End of Day report stores `tipsDeductionRate` when it is first saved, and a later edit keeps it. `distributeTipDays()` takes each day's own rate, and the tips page and the labour report both use it. A report from before this takes today's setting. Was: the tips deduction used today's rate, so reopening last month after a
    settings change splits it again. T7.18 made each person's weight dated,
    but the deduction is still read live.
    - Fix: a dated deduction, alongside **T7.11**.
17. **FIXED 21 Sep 2026 (T7.11). Timesheet hours included days outside the range** (section 3.6). Now `peopleOf()` adds hours up from the shifts kept in the range, in the timesheet route and the labour report.
    - Fix: **T7.11**.
18. **FIXED, 21 Sep 2026 (T7.8). Combos distorted the product mix and theoretical food cost.**
    - Now: `foldComboParts()` in `recipes.ts` puts each part's per-serving snapshot on the combo line, and drops the $0 parts. It is used by both the Food Cost Report and the Product Mix. A combo with a part nobody costed is incomplete, never costed on the parts that were. The mix counts parts as "made in combos", not as sold. Food cost and the mix's net sales now leave out the service charge too (`goodsShareForLines()` in `splits.ts`).
    - Checked read-only on the demo's last 60 days: recipe cost $1,168.74 in both reports, and the Food Cost Report still reads 16.3% on $7,177.48 of costed sales. The mix reads $7,177.72 because it rounds each line to the cent, so branches and items add up exactly.
    - Was:
    - A part with a costed recipe adds its cost against $0 of costed sales.
    - The combo line carries the sales but has no recipe.
    - So the cost percentage comes out **higher** than the truth.
    - Fix: **T7.8**.
19. **FIXED 21 Sep 2026 (T7.14). A loyalty reversal removed its original issue.** Now a reversed transaction is still issued on its own day, and `reversalRow()` makes the reversal its own movement on `reversedAt`. The ledger reads transactions issued OR reversed in the range, and keeps each movement by its own day. `/admin/reports/loyalty` (gated `loyalty`) shows issued, reversed and spent per branch, and what the whole scheme owes at each end: today's balances worked back through the ledger. It is valued at the new Business Settings point value (`pointValueUsd`, 0 = not set, so points only). Was: the issue disappeared
    from its day, and the reversal showed on the original day. Net movement was
    understated, and there was no closing balance or value.
    - Fix: **T7.14**.
20. **Weighted average cost is one figure across branches**, and there was no
    inventory valuation. **Valuation FIXED 21 Sep 2026 (T7.12):** `/admin/reports/inventory` reconciles each supply between its last submitted count before the period and its last in it (the periodic method). Movements in between are received (on the day stock moved, `stockAppliedAt`), transfers (every one recorded in `stockTransfers` with its unit cost from 21 Sep 2026), used (recipe snapshots of what sold) and waste. Expected closing, the difference nothing explains, and COGS = opening + purchases ± transfers − closing, each at its own snapshot cost; unknown cost is unknown, never $0. **Still open:** the stock value NOW uses the one cross-branch average; a per-branch average is a data-model change.
    - Fix: **T7.12**.
21. **FIXED 21 Sep 2026 (T7.13, T7.6). Purchases and input VAT had no report**, and there was no supplier
    invoice date. Now: receiving asks for the invoice date (optional, stored as `invoiceDate`, refused when not a date). `/admin/reports/purchases` lists every received delivery from the VAT report's own rows, per supplier and branch. It shows net, VAT and total in the invoice's currency and in the other: LBP at the rate received at, USD in lira at the business rate, marked. It shows how much of each weekly order the deliveries were booked against has arrived, across every delivery for that order, counted as the weekly order's own bar counts.
    - Fix: **T7.13**, **T7.6**.
22. **Counter retail sales and wholesale orders** share the receipt series but
    are in no export. Their numbers are in the receipt sequence report since T7.10; their money is still in no export.
    - Fix: **T7.3**, **T7.10**.
23. **FIXED 21 Sep 2026 (T7.10). There was no receipt sequence audit.** Now: `receiptSequence()` in `shared/src/receiptSequence.ts` walks every number from the lowest to the highest seen in the period, per café year. Each is on a check or retail sale, at another branch (counted, not shown), on a wholesale invoice, issued with nothing carrying it (from the log, with what it was for), skipped in a hub block (named with the block), before the log began, or missing. Duplicates are listed. Numbers issued before 21 Sep 2026 were not logged, so a gap below the first logged number of a year reads "before the log", never "missing".
    - Fix: **T7.10**.
24. **Applying a held hub sale changes a closed day**, with no adjustment
    line.
    - Fix: **T7.17**.
25. **FIXED 21 Sep 2026 (T7.6): /admin/reports/vat shows output VAT by rate, the service charge's VAT apart, reversals on refunds in their period, input VAT from received deliveries, and the net position.** Was: there was no VAT report: no split by rate, no count of checks without a
    rate, and no input VAT beside output VAT.
    - Fix: **T7.6**.
26. **Order type and happy-hour prices are recorded but barely reported.** Price rules FIXED 21 Sep 2026 (T7.9): Voids & Discounts, now the exception report, shows what sold at each price rule, from closed checks. It also shows who rang each voided item up, whether each void after sending and each refund was approved by a manager (the role is stamped from 21 Sep 2026; older ones read "Not recorded"), and the refunds given in the period, on the day they were given.
    - Fix: **T7.3**, **T7.9**.
27. **Nothing decides what happens to a card tip on a refunded check.**
    `refundOf()` returns the card amount only.
    - Fix: **T7.5** records the rule.
28. **Waste stays filed by close day for now** (decision recorded for T7.4).
    A refund's waste stamp describes what was made for that check, and the
    theoretical food cost it is compared with is filed by close day too. It
    moves only if the food cost report moves with it.
29. **Labour cost:** hourly rates now exist (T7.18). The labour report is
    **T7.11**.
30. **There is no journal and no chart of accounts.**
    - Fix: **T7.15**, with the default codes recorded under T7.0.

---

## 5. Reconciliations that should hold

| # | Identity | Status |
|---|---|---|
| R1 | Sales summary = product mix = the export's days | **Holds, but cannot be seen.** For closed checks, mix revenue − check discounts + service equals the export's net, by construction. No screen shows it, and no sales summary exists. |
| R2 | Export discounts = Voids & Discounts total | **Breaks** whenever a range has refunded or cancelled checks. |
| R3 | Export day net = Hourly takings | **Breaks** with refunds. |
| R4 | Collected − change − tips = net + VAT + service | **Holds per check** within the lira rounding, through `appliedLbp`. The tips term **cannot be checked**, because no export has tips. |
| R5 | Drawer expected vs payments | **Holds on the till** for one shift. It **cannot be checked** against the export: no admin shift report, different day rules, and refunded tenders dropped. |
| R6 | End of Day system = the day's shifts' expected cash | **Holds** with payments on, at the current rate. |
| R7 | Card total = bank settlement | **Cannot be checked:** tips, and card taken in lira, are missing. |
| R8 | VAT report = sales summary VAT | **Cannot be checked:** neither exists. Per-check rounding may leave cents, and T7.6 decides. |
| R9 | Theoretical food cost sales = export net before VAT | **Different by design** (menu lines only, stocked branches, a share of service). It needs its own name. |
| R10 | Tips split = pot | **Holds** (`verify:tips`). With gap 15 fixed, the inputs are now right too. |
| R11 | Inventory roll-forward | **Cannot be checked:** there is no valuation. |
| R12 | Receipt numbers: no unexplained gaps, no duplicates | **Cannot be checked:** there is no report. |
| R13 | Journal debits = credits | **Cannot be checked:** there is no journal. |
| R14 | Loyalty opening + issued − reversed − spent = closing | **Breaks:** a reversal removes its own issue. |
