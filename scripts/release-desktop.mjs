// Prepares a release of the Windows counter app for automatic updates —
// POS software (owner's decisions S26–S27, 15 Sep 2026).
//
//   node scripts/release-desktop.mjs --make-key   once: make the signing key
//   npm --prefix desktop run dist                 build the installer
//   node scripts/release-desktop.mjs              sign it into desktop/dist/updates/
//
// Then upload the two files in desktop/dist/updates/ to the POS server's
// DESKTOP_UPDATES_DIR (docs/desktop-updates.md). Every counter PC checks
// https://pos.cms-projectlb.com/api/desktop-updates/latest.json, and installs a
// newer version only when nobody is using it (S27).
//
// ── Why a signature, not just https ────────────────────────────────────────
// The installer runs on every café's counter PC with that PC's rights. Served
// from our own site (S26), anyone who got into the site could otherwise put
// their own program on every till at the next check. The manifest is signed
// with an Ed25519 key that never leaves this machine, and the app carries only
// the public half (desktop/update.js): a manifest not signed by this key is
// ignored, and the installer must match the manifest's size and SHA-512.
//
// The private key is kept OUTSIDE the repo, in the user's home folder, and this
// script never prints it. Lose it and no counter PC will accept an update until
// each is reinstalled by hand with a new public key; keep a copy somewhere safe.

import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KEY_FILE = process.env.BIG_CMS_UPDATE_KEY || join(homedir(), '.big-cms', 'desktop-update-key.pem')

if (process.argv.includes('--make-key')) {
  if (existsSync(KEY_FILE)) {
    console.error(`A signing key already exists at ${KEY_FILE}. It is not replaced: a new key means every counter PC needs reinstalling by hand.`)
    process.exit(1)
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  mkdirSync(dirname(KEY_FILE), { recursive: true })
  writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  console.log(`Signing key made at ${KEY_FILE} (not printed). Back it up somewhere safe.`)
  console.log('Public key for desktop/update.js UPDATE_PUBLIC_KEY:')
  console.log(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'))
  process.exit(0)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'desktop', 'package.json'), 'utf8'))
const version = String(pkg.version)
const file = `BIG-CMS-POS-Setup-${version}.exe`
const built = join(ROOT, 'desktop', 'dist', file)
if (!existsSync(built)) {
  console.error(`No installer at ${built}. Run \`npm --prefix desktop run dist\` first.`)
  process.exit(1)
}
if (!existsSync(KEY_FILE)) {
  console.error(`No signing key at ${KEY_FILE}. Make one with --make-key, once, and put its public key in desktop/update.js.`)
  process.exit(1)
}

const bytes = readFileSync(built)
const payload = JSON.stringify({
  app: 'big-cms-counter',
  version,
  file,
  size: statSync(built).size,
  sha512: createHash('sha512').update(bytes).digest('base64'),
  released: new Date().toISOString(),
})
const signature = sign(null, Buffer.from(payload, 'utf8'), createPrivateKey(readFileSync(KEY_FILE))).toString('base64')

const out = join(ROOT, 'desktop', 'dist', 'updates')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'latest.json'), JSON.stringify({ payload, signature }, null, 2))
copyFileSync(built, join(out, file))
console.log(`Signed version ${version}. Upload both files in ${out} to the POS server's DESKTOP_UPDATES_DIR:`)
console.log(`  ${file}   (${(bytes.length / 1e6).toFixed(1)} MB)`)
console.log('  latest.json   (upload it last, so no PC is told about an installer that is not there yet)')
