// `npm run build` — all three apps, or one.
//
// With no BUILD_APP set it builds web, admin and pos, as it always has; that
// is the verification ritual in CLAUDE.md. With BUILD_APP=pos (or web, or
// admin) it builds and packages only that app into dist/<app>/, by way of
// package-app.mjs — the same folder the SSH route in docs/deploying.md makes.
//
// This exists for hosts that build from git and will only run the repo's own
// `npm run build`. Hostinger's Node.js deploy is one: with the Next.js preset
// it runs `next build` inside whatever root directory it is given, which in a
// workspace finds neither Next nor the shared package; with the Other preset
// its build command is a dropdown holding exactly "None" and "npm run build".
// There is no way to tell it `npm run package -- pos`. An environment
// variable it will pass through is the one lever it leaves.
//
// On that host: root directory ./, BUILD_APP=pos, entry file
// dist/pos/pos/server.js.

import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const APPS = ['web', 'admin', 'pos']
const root = resolve(import.meta.dirname, '..')
const app = (process.env.BUILD_APP ?? '').trim()

function run(args, cwd) {
  try {
    execFileSync(process.execPath, args, { cwd, stdio: 'inherit' })
  } catch (err) {
    // The child has already printed why; a Node stack trace from this wrapper
    // on top of it only buries that.
    process.exit(typeof err?.status === 'number' ? err.status : 1)
  }
}

if (app) {
  if (!APPS.includes(app)) {
    console.error(`BUILD_APP must be one of ${APPS.join(', ')} — got "${app}".`)
    process.exit(1)
  }
  run([join(root, 'scripts', 'package-app.mjs'), app], root)
} else {
  // The Next binary directly rather than `npm run build --workspaces`, for the
  // reason given in package-app.mjs: spawning npm on Windows means npm.cmd.
  const NEXT_BIN = createRequire(import.meta.url).resolve('next/dist/bin/next')
  for (const a of APPS) {
    console.log(`\n── ${a}`)
    run([NEXT_BIN, 'build'], join(root, a))
  }
}
