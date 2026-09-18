# Adding a section

A **section** is a part of the product somebody can be allowed into: the menu,
the kitchen display, end of day, food safety. It has a key (`menu`), a set of
roles that may use it, an optional module switch that turns it off for a client
who did not buy it, and usually an admin page and a route.

A section's key and roles are declared in one place, and then named again by
hand in several others. This is the list, in the order to do it. `npm run
verify:sections` and the other verifiers named below fail when one of the
enforced steps is missed. The rest are convention.

Written 18 Sep 2026 (UPGRADE.md T0.2). The Tier 4 tasks in UPGRADE.md replace
most of these steps with one registry entry and a scaffolder. Update this page
when they land.

## The minimum: an admin page with its own permission

| # | File | What to add | Enforced by |
|---|---|---|---|
| 1 | `shared/src/roles.ts` | A `SECTION_ACCESS` key with its roles. **This adds a grant checkbox to Manage Users**, so only add one for something a manager would hand out per person. | tsc (it is the type of every other step) |
| 2 | `shared/src/adminAuth.ts` | Its `SECTION_LABELS` entry, the words on that checkbox. | tsc (`Record<SectionKey, string>`) |
| 3 | `shared/src/features.ts` | The module it belongs to: list the key in a feature's `sections` (a new feature, or an existing one), and the Firestore collections it owns in `collections`. | `verify:features`; `verify:sections` for collections a hub moves |
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
| 9 | Staff use it at the till | `pos/app/pos/page.tsx` | A `NavTile` on the floor, shown only when `useFeature('<feature>')` is on. There is no tile registry yet (UPGRADE.md T4.1). |
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
