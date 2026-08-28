# What this repo is

A de-branded fork of the Onboard café platform, forked 24 Aug 2026 so the
CMS/POS product can be built without any chance of breaking the live café's
site or touching its data.

**This is not a real business.** Every name, colour, price and branch is a
placeholder. A demo banner sits at the top of every page and `robots.txt`
blocks all crawling, both of which disappear on their own once
`NEXT_PUBLIC_BRAND_NAME` is set to something real.

---

## The isolation rules

These are the point of the fork. Breaking one undoes it.

**1. A different Firebase project. Always.**
The `FIREBASE_SERVICE_ACCOUNT` credential bypasses every security rule. Copying
production's into `.env.local` here would let this demo rewrite real customer
loyalty balances and real stock levels with no rule to stop it. Before running
anything, check that `NEXT_PUBLIC_FIREBASE_PROJECT_ID` is **not** the live
project.

**2. No git remote pointing at the original.**
This repo was `git init`-ed fresh rather than cloned, so there is no `origin`.
When you add one, add it to a *new* repository. `git push` must never be able
to reach `zikkops/onboardlb`.

**3. `RESEND_API_KEY` stays blank.**
The code has no idea it's running on a demo. With a real key, a test run of any
email flow reaches real people.

**4. A separate imgbb account.**
Otherwise demo uploads land in the live café's shared media library.

**5. A separate Vercel project.**
Not a branch of the production one. A preview deploy that inherits production
environment variables inherits every problem above.

---

## Configuration, not constants

The productization work from the product plan (§4) starts here:
*"Everything hardcoded becomes configuration. Fine for one café, fatal for two.
The missing settings page IS the productization work."*

| File | Owns |
|---|---|
| `app/lib/brand.ts` | Name, tagline, palette, fonts, contact, currency, VAT, branches, departments |
| `app/lib/features.ts` | Module registry, dependency graph, defaults |
| `app/lib/branches.ts` | Reads its lists from `brand.ts` — no longer a hardcoded array |
| `.env.example` | Every knob, with the safety notes attached |

**The rule: never inline a brand name, colour, currency, rate or branch
anywhere else.** If you're about to type a hex code or a café name into a
component, it belongs in `brand.ts` first.

`npm run audit:branding` scans for the ones that got away and prints file and
line for each, grouped by severity. It exits non-zero while anything remains,
so it can gate a release later. Add a pattern whenever you find something it
missed — the point is that the next person doesn't rediscover it.

### About the colour aliases

Roughly fifty components reference `var(--teal)`, `var(--red)`, `var(--purple)`
and `var(--navy)` in inline style objects. Renaming them all would be a
thousand-line diff with no behavioural change and a real chance of missing one.

So `app/layout.tsx` injects the semantic variables (`--brand-primary` and
friends) from config, and the four legacy names alias onto them. Existing code
keeps working; **new code uses the semantic names.** The aliases are
compatibility, not an example to follow.

### Fonts are the exception

`next/font` subsets and self-hosts faces at build time, so the family cannot
come from a runtime value. Changing typography is a two-line edit in
`app/layout.tsx`. Which face is display vs body, and everything around them, is
configuration. That line is deliberate.

---

## Feature flags

`app/lib/features.ts` holds the registry and the dependency graph — those live
in code because they're properties of the build. `loyaltyEvents` cannot work
without `events` no matter what a database says, and a browser must not be able
to edit that relationship.

Chosen state lives in `appSettings/features` in Firestore, editable by a
superadmin. Store **intent**, never the computed result, so disabling a parent
never overwrites a child's own setting.

**The gaming pack has been removed from this codebase** — D&D campaigns,
looking-for-players, campaign attendance points, the campaign leaderboard. It
was going to be the "Gaming pack" tier in the plan, but carrying five modules
of dead code through every refactor to keep that option open was the wrong
trade. The original implementation lives in the onboardlb repo if it's ever
wanted back, and it would return as a plugin rather than as core.

Three enforcement layers, and only one is real:

1. Nav and dashboard cards don't render — cosmetic.
2. `useRequireFeature()` catches direct URL entry — cosmetic.
3. Firestore rules — **the only layer that stops anything.**

A flag is a business switch, never an access control. That's what makes
fail-open safe: if the flag document is missing, every module behaves as
enabled, because a Firestore hiccup must not dark-screen the storefront. The
moment you'd use a flag to hide something sensitive, the answer is a rule keyed
on a role instead.

---

## Setup

```bash
npm install
cp .env.example .env.local     # fill in — new Firebase project, see rule 1
npx tsc --noEmit -p .
npm run build
npm run dev
```

Then, against the new Firebase project:

```bash
npm run backfill:claims -- --apply   # after provisioning a first admin by hand
npx firebase deploy --only firestore:rules
```

Provisioning the first admin is manual, by design: Firestore rules cannot
express "is this collection empty", so there is no safe self-elect rule. In the
Firebase Console create `users/{uid}` with `isStaff: true`, `role: 'admin'`,
`superadmin: true`, `xp: 0`, `obCoins: 0`, using the uid from
Authentication → Users after that person signs in once.

---

## What is still Onboard-shaped

The fork moved the *configuration surface*. It did not rewrite every page.
`npm run audit:branding` is the live list, but expect to find:

- Copy on the public pages that assumes a board game café — `/about` in
  particular still names Onboard, Lebanon and the three original branches
- Menu category images shipped as files rather than CMS content
- Seed data assumptions in the loyalty level titles
- `docs/` still describing the original deployment

Work top-down by severity. High-severity hits are the ones a visitor or a
prospective customer would actually see.
