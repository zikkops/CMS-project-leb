// Assembles one app into a folder you can actually run.
//
//   node scripts/package-app.mjs admin
//   npm run package -- admin
//
// `output: 'standalone'` in next.config.ts emits .next/standalone — the app
// plus only the node_modules it uses. What it does NOT emit is .next/static
// and public/, and Next says so in one line of its docs that everybody skips.
//
// Leaving them out does not error. The server boots, answers 200, and serves
// HTML with no CSS, no JS and no images — every page a wall of unstyled text,
// every button inert. It looks like a broken app, not a missing folder, so
// the hour goes on the wrong question. This script exists to make that
// impossible to forget.
//
// ── The workspace nesting ──────────────────────────────────────────────────
// In a workspace, standalone output is nested one level deeper than the
// single-app layout every tutorial shows:
//
//   admin/.next/standalone/           <- upload THIS, and run from here
//     node_modules/                   <- hoisted, shared by the workspace
//     admin/
//       server.js                     <- the startup file
//       .next/
//
// So the entry point is `admin/server.js`, not `server.js`. Point a host's
// "startup file" field at the wrong one and it fails with MODULE_NOT_FOUND.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
// The same loader next.config.ts uses, so this script sees exactly what the
// build will see rather than a second opinion about it.
import { loadRootEnv } from '../env.mjs'

const NEXT_BIN = createRequire(import.meta.url).resolve('next/dist/bin/next')

const APPS = ['web', 'admin', 'pos']

// Only the port differs, and only as a default — PORT wins over it. These
// match each app's `next start -p` so local and deployed agree.
const DEFAULT_PORT = { web: 3000, admin: 3001, pos: 3002 }

const app = process.argv[2]
const skipBuild = process.argv.includes('--no-build')

if (!APPS.includes(app)) {
  console.error(`Usage: node scripts/package-app.mjs <${APPS.join('|')}> [--no-build]`)
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'dist', app)

// ── Refuse to build blind ──────────────────────────────────────────────────
// NEXT_PUBLIC_* values are inlined at compile time, and firebase.ts reads six
// of them with no fallback and no validation. Build without them and nothing
// complains: the build succeeds, and initializeApp() gets a config of six
// undefineds. The failure surfaces later, in the browser, as
// auth/invalid-api-key on a page that otherwise renders — by which point the
// question being asked is 'why is login broken' rather than 'what did I not
// set'.
//
// This is the first-deploy trap specifically. .env.local is gitignored, so a
// fresh clone on a server has none, and the build that produces a broken
// bundle looks exactly like the build that produces a working one.
loadRootEnv()

const missing = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
].filter(k => !process.env[k])

if (missing.length > 0) {
  console.error('\nRefusing to build: these are inlined at compile time and are not set.\n')
  for (const k of missing) console.error('  ' + k)
  console.error('\nPut them in .env.local at the repo root — the SAME root as package.json,')
  console.error('not inside ' + app + '/. It is gitignored, so a fresh clone does not have one.')
  console.error('Copy docs/env-local.template.txt and fill it in, then run npm run check:env.\n')
  process.exit(1)
}

// ── Build ──────────────────────────────────────────────────────────────────
// --no-build is for re-assembling after a build you already ran, not for
// shipping a stale .next. If there is no build at all, refuse rather than
// package an empty folder that fails on the server instead of here.
if (!skipBuild) {
  console.log(`Building ${app}…`)
  // The Next binary directly, not 'npm run build'. Spawning npm means spawning
  // npm.cmd on Windows, which since Node 20 needs shell:true, which in turn is
  // deprecated for argument-passing. Going straight to the CLI avoids the shell
  // on both platforms and is one process fewer either way.
  execFileSync(process.execPath, [NEXT_BIN, 'build'], {
    cwd: join(root, app), stdio: 'inherit',
  })
}

const standalone = join(root, app, '.next', 'standalone')
if (!existsSync(standalone)) {
  console.error(`No standalone output at ${app}/.next/standalone.`)
  console.error('Run without --no-build, or check that next.config.ts still sets output: \'standalone\'.')
  process.exit(1)
}

// ── Assemble ───────────────────────────────────────────────────────────────
console.log(`Assembling dist/${app}…`)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

cpSync(standalone, out, { recursive: true })

// ── Externals Next links to by absolute path ───────────────────────────────
// serverExternalPackages (firebase-admin, in next.config.ts) are loaded by a
// hashed alias — `firebase-admin-a14c8a5423a75469/app` — and standalone output
// provides that alias as a SYMLINK in <app>/.next/node_modules, pointing by
// absolute path at the repo's own node_modules/firebase-admin. Outside this
// folder. That works wherever the repo still sits where it was built, which is
// every laptop, and nowhere else: Hostinger builds in one directory and runs
// from another, and every API route answered a bare "Internal Server Error"
// with ERR_MODULE_NOT_FOUND in its runtime log while the pages looked fine.
//
// The folder already carries a traced copy of the real package in its own
// node_modules, so each alias becomes a plain copy of that — no link left for
// a host's copy step to break, and nothing reaching outside the folder.
const aliasDir = join(out, app, '.next', 'node_modules')
if (existsSync(aliasDir)) {
  const aliases = []
  for (const entry of readdirSync(aliasDir)) {
    if (entry.startsWith('@')) {
      for (const inner of readdirSync(join(aliasDir, entry))) aliases.push(`${entry}/${inner}`)
    } else {
      aliases.push(entry)
    }
  }
  for (const alias of aliases) {
    const name = alias.replace(/-[0-9a-f]{16}$/, '')
    const real = join(out, 'node_modules', name)
    if (name === alias || !existsSync(real)) {
      console.error(`Cannot resolve ${app}/.next/node_modules/${alias} to a package in dist/${app}/node_modules.`)
      console.error('Refusing to package a folder whose API routes would fail on the server.')
      process.exit(1)
    }
    const dest = join(aliasDir, alias)
    // unlink, never a recursive delete, when it is a link: on Windows these
    // can be junctions, and a recursive delete through one empties the
    // repo's own node_modules/firebase-admin.
    if (lstatSync(dest).isSymbolicLink()) unlinkSync(dest)
    else rmSync(dest, { recursive: true, force: true })
    cpSync(real, dest, { recursive: true, dereference: true })
  }
  if (aliases.length) console.log(`Replaced ${aliases.length} external alias link(s) with copies: ${aliases.join(', ')}`)
}

// The two directories standalone leaves behind. Paths mirror the nesting
// above: both live under dist/<app>/<app>/, not dist/<app>/.
const staticSrc = join(root, app, '.next', 'static')
const staticDest = join(out, app, '.next', 'static')
if (!existsSync(staticSrc)) {
  console.error(`Missing ${app}/.next/static — the build did not finish. Refusing to package.`)
  process.exit(1)
}
cpSync(staticSrc, staticDest, { recursive: true })

const publicSrc = join(root, app, 'public')
if (existsSync(publicSrc)) {
  cpSync(publicSrc, join(out, app, 'public'), { recursive: true })
}

// ── A note in the box ──────────────────────────────────────────────────────
// Written into the folder rather than only printed here, because the person
// who unpacks this on the server is often not the person who packed it, and
// the runtime environment is the one thing the folder cannot carry with it.
writeFileSync(join(out, 'DEPLOY.txt'), `${app} — built to run standalone

Start it:
  PORT=${DEFAULT_PORT[app]} node ${app}/server.js

The startup file is ${app}/server.js — one level in, because this is a
workspace. server.js reads PORT and HOSTNAME from the environment and
defaults to 3000 and 0.0.0.0.

REQUIRED environment variables, set on the SERVER:

  NEXT_PUBLIC_* values are already baked into this folder — they were inlined
  when it was built, and changing them on the server does nothing. Rebuild.

  These are read at runtime and MUST be set where the app runs:
    FIREBASE_SERVICE_ACCOUNT   base64 of the service-account JSON
    IMGBB_API_KEY              image uploads fail without it
    CRON_SECRET                admin app only; the reset route 503s without it
    ADMIN_HOST                 hostname allowed to serve /admin
    POS_HOST                   hostname allowed to serve /pos

  The repo's root .env.local is NOT in this folder and is not read at runtime.
  That is deliberate — it holds a service-account private key, and shipping it
  inside a deployable is how that key ends up somewhere it should not be.
`)

console.log(`\n  dist/${app}/`)
console.log(`  start: PORT=${DEFAULT_PORT[app]} node ${app}/server.js`)
console.log(`  see dist/${app}/DEPLOY.txt for the environment variables it still needs\n`)
