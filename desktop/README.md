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

## Setting it up at a café

What the first real setup (16 Sep 2026) taught. The two-page install sheet
walks through the whole visit; these are the traps.

- **Use the app, not a browser, for the hub page.** The hub's till takes 20–30
  seconds to start on the first run, and about 10–25 s on every start after.
  The app shows its own "waiting for the café hub" screen meanwhile; a browser
  pointed at `localhost:3100` too early just says "connection refused".
  When a browser is needed, use `http://127.0.0.1:3100/pos/hub`.
- **Staff phones are switched on in the setup screen**: Ctrl+Shift+Alt+M,
  then "Staff phones on the café Wi‑Fi: On". The app starts again. (It writes
  `"hubLan": true` into `config.json`, which still works by hand.) Until then
  the hub page shows no QR code and says how to switch them on.
- **The café network must be Private in Windows.** On a network Windows calls
  Public, its firewall blocks phones even after "Allow" was answered, because
  that answer covers private networks. While phones are on, the app asks
  Windows every minute (`Get-NetConnectionProfile`) and writes the Public
  adapters to `network.json` beside the hub database; the hub page then warns,
  naming the address, with the fix (Settings → Network & internet → the
  network's properties → Private). The installer adds no firewall rule of its
  own: it installs per user without admin rights, which is what lets updates
  install silently, and a firewall rule needs admin rights (UPGRADE.md T2.19,
  an owner's decision).
- **Reserve the counter PC's address in the router** (a DHCP reservation).
  Phones are paired to the address in the QR; if the router hands the PC a new
  one, every phone has to scan again.
- **Phones must be on the same network as the PC.** A mesh wifi behind the
  internet provider's router is two networks: `192.168.68.x` on the wifi,
  `192.168.1.x` on the provider's box. The PC, the phones and the printers
  all go on the one the staff wifi uses. A phone on mobile data shows a
  `10.x` address and cannot reach the hub at all.
- **Windows must treat the café network as Private**, and the firewall prompt
  must be allowed for Private networks, or phones are blocked. On somebody's
  own laptop at a public wifi, allow the app on Public instead of making the
  whole network Private.
- **Printers often arrive on a factory address** (`192.168.123.100`,
  `192.168.192.168`), which no device on the café network can reach. Print the
  self-test page (hold FEED while switching on) and change the address first.
- **Give every staff account a first name** before the visit. The counter's
  sign-in list and the manager approvals show first names.

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
  (`hubLan.js`), and only once `"hubLan": true` is set (the setup screen's
  Staff phones switch, `configWithSetting()`). The app then opens a
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
