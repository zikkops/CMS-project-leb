# Loyalty System

Onboard's customer loyalty program runs on two currencies: **XP** (progression, never spent) and **OB Coins** (spendable).

## XP, Levels, and Tiers

Defined entirely in `app/lib/levelConfig.ts` — pure functions, no Firestore.

- 50 levels, reached on a flat curve: level *N* requires `(N-1) * 1000` XP (`XP_PER_LEVEL = 1000`). Level 50 is the cap — extra XP beyond it doesn't overflow into a level 51.
- Each level has a unique title (`LEVEL_TITLES`, e.g. "Newcomer" at level 1 up to "Onboard Legend" at level 50).
- Levels group into 5 tiers, each with its own color (`TIERS`, `TIER_COLORS`): Apprentice (1–10), Adventurer (11–20), Champion (21–30), Legend (31–40), Mythic (41–50).
- `getLevelFromXP(xp)` is the single source of truth for deriving level/title/tier/progress-percent from a raw XP number — call this anywhere you need to display or recompute level info, never hand-roll the math.

A customer's `level`/`levelTitle` fields on their `users/{uid}` doc are kept in sync with `xp` by a `useEffect` on the profile page (`app/(customer)/customer/profile/page.tsx`) that recomputes and writes them back if they ever drift. This means a direct Firestore edit to `xp` alone (without also updating `level`/`levelTitle`) will look stale until the customer next loads their profile. Anywhere XP is written programmatically (`customerManagement.ts`, the annual reset), `level`/`levelTitle` are updated in the same write to avoid relying on that resync.

## Earning XP and OB Coins

Two ways, both logged as a `transactions/{id}` document with `status: pending`, requiring staff approval before the customer's balance actually updates:

1. **Check submission** (`/customer/submit-check`) — customer enters branch, check number, total amount, and a photo of the receipt. XP/coins earned scale with the amount (`Math.floor(amount * 10)` XP, `Math.floor(amount * 1)` coins), and can be **split** with up to 9 friends — splitting divides the earned amount by the party size, so everyone in the split gets an equal share logged under the same transaction's `userId` array.
2. **Event attendance** — logged by staff on `/admin/loyalty/events` after the fact.

Pending transactions are approved or rejected by a manager/admin on `/admin/loyalty/approvals`, scoped to their assigned branch(es) (admins see everything).

## Spending OB Coins

- `/admin/loyalty/redemption-items` — staff define what's redeemable (name, description, coin cost).
- `/customer/redeem` — customer picks an item, picks a branch, confirms — creates a `redemptions/{id}` doc with `status: pending`.
- `/admin/loyalty/redemptions` — staff confirm (deducts the coins) or reject the request once the customer shows up in-branch.

## Annual Points Reset

Configured and managed entirely from `/admin/loyalty/customers` (admin-only). See `app/lib/customerManagement.ts`.

There's no server/cron job in this app, so the reset can't fire at midnight on the dot. Instead, `checkAndRunLoyaltyReset()` runs passively the first time any admin opens `/admin` (the dashboard) on or after the configured date:
1. Reads `appSettings/loyaltyReset.nextResetDate`.
2. If today is on or past that date, immediately reschedules it one year forward (this happens *before* touching any customer, so a second admin loading the dashboard moments later sees the already-future date and skips — making a double-run a harmless no-op rather than a real race condition).
3. Batches every `users/{uid}` doc to `xp: 0, level: 1, levelTitle: 'Newcomer', obCoins: 0`, in chunks of 500 (Firestore's batch write limit).
4. Logs the run to `activityLog` under section `Loyalty Reset Schedule`.

## Managing Customers Directly

`/admin/loyalty/customers` (admin-only) — search all customers, edit their XP and OB Coins independently (editing XP recomputes level/title automatically), resend a Firebase password-reset email, or delete their profile.

**Deleting a customer only removes their Firestore profile** (XP, coins, history references) — it does not and cannot delete their Firebase Auth login, since that requires Admin SDK access this app doesn't have. If they sign in again afterward, they get a brand-new blank profile, same as a first-time signup.

## Where to look

| Want to... | Look at |
|---|---|
| Change the XP curve or level titles | `app/lib/levelConfig.ts` |
| Change how much a check submission earns | `app/(customer)/customer/submit-check/page.tsx` |
| Add a new way to earn XP/coins | Follow the `transactions` pattern in `app/lib/loyalty.ts` |
| See the full audit trail of point changes | `/admin/logs` (everything) or `/admin/loyalty/activity` (filtered to loyalty-related sections, including "Customer Account") |
