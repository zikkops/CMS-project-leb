// Refuses to build a counter-app installer under a version already released
// (UPGRADE.md T0.3). Run first by `npm --prefix desktop run dist`.
//
// Two different builds both called 0.1.0 is how a café laptop ran an old build
// while everybody believed it had the new one, and why the updater would never
// have replaced it: a PC installs only a HIGHER version. The version released
// last is the one in desktop/dist/updates/latest.json, written by
// scripts/release-desktop.mjs when an installer is signed.
//
// It also removes installers left in desktop/dist under the old naming
// ("BIG CMS POS Setup x.y.z.exe", from before artifactName was set), so the
// folder holds only files named the way the updater and the docs name them.
//
// BIG_CMS_SAME_VERSION=1 allows a same-version build for a local test that
// will never be released.

import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { releaseVersionProblem } = require('../desktop/update.js')
const desktop = join(import.meta.dirname, '..', 'desktop')
const version = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')).version

let published = null
const latest = join(desktop, 'dist', 'updates', 'latest.json')
if (existsSync(latest)) {
  try {
    const manifest = JSON.parse(readFileSync(latest, 'utf8'))
    // The signed payload is a JSON string inside the manifest (release-desktop.mjs).
    published = JSON.parse(manifest.payload).version ?? null
  } catch {
    published = null
  }
}

const problem = releaseVersionProblem(version, published)
if (problem && process.env.BIG_CMS_SAME_VERSION !== '1') {
  console.error(`\n  Not building: ${problem}\n  (For a local test build that will never be released: BIG_CMS_SAME_VERSION=1.)\n`)
  process.exit(1)
}

const dist = join(desktop, 'dist')
if (existsSync(dist)) {
  for (const name of readdirSync(dist)) {
    if (/^BIG CMS POS Setup .*\.exe(\.blockmap)?$/.test(name)) {
      rmSync(join(dist, name), { force: true })
      console.log(`  removed ${name} (old naming; installers are BIG-CMS-POS-Setup-x.y.z.exe)`)
    }
  }
}
console.log(`  building version ${version}${published ? ` (last released: ${published})` : ''}`)
