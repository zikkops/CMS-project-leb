# Adding a section

A **section** is a part of the product somebody can be allowed into: the menu,
the kitchen display, end of day, food safety. It has a key (`menu`), a set of
roles that may use it, an optional module switch that turns it off for a client
who did not buy it, and usually an admin page and a route.

A section's key, roles, label and module are declared in one place, and then
named again by hand in a few others. This is the list, in the order to do it. `npm run
verify:sections` and the other verifiers named below fail when one of the
enforced steps is missed. The rest are convention.

Written 18 Sep 2026 (UPGRADE.md T0.2). Since 21 Sep 2026 (T4.2) steps 1 to 3
are one entry in `SECTIONS`, and till tiles are one entry in `POS_TILES` (T4.1).

`npm run new:section -- <key>` (T4.3) writes steps 1, 2, 4, 5 and 6 and a
verifier stub, and prints the rest. Its options are in the header of
`scripts/new-section.mjs`. Try it with `--dry-run` first.

## The minimum: an admin page with its own permission

| # | File | What to add | Enforced by |
|---|---|---|---|
| 1 | `shared/src/roles.ts` | A `SECTIONS` entry, on one line: `{ roles, label, feature }`. `roles` is who may use it; **this adds a grant checkbox to Manage Users**, so only add one for something a manager would hand out per person. `label` is the words on that checkbox. `feature` is the module switch that turns it off: an existing key of `FEATURES`, or a new one. `SECTION_ACCESS` and `SECTION_LABELS` are derived from it. | tsc (a missing label or feature does not compile); `verify:features` (the feature exists) |
| 2 | `shared/src/features.ts` | Only when it needs a new module: its `FEATURES` entry, with the Firestore collections it owns in `collections`. | `verify:sections` for collections a hub moves |
| 3 | — | (Was the `SECTION_LABELS` entry and the feature's `sections` list; both are now step 1.) | |
| 4 | `shared/src/adminNav.ts` | The nav item: label, href, `access: SECTION_ACCESS.<key>` (**the array itself**, never a copy), icon, `kind` (`use` or `setup`) and a `desc`. | `verify:admin-nav` (page exists, listed, described); `verify:sections` (access is the section) |
| 5 | `admin/app/admin/<page>/page.tsx` | `useRequireRole(SECTION_ACCESS.<key>)`. A copied role array silently loses grants, revocations and the module switch, because the section is found by reference. | `verify:sections` |
| 6 | `admin/app/api/admin/<name>/route.ts` | `export const runtime = 'nodejs'`; every handler calls `requireSection(request, '<key>')` first and wraps its body in `try { … } catch (err) { return toResponse(err) }`; mutations log through `@big-cms/shared/server/activityLog`. See CONTRIBUTING.md, "Adding a new server route". | `verify:sections` (each handler checks its caller) |
| 7 | `firestore.rules` | Usually `allow write: if false` (writes go through the route) and a scoped read. If a helper is needed, `can('<key>', [roles])` with **the same roles as step 1**. A rules deploy is a separate, approved step. | `verify:sections` (role lists match); `npm run rules:live` compares with the deployed rules |

The domain rules go in a pure `shared/src/<name>.ts` with a verifier of their
own (`scripts/verify-<name>.mjs`, a `verify:<name>` script in package.json,
ending with "N passed, M failed" so `verify:all` counts it). The server side
goes in `shared/src/server/<name>.ts`.

## Sometimes

| # | When | File | What |
|---|---|---|---|
| 8 | It queries more than one field | `firestore.indexes.json` | The composite index. Convention only. |
| 9 | Staff use it at the till | `pos/app/lib/posTiles.ts` | An entry in `POS_TILES`: label, href, icon, hue (never teal), `feature` and `section`. |
| 10 | The till uses it | `pos/app/pos/<screen>/page.tsx` | Gate the page with `useTillAccess(SECTION_ACCESS.<key>)`, not `useRequireRole`, so it works on a café hub. Read through `backend()`, never Firestore directly. |
| 11 | The till needs it offline on a café hub | `shared/src/hubSync.ts` `pullSpec()` (cloud is master) or `shared/src/hubPush.ts` `PUSHED_COLLECTIONS` (hub is master) | Then claim the collection in step 3, or `verify:sections` fails. A new till write route calls `refuseWhileHubbed()` (`verify:hub-sync` checks that). |
| 12 | The dashboard shows a count | `shared/src/adminNav.ts` `BadgeKey` and `admin/app/admin/page.tsx` | The badge key and where its count comes from. |

## Before committing

```bash
npm run verify:all
npm run build
```

Then open the page signed in as each role that should see it, and one that
should not.
