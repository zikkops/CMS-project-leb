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

**Every installer that leaves this PC has its own version.** `npm run dist`
refuses to build under a version already signed into `dist/updates/latest.json`
(`scripts/check-desktop-version.mjs`): raise `"version"` in `package.json`
first. Two builds both called 0.1.0 is how a café laptop once ran an old build
while everyone believed it had the new one, and the updater never replaces a
version with the same one. The installer is always
`BIG-CMS-POS-Setup-<version>.exe`; the build removes any older
`BIG CMS POS Setup …` file left in `dist`, so only one naming exists.
`BIG_CMS_SAME_VERSION=1` allows a same-version build for a local test that will
never be released.

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
- **As the hub**, it starts the POS server on `127.0.0.1` (this PC only),
  waits until it answers as the hub, then opens it. A server that stops
  is started again, backing off to 30 seconds. The database is
  `%APPDATA%\BIG CMS POS\hub\pos.db`, with `hub.log` beside it.
- **Phones on the café wifi reach the hub encrypted, never over plain http**
  (`hubLan.js`), and only once `"hubLan": true` is set. The app then opens a
  TLS port (`hubLanPort`, 3443) in front of the server, with the hub's own
  certificate (`hub-tls.crt` and `hub-tls.key` beside the database). Windows
  asks once whether to allow it through the firewall. No browser trusts that
  certificate: the phone app trusts it by the fingerprint in the QR on
  `/pos/hub`. The certificate is kept, because a new one means every phone
  pairs again.
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
{ "mode": "online", "posUrl": "https://pos.cms-projectlb.com/pos", "kiosk": true, "startWithWindows": true, "hubPort": 3100, "hubLan": false, "hubLanPort": 3443, "autoUpdate": true, "updatesUrl": "https://pos.cms-projectlb.com/api/desktop-updates/" }
```

- **`autoUpdate`** (on by default) lets the installed app update itself
  (`update.js`, owner's decisions S26–S27). It checks `updatesUrl` every six
  hours, accepts only a manifest signed by the release key and an installer
  matching it, and installs only when nobody is using the PC: after 05:00 with
  the PC idle ten minutes and nobody signed in, or at the next start. Releasing
  one is [docs/desktop-updates.md](../docs/desktop-updates.md).

- **`mode`** is `online` or `hub`. With none set, the app asks on its first
  start (`setup.html`, owner's decision S29): "Online till" or "Café hub", which
  goes on to the pairing code. A manager reopens that screen with
  **Ctrl+Shift+Alt+M**. Leaving hub mode is refused until the hub has sent
  everything to the cloud and has no open table or drawer shift (S30); the old
  database is then kept beside it as `pos.db.hub-backup-…`.
- **`hubLan`** opens the encrypted port for phones on the café wifi, on
  `hubLanPort`. It is never the same port as `hubPort`, which stays on this PC.
- **`posUrl`** must be https (or http on localhost). It is not used as the hub,
  which opens `http://localhost:<hubPort>/pos`.
- **A wrong value** falls back to the default rather than stopping the till.

The rules are `policy.js`, asserted by `npm run verify:desktop` from the repo
root.
