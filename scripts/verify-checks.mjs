// Assertions over the check and ticket models in shared/src/{checks,tickets}.ts.
//
// Same shape as verify-delivery-math.mjs: no test runner in this repo yet, so
// this transpiles the real modules with the project's own TypeScript and
// asserts against them. Nothing is re-implemented.
//
//   node scripts/verify-checks.mjs
//
// Worth having because these are the rules a waiter hits at speed, on a phone,
// during a service. A modifier that prices wrong charges a customer wrong. A
// ticket transition that silently succeeds sends food out twice.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'checks-verify-'))
execSync(
  `npx tsc shared/src/checks.ts shared/src/tickets.ts shared/src/money.ts --outDir ${out} --module esnext ` +
  `--target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' }
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const C = await import(`file://${join(out, 'checks.js')}`)
const T = await import(`file://${join(out, 'tickets.js')}`)
const M = await import(`file://${join(out, 'money.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}

const mod = (name, delta) => ({
  groupId: 'g', groupName: 'Size', optionId: 'o', optionName: name, priceDelta: delta,
})
const line = (over = {}) => ({
  id: 'l1', source: 'menu', refId: 'm1', name: 'Flat White',
  unitPrice: 4, modifiers: [], quantity: 1, seat: null, course: null,
  station: 'Bar', status: 'draft', note: '',
  addedBy: 'u', addedByEmail: 'u@x', sentAt: null, voidReason: null, ...over,
})

console.log('\nlineTotal — modifiers are added, then multiplied')
eq('plain, qty 1', C.lineTotal(line()), 4)
eq('qty 3', C.lineTotal(line({ quantity: 3 })), 12)
eq('one modifier', C.lineTotal(line({ modifiers: [mod('Large', 1.5)] })), 5.5)
// The order matters: (4 + 1.5) x 2, not 4 x 2 + 1.5.
eq('modifier applies per unit', C.lineTotal(line({ modifiers: [mod('Large', 1.5)], quantity: 2 })), 11)
eq('two modifiers', C.lineTotal(line({ modifiers: [mod('Large', 1.5), mod('Shot', 0.75)] })), 6.25)
// A voided line must contribute nothing, or a struck-off item still gets paid for.
eq('voided line is zero', C.lineTotal(line({ status: 'void', voidReason: 'wrong table' })), 0)
// The UNIT price is rounded to cents before it is multiplied, and that is
// deliberate rather than sloppy: a line reads "3 x $3.67" on screen and on the
// receipt, so the number shown has to be the number multiplied. Rounding only
// at the end would give $11.00 against a line whose own arithmetic says
// $11.01, and a customer checking a receipt would be right to query it.
eq('unit price rounds before multiplying, so the receipt adds up',
  C.lineTotal(line({ unitPrice: 3.333, modifiers: [mod('x', 0.333)], quantity: 3 })), 11.01)

console.log('\norderedTotal')
eq('sums lines', C.orderedTotal([line(), line({ id: 'l2', unitPrice: 6 })]), 10)
eq('skips voids', C.orderedTotal([line(), line({ id: 'l2', unitPrice: 6, status: 'void' })]), 4)
eq('empty check', C.orderedTotal([]), 0)

console.log('\nstationForSection — the map the plan predicted')
eq('Food to Kitchen', C.stationForSection('Food'), 'Kitchen')
eq('Beverage to Bar', C.stationForSection('Beverage'), 'Bar')
eq('Sweets to Sweets', C.stationForSection('Sweets'), 'Sweets')
eq('unknown section has no station', C.stationForSection('Cocktails'), null)
eq('merchandise has no station', C.stationForSection(null), null)

console.log('\ndraftsByStation — one ticket per station per send')
{
  const lines = [
    line({ id: 'a', station: 'Bar' }),
    line({ id: 'b', station: 'Kitchen' }),
    line({ id: 'c', station: 'Bar' }),
    line({ id: 'd', station: 'Kitchen', status: 'sent' }),   // already gone
    line({ id: 'e', station: null, source: 'product' }),     // merchandise
  ]
  const grouped = C.draftsByStation(lines)
  eq('two stations', [...grouped.keys()].sort(), ['Bar', 'Kitchen'])
  eq('Bar has 2', grouped.get('Bar').length, 2)
  // Already-sent lines must not be re-fired; that is a double order.
  eq('Kitchen has 1 (sent one excluded)', grouped.get('Kitchen').length, 1)
  // Nobody cooks a board game.
  eq('merchandise is in no station', [...grouped.values()].flat().some(l => l.id === 'e'), false)
}

console.log('\nseats')
{
  const lines = [
    line({ id: 'a', seat: 2 }), line({ id: 'b', seat: 1 }),
    line({ id: 'c', seat: 2 }), line({ id: 'd', seat: null }),
    line({ id: 'e', seat: 3, status: 'void' }),
  ]
  eq('seats used, sorted, voids excluded', C.seatsUsed(lines), [1, 2])
  eq('lines for seat 2', C.linesForSeat(lines, 2).map(l => l.id), ['a', 'c'])
  eq('lines for the table itself', C.linesForSeat(lines, null).map(l => l.id), ['d'])
}

console.log('\ncanEditLine — a sent line is being cooked')
eq('draft is editable', C.canEditLine(line()), true)
eq('sent is not', C.canEditLine(line({ status: 'sent' })), false)
eq('void is not', C.canEditLine(line({ status: 'void' })), false)

console.log('\ncloseBlockedReason')
const check = (over = {}) => ({
  id: 'c1', branch: 'Main', tableId: 't', tableNumber: 4, status: 'open',
  guestCount: 2, lines: [], openedBy: 'u', openedByEmail: 'u@x', closedAt: null, ...over,
})
eq('empty open check closes', C.closeBlockedReason(check()), null)
eq('all sent closes', C.closeBlockedReason(check({ lines: [line({ status: 'sent' })] })), null)
eq('unsent line blocks',
  typeof C.closeBlockedReason(check({ lines: [line()] })), 'string')
eq('already closed', C.closeBlockedReason(check({ status: 'closed' })), 'That check is already closed.')

console.log('\nticket transitions — a hot kitchen, a touchscreen')
eq('new to preparing', T.canTransition('new', 'preparing'), true)
eq('preparing to ready', T.canTransition('preparing', 'ready'), true)
eq('ready to bumped', T.canTransition('ready', 'bumped'), true)
eq('preparing back to new (mis-tap)', T.canTransition('preparing', 'new'), true)
eq('ready back to preparing', T.canTransition('ready', 'preparing'), true)
// The one that matters: un-bumping fires the same food twice.
eq('bumped to anything is refused', T.canTransition('bumped', 'preparing'), false)
eq('bumped to ready is refused', T.canTransition('bumped', 'ready'), false)
eq('cancelled is terminal', T.canTransition('cancelled', 'new'), false)
eq('new straight to bumped is refused', T.canTransition('new', 'bumped'), false)
eq('refusal explains itself', typeof T.transitionError('bumped', 'ready'), 'string')
eq('allowed move has no error', T.transitionError('new', 'preparing'), null)

console.log('\nticket lines carry no prices')
{
  const tl = T.toTicketLines([line({ modifiers: [mod('Large', 1.5)], note: 'no sugar', seat: 2 })])
  eq('one line', tl.length, 1)
  eq('modifiers flattened to words', tl[0].modifiers, 'Large')
  eq('note carried', tl[0].note, 'no sugar')
  eq('seat carried', tl[0].seat, 2)
  eq('no price on a ticket', 'unitPrice' in tl[0] || 'price' in tl[0], false)
  eq('links back to the check line', tl[0].lineId, 'l1')
}

console.log('\nurgency')
eq('just fired', T.urgency(T.minutesWaiting(1000, 1000)), 'fresh')
eq('7 minutes', T.urgency(7), 'fresh')
eq('8 minutes', T.urgency(8), 'aging')
eq('15 minutes', T.urgency(15), 'late')
eq('minutes never negative', T.minutesWaiting(2000, 1000), 0)

console.log('\nmoney — the bill total rounds, the lines do not')
// $3.67 at 89,500 is 328,465 exactly; the bill asks for 328,500.
eq('rounds up to the nearest 100', M.roundLbpTotal(328465), 328500)
eq('rounds down to the nearest 100', M.roundLbpTotal(328420), 328400)
eq('exactly halfway goes up', M.roundLbpTotal(328450), 328500)
eq('already round is untouched', M.roundLbpTotal(328500), 328500)
eq('zero stays zero', M.roundLbpTotal(0), 0)
// The rule is 100, not 1 — rounding to the nearest unit would be no rule.
eq('does not round to the nearest 1', M.roundLbpTotal(328401), 328400)

console.log('\nbillTotals — both figures, and the adjustment shown')
{
  const b = M.billTotals(3.67, 89500)
  eq('usd stays exact', b.usd, 3.67)
  eq('lbp exact, unrounded', b.lbpExact, 328465)
  eq('lbp asked for', b.lbp, 328500)
  eq('rounding is a stated figure, not a drift', b.rounding, 35)
}
{
  // The reason the rule is on the total: rounding each line accumulates.
  const perLine = Array.from({ length: 10 }, () => M.roundLbpTotal(M.usdToLbp(3.67, 89500)))
    .reduce((a, b) => a + b, 0)
  const once = M.billTotals(36.7, 89500).lbp
  eq('per-line rounding disagrees with rounding once', perLine === once, false)
  // Ten lines each rounding up 35 is +350; the same money rounded once is
  // +50. The 300 LBP gap is exactly the drift the rule exists to prevent —
  // and on a receipt it is a total that does not equal the sum of its lines.
  eq('and drifts by 300 LBP over ten lines', perLine - once, 300)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
