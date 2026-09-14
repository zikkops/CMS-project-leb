# BIG CMS POS — Windows counter app

POS software, **stage 1: online mode**. The hosted POS, full screen on the
café's counter PC. The plan and the owner's decisions are in the vault:
`01 - Projects/BIG CMS Project/POS Software (Local Hub) - Scope.md`.

It is its own package, deliberately **outside** the npm workspaces: Electron is
a large download that must never reach a Hostinger build of web, admin or pos.

## Run it

```bash
cd desktop
npm install
npm start          # full screen on the hosted POS
npm run smoke      # loads the POS without a window, prints the result, exits
npm run dist       # builds the Windows installer into desktop/dist
```

Against a local POS instead of the hosted one:

```bash
BIG_CMS_POS_URL=http://localhost:3002/pos npm start
```

## What it does, and does not

- Starts with Windows (installed app only), stays full screen, keeps the
  display awake, runs once per PC, reloads itself after a crash.
- Never leaves the POS: any other link opens in the real browser. Only the
  camera (loyalty QR) and full screen are granted, and only to the POS.
- With no connection and nothing cached, it shows its own screen and retries
  every 15 seconds. A PC marked as the counter device opens the counter screen
  offline, as in a browser.
- **Holds no secrets.** The POS server's Firebase Admin key never goes on a
  café PC. The local hub server (stage 3) gets a credential of its own.

Keys for a manager: **Ctrl+Shift+Alt+K** leaves or returns to full screen,
**Ctrl+R** or **F5** reloads.

## Settings

`config.json` in the app's data folder (`%APPDATA%\BIG CMS POS\`), all optional:

```json
{ "posUrl": "https://pos.cms-projectlb.com/pos", "kiosk": true, "startWithWindows": true }
```

`posUrl` must be https (or http on localhost). A wrong value falls back to the
default rather than stopping the till. The rules are `policy.js`, asserted by
`npm run verify:desktop` from the repo root.
