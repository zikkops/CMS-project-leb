// Assertions over the reports built from closed checks — shared/src/salesReports.ts.
//
//   node scripts/verify-reports.mjs
//   npm run verify:reports
//
// A report is read by the owner to decide something: who is voiding too much,
// what sells, when to put a second barista on. So the same traps as the
// accountant's export apply, and a few of their own:
//   - the day and the hour are the CAFÉ's, judged in its zone, never the host's;
//   - a voided line is worth what it was rung up at, although it adds nothing
//     to the bill (grossLineTotal() is 0 for it, on purpose);
//   - a discount is what it TOOK OFF, after the staff meal and before the
//     whole-check discount, exactly as checkTotals() stacks them;
//   - a void from before who-voided was recorded is "not recorded", never
//     somebody's name.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'reports-verify-'))
execSync(
  `npx tsc shared/src/salesReports.ts --outDir ${out} ` +
  `--module esnext --target es2022 --skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}
const R = await import(`file://${join(out, 'salesReports.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}

const BEIRUT = 'Asia/Beirut'
const OPTS = { timeZone: BEIRUT }

const line = (over = {}) => ({
  id: 'l1', source: 'menu', refId: 'm1', name: 'Flat White',
  unitPrice: 4, modifiers: [], quantity: 1, seat: null, course: null,
  station: 'Bar', status: 'sent', note: '',
  addedBy: 'u', addedByEmail: 'u@x', sentAt: '2026-09-12T19:00:00.000Z',
  voidReason: null, voidReasonKey: null, voidWasWaste: null, ...over,
})
const check = (over = {}) => ({
  id: 'c1', branch: 'Main', tableId: 't1', tableNumber: 4, status: 'closed',
  guestCount: 2, lines: [line()], openedBy: 'u', openedByEmail: 'u@x',
  closedAt: '2026-09-12T20:00:00.000Z', receiptNumber: '1041',
  staffDiscount: null, vatRate: 0.11, billRate: 89_500, ...over,
})
const voided = (over = {}) => line({
  id: 'v1', status: 'void', voidReason: 'Made wrong', voidReasonKey: 'made-wrong', voidWasWaste: true,
  voidedBy: 'u-rana', voidedByEmail: 'rana@cafe.test', ...over,
})

console.log('\nvoids — what was struck off, worth what it was rung up at')
{
  const r = R.voidDiscountReport([check({
    lines: [
      line(),
      voided({ unitPrice: 5, quantity: 2, modifiers: [{ groupId: 'g', optionId: 'o', name: 'Oat', priceDelta: 0.5 }] }),
      voided({ id: 'v2', name: 'Croissant', unitPrice: 3, voidReasonKey: 'changed-mind', voidReason: 'Customer changed their mind', voidWasWaste: false, sentAt: null, voidedByEmail: 'sam@cafe.test' }),
    ],
  })], OPTS)
  eq('two voids on one check', r.voids.length, 2)
  eq('THE TRAP: a void is worth its price with options × quantity, not the zero it adds to the bill', r.voids[0].value, 11)
  eq('the reason is the list\'s words', r.voids.map(v => v.reason), ['Made wrong', 'Customer changed their mind'])
  eq('waste and "after it was sent" come from the line', r.voids.map(v => [v.waste, v.afterSending]), [[true, true], [false, false]])
  eq('who voided it is named', r.voids.map(v => v.by), ['rana@cafe.test', 'sam@cafe.test'])
  eq('totals: count, value, and what of it was waste', r.totals, { voids: 2, voidValue: 14, wasteValue: 11, discounts: 0, discountValue: 0 })
  eq('by reason, the biggest first', r.voidsByReason.map(t => [t.label, t.count, t.value]), [['Made wrong', 1, 11], ['Customer changed their mind', 1, 3]])

  const old = R.voidDiscountReport([check({ lines: [voided({ voidedBy: undefined, voidedByEmail: undefined, voidReasonKey: null, voidReason: 'dropped it' })] })], OPTS)
  eq('THE TRAP: a void from before who-voided was recorded is "Not recorded", never a guess', old.voids[0].by, R.NOT_RECORDED)
  eq('...and one from before the reason list keeps the words it was given', old.voids[0].reason, 'dropped it')
  eq('an open check is left out: nothing on it is final yet', R.voidDiscountReport([check({ status: 'open', lines: [voided()] })], OPTS).voids.length, 0)
}

console.log('\ndiscounts — what each one took off, stacked as the bill stacks them')
{
  const comp = line({ id: 'd1', name: 'Cake', unitPrice: 6, discount: { kind: 'comp', percent: 1, reasonKey: 'complaint', note: '', by: 'm', byEmail: 'rana@cafe.test' } })
  const half = line({ id: 'd2', name: 'Latte', unitPrice: 5, discount: { kind: 'percent', percent: 0.5, reasonKey: 'regular', note: '', by: 'm', byEmail: 'rana@cafe.test' } })
  const r = R.voidDiscountReport([check({
    lines: [line(), comp, half],
    discount: { kind: 'percent', value: 0.1, reasonKey: 'wait', note: '', by: 'm', byEmail: 'sam@cafe.test' },
  })], OPTS)
  eq('a comp takes the whole item, a half takes half', r.discounts.filter(d => d.item).map(d => [d.item, d.kind, d.amount]), [['Cake', 'comp', 6], ['Latte', 'item-percent', 2.5]])
  eq('THE ORDER: 10% off the check is 10% of what the items left (4 + 0 + 2.50)', r.discounts.find(d => d.kind === 'check-percent').amount, 0.65)
  eq('discount reasons read as the list says', r.discountsByReason.map(t => t.label).sort(), ['Complaint — something went wrong', 'Long wait', 'Regular or friend of the house'])
  eq('by person', r.discountsByStaff.map(t => [t.label, t.count, t.value]), [['rana@cafe.test', 2, 8.5], ['sam@cafe.test', 1, 0.65]])

  const meal = R.voidDiscountReport([check({
    lines: [line({ station: 'Kitchen', unitPrice: 10 }), line({ id: 'l2', station: 'Bar', unitPrice: 4 })],
    staffDiscount: { food: 0.5, drink: 1, appliedBy: 'm', appliedByEmail: 'rana@cafe.test' },
  })], OPTS)
  eq('a staff meal is a discount too: half the food and all the drink', meal.discounts.map(d => [d.kind, d.amount, d.by]), [['staff-meal', 9, 'rana@cafe.test']])
  const both = R.voidDiscountReport([check({
    lines: [line({ station: 'Kitchen', unitPrice: 10, discount: { kind: 'percent', percent: 0.5, reasonKey: 'regular', note: '', by: 'm', byEmail: 'rana@cafe.test' } })],
    staffDiscount: { food: 0.5, drink: 0, appliedBy: 'm', appliedByEmail: 'rana@cafe.test' },
  })], OPTS)
  eq('THE ORDER: an item discount on a staff meal is taken from what the staff rate left, so the two never exceed the line',
    both.discounts.map(d => [d.kind, d.amount]).sort(), [['item-percent', 2.5], ['staff-meal', 5]])
  eq('an item discount on a voided line is not a discount: the void is the record', R.voidDiscountReport([check({
    lines: [voided({ discount: { kind: 'comp', percent: 1, reasonKey: 'complaint', note: '', by: 'm', byEmail: 'x' } })],
  })], OPTS).discounts.length, 0)
}

console.log('\nthe day is the café\'s')
{
  // 22:30 UTC is 01:30 the next day in Beirut.
  const r = R.voidDiscountReport([
    check({ id: 'a', closedAt: '2026-09-12T22:30:00.000Z', lines: [voided()] }),
    check({ id: 'b', closedAt: '2026-09-12T20:00:00.000Z', lines: [voided({ unitPrice: 2 })] }),
  ], OPTS)
  eq('THE TRAP: a void on a check closed after midnight belongs to the next café day', r.voids.map(v => v.day), ['2026-09-12', '2026-09-13'])
  eq('...and by day adds each day up apart', r.byDay.map(d => [d.day, d.voids, d.voidValue]), [['2026-09-12', 1, 2], ['2026-09-13', 1, 4]])
}

console.log('\nproduct mix — what sold, by item and by category (T3.3)')
{
  const categoryOf = { m1: 'Coffee', m2: 'Food' }
  const mix = R.productMix([
    check({ id: 'a', lines: [line({ quantity: 2 }), line({ id: 'l2', refId: 'm2', name: 'Toast', unitPrice: 6, station: 'Kitchen' })] }),
    check({ id: 'b', lines: [
      line({ name: 'Flat White (new name)' }),
      voided({ refId: 'm2', name: 'Toast', unitPrice: 6 }),
      line({ id: 'p1', source: 'product', refId: 'p-mug', name: 'Mug', unitPrice: 12, station: null }),
      line({ id: 'x1', refId: 'm-gone', name: 'Old Special', unitPrice: 3 }),
    ] }),
    check({ id: 'c', status: 'refunded', lines: [line({ quantity: 10 })] }),
    check({ id: 'd', status: 'cancelled', lines: [line({ quantity: 10 })] }),
  ], { categoryOf })
  const row = key => mix.items.find(i => i.key === key)
  eq('an item is counted across checks, three flat whites', row('menu:m1').quantity, 3)
  eq('...named as it was last sold', row('menu:m1').name, 'Flat White (new name)')
  eq('THE TRAP: a voided line is not a sale, and a refunded or cancelled check sold nothing', [row('menu:m2').quantity, mix.totals.checks], [1, 2])
  eq('a retail product is its own row, under Retail', [row('product:p-mug').category, row('product:p-mug').revenue], ['Retail', 12])
  eq('an item the menu no longer has still counts, and says so', row('menu:m-gone').category, R.OFF_MENU)
  eq('best sellers by revenue first', mix.items.map(i => i.key), ['menu:m1', 'product:p-mug', 'menu:m2', 'menu:m-gone'])
  eq('the shares add up to one', Math.round(mix.items.reduce((s, i) => s + i.share, 0) * 1000) / 1000, 1)
  eq('categories add their items up; the one no longer on the menu is its own', mix.categories.map(c => [c.category, c.quantity, c.revenue]), [['Coffee', 3, 12], ['Retail', 1, 12], ['Food', 1, 6], [R.OFF_MENU, 1, 3]])

  const discounted = R.productMix([check({
    lines: [line({ unitPrice: 10, discount: { kind: 'percent', percent: 0.5, reasonKey: 'regular', note: '', by: 'm', byEmail: 'x' } })],
    discount: { kind: 'amount', value: 2, reasonKey: 'wait', note: '', by: 'm', byEmail: 'x' },
  })], { categoryOf })
  eq('an item\'s revenue is after its own discount: $10 at half is $5', discounted.items[0].revenue, 5)
  eq('...and a whole-check discount belongs to no item, so it is shown apart', discounted.totals.checkDiscounts, 2)
  eq('nothing sold: nothing to share, and no division by zero', R.productMix([], { categoryOf }).totals, { checks: 0, quantity: 0, revenue: 0, checkDiscounts: 0 })
}

rmSync(out, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
