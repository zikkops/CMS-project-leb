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

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

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

// ── Build ──────────────────────────────────────────────────────────────────
// --no-build is for re-assembling after a build you already ran, not for
// shipping a stale .next. If there is no build at all, refuse rather than
// package an empty folder that fails on the server instead of here.
if (!skipBuild) {
  console.log(`Building ${app}…`)
  // npm.cmd rather than shell:true — passing args through a shell concatenates
  // rather than escapes them, and Node deprecated the combination for that reason.
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', `build:${app}`], {
    cwd: root, stdio: 'inherit',
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
