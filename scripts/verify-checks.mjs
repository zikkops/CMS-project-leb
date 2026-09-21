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
  `npx tsc shared/src/checks.ts shared/src/tickets.ts shared/src/money.ts shared/src/netErrors.ts shared/src/requestKey.ts shared/src/soldOut.ts --outDir ${out} --module esnext ` +
  `--target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' }
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const C = await import(`file://${join(out, 'checks.js')}`)
const T = await import(`file://${join(out, 'tickets.js')}`)
const SO = await import(`file://${join(out, 'soldOut.js')}`)
const M = await import(`file://${join(out, 'money.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}

const mod = (name, delta) => ({
  groupId: 'g', groupName: 'Size', optionId: 'o', optionName: name, priceDelta: delta,
})
const line = (over = {}) => ({
  id: 'l1', source: 'menu', refId: 'm1', name: 'Flat White',
  unitPrice: 4, modifiers: [], quantity: 1, seat: null, course: null,
  station: 'Bar', status: 'draft', note: '',
  addedBy: 'u', addedByEmail: 'u@x', sentAt: null,
  voidReason: null, voidReasonKey: null, voidWasWaste: null, ...over,
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

console.log('\nformatUsd — a price is a rendered thing, and half of one is a typo')
// The exact figures that were wrong on the menu, read off the screen: a
// coffee at 4.5 printed "$4.5" beside a salad at 9.25 printing "$9.25", so
// the column looked fine until you noticed the short one.
eq('one decimal place gets its second', M.formatUsd(4.5), '$4.50')
eq('a whole number gets both', M.formatUsd(11), '$11.00')
eq('and a small one', M.formatUsd(2), '$2.00')
eq('two decimals are left alone', M.formatUsd(9.25), '$9.25')
eq('zero is a price, not nothing', M.formatUsd(0), '$0.00')
// A third decimal cannot survive to the screen: a menu price that rounds at
// render time is a price nobody can reconcile against a till.
eq('a third decimal rounds', M.formatUsd(3.336), '$3.34')
// NOT half-up, and pinned so nobody assumes it is: 3.335 has no exact binary
// form and the nearest double sits just below it, so toFixed rounds DOWN.
// Fine for display — this is the last step before a screen — and precisely
// why it must never be the rounding in a total. That lives in money's own
// arithmetic, where a half cent is decided deliberately.
eq('a half cent is not reliably half-up', M.formatUsd(3.335), '$3.33')
// NaN reaches a price when a field is missing, and "$NaN" on a menu is worse
// than a wrong number because it cannot even be misread as one.
eq('NaN never reaches the page', M.formatUsd(Number.NaN), '$0.00')
eq('nor does Infinity', M.formatUsd(Number.POSITIVE_INFINITY), '$0.00')
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

console.log('\nstaff discounts — the rate comes from the station')
{
  const disc = { food: 0.7, drink: 0.5, appliedBy: 'u', appliedByEmail: 'u@x' }
  // Bar is a drink, Kitchen and Sweets are food. Nothing extra is stored on
  // the line to know which — the station already says what was bought.
  eq('Bar takes the drink rate', C.staffRateFor(line({ station: 'Bar' }), disc), 0.5)
  eq('Kitchen takes the food rate', C.staffRateFor(line({ station: 'Kitchen' }), disc), 0.7)
  eq('Sweets takes the food rate', C.staffRateFor(line({ station: 'Sweets' }), disc), 0.7)
  // A board game is bought stock with a real cost, not a plate of food.
  eq('merchandise takes nothing',
    C.staffRateFor(line({ source: 'product', station: null }), disc), 0)
  eq('no discount at all is zero', C.staffRateFor(line({ station: 'Bar' }), null), 0)
  // A section nobody mapped to a station gets no rate rather than a guess.
  eq('an unmapped station takes nothing', C.staffRateFor(line({ station: null }), disc), 0)

  eq('70% off $9.25 is $6.48 off',
    C.lineDiscount(line({ station: 'Kitchen', unitPrice: 9.25 }), disc), 6.48)
  eq('50% off a $3 drink is $1.50',
    C.lineDiscount(line({ station: 'Bar', unitPrice: 3 }), disc), 1.5)
  // A voided line is already zero, so there is nothing to take off it.
  eq('a voided line discounts nothing',
    C.lineDiscount(line({ station: 'Bar', unitPrice: 3, status: 'void' }), disc), 0)
}

console.log('\ncheckTotals — the discount is its own figure, not folded in')
{
  const disc = { food: 0.7, drink: 0.5, appliedBy: 'u', appliedByEmail: 'u@x' }
  const lines = [
    line({ id: 'a', station: 'Bar', unitPrice: 3 }),
    line({ id: 'b', station: 'Kitchen', unitPrice: 9.25 }),
    line({ id: 'c', source: 'product', station: null, unitPrice: 29 }),
  ]
  const plain = C.checkTotals({ lines, staffDiscount: null })
  eq('ordinary check: nothing off', plain.discount, 0)
  eq('ordinary check: gross is net', plain.gross === plain.net, true)

  const staff = C.checkTotals({ lines, staffDiscount: disc })
  eq('staff meal: gross unchanged', staff.gross, 41.25)
  eq('staff meal: 1.50 + 6.48 off', staff.discount, 7.98)
  eq('staff meal: net', staff.net, 33.27)
  // Returned separately so a staff meal is auditable rather than just smaller.
  eq('gross minus discount is net', +(staff.gross - staff.discount).toFixed(2), staff.net)
}

console.log('\ndiscounts — a manager\'s, each its own figure (slice 6)')
{
  const who = { reasonKey: 'complaint', note: '', by: 'm', byEmail: 'm@x' }
  const comp = { kind: 'comp', percent: 1, ...who }
  const half = { kind: 'percent', percent: 0.5, ...who }
  eq('a comped line costs nothing', C.lineTotal(line({ unitPrice: 9, discount: comp })), 0)
  eq('50% off one $9 item is $4.50', C.lineTotal(line({ unitPrice: 9, discount: half })), 4.5)
  eq('a voided line stays zero, discount or not',
     C.lineTotal(line({ unitPrice: 9, status: 'void', voidReason: 'x', discount: half })), 0)
  const staffDisc = { food: 0.7, drink: 0.5, appliedBy: 'u', appliedByEmail: 'u@x' }
  // $3 drink: the staff meal's 50% leaves $1.50, then the manager's 50% of
  // what is left — $0.75. The two can never add up to more than the line.
  eq('THE STACK: an item discount comes off what the staff meal left',
     C.lineTotal(line({ station: 'Bar', unitPrice: 3, discount: half }), staffDisc), 0.75)

  const lines = [
    line({ id: 'a', unitPrice: 10 }),
    line({ id: 'b', unitPrice: 6, discount: comp }),
    line({ id: 'c', unitPrice: 4, discount: half }),
  ]
  const t = C.checkTotals({ lines, staffDiscount: null, discount: { kind: 'percent', value: 0.1, ...who } })
  eq('gross is before every discount', t.gross, 20)
  eq('item discounts: the $6 comp and $2 off', t.itemDiscounts, 8)
  eq('subtotal after items', t.subtotal, 12)
  eq('10% off the check comes off the subtotal', t.checkDiscount, 1.2)
  eq('net is what is owed', t.net, 10.8)
  eq('THE SUM: every discount is accounted for',
     +(t.gross - t.discount - t.itemDiscounts - t.checkDiscount).toFixed(2), t.net)
  const big = C.checkTotals({ lines: [line({ unitPrice: 4 })], staffDiscount: null, discount: { kind: 'amount', value: 50, ...who } })
  eq('a fixed amount never takes a check below zero', [big.checkDiscount, big.net], [4, 0])
  eq('$5 off a $20 check',
     C.checkTotals({ lines: [line({ unitPrice: 20 })], staffDiscount: null, discount: { kind: 'amount', value: 5, ...who } }).net, 15)
  eq('a percentage over 100% is read as 100%, not a refund',
     C.checkDiscountAmount(10, { kind: 'percent', value: 3, ...who }), 10)
  eq('no discount: nothing off', C.checkDiscountAmount(10, null), 0)
  eq('an ordinary check: no discount figures at all',
     (({ itemDiscounts, checkDiscount }) => [itemDiscounts, checkDiscount])(C.checkTotals({ lines: [line()], staffDiscount: null })), [0, 0])
  eq('every reason has a key and a label', C.DISCOUNT_REASONS.every(r => r.key && r.label), true)
}

// ── The same order twice ───────────────────────────────────────────────────
// A Send whose reply is lost had an unknown outcome, and resending blind put
// the lines on the check twice — the kitchen cooked the order twice.
{
  const NE = await import(`file://${join(out, 'netErrors.js')}`)

  console.log('\nbatch keys — a retry of the same Send adds nothing')
  const uuid = '3f2c8a4e-9b1d-4e7a-8c2f-6d5e4a3b2c1d'
  eq('a randomUUID is a valid key', C.BATCH_KEY_PATTERN.test(uuid), true)
  eq('an empty key is not', C.BATCH_KEY_PATTERN.test(''), false)
  eq('punctuation is not', C.BATCH_KEY_PATTERN.test('<script>'), false)
  eq('an absurd length is not', C.BATCH_KEY_PATTERN.test('a'.repeat(65)), false)

  eq('a new batch is not applied', C.batchAlreadyApplied([{ batchKey: 'other-key-1' }], uuid), false)
  eq('THE BUG: the retry of a landed batch is recognised',
     C.batchAlreadyApplied([{}, { batchKey: uuid }, { batchKey: uuid }], uuid), true)
  eq('a null key is never deduplicated', C.batchAlreadyApplied([{}], null), false)
  eq('old lines with no key do not match anything', C.batchAlreadyApplied([{}, {}], uuid), false)

  console.log('\nreconcilePendingBatch — the live check settles an unsettled Send')
  eq('not there: absent', C.reconcilePendingBatch([{ status: 'sent' }], uuid), 'absent')
  eq('there, still unsent: landed',
     C.reconcilePendingBatch([{ batchKey: uuid, status: 'draft' }, { batchKey: uuid, status: 'sent' }], uuid), 'landed')
  eq('there, all fired: sent',
     C.reconcilePendingBatch([{ batchKey: uuid, status: 'sent' }, { batchKey: uuid, status: 'sent' }], uuid), 'sent')
  eq('a voided line in it does not hold it open',
     C.reconcilePendingBatch([{ batchKey: uuid, status: 'sent' }, { batchKey: uuid, status: 'void' }], uuid), 'sent')

  console.log('\nisNetworkFailure — "no answer" is not "the answer was no"')
  eq('Chrome, offline', NE.isNetworkFailure(new TypeError('Failed to fetch')), true)
  eq('Safari, offline', NE.isNetworkFailure(new TypeError('Load failed')), true)
  eq('Firefox, offline',
     NE.isNetworkFailure(new TypeError('NetworkError when attempting to fetch resource.')), true)
  eq('our own timeout', NE.isNetworkFailure({ name: 'AbortError', message: 'aborted' }), true)
  eq('a token refresh with no network', NE.isNetworkFailure({ code: 'auth/network-request-failed' }), true)
  eq('a NetworkError', NE.isNetworkFailure(new NE.NetworkError('x')), true)
  eq('a server refusal is not', NE.isNetworkFailure(new Error('That check is closed.')), false)
  // The one that matters most: a bug must never be reported as bad wifi.
  eq('a BUG that is a TypeError is not',
     NE.isNetworkFailure(new TypeError('Cannot read properties of undefined')), false)
  eq('nothing at all is not', NE.isNetworkFailure(undefined), false)

  // ── Admin submissions: a delivery, a sale, a transfer, a weekly order ─────
  const RK = await import(`file://${join(out, 'requestKey.js')}`)
  console.log('\nrequest keys — a retried Save is recognised, a real second sale is not swallowed')
  let nonces = 0
  const keys = RK.createRequestKeys(() => `nonce${++nonces}`)
  const sale = { customerName: 'A', branch: 'Main', lines: [{ productId: 'p1', quantity: 1 }] }
  const first = keys.keyFor('purchase', sale)
  eq('THE BUG: the retry after a lost reply gets the same key',
     keys.keyFor('purchase', sale), first)
  eq('an edited submission is a new one',
     keys.keyFor('purchase', { ...sale, customerName: 'B' }) !== first, true)
  keys.settled('purchase')
  // The failure the fix could cause, and must not: a café selling the same
  // item to the same name twice in a row is two sales.
  eq('after an answer, an identical sale is a NEW sale',
     keys.keyFor('purchase', sale) !== first, true)
  eq('kinds keep separate keys',
     keys.keyFor('delivery', sale).split('-')[0] !== keys.keyFor('purchase', sale).split('-')[0], true)
  // A wholesale order carries an invoice the browser draws just before it
  // posts. postOnce hashes the cart and notes, not the whole body, because a
  // redrawn invoice on a retry would otherwise read as a new order.
  const cart = { items: [{ productId: 'p1', quantity: 3 }], notes: '' }
  const wKey = keys.keyFor('wholesale-order', cart)
  eq('THE WHOLESALE BUG: keyed on the whole body, a redrawn invoice is a "new" order',
     keys.keyFor('wholesale-order', { ...cart, invoiceNumber: 'OB-2' }) !== keys.keyFor('wholesale-order', { ...cart, invoiceNumber: 'OB-1' }), true)
  eq('keyed on the cart, the retry with a redrawn invoice is the same order',
     keys.keyFor('wholesale-order', { items: cart.items, notes: cart.notes }), wKey)
  const realKey = `${'3f2c8a4e-9b1d-4e7a-8c2f-6d5e4a3b2c1d'}-${RK.stableHash(JSON.stringify(sale))}`
  eq('a real key is a valid document id', RK.REQUEST_KEY_PATTERN.test(realKey), true)
  eq('a slash could never reach a document path', RK.REQUEST_KEY_PATTERN.test('a/b/c/d/e/f/g/h'), false)
  eq('the hash is stable', RK.stableHash('abc'), RK.stableHash('abc'))
  eq('and changes with its input', RK.stableHash('abc') !== RK.stableHash('abd'), true)
}

console.log('\nvoid reasons — the reason decides the shelf')
{
  // The whole point: "changed his mind" leaves a sellable item, "damaged"
  // destroys one, and a till that treats them alike gets its stock wrong.
  eq('changed their mind returns it', C.voidReason('changed-mind').returnsToStock, true)
  eq('and is not waste', C.voidReason('changed-mind').isWaste, false)
  eq('rung up by mistake returns it', C.voidReason('rung-wrong').returnsToStock, true)
  eq('damaged does not return', C.voidReason('damaged').returnsToStock, false)
  eq('and is waste', C.voidReason('damaged').isWaste, true)
  eq('made wrong does not return', C.voidReason('made-wrong').returnsToStock, false)
  eq('sent back does not return', C.voidReason('sent-back').returnsToStock, false)

  // Guessing wrong here invents inventory that is not on the shelf, so the
  // catch-all deliberately does not.
  eq('Other does NOT return to stock', C.voidReason('other').returnsToStock, false)
  eq('an unknown key is undefined', C.voidReason('made-up'), undefined)

  // Every reason must answer both questions, or a line ends up half-classified.
  eq('every reason states both flags',
    C.VOID_REASONS.every(r => typeof r.returnsToStock === 'boolean' && typeof r.isWaste === 'boolean'),
    true)
  eq('every key is unique',
    new Set(C.VOID_REASONS.map(r => r.key)).size, C.VOID_REASONS.length)
  // Something that goes back on the shelf was not consumed, by definition.
  eq('nothing both returns and counts as waste',
    C.VOID_REASONS.some(r => r.returnsToStock && r.isWaste), false)
}

console.log('\nthe front picking up a ready plate')
{
  eq('a ready ticket is picked up', T.pickupOutcome('ready'), { kind: 'pick' })
  eq('already gone is not an error — two people reached for one plate', T.pickupOutcome('bumped'), { kind: 'already' })
  eq('THE TRAP: a ticket sent back to preparing is not cleared by a late tap', T.pickupOutcome('preparing').kind, 'refused')
  eq('nor one the kitchen has not started', T.pickupOutcome('new').kind, 'refused')
  eq('a cancelled ticket says why', T.pickupOutcome('cancelled'),
    { kind: 'refused', reason: 'That ticket was cancelled — every item on it was voided.' })
}

console.log('\nhold and fire (UPGRADE.md T3.11)')
{
  eq('a held ticket goes only to new (fired) or cancelled (every line voided)',
    [T.canTransition('held', 'new'), T.canTransition('held', 'cancelled'), T.canTransition('held', 'preparing'), T.canTransition('held', 'ready'), T.canTransition('held', 'bumped')],
    [true, true, false, false, false])
  eq('nothing goes back to held once it is on the pass', ['new', 'preparing', 'ready'].map(s => T.canTransition(s, 'held')), [false, false, false])
  eq('the kitchen screen asks for held tickets, so it can show them waiting', T.ACTIVE_TICKET_STATUSES.includes('held'), true)
  eq('THE TRAP: only stations this Send has are held, each once; nothing else is invented',
    T.heldStationsFor(['Kitchen', 'Sweets', 'Kitchen', 7, 'Pizza oven'], ['Bar', 'Kitchen']), ['Kitchen'])
  eq('holding nothing holds nothing', T.heldStationsFor([], ['Bar', 'Kitchen']), [])
}

console.log('\nthe service charge (UPGRADE.md T3.8)')
{
  const L = (over = {}) => ({ id: 'l1', source: 'menu', refId: 'm', name: 'Dish', unitPrice: 10, modifiers: [], quantity: 1, seat: null, course: null,
    station: 'Kitchen', status: 'sent', note: '', addedBy: 'u', addedByEmail: 'u', sentAt: 'x', voidReason: null, voidReasonKey: null, voidWasWaste: null, ...over })
  const plain = C.checkTotals({ lines: [L(), L({ id: 'l2', unitPrice: 10 })], staffDiscount: null, serviceCharge: { rate: 0.1 } })
  eq('10% service on $20 of food: $2.00, and the bill is $22.00', [plain.service, plain.net], [2, 22])
  const disc = C.checkTotals({ lines: [L(), L({ id: 'l2' })], staffDiscount: null, serviceCharge: { rate: 0.1 },
    discount: { kind: 'amount', value: 5, reasonKey: 'wait', note: '', by: 'm', byEmail: 'm' } })
  eq('THE ORDER: service is charged on what is left after every discount, never on the discount', [disc.checkDiscount, disc.service, disc.net], [5, 1.5, 16.5])
  eq('taken off, or never put on, there is none', [C.checkTotals({ lines: [L()], staffDiscount: null, serviceCharge: { rate: 0, removedBy: 'm' } }).service,
    C.checkTotals({ lines: [L()], staffDiscount: null }).service], [0, 0])
  eq('THE TRAP: a rate that is not a sensible fraction charges nothing: 10 (meaning ten percent), negative, over 30%, text',
    [10, -0.1, 0.5, 'x', Number.NaN].map(rate => C.serviceRate({ rate })), [0, 0, 0, 0, 0])
  eq('a voided line carries no service', C.checkTotals({ lines: [L(), L({ id: 'l2', status: 'void' })], staffDiscount: null, serviceCharge: { rate: 0.1 } }).service, 1)
}

console.log('\n86 from the till: sold out for the café day (UPGRADE.md T3.5)')
{
  // Beirut is UTC+3 in September.
  const at = utc => new Date(`2026-09-13T${utc}:00.000Z`)
  eq('THE TRAP: at 01:30 in the café zone it is still last night: a dish run out of at 22:00 stays out', SO.soldOutDay('Asia/Beirut', at('22:30')), '2026-09-13')
  eq('...at 04:30 there too', SO.soldOutDay('Asia/Beirut', at('01:30')), '2026-09-12')
  eq('...and from 05:00 it is a new day, back on the menu by itself', SO.soldOutDay('Asia/Beirut', at('02:30')), '2026-09-13')
  eq('the mark counts only at its own branch and on its own day',
    [SO.isSoldOut({ Main: '2026-09-13' }, 'Main', '2026-09-13'), SO.isSoldOut({ Main: '2026-09-13' }, 'Second', '2026-09-13'), SO.isSoldOut({ Main: '2026-09-12' }, 'Main', '2026-09-13')],
    [true, false, false])
  eq('anything that is not branch → day is read as nothing sold out', [SO.readSoldOut(null), SO.readSoldOut(['Main']), SO.readSoldOut({ Main: 7, Second: 'soon', Third: '2026-09-13' })],
    [{}, {}, { Third: '2026-09-13' }])
}

console.log('\nMoving items between checks (UPGRADE.md T5.6)')
{
  const a = { id: 'a', branch: 'Main', status: 'open', staffDiscount: null, payments: [], lines: [line({ id: 'l1' }), line({ id: 'l2', status: 'void' })] }
  const b = { id: 'b', branch: 'Main', status: 'open', staffDiscount: null }
  eq('an item moves to another open check', C.moveProblem(a, b, ['l1']), null)
  eq('not to the same check', typeof C.moveProblem(a, a, ['l1']), 'string')
  eq('not to a closed one', typeof C.moveProblem(a, { ...b, status: 'closed' }, ['l1']), 'string')
  eq('not across branches', typeof C.moveProblem(a, { ...b, branch: 'Other' }, ['l1']), 'string')
  eq('nothing moves off a check with a payment on it', /payment/.test(C.moveProblem({ ...a, payments: [{}] }, b, ['l1']) ?? ''), true)
  eq('not from a staff meal to an ordinary check', typeof C.moveProblem({ ...a, staffDiscount: { rate: 0.5 } }, b, ['l1']), 'string')
  eq('a voided item stays where it was voided', typeof C.moveProblem(a, b, ['l2']), 'string')
  eq('an item not on the check is refused', typeof C.moveProblem(a, b, ['nope']), 'string')
  eq('an item chosen twice is refused', typeof C.moveProblem(a, b, ['l1', 'l1']), 'string')
  eq('nothing chosen is refused', typeof C.moveProblem(a, b, []), 'string')
  eq('a move whose key is already on the other check is done', C.moveAlreadyApplied([{ movedKey: 'k-1' }], 'k-1'), true)
  eq('...a move without a key never is', C.moveAlreadyApplied([{ movedKey: 'k-1' }], null), false)
}

console.log('\nOrder types (UPGRADE.md T5.5)')
eq('a check from before order types is dine-in', C.orderTypeOf({}), 'dine-in')
eq('an unknown type is dine-in, never trusted', C.orderTypeOf({ orderType: 'drive-thru' }), 'dine-in')
eq('a table is called by its number', C.checkLabel({ tableNumber: 12 }), 'Table 12')
eq('a takeaway with a name', C.checkLabel({ orderType: 'takeaway', orderName: '  Rana  ', tableNumber: 0 }), 'Takeaway: Rana')
eq('a delivery with no name is just the type, never "Table 0"', C.checkLabel({ orderType: 'delivery', orderName: null, tableNumber: 0 }), 'Delivery')
eq('a tab', C.checkLabel({ orderType: 'tab', orderName: 'Sam', tableNumber: 0 }), 'Tab: Sam')
eq('a tab needs a name', typeof C.orderOpenProblem('tab', ''), 'string')
eq('a takeaway does not', C.orderOpenProblem('takeaway', ''), null)
eq('an unknown type is refused when opening', typeof C.orderOpenProblem('drive-thru', 'x'), 'string')
eq('a name is one short line', C.readOrderName('a\n\n   b' + 'x'.repeat(80)).length, C.ORDER_NAME_MAX)
eq('...with its spaces folded', C.readOrderName(' Rana \n Haddad '), 'Rana Haddad')
eq('a name that is not text is none', C.readOrderName(42), '')

console.log('\nWho may take food or money back (UPGRADE.md T5.1)')
eq('a barista voids a line never sent', C.reversalRefusal('barista', 'void-unsent'), null)
eq('a barista cannot void food already sent', typeof C.reversalRefusal('barista', 'void-sent'), 'string')
eq('nor can kitchen crew', typeof C.reversalRefusal('kitchen_crew', 'void-sent'), 'string')
eq('a manager voids food already sent', C.reversalRefusal('manager', 'void-sent'), null)
eq('an admin refunds', C.reversalRefusal('admin', 'refund'), null)
eq('a barista cannot refund', /refund/.test(C.reversalRefusal('barista', 'refund') ?? ''), true)
eq('no role at all cannot refund', typeof C.reversalRefusal(null, 'refund'), 'string')
eq('the void refusal says the food has gone to the kitchen', /kitchen/.test(C.reversalRefusal('retail', 'void-sent') ?? ''), true)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
