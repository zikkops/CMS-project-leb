# Onboard — Games & Tales

Website for Onboard, a board-game café and restaurant chain with three branches in Lebanon (Beirut/Hamra, Zouk, Broummana). Customer-facing site (shop, menu, events, table bookings, loyalty program) plus a full admin panel for staff to manage content, bookings, and the loyalty economy.

## Tech Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Firebase 12** — Auth + Firestore, **client SDK only**. There is no Admin SDK, no service account, and no Cloud Functions anywhere in this project — every read/write, including everything staff do in the admin panel, runs from the browser with the Firebase client SDK. See [ARCHITECTURE.md](./ARCHITECTURE.md#no-admin-sdk) for what this does and doesn't let you do.
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
- **Firestore** — in Native mode. Security rules are version-controlled in `firestore.rules` at the project root, but deploying them is still a manual step (paste into Console → Rules → Publish, or `firebase deploy --only firestore:rules` if you have the CLI) — there's no CI/CD wired up to do this automatically (see [ARCHITECTURE.md](./ARCHITECTURE.md#firestore-rules)).

There's no seed script for the first admin — sign in once through `/admin/login` with the account you want to be admin (this just creates a normal, unprovisioned Firebase Auth user), then in the Firebase Console create one `adminUsers/{uid}` document by hand using that user's uid, with a `role: "admin"` field. See [docs/admin-panel.md](./docs/admin-panel.md#auth) for why this is manual now.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run build` | Production build — also runs the full TypeScript check |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |

## Project Structure

```
app/
  page.tsx                 Home page
  about/, shop/, menu/, events/, tables/, loyalty/   Public marketing pages
  (customer)/customer/     Customer account pages (login, profile, friends, redeem, submit-check)
  customer/leaderboard/    (outside the (customer) group — public, no login wall)
  admin/                   Staff-only admin panel (see docs/admin-panel.md)
  api/                     Two server route handlers (image upload proxy, image delete)
  lib/                     Data layer — one file per feature, mostly hooks + Firestore calls
  components/
    home/                  Home-page sections
    layout/                Navbar, Footer
    tables/, events/       Booking modals
    admin/                 Admin-only shared components (media picker, attendee search)
```

## Further reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, Firestore schema, the no-Admin-SDK constraint and what it means
- [CONTRIBUTING.md](./CONTRIBUTING.md) — code conventions and patterns used throughout
- [docs/loyalty-system.md](./docs/loyalty-system.md) — the XP/OB Coins program in detail
- [docs/admin-panel.md](./docs/admin-panel.md) — admin auth, roles, and route map
