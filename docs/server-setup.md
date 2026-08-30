# Server setup — Firebase Admin SDK

Phase 00 of the product plan. This adds a privileged server layer to the
existing deployment: Next.js route handlers running the Firebase Admin
SDK. No new infrastructure, no Cloud Functions, no second host.

Do these steps in order. Step 4 (backfill) must happen before any Firestore
rule reads a custom claim — a rules deploy has no gradual rollout, so a rule
checking a claim that was never minted locks every staff member out of that
collection until you notice.

---

## 1. Generate a service account key

Firebase Console → **Project settings** → **Service accounts** →
**Generate new private key**. A JSON file downloads.

Treat that file the way you'd treat a database root password. It bypasses
every Firestore security rule. Do not commit it, do not paste it into a chat,
and delete it from your Downloads folder once step 2 is done.

## 2. Encode it and set the env var

The JSON contains a multi-line PEM private key. Pasting that raw into an
env-var box is the single most common way this setup breaks — newlines get
eaten or double-escaped, and you get an opaque `Invalid PEM formatted message`
at runtime. Base64 sidesteps it entirely.

**Windows PowerShell:**

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\firebase-adminsdk.json")) | Set-Clipboard
```

**macOS / Linux:**

```bash
base64 -w0 ~/Downloads/firebase-adminsdk.json | pbcopy   # or | xclip -sel clip
```

Then:

- **Locally** — add to `.env.local` (already gitignored via `.env*`):

  ```
  FIREBASE_SERVICE_ACCOUNT=<the base64 string>
  ```

- **On the host** (Hostinger) — set it as a server-side environment variable. Name
  `FIREBASE_SERVICE_ACCOUNT`, paste the same value, tick **Production**,
  **Preview** and **Development**. Redeploy — env var changes don't apply to
  an existing deployment.

Note the missing `NEXT_PUBLIC_` prefix. That prefix is what inlines a variable
into the browser bundle; this one must never have it.

## 3. Install and verify the build

```bash
npm install
npx tsc --noEmit -p .
npm run build
```

`firebase-admin` is listed in `serverExternalPackages` in `next.config.ts`, so
it stays a runtime `require()` on the server instead of being bundled. That is
also a tripwire: if the Admin SDK ever gets imported from a client component by
mistake, the build fails loudly rather than shipping the credential path to a
browser.

## 4. Backfill custom claims

Every existing staff account needs claims minted onto its Auth user. Dry run
first — it prints exactly what it would write and touches nothing:

```bash
npm run backfill:claims              # dry run
npm run backfill:claims -- --apply   # write
```

Run it against production, not just locally — it acts on whatever project the
service account belongs to.

Read the output. `FAIL … no Firebase Auth user for uid` means a `users/{uid}`
document with no matching Auth account — an orphan left by the old four-step
create flow failing between steps 1 and 3. Those are real, previously invisible
data problems; clean them up before moving on.

The script is idempotent. An account whose claims already match is skipped, so
re-running is free.

## 5. Verify claims actually land

This is the step people skip, and it's the one that makes a rules deploy safe.

1. Sign in to `/admin` as a staff member.
2. Open DevTools → Console and run:

   ```js
   await firebase.auth().currentUser.getIdTokenResult(true)
   ```

   (or, in this app's module setup, easiest is to add a temporary
   `console.log(await u.getIdTokenResult())` inside `useAdminUser`.)
3. Confirm `claims.staff === true` and `claims.role` matches that account.

Only once you've seen a real token carrying real claims should you write a
Firestore rule that depends on one.

## 6. Smoke-test the route

Create a staff account from `/admin/users`. It should behave identically to
before — same fields, same error messages — but it's now one request to
`/api/admin/accounts` instead of four calls to Google's REST APIs.

Then check:

- The new account appears in Firebase Console → Authentication **and** in
  `users/{uid}`. Under the old flow those could disagree.
- `/admin/logs` shows a "User Account" create entry. The audit trail has to
  survive a mutation moving to the server; if it doesn't, the log has a hole.
- Change that account's role. `/admin/logs` shows the diff, and if you reload
  as that user their access updates immediately rather than after an hour.

---

## What this unlocked

The plan lists four things blocked on having a server. All four are now
possible; only the claims one is built.

| | Status |
|---|---|
| Server-issued receipt sequences | **Built.** `shared/src/server/invoiceNumber.ts`, used on check close. |
| Server-computed bill totals | **Built.** The browser sends item ids and quantities; price, name and station are looked up server-side. |
| Role + tenant in custom claims | **Built.** Rules can now read `request.auth.token.role`. |
| True account deletion | Possible via `adminAuth().deleteUser()`; not yet done. The scheduled loyalty reset is built — see [scheduled-jobs.md](./scheduled-jobs.md). |

## What came next, and what is left

1. ~~**Rewrite `firestore.rules` to read claims**~~ — **done and deployed.**
   Every staff-gated collection now checks `request.auth.token.role` rather
   than a broad `isStaff()`. It went out one collection at a time, which is
   the only way a rules change can go out: a deploy has no gradual rollout, so
   a wrong rule breaks that collection for every user at once.
2. ~~**Move the remaining privileged writes behind routes**~~ — **done.**
   `npm run audit:writes` is at zero and its baseline is zero, so the next one
   to reappear fails the check. The rule stands: no client SDK writes. Reads
   stay on `onSnapshot` — that's the part of Firestore worth keeping.
3. ~~**A real cron** for the annual loyalty reset~~ — **built**, and it runs
   from the host's cron panel rather than anything in this repo. See
   [scheduled-jobs.md](./scheduled-jobs.md). `checkAndRunLoyaltyReset()`'s
   passive fire-on-page-load survives as a backstop.
4. **True account deletion** — still outstanding. `deleteCustomerAccount()`
   deletes the profile but not the Auth login, so a deleted customer signing
   in gets a blank new profile.

## Cleanup, once nothing calls the old path

The `adminInvitations` collection and its rule exist only to prop up the old
four-step account creation. Once `/admin/users` has been running on the route
for a while and no other caller writes to it, delete both.

Do it in that order — rule last — and only after confirming in
`/admin/logs` that account creation has been going through the route.

## Known limitation: the claim refresh window

A Firebase ID token lives up to an hour and carries a snapshot of the claims
at issue time. Firestore rules read that snapshot and do **not** check whether
the refresh token was revoked since. So an access change can take up to an hour
to be enforced *in rules* for a tab that stays open.

Two mitigations are in place:

- `syncClaims()` stamps `claimsUpdatedAt` on the user document, and
  `useAdminUser()` force-refreshes the token when that stamp is newer than the
  token in hand — so in practice the change lands on the user's next page load.
- `syncClaims(uid, { revokeSessions: true })` kills existing sessions outright,
  for a deliberate lock-out.

Where an immediate boundary is genuinely required, put the operation behind a
route handler: `getCaller()` verifies with `checkRevoked: true`, which rules
cannot do.

## The import rule

Everything under `shared/src/server/**` reads a service-account private key. It
may be imported from an app's `app/api/**` and from `scripts/**` — nowhere else. Never from a
file carrying `'use client'`, and never from a module a client component
imports.

`shared/src/serverAuth.ts` is the older pattern and still backs the two image
routes. It verifies a token over REST and does authorization reads *as the
calling user*, so it can only ever confirm facts the caller could already read
for themselves. Leave it where it is; don't extend it. New routes use
`shared/src/server/auth.ts`.
