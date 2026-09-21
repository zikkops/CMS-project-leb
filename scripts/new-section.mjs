// Scaffolds a new section (UPGRADE.md T4.3).
//
//   npm run new:section -- <key> [options]
//
//     --label "Words"      what Manage Users and the page call it (default: from the key)
//     --roles a,b          who may use it (default: admin,manager)
//     --feature <key>      an existing module switch that governs it (default: a new
//                          one named after the section, off by default)
//     --nav <section>      the admin nav section it goes under (default: admin)
//     --kind use|setup     daily work or configuration done once (default: use)
//     --dry-run            say what would be written, write nothing
//
// It writes the steps docs/adding-a-section.md lists as enforced, in the shapes
// the verifiers check, and prints what is left by hand. Everything it writes
// is a stub to be filled in: a page that loads an empty list from a route that
// returns one, and a verifier with one real assertion to replace.
//
// It refuses a key already declared, a file that already exists, and anything
// it cannot place exactly, and it writes nothing until every edit has been
// worked out, so a refusal never leaves half a section behind.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const ROLES = ['admin', 'manager', 'social', 'retail', 'kitchen_crew', 'barista']

function fail(message) {
  console.error(`new:section: ${message}`)
  process.exit(1)
}

// ── Arguments ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const opts = { dryRun: false }
const positional = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--dry-run') opts.dryRun = true
  else if (a.startsWith('--')) {
    const value = args[++i]
    if (value === undefined) fail(`${a} needs a value`)
    opts[a.slice(2)] = value
  } else positional.push(a)
}
const key = positional[0]
if (!key) fail('name the section: npm run new:section -- <key>, for example stockTakes')
if (!/^[a-z][a-zA-Z0-9]{2,39}$/.test(key)) fail(`"${key}" is not a section key: camelCase letters and digits, starting lower case`)

const kebab = key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())
const Pascal = key[0].toUpperCase() + key.slice(1)
const label = opts.label ?? kebab.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
if (/['\\\n`]/.test(label)) fail('the label cannot contain quotes, backslashes or new lines')
const roles = (opts.roles ?? 'admin,manager').split(',').map(r => r.trim()).filter(Boolean)
for (const r of roles) if (!ROLES.includes(r)) fail(`"${r}" is not a role (${ROLES.join(', ')})`)
if (!roles.includes('admin')) fail('admin must be among the roles: an admin can open every section')
const kind = opts.kind ?? 'use'
if (kind !== 'use' && kind !== 'setup') fail('--kind is use or setup')
const navKey = opts.nav ?? 'admin'

// ── Read everything first ─────────────────────────────────────────────────
const P = {
  roles: 'shared/src/roles.ts',
  features: 'shared/src/features.ts',
  nav: 'shared/src/adminNav.ts',
  pkg: 'package.json',
  page: `admin/app/admin/${kebab}/page.tsx`,
  route: `admin/app/api/admin/${kebab}/route.ts`,
  rules: `shared/src/${key}.ts`,
  verifier: `scripts/verify-${kebab}.mjs`,
}
for (const f of [P.page, P.route, P.rules, P.verifier]) if (existsSync(f)) fail(`${f} already exists`)

const src = Object.fromEntries(['roles', 'features', 'nav', 'pkg'].map(k => [k, readFileSync(P[k], 'utf8')]))
const nl = s => (s.includes('\r\n') ? '\r\n' : '\n')

function literal(text, marker, file) {
  const start = text.indexOf(marker)
  if (start === -1) fail(`could not find ${marker} in ${file}`)
  let depth = 0
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return { start, end: i } }
  }
  fail(`${marker} in ${file} never closes`)
}
const topKeys = (text, { start, end }) =>
  new Set([...text.slice(start, end).matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s/gm)].map(m => m[1]))

// 1. The section, in SECTIONS.
const sections = literal(src.roles, 'export const SECTIONS = {', P.roles)
if (topKeys(src.roles, sections).has(key)) fail(`${key} is already a section in ${P.roles}`)
const featureBlock = literal(src.features, 'export const FEATURES = {', P.features)
const features = topKeys(src.features, featureBlock)
const feature = opts.feature ?? key
const newFeature = !features.has(feature)
if (opts.feature && newFeature) fail(`--feature ${feature} is not a key of FEATURES; leave it out to make a new one`)
if (!opts.feature && features.has(key)) fail(`a feature called ${key} exists already; pass --feature ${key} to use it`)

const rolesExpr = `[${roles.map(r => `'${r}'`).join(', ')}] as Role[]`
const sectionLine = `  ${key}: { roles: ${rolesExpr}, label: '${label}', feature: '${feature}' },`
const rolesOut = src.roles.slice(0, sections.end) + sectionLine + nl(src.roles) + src.roles.slice(sections.end)

// 2. The feature, when it is a new one: off by default, as every new module is.
let featuresOut = src.features
if (newFeature) {
  const n = nl(src.features)
  const entry = [
    `  // Scaffolded by new:section. Say here what switching it off takes away.`,
    `  ${key}: {`,
    `    label: '${label}', group: 'Operations', requires: [], defaultEnabled: false,`,
    `  },`,
    '',
  ].join(n)
  featuresOut = src.features.slice(0, featureBlock.end) + entry + src.features.slice(featureBlock.end)
}

// 3. The nav item, last in its section, with the section's own icon (already imported).
const navStart = src.nav.indexOf(`    key: '${navKey}',`)
if (navStart === -1) {
  const known = [...src.nav.matchAll(/^ {4}key: '([^']+)',/gm)].map(m => m[1])
  fail(`no admin nav section "${navKey}" (${known.join(', ')})`)
}
const icon = src.nav.slice(navStart).match(/^ {4}icon: (\w+),/m)?.[1]
if (!icon) fail(`could not read the icon of nav section ${navKey}`)
const itemsClose = src.nav.indexOf('\n    ],', navStart)
if (itemsClose === -1) fail(`could not find the end of nav section ${navKey}'s items`)
if (src.nav.includes(`href: '/admin/${kebab}'`)) fail(`/admin/${kebab} is in the navigation already`)
const navLine = `      { label: '${label}', href: '/admin/${kebab}', access: SECTION_ACCESS.${key}, icon: ${icon}, kind: '${kind}', desc: 'TODO: what this page does, in one line.' },`
const navOut = src.nav.slice(0, itemsClose) + nl(src.nav) + navLine + src.nav.slice(itemsClose)

// 4. The verifier script, beside the others; verify:all finds it by name.
const pkg = JSON.parse(src.pkg)
if (pkg.scripts[`verify:${kebab}`]) fail(`package.json already has verify:${kebab}`)
const anchor = '    "verify:all":'
if (!src.pkg.includes(anchor)) fail('could not find "verify:all" in package.json')
const pkgOut = src.pkg.replace(anchor, `    "verify:${kebab}": "node scripts/verify-${kebab}.mjs",${nl(src.pkg)}${anchor}`)

// ── The new files ─────────────────────────────────────────────────────────
const files = {}

files[P.rules] = `// ${label}: the rules, pure, with no Firestore and no browser in them, so
// scripts/verify-${kebab}.mjs can assert every one (npm run verify:${kebab}).
// The route and the page only apply what this decides.
//
// Scaffolded by new:section. Replace the example below with the real rules.

export interface ${Pascal}Input {
  name: string
}

/** What a request carries, cleaned, or the reason it is refused. */
export function read${Pascal}Input(body: Record<string, unknown>): ${Pascal}Input | string {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return 'Give it a name.'
  if (name.length > 80) return 'Keep the name under 80 characters.'
  return { name }
}
`

files[P.route] = `// ${label} (scaffolded by new:section).
//
// GET   the list
//
// Gated on the ${key} section, with the ${feature} switch on. A mutation added
// here logs through @big-cms/shared/server/activityLog, takes
// parseRequestId() when it creates something, and rolls back a partial write.

import { requireSection, toResponse, HttpError } from '@big-cms/shared/server/auth'
import { serverFeatureOn } from '@big-cms/shared/server/features'

export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store' }

async function switchedOn(): Promise<void> {
  if (!(await serverFeatureOn('${feature}'))) throw new HttpError(403, '${label} is switched off.')
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSection(request, '${key}')
    await switchedOn()
    return Response.json({ ok: true, items: [] as unknown[] }, { headers: noStore })
  } catch (err) {
    return toResponse(err)
  }
}
`

files[P.page] = `'use client'

// ${label} (scaffolded by new:section). The rules are in
// shared/src/${key}.ts; this page only shows what /api/admin/${kebab} answers.

import { useEffect, useState } from 'react'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { isNetworkFailure } from '@big-cms/shared/netErrors'
import { startLoad } from '@big-cms/shared/startLoad'
import { Page, PageHeader, Panel, Loading, EmptyState, ErrorLine } from '../../components/ui'

export default function ${Pascal}Page() {
  const { checking } = useRequireRole(SECTION_ACCESS.${key})
  const [items, setItems] = useState<unknown[] | null>(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      const answer = await unwrap(await authedFetch('/api/admin/${kebab}', 'GET')) as { items: unknown[] }
      setItems(answer.items)
      setError('')
    } catch (err) {
      setError(isNetworkFailure(err) ? 'No connection. Try again when the internet is back.' : err instanceof Error ? err.message : 'This could not be read.')
    }
  }

  useEffect(() => {
    if (checking) return
    startLoad(load)
  }, [checking])

  if (checking) return <Loading />
  return (
    <Page>
      <PageHeader title="${label}" lead="TODO: one or two sentences on what this page is for." />
      {error && <ErrorLine>{error}</ErrorLine>}
      <Panel>
        {items === null ? <Loading /> : items.length === 0 ? <EmptyState title="Nothing here yet." /> : null}
      </Panel>
    </Page>
  )
}
`

files[P.verifier] = `// Assertions over ${label}: shared/src/${key}.ts.
//
//   npm run verify:${kebab}
//
// Scaffolded by new:section. Say here what would go wrong, and for whom, if
// these rules were wrong; then replace the example cases with real ones.

import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), '${kebab}-verify-'))
execSync(
  \`npx tsc shared/src/${key}.ts --outDir \${out} --module esnext --target es2022 --skipLibCheck --moduleResolution bundler --strict\`,
  { stdio: 'pipe' },
)
const M = await import(\`file://\${join(out, '${key}.js')}\`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(\`  \${ok ? 'PASS' : 'FAIL'}  \${name.padEnd(64)} got=\${JSON.stringify(got)}\`)
  if (ok) pass++; else fail++
}

console.log('\\nReading a request')
eq('a name is taken, trimmed', M.read${Pascal}Input({ name: '  Main  ' }), { name: 'Main' })
eq('no name is refused', typeof M.read${Pascal}Input({}), 'string')

rmSync(out, { recursive: true, force: true })
console.log(\`\\n\${pass} passed, \${fail} failed\`)
if (fail) process.exit(1)
`

// ── Write, or say what would be written ───────────────────────────────────
const edits = [
  [P.roles, rolesOut, `SECTIONS gains ${key} (roles ${roles.join(', ')}, feature ${feature})`],
  ...(newFeature ? [[P.features, featuresOut, `FEATURES gains ${key}, off by default`]] : []),
  [P.nav, navOut, `the ${navKey} nav section gains "${label}" (${kind})`],
  [P.pkg, pkgOut, `package.json gains verify:${kebab}`],
]
for (const [file, , what] of edits) console.log(`${opts.dryRun ? 'would edit ' : 'edited     '} ${file.padEnd(34)} ${what}`)
for (const file of Object.keys(files)) console.log(`${opts.dryRun ? 'would write' : 'wrote      '} ${file}`)

if (!opts.dryRun) {
  for (const [file, text] of edits) writeFileSync(file, text)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
}

console.log(`
Left by hand (docs/adding-a-section.md):
  - Replace every TODO: the nav item's desc in ${P.nav}, the page's lead.${newFeature ? `
  - The new feature's comment, group and requires in ${P.features}. It is off:
    switch it on at /admin/settings/features to see the page.` : ''}
  - Firestore rules: usually \`allow write: if false\` and a scoped read. A helper
    uses can('${key}', [${roles.map(r => `'${r}'`).join(', ')}]), the same roles. Deploying rules is a
    separate, approved step (npm run rules:live compares).
  - A composite index in firestore.indexes.json, if it queries more than one field.
  - A till tile in pos/app/lib/posTiles.ts, if staff use it at the till.
  - Collections a café hub pulls or pushes: claim them in the feature's collections.
  - Then: npm run verify:all, and look at ${'/admin/' + kebab} signed in.`)
