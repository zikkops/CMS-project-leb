# Café CMS

A café management platform: a customer-facing site (shop, menu, events, table
bookings, loyalty program) and a full admin panel for staff to manage content,
bookings, stock and the loyalty program.

Everything brand-shaped — name, palette, fonts, contact details, currency, VAT
and exchange rates, branches, departments — is configuration in
`app/lib/brand.ts`, driven by environment variables. `npm run audit:branding`
fails the moment one of those values gets inlined somewhere instead.

## Tech Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Firebase 12** (client SDK) + **firebase-admin 14** (server). Reads run in the browser on live `onSnapshot` listeners; **privileged writes go through route handlers under `app/api/`** using the Admin SDK and a service account. Anything that decides money, stock or someone else's balance belongs on the server — `npm run audit:writes` tracks what is left to move. Setup: [docs/server-setup.md](./docs/server-setup.md).
- **FontAwesome** for icons, **@dnd-kit** for drag-to-reorder (admin/menu), **imgbb** for image hosting, **DiceBear** for placeholder avatars
- Styling is hand-written inline `style={{}}` objects throughout — Tailwind is installed but not used (see [CONTRIBUTING.md](./CONTRIBUTING.md))

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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

The Firebase values come from your Firebase project's web app config (Project Settings → General → Your apps). The imgbb key is a free API key from [api.imgbb.com](https://api.imgbb.com/) — used for hosting game/menu/event images and customer avatar/check-photo uploads. **Deliberately not `NEXT_PUBLIC_`-prefixed** — every upload in the app goes through `/api/upload-image` (or `/api/import-image` for the bulk wizard) instead of calling imgbb directly from the browser, so this key is never bundled into client-side JS. If you're deploying to Vercel, add this as a server-side environment variable there too — `.env.local` is gitignored and won't carry over automatically.

### Firebase project setup

This app needs, in your Firebase project:
- **Authentication** — Email/Password and Google sign-in enabled.
- **Firestore** — in Native mode. Security rules are version-controlled in `firestore.rules` at the project root and deployed with `firebase deploy --only firestore:rules`. **Never paste them into the Console UI**, and never deploy more than one collection's change at a time: a rules deploy has no gradual rollout, so a wrong rule breaks that collection for every user at once. Composite indexes live in `firestore.indexes.json`.

There is **no `adminUsers` collection** — staff and customers share `users/{uid}`, and a staff account is one with `isStaff: true` plus `role`, `branchIds` and its grants. For the first admin, sign in once through `/admin/login` to create the Auth user, then set those fields on that uid. Roles are also mirrored into custom claims, which is what `firestore.rules` actually checks — see [docs/server-setup.md](./docs/server-setup.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run build` | Production build — also runs the full TypeScript check |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run audit:branding` | Fails while any brand value is inlined outside `brand.ts` |
| `npm run audit:writes` | Tracks privileged writes still running in the browser |
| `npm run verify:delivery-math` | Checks the receiving/costing arithmetic |
| `npm run seed:demo` | Writes demo supplies, providers, an order template and a weekly order |

## Project Structure

```
app/
  page.tsx                 Home page
  about/, shop/, menu/, events/, tables/, loyalty/   Public marketing pages
  (customer)/customer/     Customer account pages (login, profile, friends, redeem, submit-check)
  customer/leaderboard/    (outside the (customer) group — public, no login wall)
  admin/                   Staff-only admin panel (see docs/admin-panel.md)
  api/                     Route handlers — every privileged write, plus the image proxy
  lib/server/              Admin SDK layer. Import from app/api/** and scripts/** only.
  lib/                     Data layer — one file per feature, mostly hooks + Firestore calls
  components/
    home/                  Home-page sections
    layout/                Navbar, Footer
    tables/, events/       Booking modals
    admin/                 Admin-only shared components (media picker, attendee search)
```

## Further reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design and Firestore schema
- [CONTRIBUTING.md](./CONTRIBUTING.md) — code conventions and patterns used throughout
- [docs/loyalty-system.md](./docs/loyalty-system.md) — points, tiers and the annual reset
- [docs/server-setup.md](./docs/server-setup.md) — service account, custom claims, rules deploys
- [docs/admin-panel.md](./docs/admin-panel.md) — admin auth, roles, and route map
