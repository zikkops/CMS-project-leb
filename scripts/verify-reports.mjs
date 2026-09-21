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
  `npx tsc shared/src/salesReports.ts shared/src/timeClock.ts shared/src/waitlist.ts --outDir ${out} ` +
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

console.log('\nhourly sales, beside the same day last week (T3.4)')
{
  // Beirut is UTC+3 in September: 09:15 UTC is 12:15 at the café.
  const at = (day, utc) => `${day}T${utc}:00.000Z`
  const h = R.hourlySales([
    check({ id: 'a', closedAt: at('2026-09-12', '09:15'), lines: [line({ unitPrice: 4 })] }),
    check({ id: 'b', closedAt: at('2026-09-12', '09:50'), lines: [line({ unitPrice: 6 })] }),
    check({ id: 'c', closedAt: at('2026-09-12', '17:05'), lines: [line({ unitPrice: 20 })] }),
    check({ id: 'd', closedAt: at('2026-09-05', '09:30'), lines: [line({ unitPrice: 8 })] }),
    // 22:30 UTC on the 11th is 01:30 on the 12th in Beirut.
    check({ id: 'e', closedAt: at('2026-09-11', '22:30'), lines: [line({ unitPrice: 3 })] }),
    check({ id: 'f', closedAt: at('2026-09-12', '10:00'), status: 'refunded', lines: [line({ unitPrice: 5 })] }),
    check({ id: 'g', closedAt: at('2026-09-12', '10:00'), status: 'cancelled', receiptNumber: null, lines: [line({ unitPrice: 50 })] }),
  ], { timeZone: BEIRUT, day: '2026-09-12' })
  eq('the same day last week is seven days before', h.compareDay, '2026-09-05')
  eq('THE TRAP: 09:15 and 09:50 UTC are the café\'s 12:00 hour', [h.hours[12].checks, h.hours[12].net], [2, 10])
  eq('...and 17:05 UTC is its 20:00 hour', h.hours[20].net, 20)
  eq('THE TRAP: 22:30 UTC the night before is 01:30 on this café day', [h.hours[1].checks, h.hours[1].net], [1, 3])
  eq('last week sits beside it in the same hour', [h.hours[12].compareChecks, h.hours[12].compareNet], [1, 8])
  eq('a refunded check was still a sale that day; a cancelled one never was', h.hours[13].net, 5)
  eq('totals for both days', h.totals, { checks: 5, net: 38, compareChecks: 1, compareNet: 8 })
  eq('the busiest hour is by takings', h.peakHour, 20)
  eq('24 hours, always, so the chart has a place for each', h.hours.length, 24)
  eq('a day with nothing has no busiest hour', R.hourlySales([], { timeZone: BEIRUT, day: '2026-09-12' }).peakHour, null)
  eq('THE TRAP: across a month end, a week before 3 Mar is 24 Feb, not a guess', R.dayBefore('2026-03-03', 7), '2026-02-24')
}

console.log('\nthe timesheet (UPGRADE.md T3.12)')
{
  const TC = await import(`file://${join(out, 'timeClock.js')}`)
  const at = s => Date.parse(`2026-09-12T${s}:00.000Z`)
  const e = (uid, direction, s, name = uid) => ({ uid, name, branch: 'Main', direction, at: at(s) })
  const sheet = TC.timesheet([
    e('rana', 'in', '05:00'), e('rana', 'out', '13:30'),
    e('sam', 'out', '06:00'),
    e('sam', 'in', '07:00'), e('sam', 'in', '08:00'), e('sam', 'out', '12:00'),
    e('lea', 'in', '10:00'),
  ], { timeZone: BEIRUT, now: at('14:00') })
  eq('an in and the next out make a shift, in minutes', sheet.shifts.find(s => s.uid === 'rana').minutes, 510)
  eq('THE TRAP: a clock-out with no clock-in before it is listed apart, never paired with a guess', sheet.unmatched.map(x => x.uid), ['sam'])
  eq('a second clock-in leaves the first open and starts again', sheet.shifts.filter(s => s.uid === 'sam').map(s => s.minutes), [null, 240])
  eq('someone still in has an open shift', sheet.people.find(p => p.uid === 'lea').open, true)
  eq('hours by person, most first', sheet.people.map(p => [p.uid, p.minutes]), [['rana', 510], ['sam', 240], ['lea', 0]])
  eq('the shift belongs to the café day it started on', sheet.shifts.find(s => s.uid === 'rana').day, '2026-09-12')
  const long = TC.timesheet([e('x', 'in', '01:00'), e('x', 'out', '20:00')], { timeZone: BEIRUT, now: at('21:00') })
  eq('over 16 hours is flagged to check, not hidden', long.shifts[0].long, true)
  eq('which way the next clock goes', [TC.nextDirection(null), TC.nextDirection({ direction: 'in' }), TC.nextDirection({ direction: 'out' })], ['in', 'out', 'in'])
}

console.log('\nthe waitlist (UPGRADE.md T3.13)')
{
  const W = await import(`file://${join(out, 'waitlist.js')}`)
  eq('a party as typed', W.readWaitInput({ name: '  Rana   Khoury ', partySize: '4', quotedMinutes: '20', note: 'terrace' }), { name: 'Rana Khoury', partySize: 4, note: 'terrace', quotedMinutes: 20 })
  eq('nothing quoted is null, not zero', W.readWaitInput({ name: 'Sam', partySize: 2, quotedMinutes: '' }).quotedMinutes, null)
  eq('THE TRAP: no name, nobody, a crowd, or a quote that is not minutes is refused, in words',
    [{ name: '', partySize: 2 }, { name: 'A', partySize: 0 }, { name: 'A', partySize: 99 }, { name: 'A', partySize: 2, quotedMinutes: 2.5 }, { name: 'A', partySize: 2, quotedMinutes: 999 }].map(r => typeof W.readWaitInput(r)),
    ['string', 'string', 'string', 'string', 'string'])
  const m = 60_000
  const e = (id, over = {}) => ({ id, branch: 'Main', day: '2026-09-12', name: id, partySize: 2, note: '', quotedMinutes: 15, status: 'waiting', addedAt: 0, doneAt: null, ...over })
  const view = W.waitView([
    e('b', { addedAt: 5 * m }), e('a', { addedAt: 0 }),
    e('seated1', { status: 'seated', addedAt: 0, doneAt: 10 * m }), e('seated2', { status: 'seated', addedAt: 0, doneAt: 20 * m }),
    e('gone', { status: 'left', doneAt: 30 * m }), e('yesterday', { day: '2026-09-11' }),
  ], '2026-09-12')
  eq('waiting in the order they came, with their place', view.waiting.map(w => [w.id, w.place]), [['a', 1], ['b', 2]])
  eq('yesterday\'s queue is not today\'s', view.waiting.some(w => w.id === 'yesterday'), false)
  eq('seated or gone, the most recent first', view.done.map(d => d.id), ['gone', 'seated2', 'seated1'])
  eq('the average wait of those seated today', view.averageWait, 15)
  eq('past what they were told, only while still waiting', [W.overQuote(e('x'), 16 * m), W.overQuote(e('x'), 10 * m), W.overQuote(e('x', { status: 'seated', doneAt: 30 * m }), 40 * m), W.overQuote(e('x', { quotedMinutes: null }), 99 * m)],
    [true, false, false, false])
}

rmSync(out, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
