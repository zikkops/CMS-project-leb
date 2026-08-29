# Loyalty System

One balance, four tiers, no game. This document describes what the code does
today — it was rewritten after the program was de-gamified, and the XP / OB
Coins / 50-levels design it used to describe no longer exists anywhere.

## Points

Every customer document carries two numbers, and the difference between them is
the whole design:

| Field | Meaning |
|---|---|
| `points` | The spendable balance. Goes up on an approved earn, down on a confirmed redemption. |
| `pointsEarned` | Lifetime points earned. **Never decreases when points are spent.** |

Tier status is derived from `pointsEarned`, so redeeming a reward can never
demote a customer. A program that takes your status away for using it teaches
people to hoard, which is the opposite of what a café wants.

## Tiers

`app/lib/loyaltyTiers.ts` owns this, in pure functions with no Firestore access
— which is why the server can import it too.

| Tier | From |
|---|---|
| Bronze | 0 |
| Silver | 5,000 |
| Gold | 20,000 |
| Platinum | 50,000 |

`getTier(pointsEarned)` is the single source of truth for label, colour and
progress to the next tier. Never re-derive it by hand.

Tier status is **computed on read**, not stored. There is no `tier` field on the
customer document to drift out of sync, and no resync effect to write one back.

## Earn rates

Also in `loyaltyTiers.ts`, so the website and anything else reading it cannot
disagree about what an action is worth:

| Constant | Value | Applies to |
|---|---|---|
| `POINTS_PER_DOLLAR` | 10 | Check submissions |
| `EVENT_POINTS_PER_PERSON` | 250 | Event attendance |
| `TABLE_CHECKIN_POINTS` | 150 | Table check-in |

## Earning

Every earn lands as a `transactions/{id}` document with `status: 'pending'` and
is worth nothing until staff approve it.

1. **Check submission** (`/customer/submit-check`) — the customer enters branch,
   check number and total, and uploads a photo of the receipt. It can be split
   with up to 9 friends; a split divides the points by the party size so
   everyone in it earns an equal share against the same transaction.
2. **Event attendance** — recorded by staff after the fact.
3. **Table check-in** — recorded by staff when a reservation is seated.

Approval happens on `/admin/loyalty/approvals`, scoped to the approver's
branches (admins see everything).

**The approval itself runs on the server**, through
`/api/admin/loyalty/transactions` and `resolveTransaction()` in
`app/lib/server/loyalty.ts`. Three things matter about that and are easy to
undo by accident:

- The amount is taken from the **stored transaction**, never from the request.
  A browser deciding how many points it is owed is not a design.
- The balance moves with `FieldValue.increment()`, not read-then-write. Two
  managers approving at the same moment used to lose one of the awards.
- The pending status is re-checked **inside** the transaction, so the same
  award cannot be approved twice by two clicks.

## Spending

- `/admin/loyalty/redemption-items` — staff define what is redeemable and what
  it costs.
- `/customer/redeem` — the customer picks an item and a branch, creating a
  `redemptions/{id}` with `status: 'pending'`.
- `/admin/loyalty/redemptions` — staff confirm (which deducts the points) or
  reject, once the customer is actually in the branch.

Confirmation goes through `/api/admin/loyalty/redemptions` and
`resolveRedemption()`, under the same three rules as approvals above.

## Tier perks

`app/lib/tierPerks.ts`, collection `tierPerks`, one document per tier keyed by
tier label. Sorted in memory by `TIER_ORDER` — Firestore would sort them
alphabetically and hand you Bronze, Gold, Platinum, Silver.

## The annual reset

`runAnnualReset()` in `app/lib/server/loyalty.ts`, reached two ways:

- **A Vercel cron**, `GET /api/admin/loyalty/reset` at 03:00 daily, authorised
  by `Authorization: Bearer $CRON_SECRET`. Configured in `vercel.json`.
- **An admin**, `POST` to the same route, which accepts `force: true`.

It reads `appSettings/loyaltyReset.nextResetDate` and, when the date has
arrived, zeroes `points` and `pointsEarned` in batches of 500.

Two things it deliberately does:

- **It advances the date only after the work succeeds.** The earlier version
  rescheduled first, so a failure part-way through left half the customers
  reset and the date a year in the future — the other half kept their balances
  permanently.
- **On a project that has never been configured, it seeds the date and stops.**
  Seeding and running on the same pass would wipe every customer on first
  deploy.

## Managing customers directly

`/admin/loyalty/customers` (admin only) — search customers and adjust their
balance. Adjustments go through `/api/admin/loyalty/customers` and
`adjustCustomerBalance()`; the browser sends a delta and a reason, and the
server writes the increment and the audit entry together.

**Deleting a customer still only removes their Firestore profile.** The Auth
login survives, so signing in again produces a fresh blank profile. The Admin
SDK that would let this be done properly now exists (Phase 00) — this path just
hasn't been migrated yet, and is one of the remaining client-side writes
`npm run audit:writes` counts.

## Where to look

| Want to… | Look at |
|---|---|
| Change tier thresholds, or what an action earns | `app/lib/loyaltyTiers.ts` |
| Change how approval moves a balance | `app/lib/server/loyalty.ts` |
| Add a new way to earn | Follow the `transactions` pattern — create it pending, resolve it server-side |
| See the audit trail | `/admin/logs`, or `/admin/loyalty/activity` filtered to loyalty sections |
