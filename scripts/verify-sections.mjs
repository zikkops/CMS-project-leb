// Assertions that a section is wired up the same way everywhere it is named.
//
//   node scripts/verify-sections.mjs
//   npm run verify:sections
//
// A section's key and roles are declared in shared/src/roles.ts, and then named
// again by hand in several other places. Each of those used to be convention
// only, and one had already drifted: the Weekly Order Log page passed its own
// ['admin', 'manager'] instead of SECTION_ACCESS.weeklyOrders, so a grant or a
// revocation of that section did nothing there. So this fails when:
//   - a page's useRequireRole(...) passes a role array of its own rather than
//     SECTION_ACCESS.<key>, ADMIN_ONLY, ALL_ROLES or ['admin'] (useRequireRole
//     finds the section by reference, so a copy silently loses grants and the
//     module switch);
//   - a can('<key>', [...]) role list in firestore.rules differs from
//     SECTION_ACCESS.<key>, or names a key that does not exist;
//   - an admin nav item's access is neither a SECTION_ACCESS value (the same
//     array, not a copy) nor the admin-only list;
//   - a collection a café hub pulls or pushes is not claimed by any feature;
//   - an API route under admin/app/api or pos/app/api/pos has no caller check
//     (routes that are public on purpose are listed below, with the reason).

import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = process.cwd()
const cache = join(root, 'node_modules', '.cache')
mkdirSync(cache, { recursive: true })
const out = mkdtempSync(join(cache, 'sections-verify-'))
execSync(
  `npx tsc shared/src/adminNav.ts shared/src/features.ts shared/src/hubSync.ts shared/src/hubPush.ts ` +
  `--outDir ${out} --rootDir shared/src --module esnext --target es2022 --skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
const fixImports = dir => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { fixImports(p); continue }
    if (p.endsWith('.js')) writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
  }
}
fixImports(out)
const load = name => import(`file://${join(out, name)}`)
const R = await load('roles.js')
const N = await load('adminNav.js')
const F = await load('features.js')
const S = await load('hubSync.js')
const P = await load('hubPush.js')

let pass = 0, fail = 0
const check = (name, problems) => {
  const ok = problems.length === 0
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  for (const p of problems.slice(0, 12)) console.log(`        - ${p}`)
  if (problems.length > 12) console.log(`        … and ${problems.length - 12} more`)
  if (ok) pass++; else fail++
}

const walk = (dir, keep, found = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, keep, found)
    else if (keep(p)) found.push(p)
  }
  return found
}
const rel = p => relative(root, p).split(sep).join('/')
const SECTION_KEYS = Object.keys(R.SECTION_ACCESS)
const sameRoles = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

// ── 1. useRequireRole is handed the section itself ─────────────────────────
{
  // What a page may pass: the section by name, or one of the deliberate
  // not-a-section lists. Anything else is a copied array.
  const allowed = [/^SECTION_ACCESS\.(\w+)$/, /^ADMIN_ONLY$/, /^ALL_ROLES$/, /^\['admin'\](\s+as\s+Role\[\])?$/, /^$/]
  // Wrappers that pass on what THEIR caller handed them, unchanged.
  const PASS_THROUGH = { 'pos/app/lib/useTillAccess.ts': 'allowed, routes' }
  const problems = []
  const files = [...walk(join(root, 'admin', 'app'), p => /\.tsx?$/.test(p)), ...walk(join(root, 'pos', 'app'), p => /\.tsx?$/.test(p))]
  let calls = 0
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/useRequireRole\(([^)]*)\)/g)) {
      if (/^\s*(\/\/|\*)/.test(text.slice(text.lastIndexOf('\n', m.index) + 1, m.index))) continue
      calls++
      const arg = m[1].trim()
      if (PASS_THROUGH[rel(file)] === arg) continue
      const hit = allowed.find(re => re.test(arg))
      if (!hit) { problems.push(`${rel(file)}: useRequireRole(${arg}) — pass SECTION_ACCESS.<key> itself`); continue }
      const key = arg.match(/^SECTION_ACCESS\.(\w+)$/)?.[1]
      if (key && !SECTION_KEYS.includes(key)) problems.push(`${rel(file)}: SECTION_ACCESS.${key} does not exist`)
    }
  }
  check(`every page's useRequireRole passes a section, not a copy (${calls} calls)`, problems)
}

// ── 2. The rules' role lists match roles.ts ────────────────────────────────
{
  const rules = readFileSync(join(root, 'firestore.rules'), 'utf8')
  const problems = []
  let helpers = 0
  for (const m of rules.matchAll(/can\('(\w+)',\s*\[([^\]]*)\]\)/g)) {
    helpers++
    const [, key, list] = m
    const roles = [...list.matchAll(/'(\w+)'/g)].map(x => x[1])
    if (!SECTION_KEYS.includes(key)) { problems.push(`can('${key}') names a section roles.ts does not have`); continue }
    if (!sameRoles(roles, R.SECTION_ACCESS[key])) {
      problems.push(`can('${key}') allows [${roles.join(', ')}] but SECTION_ACCESS.${key} is [${R.SECTION_ACCESS[key].join(', ')}]`)
    }
  }
  check(`every can() role list in firestore.rules matches SECTION_ACCESS (${helpers} helpers)`, problems)
}

// ── 3. Nav access is the section's own array ───────────────────────────────
{
  const values = new Set(Object.values(R.SECTION_ACCESS))
  const problems = []
  let items = 0
  for (const section of N.ADMIN_NAV) {
    for (const item of section.items) {
      items++
      if (values.has(item.access)) continue
      if (sameRoles(item.access, ['admin'])) continue
      problems.push(`${item.href}: access is a copied array [${item.access.join(', ')}], not SECTION_ACCESS.<key>`)
    }
  }
  check(`every admin nav item's access is a section or admin-only (${items} items)`, problems)
}

// ── 4. What a hub moves belongs to a feature ───────────────────────────────
{
  const claimed = new Set(Object.values(F.FEATURES).flatMap(f => f.collections ?? []))
  const moved = new Set([...S.pullSpec('Main').map(s => s.collection), ...P.PUSHED_COLLECTIONS])
  const problems = [...moved].filter(c => !claimed.has(c)).map(c => `${c} is pulled or pushed by a hub but no feature in features.ts lists it in collections`)
  check(`every collection a hub pulls or pushes is claimed by a feature (${moved.size} collections)`, problems)
}

// ── 5. Every API route checks its caller ───────────────────────────────────
{
  // Public on purpose, each for a reason that is written down where it lives.
  const PUBLIC = {
    'admin/app/api/errors/route.ts': 'a broken page is often signed out; hostile input is handled in the route (CLAUDE.md, Error reporting)',
    'admin/app/api/auth/login-preflight/route.ts': 'rate-limits the sign-in form, before anybody is signed in',
  }
  const GUARD = /\b(requireSection|requireRole|requireStaff|requireSuperadmin|requireCaller|getCaller|verifyStaffToken)\(|CRON_SECRET/
  const routes = [
    ...walk(join(root, 'admin', 'app', 'api'), p => p.endsWith(`${sep}route.ts`)),
    ...walk(join(root, 'pos', 'app', 'api', 'pos'), p => p.endsWith(`${sep}route.ts`)),
  ]
  const problems = []
  for (const file of routes) {
    const r = rel(file)
    if (PUBLIC[r]) continue
    const text = readFileSync(file, 'utf8')
    // Each handler on its own: one guarded handler must not vouch for the
    // others, and an import naming the helper is not a call to it.
    const parts = text.split(/(?=export async function (?:GET|POST|PATCH|PUT|DELETE)\b)/).slice(1)
    for (const part of parts) {
      const method = part.match(/export async function (\w+)/)[1]
      if (!GUARD.test(part)) problems.push(`${r} ${method} has no caller check (requireSection / requireRole / requireStaff)`)
    }
  }
  check(`every admin and till API route checks its caller (${routes.length} routes)`, problems)
}

rmSync(out, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
