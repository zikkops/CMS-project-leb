# Deploying admin and pos to their own subdomains

Three apps, three Node processes, three hostnames, one Firebase project. The
customer site is already up; this is how the other two join it.

Written for Hostinger Web/Cloud hosting with hPanel and SSH. hPanel's wording
moves around between redesigns, so the field *names* below may not match
exactly — the four things it asks for (root, URL, startup file, Node version)
are stable, and those are what matter.

---

## The order matters

Do these in sequence. Two of the steps break things if run early.

1. Create the subdomains and let DNS resolve.
2. Build and place the apps.
3. Create a Node.js app per subdomain, with its environment variables.
4. **Last:** set `ADMIN_HOST` / `POS_HOST`.

Step 4 is last because it is the switch that makes the split real. Set
`ADMIN_HOST` before `admin.cms-projectlb.com` resolves and the apex stops
serving `/admin` while the subdomain is not yet answering — no admin panel
anywhere, and no error message that says why.

---

## 1. The subdomains

hPanel → Domains → Subdomains. Create `admin` and `pos` under
`cms-projectlb.com`.

Wait for both to resolve and for SSL to issue before going further:

```bash
curl -sI https://admin.cms-projectlb.com | head -1
```

A certificate error here is a "not yet", not a problem. A `NXDOMAIN` is DNS
still propagating. Neither is worth debugging in the first ten minutes.

---

## 2. Build

Next needs **Node 20.9 or newer**. Check what the server has before anything
else — an older Node fails in the middle of the build with an error about
syntax, not about versions.

```bash
node -v
```

### Building on the server

```bash
cd ~/big-cms-project
git pull
npm ci
npm run package -- admin
npm run package -- pos
```

`npm run package` builds the app and assembles `dist/<app>/` — a folder that
runs on its own. It exists because `output: 'standalone'` does **not** copy
`.next/static` or `public/`, and an app missing those does not error: it boots,
returns 200, and serves every page with no CSS and no JavaScript. That looks
like a broken app rather than a missing folder, which is why the script does it
for you. See [scripts/package-app.mjs](../scripts/package-app.mjs).

If `npm ci` or the build gets killed on a shared plan, it ran out of memory.
Build on your own machine instead and upload `dist/admin` and `dist/pos` —
they are self-contained, around 46 MB each, and need no `npm install` on the
server.

### What comes out

```
dist/admin/
  node_modules/          hoisted by the workspace
  admin/
    server.js            <- the startup file
    public/
    .next/
```

**The startup file is `admin/server.js`, not `server.js`.** One level in,
because this is a workspace and standalone output nests. Pointing hPanel at
the top-level path fails with `MODULE_NOT_FOUND`, which reads like a broken
install and is not.

---

## 3. A Node.js app per subdomain

hPanel → Advanced → Node.js. Create one entry for each:

| | admin | pos |
|---|---|---|
| Application root | `dist/admin` | `dist/pos` |
| Application URL | admin.cms-projectlb.com | pos.cms-projectlb.com |
| Startup file | `admin/server.js` | `pos/server.js` |
| Node version | 20.9+ | 20.9+ |

The port is not yours to choose. `server.js` reads `PORT` from the
environment, and the panel sets it. The `-p 3001` in `admin/package.json` is
for `npm run dev` on your laptop; it has no effect here.

### Environment variables

Set these on **each** Node.js app entry, in the panel:

| | admin | pos | web |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | yes | yes | yes |
| `IMGBB_API_KEY` | yes | — | yes |
| `CRON_SECRET` | yes | — | — |
| `ADMIN_HOST` | yes | yes | yes |
| `POS_HOST` | yes | yes | yes |

**The repo's root `.env.local` is not read at runtime and is not in `dist/`.**
That is deliberate: it holds a service-account private key, and a private key
inside a deployable folder is a private key that ends up somewhere you did not
put it. The panel's environment variables are the right home for these.

**`NEXT_PUBLIC_*` values are already baked in.** They were inlined when the
folder was built. Setting one in the panel does nothing at all — no error, no
warning, just no effect. To change one, edit the root `.env.local` and rebuild.

---

## 4. Flip the split on

Only now, and only once both subdomains answer.

Set on all three apps:

```
ADMIN_HOST=admin.cms-projectlb.com
POS_HOST=pos.cms-projectlb.com
```

Bare hostnames — no `https://`, no trailing slash. `hostConfigFromEnv()`
strips both anyway, but the value you read back should say what you meant.

Restart all three. Then check the thing you actually changed:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://cms-projectlb.com/admin
curl -s -o /dev/null -w '%{http_code}\n' https://admin.cms-projectlb.com/admin/login
```

You want **404** then **200**. The 404 is a bare text response, not the styled
not-found page and not a redirect to a login — a redirect would confirm the
admin panel exists on a host that is supposed to have none.

### Firebase Auth will reject the new hostnames

Firebase Console → Authentication → Settings → Authorized domains. Add
`admin.cms-projectlb.com` and `pos.cms-projectlb.com`.

Miss this and sign-in fails on the new hosts with `auth/unauthorized-domain`.
The page looks fine until someone tries to log in, so it will not be you who
finds it.

---

## What this does and does not buy

The split is separation, not authentication. Anyone can resolve
`admin.cms-projectlb.com` and reach the login page. What changes is that
`/admin` is *absent* from the customer domain rather than merely gated, the
admin session cookie stops being sent to the customer site, and there is now
one hostname you can put a real network gate in front of later without
touching the customer site.

The actual boundary is unchanged and lives elsewhere: Firebase Auth, custom
claims, `firestore.rules`, and every privileged mutation behind a route
handler.

---

## Linking to it — a separate decision

`NEXT_PUBLIC_ADMIN_URL` puts a staff shortcut in the customer site's navbar
and redirects staff there after they sign in. Leaving it unset renders no
link, and staff type the URL.

That is not a smaller version of the same setting — it is the opposite
decision. `ADMIN_HOST` keeps the admin hostname out of the customer bundle;
`NEXT_PUBLIC_ADMIN_URL` puts it in, for every visitor, because an inlined
value is in the JavaScript whether or not the viewer is staff. Not a leak, and
not a secret. Just do it on purpose.

`NEXT_PUBLIC_POS_URL` currently does nothing — `posUrl()` is exported and
imported nowhere.

Both are inlined at build time. See
[env-local.template.txt](./env-local.template.txt).

---

## Afterwards

- The loyalty reset cron, which needs the admin hostname to exist first:
  [scheduled-jobs.md](./scheduled-jobs.md).
- Redeploying: `git pull && npm run package -- admin`, then restart that app
  from the panel. Each app redeploys on its own — that is the point of the
  split, and a POS-tier customer never receives admin code at all.
