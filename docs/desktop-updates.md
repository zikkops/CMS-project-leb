# Releasing an update to the Windows counter app

Counter PCs update themselves (owner's decisions S26–S27, 15 Sep 2026). Each
one looks at `https://pos.cms-projectlb.com/api/desktop-updates/latest.json`
every six hours. When a newer version is there, it downloads it, checks it, and
installs it only when nobody is using the PC:

- after 05:00 with the PC untouched for ten minutes and nobody signed in, or
- the next time the app starts.

Never mid-service. The rules are `desktop/update.js`, asserted by
`npm run verify:desktop`.

## Why it is signed

The installer runs on every café's till. A manifest is accepted only if it is
signed by the **release key**, whose public half is built into the app
(`UPDATE_PUBLIC_KEY` in `desktop/update.js`), and an installer only if its size
and SHA-512 match that manifest. Somebody who got into the website could put
files in the folder, and every counter PC would ignore them.

**The release key is `%USERPROFILE%\.big-cms\desktop-update-key.pem`** on the
machine that made it (15 Sep 2026). It is not in the repo and never printed.

- **Back it up** somewhere safe and private. Lose it, and no counter PC accepts
  an update until each one is reinstalled by hand with a new key.
- **Never share or commit it.** Whoever has it can put a program on every till.
- `node scripts/release-desktop.mjs --make-key` refuses to replace an existing
  key, for exactly that reason.

## One-time: the folder on the POS server

The POS server serves the files from a folder **outside** the app, because the
app folder is rebuilt on every deploy and an installer is too big for git.

1. Over SSH or hPanel's File Manager, make a folder in your home directory, for
   example `~/desktop-updates`.
2. hPanel → Node.js → the **pos** application → Environment variables: add
   `DESKTOP_UPDATES_DIR` with that folder's absolute path, e.g.
   `/home/u123456789/desktop-updates`. Restart the application.
3. Check: `curl -s -o /dev/null -w '%{http_code}\n' https://pos.cms-projectlb.com/api/desktop-updates/latest.json`
   answers `404` while the folder is empty, and `200` once a release is in it.

Only `latest.json` and files named `BIG-CMS-POS-Setup-x.y.z.exe` are ever
served from that folder.

## Each release

1. Raise `"version"` in `desktop/package.json` (for example `0.1.0` → `0.2.0`).
   A counter PC installs only a **higher** version.
2. Build the installer: `npm --prefix desktop run dist`. It ends with the check
   that every hub file shipped.
3. Smoke-run the packaged app, as the desktop README says, before anybody gets it.
4. Sign it: `node scripts/release-desktop.mjs`. It writes
   `desktop/dist/updates/latest.json` and a copy of the installer.
5. Upload to `DESKTOP_UPDATES_DIR`: **the installer first, `latest.json` last**,
   so no PC is told about an installer that is not there yet.
6. Check: `curl -s https://pos.cms-projectlb.com/api/desktop-updates/latest.json`
   shows the new version.

Counter PCs pick it up within six hours and install it the next quiet morning or
start. A PC that has `"autoUpdate": false` in its `config.json` never updates
itself.

## If an update goes wrong

- **An installer that fails** is started at most twice for one version, then left
  alone, so a PC is not stuck restarting. Release a fixed higher version.
- **To stop a release** before PCs install it, put the previous `latest.json` back.
  A PC that already downloaded the newer one still installs it, because it was
  genuine; a PC never goes back to a lower version on its own.
