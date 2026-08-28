# Deploying the claims-based Firestore rules

The rewrite in `firestore.rules` replaces one blanket `isStaff()` check with
per-role, per-section authorization read from custom claims. It closes the
feature audit's P0.

**A rules deploy has no gradual rollout.** There is no canary, no percentage,
no per-user flag. The moment it lands it applies to every request. Read this
whole page before running the deploy command.

---

## Before you deploy anything

### 1. The server layer must be live

`docs/server-setup.md` steps 1–6, finished. Specifically:

- `FIREBASE_SERVICE_ACCOUNT` set in Vercel **and** redeployed.
- `npm run backfill:claims -- --apply` run against **production**.
- A real staff login verified to carry `claims.staff === true` and the right
  `claims.role`.

If you deploy rules before the backfill, the fallback below carries you — but
you'd be relying on a safety net instead of a plan. Do it in order.

### 2. Deploy the app first, rules second

The app changes and the rules changes are not independent:

- `/admin/users` now revokes access through `DELETE /api/admin/accounts`. The
  old client-side `updateDoc` that cleared `isStaff`/`role` **is blocked by the
  new rules** (privilege fields are denied to every client). If the rules land
  before the app, revoking access breaks.
- Revoking through the old path would have left the revoked account's claims
  minted forever anyway. That's the bug this ordering exists to avoid.

So: merge and deploy the app, confirm `/admin/users` works, then deploy rules.

### 3. Validate the syntax before it reaches production

**Update (28 Aug 2026): it now compiles.** `firebase deploy` runs the rules
through the parser as a preflight even for an indexes-only deploy, and reported
`rules file firestore.rules compiled successfully` against `cms-project-f7e15`.
The rules were **not** deployed by that command — only the indexes were.

So the syntax question is closed. What is still open is **behaviour**: compiling
means the file parses, not that it allows and denies the right things. The
checks below are still worth running, and check 9 in particular.

The original note read: *the rules file was written but not run against
Firebase's parser — the sandbox it was authored in couldn't download the
emulator.* To exercise real reads and writes rather than just syntax:

```bash
# Best: run the emulator locally and exercise real reads/writes
npx firebase emulators:start --only firestore
```

Or paste the file into **Firebase Console → Firestore → Rules → Rules
Playground**, which compiles it and lets you simulate an authenticated request
without publishing.

A deploy of syntactically invalid rules is rejected server-side rather than
published, so a typo can't take the site down — but finding it in the
playground is a lot calmer than finding it in a deploy log.

---

## The deploy

`firebase.json` is new in this change — the repo had none, so the deploy
command documented in ARCHITECTURE.md had nothing to point at.

```bash
npx firebase login          # once
npx firebase use <your-project-id>
npx firebase deploy --only firestore:rules
```

Never paste into the Console UI. That's how the repo and the live project
drifted apart before.

### Rollback

```bash
git checkout HEAD~1 -- firestore.rules
npx firebase deploy --only firestore:rules
```

Firebase Console → Firestore → Rules also keeps a version history you can
inspect and republish from. Know which of these you'd reach for **before** you
deploy, not while something is broken.

---

## What changed, and what to check afterwards

### The safety net: a document fallback

Every identity helper reads the claim first and falls back to reading
`users/{uid}`:

```
function isStaff() {
  return hasClaims() || (isSignedIn() && userDoc().get('isStaff', false) == true);
}
```

A token minted before the backfill still works, at the cost of one billed read.
That fallback **is** the gradual rollout: nobody is locked out mid-shift while
tokens rotate.

Once the whole team has signed in after the backfill, delete every fallback
branch — search `firestore.rules` for **FALLBACK**. Until then it costs a read
only for tokens that predate claims, which trends to zero on its own.

### Role gating — the actual fix

Writes are now gated on the roles each section names in
`app/lib/roles.ts`. A `gamer` can no longer write to `menuItems`; a `barista`
can no longer write to `games`. Previously any staff account could write to any
staff-gated collection with a direct SDK call — the UI just hid the button.

Per-user `sectionGrants` are honoured (`can()` checks them), so an individual
granted a section outside their role keeps working.

### Verify these, in this order, with real accounts

Do these as the actual roles, not as an admin. An admin passes everything and
proves nothing.

| # | Check | Expected |
|---|---|---|
| 1 | Admin: create a staff account, edit its role, revoke it | All three work; each appears in `/admin/logs` |
| 2 | Manager: submit an end-of-day report | Works |
| 3 | Kitchen crew: submit a daily inventory count | Works, and `supplies` quantities update |
| 4 | Any role: submit a weekly order | Works — `weeklyOrdersSubmit` is every role |
| 5 | Gamer: record a game sale | Works |
| 6 | Social: approve an event reservation | Works |
| 7 | Customer: book a table, cancel it, submit a check | All work |
| 8 | Customer: edit their profile | Works; XP and coins unchanged |
| 9 | Barista: open the browser console on any admin page and try `updateDoc(doc(db,'games','<id>'), {price: 0})` | **Denied.** This is the P0. If it succeeds, roll back. |

Check 9 is the one that matters. Run it.

## ✅ Check 9 PASSED — 29 Aug 2026

Run against production (`cms-project-f7e15`) with a real `barista` account,
not an admin:

    updateDoc(doc(db, 'games', 'product-brew-guide'), { price: 0 })
    → permission-denied

Confirmed server-side afterwards rather than taken on trust: the product is
still $29, no product in the catalogue sits at price 0, and the barista's
points balance is 0. The account carries `role: barista` in both its document
and its minted custom claim, so the rule took the free token path rather than
the fallback document read.

**That closes the P0.** Before this, any staff account could write to any
staff-gated collection with a direct SDK call; the admin panel only hid the
button.

Two related writes are also denied now, both of which the old rules allowed:

| Attempt | Why it's denied |
|---|---|
| `users/{own-uid}` → `{ points: 999999 }` | balance fields are locked to every client; all point movement runs through a route |
| `appSettings/invoiceCounter` → `{ nextNumber: 1 }` | the sequence is issued inside the transaction that uses it |

### What is still NOT covered

Rules gate the DATABASE. They say nothing about the mobile app, which has its
own P0 — no per-screen role gates at all — and which lives in the Onboard App
repo, not here. Closing this one does not close that one.

### Behaviour changes that may surprise you

**End-of-day reports are now admin/manager only.** The old rule's comment said
"any staff member (the cashier on shift fills it in)", but
`SECTION_ACCESS.endOfDay` has always been `['admin', 'manager']`, so the UI
never showed the form to anyone else. The rule now matches the UI. If a barista
genuinely fills these in at your branches, grant them the `endOfDay` section
from Manage Users rather than widening the rule.

**Audit logs are append-only.** `activityLog`, `transactionLog`,
`weeklyOrderLogs` and `endOfDayLogs` now deny update and delete outright, where
a blanket `write` previously allowed both. Server-side writes bypass rules, so
`app/lib/server/activityLog.ts` is unaffected.

**Privilege fields are denied to every client.** `isStaff`, `role`,
`superadmin`, `branchIds`, `isDungeonMaster` and `claimsUpdatedAt` cannot be
written from a browser at all. Nothing needs to any more — creation, role
changes and revocation all run through `/api/admin/accounts`. Before this, any
staff account could make itself an admin by writing its own document.

**Balance fields narrowed.** Only `admin`/`manager` (the `loyalty` section) can
move `xp`/`obCoins`, down from any staff member.

**A superadmin's document can only be edited by that superadmin.** `/admin/users`
already greyed the button out; it's now a rule.

---

## Known limitations, stated rather than buried

**`sectionRevocations` are not enforced in rules.** Honouring them would cost a
document read on *every* staff write, not just the grant path — a revocation
has to beat the role, and you can't know one isn't present without looking. A
revoked user is still a staff member holding that role, so what's lost is a UI
convenience, not a boundary. But be clear-eyed: **a revoked user can still write
via a direct SDK call.** If a revocation needs to be a real boundary, change
that person's role instead.

**The claim refresh window.** An ID token lives up to an hour and carries a
claims snapshot; rules read the snapshot and don't check revocation. An access
change can take up to an hour to bite for a tab left open. `claimsUpdatedAt` +
the forced refresh in `useAdminUser()` makes it land on the next page load in
practice, and revocation kills the session outright — but the window is real
and inherent to claims-based rules.

**Branch scoping is not enforced.** `branchIds` is in the claim, so per-branch
rules are one condition away — there's a commented-out `inBranch()` helper in
the rules file ready for it. It's deliberately off: admins and managers with an
empty `branchIds` array would be locked out of their own branches, and that
needs a data audit first. One tightening at a time.

---

## Cleanup, once this has run for a week

1. **Delete the FALLBACK branches** in `firestore.rules` once every staff member
   has signed in post-backfill. Rules then cost zero reads for identity.
2. **Delete `adminInvitations`** — the collection and its rule block. It existed
   only to prop up the old four-step client-side account creation. Confirm in
   `/admin/logs` that creations are going through the route first.
3. **Delete the deprecated `users` create branch** that checks
   `exists(/adminInvitations/$(userId))`, at the same time.
4. **Delete the `appSettings/loyaltyReset` exception** when the annual reset
   moves to Vercel Cron — a cron route runs on the Admin SDK and bypasses rules,
   so no client will need to write there.

## Worth doing next

There is no automated test for any of this. For a security boundary with no
gradual rollout, `@firebase/rules-unit-testing` against the emulator is the
right answer — a suite asserting "a barista cannot write games", "a customer
cannot change their own xp", "a revoked account has no claims" turns the table
above into something CI runs on every change rather than something a person
remembers to do.
