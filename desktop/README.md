# BIG CMS POS — Windows counter app

POS software for the café's counter PC, in one of two modes, chosen per client.
The plan and the owner's decisions are in the vault:
`01 - Projects/BIG CMS Project/POS Software (Local Hub) - Scope.md`.

- **Online** (stage 1, the default): the hosted POS, full screen.
- **Hub** (stage 3): this PC is the café's hub. The app runs the POS server
  that ships inside it, with its own database, and keeps trading with no
  internet.

It is its own package, deliberately **outside** the npm workspaces: Electron is
a large download that must never reach a Hostinger build of web, admin or pos.

## Run it

```bash
cd desktop
npm install
npm start          # full screen, online
npm run smoke      # loads the POS without a window, prints the result, exits
npm run dist       # puts the POS server in, then builds the installer into desktop/dist
```

Against a local POS instead of the hosted one:

```bash
BIG_CMS_POS_URL=http://localhost:3002/pos npm start
```

As the hub, from the repo (the server comes from `desktop/hub-bundle/hub`,
which `npm run hub:prepare` assembles):

```bash
npm run hub:prepare
BIG_CMS_DESKTOP_MODE=hub BIG_CMS_HUB_DATA=../.hub/desktop npm start
```

`BIG_CMS_HUB_DATA` keeps a development hub's database out of the real app data
folder. A fresh hub has no menu: `npm run hub:seed -- --db=.hub/desktop/pos.db`
from the repo root copies the demo one in (development only).

## What it does, and does not

- Starts with Windows (installed app only), stays full screen, keeps the
  display awake, runs once per PC, reloads itself after a crash.
- Never leaves the POS: any other link opens in the real browser. Only the
  camera (loyalty QR) and full screen are granted, and only to the POS.
- With no connection and nothing cached, it shows its own screen and retries
  every 15 seconds. A PC marked as the counter device opens the counter screen
  offline, as in a browser.
- **As the hub**, it starts the POS server on `127.0.0.1` (this PC only, for
  now), waits until it answers as the hub, then opens it. A server that stops
  is started again, backing off to 30 seconds. The database is
  `%APPDATA%\BIG CMS POS\hub\pos.db`, with `hub.log` beside it.
- **Holds no secrets.** The Firebase Admin key never goes on a café PC:
  - The hub server is started with a short list of environment variables, so
    a key set on the PC cannot reach it.
  - `scripts/package-hub.mjs` searches every file it packages for this
    machine's service account, and refuses to package on a match.

Keys for a manager: **Ctrl+Shift+Alt+K** leaves or returns to full screen,
**Ctrl+R** or **F5** reloads.

## Settings

`config.json` in the app's data folder (`%APPDATA%\BIG CMS POS\`), all optional:

```json
{ "mode": "online", "posUrl": "https://pos.cms-projectlb.com/pos", "kiosk": true, "startWithWindows": true, "hubPort": 3100 }
```

- **`mode`** is `online` or `hub`.
- **`posUrl`** must be https (or http on localhost). It is not used as the hub,
  which opens `http://localhost:<hubPort>/pos`.
- **A wrong value** falls back to the default rather than stopping the till.

The rules are `policy.js`, asserted by `npm run verify:desktop` from the repo
root.
