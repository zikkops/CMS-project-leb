// Assertions over the admin navigation — shared/src/adminNav.ts.
//
//   node scripts/verify-admin-nav.mjs
//   npm run verify:admin-nav
//
// The sidebar and the dashboard now read one list. What still lets them go
// wrong is a page that is not IN that list — which is how four admin pages
// ended up in neither, and how the two old lists drifted: a page was added,
// and the lists were somebody else's job. So this fails when:
//   - an admin page.tsx exists that the list does not name (or NOT_IN_NAV),
//   - an entry points at a page that does not exist,
//   - a section does not say what it is for, or an item what it does.
//
// Compiled into node_modules/.cache rather than the OS temp folder, because
// adminNav.ts imports FontAwesome's icons and Node resolves packages upward
// from the file — from a temp folder there is no node_modules to find.

import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'

const cache = join(process.cwd(), 'node_modules', '.cache')
mkdirSync(cache, { recursive: true })
const out = mkdtempSync(join(cache, 'admin-nav-verify-'))
execSync(
  `npx tsc shared/src/adminNav.ts --outDir ${out} --module esnext --target es2022 ` +
  `--skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}
const N = await import(`file://${join(out, 'adminNav.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}

const items = N.ADMIN_NAV.flatMap(s => s.items.map(i => ({ ...i, section: s.key })))
const hrefs = items.map(i => i.href)

console.log('\nevery section and item explains itself')
{
  eq('section keys are unique', new Set(N.ADMIN_NAV.map(s => s.key)).size, N.ADMIN_NAV.length)
  eq('every section says what it is for', N.ADMIN_NAV.filter(s => !(typeof s.purpose === 'string' && s.purpose.length >= 40)).map(s => s.key), [])
  eq('every section has an icon and a colour', N.ADMIN_NAV.filter(s => !s.icon?.iconName || !s.color).map(s => s.key), [])
  eq('every item says what the page does', items.filter(i => !(typeof i.desc === 'string' && i.desc.length >= 15)).map(i => i.href), [])
  eq('every item is daily use or setup', items.filter(i => i.kind !== 'use' && i.kind !== 'setup').map(i => i.href), [])
  eq('every item has an icon', items.filter(i => !i.icon?.iconName).map(i => i.href), [])
  eq('every item names who may open it', items.filter(i => !Array.isArray(i.access) || i.access.length === 0).map(i => i.href), [])
}

console.log('\nthe list and the pages agree')
{
  eq('no section is empty', N.ADMIN_NAV.filter(s => s.items.length === 0).map(s => s.key), [])
  eq('no page is listed twice', hrefs.filter((h, i) => hrefs.indexOf(h) !== i), [])

  const pageFor = href => join('admin', 'app', ...href.split('/').filter(Boolean), 'page.tsx')
  eq('THE TRAP: every entry points at a page that exists', hrefs.filter(h => !existsSync(pageFor(h))), [])

  const root = join('admin', 'app', 'admin')
  const pages = readdirSync(root, { recursive: true })
    .map(String)
    .filter(f => f === 'page.tsx' || f.endsWith(`${sep}page.tsx`))
    .map(f => '/admin' + (f === 'page.tsx' ? '' : '/' + f.slice(0, -(`${sep}page.tsx`.length)).split(sep).join('/')))
  const known = new Set([...hrefs, ...N.NOT_IN_NAV])
  eq('THE TRAP: every admin page is in the list, or deliberately not', pages.filter(p => !known.has(p)).sort(), [])
  eq('nothing in NOT_IN_NAV is also listed', N.NOT_IN_NAV.filter(p => hrefs.includes(p)), [])
  eq('nothing in NOT_IN_NAV has gone missing', N.NOT_IN_NAV.filter(p => !pages.includes(p)), [])
}

console.log('\nwhich guide a page shows')
{
  const at = p => { const r = N.sectionForPath(p); return r ? `${r.section.key}:${r.item.label}` : null }
  eq('a listed page is itself', at('/admin/menu/recipes'), 'menu:Recipes & Costing')
  eq('a detail page belongs to the page it is reached from', at('/admin/supplies/daily/history/2026-09-14'), 'stock:Daily Inventory History')
  eq('the longest match wins — a report is not the page above it', at('/admin/supplies/receiving/report'), 'stock:Food Cost Report')
  eq('a path that only starts with the same letters is not a match', at('/admin/menuX'), null)
  eq('the dashboard has no guide strip', at('/admin'), null)
}

console.log('\nwho sees which item (visibleNav, the sidebar and the dashboard alike)')
{
  const sees = (viewer, flags, href) => N.visibleNav(viewer, flags).some(s => s.items.some(i => i.href === href))
  const manager = { role: 'manager', sectionGrants: [], sectionRevocations: [] }
  eq('a manager sees End of Day', sees(manager, null, '/admin/end-of-day'), true)
  eq('THE TRAP: a section taken away from them is gone, on the dashboard too',
    sees({ ...manager, sectionRevocations: ['endOfDay'] }, null, '/admin/end-of-day'), false)
  eq('a retail hire granted the stock count sees it; without the grant, not',
    [sees({ role: 'retail', sectionGrants: ['dailyInventory'] }, null, '/admin/supplies/daily'), sees({ role: 'retail' }, null, '/admin/supplies/daily')],
    [true, false])
  eq('a switched-off module hides its pages; while the switches load, nothing is hidden',
    [sees(manager, { endOfDay: { enabled: false } }, '/admin/end-of-day'), sees(manager, {}, '/admin/end-of-day'), sees(manager, null, '/admin/end-of-day')],
    [false, true, true])
  eq('nobody signed in sees nothing', N.visibleNav({ role: null }, null).length, 0)
  eq('an admin-only page is for admins only', [sees({ role: 'admin' }, null, '/admin/errors'), sees(manager, null, '/admin/errors')], [true, false])
}

console.log('\nhow Manage Users groups the per-person grants (sectionGroups)')
{
  const R = await import(`file://${join(out, 'roles.js')}`)
  const groups = N.sectionGroups()
  const listed = groups.flatMap(g => g.keys)
  eq('every section is offered exactly once', [listed.length, new Set(listed).size, Object.keys(R.SECTION_ACCESS).length], [Object.keys(R.SECTION_ACCESS).length, Object.keys(R.SECTION_ACCESS).length, Object.keys(R.SECTION_ACCESS).length])
  eq('the groups follow the sidebar\'s order, and none is empty',
    groups.filter(g => g.title !== 'Other').map(g => g.title), N.ADMIN_NAV.map(s => s.title).filter(t => groups.some(g => g.title === t)))
  eq('a section sits under the nav section whose page it opens', groups.find(g => g.keys.includes('endOfDay'))?.title, N.ADMIN_NAV.find(s => s.items.some(i => i.href === '/admin/end-of-day'))?.title)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
