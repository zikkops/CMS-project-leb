# Contributing

## Before you write any code

Read `AGENTS.md` at the project root. This Next.js version has breaking changes from what most training data / tutorials assume — check `node_modules/next/dist/docs/` for the real current API before assuming you know how something works.

A concrete example that actually bit this project: as of Next.js 16, `middleware.ts` is renamed to `proxy.ts` (file name *and* the convention's export name) — "the functionality remains the same," per Next's own docs, but training data overwhelmingly assumes the old name. This repo's root-level `proxy.ts` (admin route protection) would silently never run at all if renamed back to `middleware.ts` out of habit — Next.js just wouldn't recognize the file, no error, no warning.

## Styling

**Every component uses hand-written inline `style={{}}` objects.** Tailwind is installed and wired into `globals.css`, but nothing in `app/` actually uses Tailwind classes — don't introduce them. There are no CSS modules either. This is a deliberate, consistent choice across the whole codebase; match it.

Conventions used everywhere:
- CSS variables for the palette: `var(--teal)`, `var(--red)`, `var(--purple)`, `var(--navy)`, `var(--black)`, `var(--offwhite)`
- `var(--font-cinzel)` for display/headings, `var(--font-inter)` for body text
- FontAwesome (`solid` + `brands` sets) for all icons

## Mobile responsiveness

There's a `useIsMobile(breakpoint = 768)` hook, **deliberately duplicated in nearly every page/component file** rather than imported from one shared location (there is a shared version at `shared/src/useIsMobile.ts`, but most files still define their own copy — this is the established pattern, not an oversight to "fix"). Match this when adding a new file: copy the hook in rather than refactoring existing files to import the shared one.

Every layout decision that needs to differ on mobile is an `isMobile ? x : y` ternary inline in the `style` object — there's no separate mobile stylesheet or CSS media query anywhere.

When adding a row of items that could realistically be 4+ items wide (tabs, filter chips, etc.), don't assume `flex: 1` on each item will look fine on a 375px phone — do the arithmetic (item count × minimum readable width + padding) against a real phone width before shipping. This bit us once already (the "Your History" tab row on the customer profile page used to force 5 tabs into one unreadably-squeezed row).

## Hover animations

There's an established, consistent hover language across every customer-facing page — copy these patterns rather than inventing a new one:

- **Solid CTA buttons** (e.g. "Reserve a Table" in the Navbar, "Sign In" buttons): background inverts to a translucent tint of the accent color, border brightens to the full color, `backdropFilter: blur(10px)` appears, and a diagonal shine sweeps across via an absolutely-positioned skewed-gradient `<span>` that slides from `left: -60%` to `left: 120%` over 0.5s.
- **Outlined/secondary buttons**: border and text color brighten to the accent color, no shine sweep.
- **Cards** (game cards, event cards, the big "Browse Full Library"-style CTA boxes): border-color brighten + `transform: translateY(-4px to -6px)` lift + a `boxShadow` glow, plus an image zoom (`scale(1.08)`) if there's a background image.

**Known gotcha:** if a card needs both a `box-shadow` on hover *and* `overflow: hidden` (to clip a rounded-corner image inside it), **do not put both on the same element** — `overflow: hidden` clips an element's own outer box-shadow, silently killing the glow effect. Split it into an outer wrapper (transform + box-shadow, no overflow) and an inner wrapper (border + overflow: hidden). See `EventCard` in `app/events/page.tsx` for the reference implementation.

**Known gotcha #2:** never declare a component as a function nested inside another component's render body (`function EventsPage() { function EventCard() {...}; return ... }`). Every re-render of the outer component creates a *new* `EventCard` function reference, which makes React treat every usage as a brand-new component type and fully unmount+remount the DOM on every state change — silently killing any CSS transition on it, since a freshly-mounted element has no "previous" frame to animate from. Always declare child components at module scope and pass state down as props.

## Verification ritual

Before considering any change done:
```bash
npx tsc --noEmit -p .
npm run build
```

If you touched anything under `shared/src/server/**` or an app's `app/api/**`, `.env.local` needs `FIREBASE_SERVICE_ACCOUNT` set or those routes will fail at request time with a clear error — see [docs/server-setup.md](./docs/server-setup.md).
Then start the dev server and hit the routes you touched (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/<route>` is enough to catch a server-side crash; for anything visual, actually look at it in a browser — type-checking and a successful build verify the code compiles, not that the feature looks or behaves right).

## Firestore rules

**Correction to an earlier version of this file: there *is* a rules file in this repo.** `firestore.rules` at the project root is version-controlled and is the source of truth for what's deployed. Edit it there and deploy with the Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

Never paste into the Console UI — that's how the repo and the live project drifted apart before.

If you add a new collection, add its rule. Firestore denies anything unmatched, so a *missing* rule fails closed and you'll notice immediately; a rule that's merely too permissive fails open and nothing automated will catch it. See [ARCHITECTURE.md](./ARCHITECTURE.md#firestore-rules) for the shape every existing rule follows and the patterns worth reusing.

A rules deploy has **no gradual rollout**. A wrong rule breaks that collection for every user at once. Change one collection at a time and verify before the next.

## Image uploads

Every file-upload handler (avatar, check photo, admin product/menu/event images) must call `uploadImage(file)` from `shared/src/media.ts` — never build a `FormData` and `fetch('https://api.imgbb.com/...')` directly. `uploadImage()` does two things in one call: validates the file (real `file.type`, not just the `accept="image/*"` picker-dialog hint, plus a size cap — `accept` alone doesn't stop a renamed file or a drag-and-drop from submitting something it shouldn't), then posts it to `/api/upload-image`, a server route that holds the imgbb key so it's never bundled into client-side JS. It throws on either failure with a message safe to show directly to the user — wrap the call in `try/catch`, not an `if (validationError)` branch. This is the one shared helper that genuinely is meant to be imported everywhere, unlike `useIsMobile` above.

The one exception is the bulk WooCommerce import wizard (`admin/app/admin/products/import/page.tsx`), which goes through a *different* server route, `/api/import-image` — that one downloads an arbitrary external URL server-side first (browsers can't do cross-origin image fetches reliably) before re-hosting it the same way. Both routes are in `shared/src/serverAuth.ts`'s authorization pattern — see the section below.

## Adding a new server route (API route handler)

This project has a Firebase Admin SDK server layer as of Phase 00 — see [ARCHITECTURE.md § The Server Layer](./ARCHITECTURE.md#the-server-layer) and [docs/server-setup.md](./docs/server-setup.md). If you're working from an older copy of this file that says there's no Admin SDK, that's out of date.

A new route handler under each app's `app/api/` looks like this:

```ts
import { requireRole, toResponse, HttpError } from '@/shared/src/server/auth'
import { adminDb } from '@/shared/src/server/firebaseAdmin'
import { logCreate } from '@/shared/src/server/activityLog'

export const runtime = 'nodejs'   // the Admin SDK cannot run on edge

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireRole(request, ['admin', 'manager'])
    // ... validate the body, do the work with adminDb() ...
    await logCreate(actor, 'Section Name', label, snapshot)
    return Response.json({ ok: true })
  } catch (err) {
    return toResponse(err)   // HttpError → its message; anything else → generic 500
  }
}
```

Four rules that are easy to get wrong:

1. **Never import `shared/src/server/**` from a client component.** Those modules read a service-account private key. They may be imported from an app's `app/api/**` and `scripts/**`, nowhere else. `firebase-admin` is in `serverExternalPackages`, so a mistake fails the build rather than shipping quietly — don't rely on that as your only check.
2. **Validate every input server-side**, even ones the UI constrains. The route is now the boundary; a `<select>` is not.
3. **Keep the audit log.** A mutation moving from the browser to a route handler silently drops out of `/admin/logs` unless you swap `shared/src/activityLog` for `shared/src/server/activityLog` — the client logger reads `auth.currentUser`, which doesn't exist on the server. An audit trail with a hole in it is worse than one you know is incomplete.
4. **Roll back partial writes.** If you create an Auth user and the follow-up Firestore write fails, delete the Auth user. See `app/api/admin/accounts/route.ts` — orphaned Auth accounts with no profile were the old flow's worst failure mode, because the email is then taken and the admin can't simply retry.

**Authorization:** `requireStaff()` for any staff member, `requireRole(request, [...])` to match a page's `useRequireRole`, `requireSection(request, key)` when per-user `sectionGrants`/`sectionRevocations` should apply (costs one document read per call — see the comment on it), `requireSuperadmin()` for the rest.

**Reads stay client-side.** Live `onSnapshot` listeners are the part of Firestore worth keeping; don't move reads onto the server for consistency's sake. It's *writes* that belong behind routes — and the rule from here is no new client SDK writes.

**The older pattern:** `shared/src/serverAuth.ts` still backs the two image routes. It verifies a token over REST and does authorization reads as the calling user, so it can only confirm facts the caller could already read for themselves. Leave it; don't extend it. The mistake it exists to prevent is still worth knowing: don't call the Firestore *client* SDK's `getDoc`/`getDocs` bare inside a route handler to check a role — there's no signed-in session on the server, so it runs as an unauthenticated read and either fails against real rules or pressures you into loosening one to anonymous-readable just to make the check possible.

## Commit style

Commits on this project tend to be large and feature-grouped (check `git log` for examples) rather than one-commit-per-file. A typical message describes everything a working session shipped, comma-separated, in the imperative ("Add X, fix Y, replace Z").
