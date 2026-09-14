// Puts the POS server inside the Windows counter app, for hub mode — POS
// software, stage 3.
//
//   node scripts/package-hub.mjs              # build the POS, assemble it, copy it in
//   node scripts/package-hub.mjs --no-build   # reuse the last build
//
// desktop's `npm run dist` runs this first; electron-builder then copies
// desktop/hub-bundle into the installer's resources, so the server lands at
// resources/hub. The assembling is scripts/package-app.mjs, the same folder a
// host would run.
//
// ── Why the server sits one level down, in hub-bundle/hub ─────────────────
// electron-builder's copy filter drops a folder called node_modules that sits
// at the ROOT of a copy source, before any pattern is consulted
// (app-builder-lib/out/util/filter.js: `if (relative === "node_modules")
// return false`). No filter can put it back. Copied from hub-app with the
// server at its root, the first installer shipped 402 of 2,352 files, and the
// server died on start with "Cannot find module 'next'". From hub-bundle,
// node_modules is hub/node_modules, and it is copied like any other folder.
// scripts/check-hub-shipped.mjs proves the copy after every build.
//
// ── The one thing it must never ship ─────────────────────────────────────
// The hub never holds the Firebase Admin key (scope, "Security rule for the
// hub"). The server folder should not contain it: .env.local is not copied,
// and the server reads the key from its environment. But "should not" is not a
// check, and an installer goes onto a PC anybody can walk up to. So every file
// that is about to ship is searched for THIS machine's service account — its
// key id, its client email and a piece of the key itself — and for any .env or
// .pem file. A hit refuses the package, naming the file and never the value.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { loadRootEnv } from '../env.mjs'

const root = resolve(import.meta.dirname, '..')
const built = join(root, 'dist', 'pos')
const bundle = join(root, 'desktop', 'hub-bundle')
const target = join(bundle, 'hub')

execFileSync(process.execPath, [join(root, 'scripts', 'package-app.mjs'), 'pos', ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit',
})

if (!existsSync(join(built, 'pos', 'server.js'))) {
  console.error('dist/pos/pos/server.js is missing: the POS server was not assembled.')
  process.exit(1)
}

// ── What to look for ────────────────────────────────────────────────────────
loadRootEnv()
const needles = []
const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (raw) {
  try {
    const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))
    if (sa.private_key_id) needles.push(['the service account key id', String(sa.private_key_id)])
    if (sa.client_email) needles.push(['the service account email', String(sa.client_email)])
    const body = String(sa.private_key ?? '').replace(/\\n/g, '\n').split('\n').filter(l => l.length > 40 && !l.startsWith('-----'))
    if (body.length > 1) needles.push(['the service account private key', body[1]])
  } catch {
    console.error('FIREBASE_SERVICE_ACCOUNT is set but could not be read, so the search would prove nothing. Refusing.')
    process.exit(1)
  }
  // The whole setting as it is stored, too: base64 or raw.
  if (raw.length > 40) needles.push(['FIREBASE_SERVICE_ACCOUNT as stored', raw.trim().slice(0, 60)])
} else {
  console.warn('No FIREBASE_SERVICE_ACCOUNT on this machine: only file names are checked.')
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* files(p)
    else yield p
  }
}

// ── Copy, then search what will actually ship ─────────────────────────────
rmSync(bundle, { recursive: true, force: true })
mkdirSync(bundle, { recursive: true })
cpSync(built, target, { recursive: true })
// Its instructions are for a web host, which a hub is not.
rmSync(join(target, 'DEPLOY.txt'), { force: true })

const problems = []
let count = 0
let bytes = 0
const encoded = needles.map(([label, value]) => [label, Buffer.from(value, 'utf8')])
for (const file of files(bundle)) {
  count++
  const rel = relative(root, file)
  const base = file.split(/[\\/]/).pop() ?? ''
  if (/^\.env/i.test(base) || /\.pem$/i.test(base)) problems.push(`${rel}: a ${base.startsWith('.env') ? '.env' : '.pem'} file`)
  const content = readFileSync(file)
  bytes += content.length
  for (const [label, needle] of encoded) {
    if (content.includes(needle)) problems.push(`${rel}: contains ${label}`)
  }
}

if (problems.length > 0) {
  rmSync(bundle, { recursive: true, force: true })
  console.error('\nRefusing to put the POS server in the Windows app. The hub never holds the Admin key:\n')
  for (const p of problems) console.error(`  ${p}`)
  console.error('\ndesktop/hub-bundle was removed.\n')
  process.exit(1)
}

console.log(`\ndesktop/hub-bundle/hub: ${count} files, ${(bytes / 1_048_576).toFixed(1)} MB, searched for ${needles.length} marks of the service account — none found.\n`)
