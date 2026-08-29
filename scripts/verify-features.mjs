// Keeps the feature registry and SECTION_ACCESS in step.
//
//   npm run verify:features
//
// The registry sat in app/lib/features.ts for months with nothing reading it,
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
// Parses the source rather than importing it, because both modules are
// TypeScript and this has to run under plain node in CI without a build step.

import { readFileSync } from 'node:fs'

const roles = readFileSync('app/lib/roles.ts', 'utf8')
const features = readFileSync('app/lib/features.ts', 'utf8')

// ── SECTION_ACCESS keys ───────────────────────────────────────────────────
// Bounded to the object literal itself. An earlier version of this scan took
// everything indented by two spaces from SECTION_ACCESS to end-of-file and
// picked up `role` and `allowed` — the parameters of hasSectionAccess() —
// reporting two orphan sections that do not exist.
const start = roles.indexOf('SECTION_ACCESS = {')
if (start === -1) {
  console.error('Could not find SECTION_ACCESS in app/lib/roles.ts.')
  process.exit(1)
}
let depth = 0, end = start
for (let i = roles.indexOf('{', start); i < roles.length; i++) {
  if (roles[i] === '{') depth++
  else if (roles[i] === '}') { depth--; if (depth === 0) { end = i; break } }
}
const literal = roles.slice(start, end)
const sections = [...literal.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s/gm)].map(m => m[1])

// ── Sections each feature claims ──────────────────────────────────────────
const claimed = new Map()   // section -> feature key
for (const m of features.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*\{([\s\S]*?)\n\s{2}\},/gm)) {
  const [, key, body] = m
  const list = body.match(/sections:\s*\[([^\]]*)\]/)
  if (!list) continue
  for (const s of list[1].matchAll(/'([^']+)'/g)) claimed.set(s[1], key)
}

const orphans = sections.filter(s => !claimed.has(s))
const ghosts = [...claimed.keys()].filter(s => !sections.includes(s))

console.log(`SECTION_ACCESS keys        ${String(sections.length).padStart(3)}`)
console.log(`  governed by a feature    ${String(sections.length - orphans.length).padStart(3)}`)
console.log(`  no feature owns them     ${String(orphans.length).padStart(3)}`)
console.log(`features claiming a section that does not exist  ${ghosts.length}\n`)

let failed = false

if (orphans.length) {
  failed = true
  console.error('Sections no feature governs — these pages cannot be switched off:')
  for (const s of orphans) console.error(`  ${s}`)
  console.error('\nAdd each to the `sections` list of the feature that owns it in')
  console.error('app/lib/features.ts, or add a feature for it.\n')
}

if (ghosts.length) {
  failed = true
  console.error('Features claiming sections that do not exist in SECTION_ACCESS:')
  for (const s of ghosts) console.error(`  ${s}  (claimed by ${claimed.get(s)})`)
  console.error('\nThese toggles govern nothing. Fix the name or drop the claim.\n')
}

if (failed) process.exit(1)
console.log('Registry and SECTION_ACCESS agree.')
