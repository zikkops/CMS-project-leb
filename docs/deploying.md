# Deploying admin and pos to their own subdomains

Written for Hostinger Web/Cloud hosting with hPanel and SSH, for someone doing
this for the first time. hPanel's wording moves between redesigns, so a field
name below may not match exactly — the four things it asks for (application
root, application URL, startup file, Node version) are stable, and those are
what matter.

---

## First, the thing that confuses everyone

**You do not pull a subdomain out of the repo.** There is no folder in here
that is "the admin subdomain" in the way a static site has one.

What you do is:

- clone the **whole repo, once**, into a private folder that no subdomain
  points at;
- build it there, three times, producing three self-contained folders;
- create three **Node.js applications** in hPanel, each pointed at a different
  one of those folders and a different hostname.

Each app is a running Node process, not files in a web root. Nothing is ever
served straight off the repo, and `public_html` stays empty of application
code. If you have only ever deployed HTML/PHP by dropping files into
`public_html`, that is the part to unlearn.

```
~/repo/big-cms-project/          the clone — served by nothing
  web/  admin/  pos/  shared/    source
  dist/
    web/     ─────────────────►  Node app #1  cms-projectlb.com
    admin/   ─────────────────►  Node app #2  admin.cms-projectlb.com
    pos/     ─────────────────►  Node app #3  pos.cms-projectlb.com
```

---

## Step 0 — Nothing, this is done

The three-app split is on `main`. Cloning the repo gives you `web/`, `admin/`,
`pos/` and `shared/`, and Step 3 needs no branch step.

Worth knowing why this heading exists: `main` used to be the old single-app
repo — one `app/` folder, `next.config.ts` at the root, `vercel.json` still in
it — while the split lived only on an unpushed `monorepo-split` branch.
Cloning `main` in that state gave you nothing to build, and the error you got
was a confusing one, because everything *looked* like a normal repo. The
`ls` check at the end of Step 3 catches it if you ever end up on an old
clone.

---

## Step 1 — Create the subdomains

hPanel → **Domains → Subdomains**. Create two, both under
`cms-projectlb.com`:

| Subdomain | Becomes |
|---|---|
| `admin` | admin.cms-projectlb.com |
| `pos` | pos.cms-projectlb.com |

hPanel will create a document root folder for each (typically
`domains/admin.cms-projectlb.com/public_html`). **You will not put the app
there.** It stays empty; the Node.js app takes the hostname over. Do not delete
it either — the panel expects it to exist.

Wait until both resolve and have a certificate:

```bash
curl -sI https://admin.cms-projectlb.com | head -1
```

`HTTP/2 200`, `403`, or `404` all mean DNS works and you can continue. A
certificate warning means SSL has not issued yet — give it a while. A
`Could not resolve host` means DNS has not propagated; that is a wait, not a
problem to fix.

---

## Step 2 — Get in over SSH and check Node

hPanel → **Advanced → SSH Access** for the host, port, and username.

```bash
ssh -p PORT uXXXXXXXXX@YOUR-SERVER
```

Then:

```bash
node -v
```

**Next 16 requires Node 20.9 or newer.** If you get something older, or
`command not found`, that is expected — on this kind of plan the shell's
default Node is not the one hPanel runs your app with. You will select the
version per-app in Step 7. For the build in Step 6 you need a modern Node in
the shell too; hPanel's Node.js page usually gives you a command to activate an
app's environment (`source ~/nodevenv/.../bin/activate` or similar). Run that
first, then check `node -v` again.

Also confirm git exists:

```bash
git --version
```

---

## Step 3 — Clone the repo

Put it **outside every `public_html`**. A folder in your home directory:

```bash
mkdir -p ~/repo
cd ~/repo
```

The repo is private, so plain `git clone` over HTTPS will prompt for a
password and GitHub will reject your account password. Use a **personal access
token** instead:

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained
tokens → Generate. Give it **Contents: Read-only** on `CMS-project-leb` and
nothing else. Copy the token.

```bash
git clone https://github.com/zikkops/CMS-project-leb.git big-cms-project
cd big-cms-project
```

Username: your GitHub username. Password: **paste the token**, not your
password. It will not echo as you paste — that is normal, press Enter.

You land on `main`, which is what you want. No branch to check out.

Confirm you got the right thing before going on:

```bash
ls
```

You want to see `web  admin  pos  shared  env.mjs`. If you see `app` and
`next.config.ts` at the top instead, you are looking at a clone made before
the split landed — `git pull` it, or delete it and clone again.

---

## Step 4 — Create `.env.local` on the server

**This is the step that quietly ruins a first deploy.** `.env.local` is
gitignored, so the clone does not have one, and the Firebase values in it are
compiled *into* the JavaScript in Step 6. Build without it and nothing
complains — the build succeeds and produces a bundle whose Firebase config is
six `undefined`s. You find out later, in a browser, as `auth/invalid-api-key`
on a page that otherwise looks fine.

```bash
nano .env.local
```

Paste the contents of your local `.env.local` — the same file on your own
machine, at the repo root. Ctrl+O, Enter, Ctrl+X to save and quit.

The template with every variable explained is
[env-local.template.txt](./env-local.template.txt).

**It goes at the repo root** — beside `package.json` and `env.mjs` — not
inside `web/`, `admin/` or `pos/`. One file feeds all three; `env.mjs` loads it
from each app's `next.config.ts`.

Then check it:

```bash
npm run check:env
```

Fix anything it calls an ERROR before continuing. Warnings you can read and
decide about.

---

## Step 5 — Install dependencies

```bash
npm ci
```

Takes a few minutes. `npm ci` rather than `npm install` — it installs exactly
what `package-lock.json` pins, so the server gets the versions you tested
against rather than whatever is newest today.

If it is **Killed**, you ran out of memory. Skip to
[If the server cannot build](#if-the-server-cannot-build).

---

## Step 6 — Build each app

```bash
npm run package -- admin
npm run package -- pos
```

Each takes a few minutes and ends with:

```
  dist/admin/
  start: PORT=3001 node admin/server.js
```

`npm run package` runs the build and then assembles `dist/<app>/` — a folder
that runs on its own. It exists because `output: 'standalone'` does **not**
copy `.next/static` or `public/` into its output, and an app missing those does
not error: it boots, returns 200, and serves every page with no CSS and no
JavaScript. That reads as a broken app rather than a missing folder, which is
why the script does it for you. See
[scripts/package-app.mjs](../scripts/package-app.mjs).

You do not need to rebuild `web` to add the subdomains. You **will** need to
restart it in Step 9.

### What comes out, and the one path that catches people

```
dist/admin/
  node_modules/          hoisted by the workspace
  DEPLOY.txt
  admin/                 <- note the second 'admin'
    server.js            <- THE STARTUP FILE
    package.json
    public/
    .next/
```

**The startup file is `admin/server.js`, not `server.js`.** One level in.
Standalone output nests like this in a workspace, which is not what any Next
tutorial shows, because they all assume a single-app repo. Point hPanel at the
top level and it fails with `MODULE_NOT_FOUND`, which reads like a broken
install and is not.

Get the absolute path — you need it in the next step:

```bash
pwd
```

Something like `/home/u123456789/repo/big-cms-project`. The application root
you will enter is that plus `/dist/admin`.

---

## Step 7 — One Node.js application per subdomain

hPanel → **Advanced → Node.js** → Create application. Twice:

| Field | admin | pos |
|---|---|---|
| Node version | 20.9 or newer | 20.9 or newer |
| Application mode | Production | Production |
| Application root | `repo/big-cms-project/dist/admin` | `repo/big-cms-project/dist/pos` |
| Application URL | admin.cms-projectlb.com | pos.cms-projectlb.com |
| Application startup file | `admin/server.js` | `pos/server.js` |

Application root is usually relative to your home directory — if the field
rejects a leading `/`, drop the `/home/uXXXXXXXXX/` part as shown above.

**Do not click "Run NPM Install".** `dist/` already contains exactly the
`node_modules` the app needs, and there is no `package-lock.json` in there for
npm to work from. Running it can strip the folder down to nothing.

**Do not set a port anywhere.** `server.js` reads `PORT` from the environment
and the panel assigns it. The `-p 3001` in `admin/package.json` is for
`npm run dev` on your laptop and has no effect here.

---

## Which app serves which hostname

**Nothing in this repo binds a hostname to an app.** There is no routing file,
no vhost config, no manifest. Do not go looking for one. The binding is two
fields on the hPanel application, and only those two:

| Field | What it means |
|---|---|
| **Application URL** | the hostname visitors type |
| **Application root** | the folder whose `server.js` answers it |

To make a subdomain serve a different app, edit **Application root** and the
**startup file** to match, then restart. Nothing in the repo changes:

| To serve | Application root | Startup file |
|---|---|---|
| the customer site | `…/dist/web` | `web/server.js` |
| the admin panel | `…/dist/admin` | `admin/server.js` |
| the POS | `…/dist/pos` | `pos/server.js` |

The startup file always repeats the app name, because standalone output nests
in a workspace. Change the root without changing it and you get
`MODULE_NOT_FOUND`.

### `ADMIN_HOST` does not route — it gates

This is the part that surprises people. `ADMIN_HOST` and `POS_HOST` do not
send a hostname anywhere. hPanel has already decided which process answers by
the time the app sees the request; these two only tell that process *which
hostname it believes it is*, so it can refuse paths that belong elsewhere.

Which means they have to agree with the pairing above. When they disagree,
every layer behaves correctly and the site is dark.

### The mis-pairing signature

Point `admin.cms-projectlb.com` at `dist/web` by mistake, with `ADMIN_HOST`
set correctly, and this is what you get — measured, by running the packaged
web app and sending it these Host headers:

| Host | Path | Result |
|---|---|---|
| cms-projectlb.com | `/` | 200 |
| cms-projectlb.com | `/menu` | 200 |
| admin.cms-projectlb.com | `/` | 307 → `/admin` |
| admin.cms-projectlb.com | `/menu` | **404** |
| admin.cms-projectlb.com | `/admin/login` | **404** |

The subdomain is a total blackout while the apex is perfectly healthy. The
reason is that the app correctly concluded "I am the admin host, so I serve
only `/admin/**`" — and it is the *customer* app, which has no `/admin` routes
at all. Every layer did its job.

**So: 404 on everything at one subdomain, with the main site fine, means the
Application root points at the wrong app.** Not DNS, not SSL, not the rules.

---

## Step 8 — Environment variables, in the panel

Still on each application's page, add these under Environment variables. They
are read **at runtime**, so they belong here and not in a file:

| Variable | admin | pos | web |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | ✔ | ✔ | ✔ |
| `IMGBB_API_KEY` | ✔ | — | ✔ |
| `CRON_SECRET` | ✔ | — | — |

Values are the same ones in your `.env.local`.

Two rules that explain the whole shape of this:

**The root `.env.local` is not in `dist/` and is not read at runtime.** That is
deliberate — it holds a service-account private key that bypasses every
Firestore rule, and a private key sitting inside a deployable folder is a
private key that ends up somewhere you did not put it. It exists on the server
only for the build.

**Every `NEXT_PUBLIC_*` value is already baked in.** It was inlined into the
JavaScript in Step 6. Setting one here does nothing at all — no error, no
warning, no effect. To change one you edit `.env.local` and rebuild.

Start both applications. Then, before touching hostnames, check they are alive:

```bash
curl -sI https://admin.cms-projectlb.com/admin/login | head -1
curl -sI https://pos.cms-projectlb.com/pos/login | head -1
```

Both should be `200`. Open `https://admin.cms-projectlb.com/admin/login` in a
browser and confirm it is **styled** — if the login page is unstyled black text
on white, `.next/static` did not make it, and the answer is to re-run
`npm run package` rather than to debug CSS.

---

## Step 9 — Turn the split on, last

Only now, and only once both subdomains answer.

Add to **all three** applications, including `web`:

```
ADMIN_HOST=admin.cms-projectlb.com
POS_HOST=pos.cms-projectlb.com
```

Bare hostnames — no `https://`, no trailing slash, no path.

Restart all three, `web` included. `web` is not optional here: it is the app
these variables change most.

### Why this is last

This is the switch that makes the split real. Set `ADMIN_HOST` before
`admin.cms-projectlb.com` is answering and the customer site stops serving
`/admin` while the subdomain is not yet up — no admin panel anywhere, and no
error that says why.

### What it changes, measured

Requests to the customer site, before and after — this is the actual output of
running the packaged `web` app and sending it a `Host: cms-projectlb.com`
header:

| Path | Before | After |
|---|---|---|
| `/` | 200 | 200 |
| `/admin` | **307 → /admin/login** | **404** |
| `/admin/login` | 404 | 404 |

That redirect is the point. Left over from before the split, the customer site
answers `/admin` by bouncing you to a login page — which tells anyone who
tries that an admin panel exists here. With `ADMIN_HOST` set it is a bare
`404`: plain text, no redirect, no styled not-found page naming the business.

Verify on the real hosts:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://cms-projectlb.com/admin
curl -s -o /dev/null -w '%{http_code}\n' https://admin.cms-projectlb.com/admin/login
```

You want **404** then **200**.

---

## Step 10 — Let Firebase accept the new hostnames

Firebase Console → **Authentication → Settings → Authorized domains** → Add
domain. Add both:

```
admin.cms-projectlb.com
pos.cms-projectlb.com
```

Miss this and both pages load perfectly and sign-in fails with
`auth/unauthorized-domain`. Nothing looks wrong until someone tries to log in,
so it will not be you who finds it.

---

## Done — the check that matters

Sign in at `https://admin.cms-projectlb.com/admin/login` and open a page that
reads data. Then `https://pos.cms-projectlb.com/pos` and confirm the floor
loads.

A successful build proves the code compiles, not that the feature works. Three
bugs this month were invisible to both `tsc` and the build: a CSP that blocked
Google sign-in, a listener that turned permission-denied into an empty list,
and a money formatter that had lost its dollar sign. Look at the pages.

---

## If the server cannot build

`npm ci` or the build being **Killed** means out of memory, which shared plans
hit routinely. Build on your own machine instead:

```bash
npm run package -- admin
npm run package -- pos
```

Then upload `dist/admin` and `dist/pos` — hPanel File Manager, or:

```bash
scp -P PORT -r dist/admin uXXXXXXXXX@YOUR-SERVER:~/repo/big-cms-project/dist/
```

They are self-contained, around 46 MB each, and need no `npm install` on the
server. Everything from Step 7 on is unchanged. You still need the repo
cloned there if you want to build there later, but not for this route.

---

## Redeploying later

```bash
cd ~/repo/big-cms-project
git pull
npm ci                      # only when package-lock.json changed
npm run package -- admin
```

Then Restart that application in hPanel. Each app redeploys on its own — that
is the point of the split, and why a client on the POS tier receives no admin
code at all.

If you changed anything `NEXT_PUBLIC_*`, you must rebuild; changing it in the
panel does nothing.

---

## When it goes wrong

| What you see | What it is |
|---|---|
| `MODULE_NOT_FOUND` on start | Startup file is `server.js`. It is `admin/server.js` — one level in. |
| App starts, every page unstyled | `.next/static` missing. Re-run `npm run package`, do not debug CSS. |
| One subdomain 404s everything, main site fine | Application root points at the wrong app. See [Which app serves which hostname](#which-app-serves-which-hostname). |
| `auth/invalid-api-key` in the browser | Built without `.env.local`. Create it (Step 4) and rebuild. |
| `auth/unauthorized-domain` on login | Step 10. |
| `/admin` still redirects on the apex | `web` was not restarted after `ADMIN_HOST`, or the variable was set on admin only. |
| `/admin` 404s everywhere, including the subdomain | `ADMIN_HOST` does not match the hostname exactly, or was set before the subdomain resolved. |
| Uploads fail with a clear error | `IMGBB_API_KEY` unset — or set as `NEXT_PUBLIC_IMGBB_API_KEY`, which nothing reads. `npm run check:env` catches this one. |
| `Killed` during install or build | Out of memory. See above. |
| Refuses to build, lists `NEXT_PUBLIC_FIREBASE_*` | Working as intended — Step 4. |

---

## What this buys, and what it does not

The split is separation, not authentication. Anyone can resolve
`admin.cms-projectlb.com` and reach the login page. What changes: `/admin` is
*absent* from the customer domain rather than merely gated, the admin session
cookie stops being sent to the customer site, and there is now one hostname you
can put a real network gate in front of later without touching the customer
site.

The actual boundary is unchanged and lives elsewhere: Firebase Auth, custom
claims, `firestore.rules`, and every privileged mutation behind a route
handler.

---

## Linking to it — a separate decision, on purpose

`NEXT_PUBLIC_ADMIN_URL` puts a staff shortcut in the customer site's navbar and
sends staff there after they sign in. Unset, no link renders and staff type the
URL.

It is not a smaller version of `ADMIN_HOST` — it is the opposite decision.
`ADMIN_HOST` keeps the admin hostname out of the customer bundle;
`NEXT_PUBLIC_ADMIN_URL` puts it in, for every visitor, because an inlined value
is in the JavaScript whether or not the viewer is staff. Not a leak, not a
secret. Just do it deliberately.

`NEXT_PUBLIC_POS_URL` currently does nothing — `posUrl()` is exported and
imported nowhere.

Both are build-time. See [env-local.template.txt](./env-local.template.txt).

---

## Afterwards

The loyalty reset cron needs the admin hostname to exist first:
[scheduled-jobs.md](./scheduled-jobs.md).
