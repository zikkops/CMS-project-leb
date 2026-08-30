# Café CMS

A café management platform in three parts: a customer-facing site (shop, menu,
events, table bookings, loyalty program), an admin panel for staff to manage
content, bookings, stock and the loyalty program, and a POS for taking orders
on the floor — tables, checks, kitchen tickets, receipts and refunds.

They are three separate deployables sharing one Firebase project and one set of
environment variables, so a café can be sold the POS without the rest.

Everything brand-shaped — name, palette, fonts, contact details, currency, VAT
and exchange rates, branches, departments — is configuration in
`shared/src/brand.ts`, driven by environment variables. `npm run audit:branding`
fails the moment one of those values gets inlined somewhere instead.

## Tech Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Firebase 12** (client SDK) + **firebase-admin 14** (server). Reads run in the browser on live `onSnapshot` listeners; **privileged writes go through route handlers under each app's `app/api/`** using the Admin SDK and a service account. Anything that decides money, stock or someone else's balance belongs on the server — `npm run audit:writes` tracks what is left to move. Setup: [docs/server-setup.md](./docs/server-setup.md).
- **FontAwesome** for icons, **@dnd-kit** for drag-to-reorder (admin/menu), **imgbb** for image hosting, **DiceBear** for placeholder avatars
- Styling is hand-written inline `style={{}}` objects throughout — Tailwind is installed but not used (see [CONTRIBUTING.md](./CONTRIBUTING.md))

## Getting Started

```bash
npm install
```

Then whichever app you're working on — each takes its own port, and you can
run all three at once in separate terminals:

| | | |
|---|---|---|
| `npm run dev` | web | [localhost:3000](http://localhost:3000) |
| `npm run dev:admin` | admin | [localhost:3001](http://localhost:3001) |
| `npm run dev:pos` | pos | [localhost:3002](http://localhost:3002) |

There is one `.env.local`, at the repo root. Each app's `next.config.ts`
loads it through `env.mjs` — do not copy it into the app folders, they will
drift.

### Environment variables

Create `.env.local` in the project root with:

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
IMGBB_API_KEY=
```

The Firebase values come from your Firebase project's web app config (Project Settings → General → Your apps). The imgbb key is a free API key from [api.imgbb.com](https://api.imgbb.com/) — used for hosting product/menu/event images and customer avatar/check-photo uploads. **Deliberately not `NEXT_PUBLIC_`-prefixed** — every upload in the app goes through `/api/upload-image` (or `/api/import-image` for the bulk wizard) instead of calling imgbb directly from the browser, so this key is never bundled into client-side JS. Set it as a server-side environment variable on the host too — `.env.local` is gitignored and won't carry over automatically.

### Firebase project setup

This app needs, in your Firebase project:
- **Authentication** — Email/Password and Google sign-in enabled.
- **Firestore** — in Native mode. Security rules are version-controlled in `firestore.rules` at the project root and deployed with `firebase deploy --only firestore:rules`. **Never paste them into the Console UI**, and never deploy more than one collection's change at a time: a rules deploy has no gradual rollout, so a wrong rule breaks that collection for every user at once. Composite indexes live in `firestore.indexes.json`.

There is **no `adminUsers` collection** — staff and customers share `users/{uid}`, and a staff account is one with `isStaff: true` plus `role`, `branchIds` and its grants. For the first admin, sign in once through `/admin/login` to create the Auth user, then set those fields on that uid. Roles are also mirrored into custom claims, which is what `firestore.rules` actually checks — see [docs/server-setup.md](./docs/server-setup.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `dev:admin` / `dev:pos` | Start one app's dev server (Turbopack) |
| `npm run build` | Production build of all three — also runs the full TypeScript check |
| `npm run build:web` / `build:admin` / `build:pos` | Build one app |
| `npm run lint` | ESLint |
| `npm run audit:branding` | Fails while any brand value is inlined outside `brand.ts` |
| `npm run audit:writes` | Fails if a privileged write reappears in the browser (baseline 0) |
| `npm run verify:checks` | Checks the POS check, void and money rules |
| `npm run verify:features` | Checks the feature-flag registry |
| `npm run verify:hosts` | Checks the hostname routing |
| `npm run check:env` | Reports which environment variables are missing |
| `npm run cron:reset` | Knocks on the loyalty-reset job the way a scheduler would |
| `npm run verify:delivery-math` | Checks the receiving/costing arithmetic |
| `npm run seed:demo` | Writes demo supplies, providers, an order template and a weekly order |

## Project Structure

Three Next.js apps and one shared library, as npm workspaces. Each app builds
`standalone` and deploys on its own hostname, so a customer who buys only the
POS never receives the admin panel's code.

```
web/      the public site          cms-projectlb.com
admin/    the staff back office    admin.cms-projectlb.com
pos/      the till and the KDS     pos.cms-projectlb.com
shared/   everything all three need
```

```
web/app/
  page.tsx                 Home page
  about/, shop/, menu/, events/, tables/, loyalty/   Public marketing pages
  retail/, wholesale/, pricelist/, branch/           Catalogue pages
  (customer)/customer/     Customer account pages (login, profile, friends, redeem, submit-check)
  customer/leaderboard/    (outside the (customer) group — public, no login wall)
  api/                     Public route handlers
  components/              home/, layout/, tables/, events/

admin/app/
  admin/                   The whole back office (see docs/admin-panel.md) —
                           products, menu, supplies, weekly-orders, branches,
                           tables, events, loyalty, users, media, schedule,
                           end-of-day, wholesale, logs, settings
  api/                     Privileged route handlers — every admin mutation
  components/admin/        Media picker, attendee search, and friends

pos/app/
  pos/                     page.tsx is the floor; check/[id], closed, kds, login
  api/                     Check, ticket and shift route handlers
  lib/                     POS-only hooks (usePos.ts — every listener, scoped)

shared/src/
  server/                  Admin SDK layer. Import from an app's app/api/**
                           and scripts/** only — never from a client component.
  *.ts                     Data layer — one file per feature, mostly hooks +
                           Firestore listeners, plus the pure model modules
                           (checks, tickets, money, modifiers, roles)
  components/              The handful of components all three apps render
```

Import shared code as `@big-cms/shared/<file>` — `@big-cms/shared/checks`,
`@big-cms/shared/server/auth`. Never reach across apps with a relative path;
if two apps need it, it belongs in `shared/`.

## Further reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design and Firestore schema
- [CONTRIBUTING.md](./CONTRIBUTING.md) — code conventions and patterns used throughout
- [docs/loyalty-system.md](./docs/loyalty-system.md) — points, tiers and the annual reset
- [docs/deploying.md](./docs/deploying.md) — the three apps onto three subdomains
- [docs/server-setup.md](./docs/server-setup.md) — service account, custom claims, rules deploys
- [docs/admin-panel.md](./docs/admin-panel.md) — admin auth, roles, and route map
