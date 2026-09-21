// Keeps the feature registry and SECTION_ACCESS in step.
//
//   npm run verify:features
//
// The registry sat in shared/src/features.ts for months with nothing reading it,
// and useRequireFeature() was described in its own header as enforcement
// layer 2 while not existing at all. Both are now wired. This is what stops
// them drifting apart again, because the failure mode is silent in both
// directions:
//
//   A section no feature claims is a page that can NEVER be switched off. It
//   simply ignores the switchboard, and nothing says so — a superadmin turns
//   the module off, the nav entry disappears, and the page still works.
//
//   A feature claiming a section that does not exist is the mirror image: a
//   toggle on the switchboard that governs nothing. It looks like it works.
//
// Since UPGRADE.md T4.2 each section names its feature where it is declared,
// in roles.ts's SECTIONS, so a section with no feature cannot compile. What is
// left to check is the other half: that every feature a section names is a
// real key of FEATURES (a typo is a section governed by a switch that does not
// exist, and so never switched off), and that every entry has a label.
//
// Parses the source rather than importing it, because both modules are
// TypeScript and this has to run under plain node in CI without a build step.

import { readFileSync } from 'node:fs'

const roles = readFileSync('shared/src/roles.ts', 'utf8')
const features = readFileSync('shared/src/features.ts', 'utf8')

function literalAfter(src, marker, file) {
  const start = src.indexOf(marker)
  if (start === -1) {
    console.error(`Could not find ${marker} in ${file}.`)
    process.exit(1)
  }
  let depth = 0, end = start
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  return src.slice(start, end)
}

// ── The sections, bounded to the SECTIONS literal itself ──────────────────
// Bounded because an earlier version of this scan ran to end-of-file and
// picked up the parameters of hasSectionAccess() as two orphan sections.
const sectionsLiteral = literalAfter(roles, 'export const SECTIONS = {', 'shared/src/roles.ts')
const keys = [...sectionsLiteral.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s/gm)].map(m => m[1])
const entries = [...sectionsLiteral.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s+\{[^\n]*?label: '([^']*)', feature: '([^']*)' \},/gm)]
  .map(m => ({ key: m[1], label: m[2], feature: m[3] }))

// ── The features, bounded to the FEATURES literal ─────────────────────────
const featuresLiteral = literalAfter(features, 'export const FEATURES = {', 'shared/src/features.ts')
const featureKeys = new Set([...featuresLiteral.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s/gm)].map(m => m[1]))

const unread = keys.filter(k => !entries.some(e => e.key === k))
const ghosts = entries.filter(e => !featureKeys.has(e.feature))
const unnamed = entries.filter(e => e.label.trim() === '')
const governing = new Set(entries.map(e => e.feature))

console.log(`sections                   ${String(keys.length).padStart(3)}`)
console.log(`  read as one entry        ${String(entries.length).padStart(3)}`)
console.log(`  naming no real feature   ${String(ghosts.length).padStart(3)}`)
console.log(`  without a label          ${String(unnamed.length).padStart(3)}`)
console.log(`features governing a section ${governing.size} of ${featureKeys.size}\n`)

let failed = false

if (keys.length === 0) {
  failed = true
  console.error('No sections found: the pattern no longer matches SECTIONS.\n')
}
if (unread.length) {
  failed = true
  console.error('Sections this check could not read (keep each on one line: roles, label, feature):')
  for (const k of unread) console.error(`  ${k}`)
  console.error('')
}
if (ghosts.length) {
  failed = true
  console.error('Sections governed by a feature that does not exist — these pages cannot be switched off:')
  for (const e of ghosts) console.error(`  ${e.key}  (names ${e.feature})`)
  console.error('\nName a key of FEATURES in shared/src/features.ts, or add a feature for it.\n')
}
if (unnamed.length) {
  failed = true
  console.error('Sections without a label (Manage Users would show the raw key):')
  for (const e of unnamed) console.error(`  ${e.key}`)
  console.error('')
}

if (failed) process.exit(1)
console.log('Registry and SECTION_ACCESS agree.')
