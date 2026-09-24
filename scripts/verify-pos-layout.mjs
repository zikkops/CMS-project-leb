// Assertions over what a branch's till shows — shared/src/posLayout.ts.
//
//   node scripts/verify-pos-layout.mjs
//   npm run verify:pos-layout
//
// This decides what a waiter can see, so the traps are about what happens when
// nobody has said anything:
//   - the stored list is what is HIDDEN, so a dish added tomorrow shows by
//     itself; a list of what to show would make every new dish invisible;
//   - hiding a category hides its dishes, which is the case it was asked for
//     ("we do not do desserts at that branch");
//   - a branch nobody has configured shows everything;
//   - it is per branch, so hiding at Main must not touch Second;
//   - a malformed stored value reads as "not hidden", never as hidden — a
//     broken field must not empty a till.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'pos-layout-verify-'))
execSync(
  `npx tsc shared/src/posLayout.ts --outDir ${out} --module esnext --target es2022 --skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}
const L = await import(`file://${join(out, 'posLayout.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(68)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}

// A small café menu: two categories, four dishes.
const cats = () => [
  { id: 'food', posHidden: undefined },
  { id: 'sweets', posHidden: undefined },
]
const items = () => [
  { id: 'salad', categoryId: 'food', posHidden: undefined },
  { id: 'sandwich', categoryId: 'food', posHidden: undefined },
  { id: 'cheesecake', categoryId: 'sweets', posHidden: undefined },
  { id: 'brownie', categoryId: 'sweets', posHidden: undefined },
]
const shownItems = (c, i, branch) => L.tillMenu(c, i, branch).items.map(x => x.id)
const shownCats = (c, i, branch) => L.tillMenu(c, i, branch).categories.map(x => x.id)

console.log('nothing configured')
{
  eq('THE TRAP: a branch nobody has set up shows the whole menu', shownItems(cats(), items(), 'Main'), ['salad', 'sandwich', 'cheesecake', 'brownie'])
  eq('...and every category', shownCats(cats(), items(), 'Main'), ['food', 'sweets'])
  eq('a dish with no posHidden at all is shown', L.hiddenOnTill(undefined, 'Main'), false)
}

console.log('\nhiding')
{
  const c = cats(); c[1].posHidden = { Main: true }
  eq('THE TRAP: hiding a category hides its dishes — the whole dessert menu', shownItems(c, items(), 'Main'), ['salad', 'sandwich'])
  eq('...and the category itself', shownCats(c, items(), 'Main'), ['food'])

  const i = items(); i[0].posHidden = { Main: true }
  eq('one dish hidden leaves the rest', shownItems(cats(), i, 'Main'), ['sandwich', 'cheesecake', 'brownie'])

  const orphan = [{ id: 'stray', categoryId: 'gone', posHidden: undefined }]
  eq('a dish whose category does not exist is left alone, not made to vanish', shownItems(cats(), orphan, 'Main'), ['stray'])
}

console.log('\nper branch')
{
  const c = cats(); c[1].posHidden = { Main: true }
  const i = items(); i[0].posHidden = { Main: true }
  eq('THE TRAP: hiding at Main changes nothing at Second',
    [shownItems(c, i, 'Main'), shownItems(c, i, 'Second')],
    [['sandwich'], ['salad', 'sandwich', 'cheesecake', 'brownie']])
  eq('a branch named in the map as false is not hidden', L.hiddenOnTill({ Main: false }, 'Main'), false)
}

console.log('\na stored value that makes no sense')
{
  eq('THE TRAP: rubbish reads as not hidden, so a broken field cannot empty a till',
    [null, 'yes', 42, [], ['Main'], { Main: 'true' }, { Main: 1 }, { '': true }].map(v => L.hiddenOnTill(v, 'Main')),
    [false, false, false, false, false, false, false, false])
  eq('only an exact true counts', L.readPosHidden({ Main: true, Second: 'true', Third: 1 }), { Main: true })
}

console.log('\nwhat the admin page reports')
{
  const c = cats(); c[1].posHidden = { Main: true }
  eq('the counts follow the hiding', L.layoutCounts(c, items(), 'Main'),
    { categoriesShown: 1, categoriesTotal: 2, itemsShown: 2, itemsTotal: 4, empty: false })
  const all = cats().map(x => ({ ...x, posHidden: { Main: true } }))
  eq('everything hidden is reported as empty, so the page can say so', L.layoutCounts(all, items(), 'Main').empty, true)
  eq('a café with no menu at all is not "empty" — there is nothing to hide', L.layoutCounts([], [], 'Main').empty, false)
}

console.log('\nwhat a save changes')
{
  const c = cats(); c[0].posHidden = { Main: true }
  eq('only what moved is written', L.layoutChanges(c, ['sweets'], 'Main'), { hide: ['sweets'], show: ['food'] })
  eq('an unchanged save writes nothing', L.layoutChanges(c, ['food'], 'Main'), { hide: [], show: [] })
  eq('THE TRAP: another branch\'s hiding is not undone by this branch\'s save',
    L.layoutChanges([{ id: 'food', posHidden: { Second: true } }], [], 'Main'), { hide: [], show: [] })
  eq('an id the menu does not have is ignored rather than written',
    L.layoutChanges(cats(), ['food', 'nonsense'], 'Main'), { hide: ['food'], show: [] })
}

rmSync(out, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
