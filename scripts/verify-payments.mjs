// Assertions over the payment arithmetic in shared/src/payments.ts.
//
// Same shape as verify-receipt.mjs: transpile the real module with the
// project's own TypeScript and assert against it. Nothing is re-implemented.
//
//   node scripts/verify-payments.mjs
//
// This is money. A wrong "remaining" closes a check that is short or keeps a
// paid one open; wrong change is a drawer that will not count. Every case
// below is one a waiter will meet in a normal week.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'payments-verify-'))
execSync(
  `npx tsc shared/src/payments.ts shared/src/money.ts shared/src/businessSettings.ts shared/src/splits.ts shared/src/drawer.ts ` +
  `shared/src/memberCode.ts shared/src/loyaltyTiers.ts ` +
  `--outDir ${out} --module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' }
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const P = await import(`file://${join(out, 'payments.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(66)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}

const RATE = 89_500
const pay = (due, paid, req) => P.applyPayment(due, paid, RATE, req)
const applied = (...lbp) => lbp.map(appliedLbp => ({ appliedLbp }))
const cash = (currency, amount) => ({ tender: 'cash', currency, amount })
const card = (currency, amount) => ({ tender: 'card', currency, amount })

console.log('\nbalance — what is left, as the customer would be asked for it')
eq('nothing paid: $10.00 owed is 895,000 LBP', P.balance(10, [], RATE).remainingLbp, 895_000)
eq('nothing paid: remaining USD is the bill', P.balance(10, [], RATE).remainingUsd, 10)
eq('exact USD paid: settled', P.balance(10, applied(895_000), RATE).settled, true)
// $10.01 → 895,895 exact → the customer is asked for 895,900.
eq('lira bill rounds UP: asked 895,900', P.balance(10.01, [], RATE).remainingLbp, 895_900)
eq('paying the rounded-up figure settles it', P.balance(10.01, applied(895_900), RATE).settled, true)
// 895,849 exact → asked 895,800; paying that leaves 49, which rounds to nothing.
eq('lira bill rounds DOWN: paying the asked figure settles it',
   P.balance(895_849 / RATE, applied(895_800), RATE).settled, true)
eq('a cent short in USD is not settled', P.balance(10, applied(9.99 * RATE), RATE).settled, false)
eq('...and says one cent is left', P.balance(10, applied(9.99 * RATE), RATE).remainingUsd, 0.01)
eq('remaining USD never reads 10.01 for an exact 10.00 (float noise)',
   P.balance(10, [], RATE).remainingUsd, 10)

console.log('\ncash in USD — change in whole dollars, the rest in lira')
const r1 = pay(9.5, [], cash('USD', 20))
eq('$20 on $9.50: ok', r1.ok, true)
eq('...$10 back in dollars', r1.changeUsd, 10)
// 0.50 × 89,500 = 44,750 → the nearest note is 45,000.
eq('...and 45,000 LBP for the fifty cents', r1.changeLbp, 45_000)
eq('...the note rounding is recorded, not absorbed', r1.changeRounding, 250)
eq('...the bill takes only what it was owed', r1.appliedLbp, 9.5 * RATE)
const r2 = pay(10, [], cash('USD', 10))
eq('exact $10 on $10: no change at all', [r2.changeUsd, r2.changeLbp], [0, 0])
const r3 = pay(10, [], cash('USD', 5))
eq('$5 on $10: a partial payment, no change', [r3.ok, r3.changeUsd, r3.changeLbp], [true, 0, 0])
eq('...and $5 left', P.balance(10, applied(r3.appliedLbp), RATE).remainingUsd, 5)

console.log('\ncash in LBP — change in lira')
const r4 = pay(10.01, [], cash('LBP', 1_000_000))
eq('1,000,000 on a 895,900 bill: ok', r4.ok, true)
eq('...no dollars back', r4.changeUsd, 0)
// Over by 1,000,000 − 895,895 = 104,105 → the nearest note is 104,000.
eq('...104,000 LBP back', r4.changeLbp, 104_000)
eq('...rounding recorded as a negative', r4.changeRounding, -105)
eq('lira cash must be whole notes', pay(10, [], cash('LBP', 895_500)).ok, false)

console.log('\nsplit tender — several payments, one check')
const s1 = pay(20, [], cash('USD', 5))
const s2 = pay(20, applied(s1.appliedLbp), card('USD', 10))
const s3 = pay(20, applied(s1.appliedLbp, s2.appliedLbp), cash('LBP', 448_000))
eq('$5 cash, $10 card, then the rest in lira: each ok', [s1.ok, s2.ok, s3.ok], [true, true, true])
eq('...settled after the lira', P.balance(20, applied(s1.appliedLbp, s2.appliedLbp, s3.appliedLbp), RATE).settled, true)
// $5 left is 447,500; the customer handed 448,000, so 500 comes back — which
// rounds to the nearest note, 1,000.
eq('...the lira change is on the last payment only', [s3.changeUsd, s3.changeLbp], [0, 1_000])

console.log('\ncards — charged what is owed, never more')
eq('a card for the exact USD owed: ok', pay(10, [], card('USD', 10)).ok, true)
eq('a card for more than is owed: refused', pay(10, [], card('USD', 10.5)).ok, false)
eq('...and says how much it may be', pay(10, [], card('USD', 10.5)).reason,
   'A card is charged what is owed, never more — at most $10.00.')
eq('a card in LBP for the asked lira figure: ok', pay(10.01, [], card('LBP', 895_900)).ok, true)
eq('a card in LBP one hundred over: refused', pay(10.01, [], card('LBP', 896_000)).ok, false)
eq('a card never gives change', pay(10, [], card('USD', 4)).changeUsd, 0)
eq('a card in LBP may be any whole lira', pay(10, [], card('LBP', 123_456)).ok, true)

console.log('\nrefusals — before any arithmetic')
eq('nothing left to pay: refused', pay(10, applied(895_000), cash('USD', 1)).reason,
   'Nothing is left to pay on this check.')
eq('zero: refused', pay(10, [], cash('USD', 0)).ok, false)
eq('negative: refused', pay(10, [], cash('USD', -5)).ok, false)
eq('NaN: refused', pay(10, [], cash('USD', NaN)).ok, false)
eq('a fraction of a cent: refused', pay(10, [], cash('USD', 1.005)).ok, false)
eq('fractional lira: refused', pay(10, [], card('LBP', 1000.5)).ok, false)
eq('an absurd amount: refused', pay(10, [], cash('USD', 1_000_000)).ok, false)
eq('an unknown tender: refused', pay(10, [], { tender: 'cheque', currency: 'USD', amount: 5 }).ok, false)
eq('no exchange rate: refused', P.applyPayment(10, [], 0, cash('USD', 5)).ok, false)

console.log('\nkeys — a resent payment is recognised')
eq('a key already on the check is applied', P.paymentAlreadyApplied([{ key: 'k-12345678' }], 'k-12345678'), true)
eq('a new key is not', P.paymentAlreadyApplied([{ key: 'k-12345678' }], 'k-87654321'), false)
eq('a null key is never deduplicated', P.paymentAlreadyApplied([{ key: 'k-12345678' }], null), false)
eq('a uuid is a valid key', P.PAYMENT_KEY_PATTERN.test('3f2c8a4e-9b1d-4e7a-8c2f-6d5e4a3b2c1d'), true)
eq('a slash is not', P.PAYMENT_KEY_PATTERN.test('a/b/c/d/e/f/g/h'), false)

// ── Slice 2: VAT ───────────────────────────────────────────────────────────
const B = await import(`file://${join(out, 'businessSettings.js')}`)
const M = await import(`file://${join(out, 'money.js')}`)

console.log('\nVAT — included in the price, and in force from a day')
// 10% rather than the café's own rate: the branding audit rightly flags any
// literal of the configured rate, and a fixture is no exception to that.
eq('$10.00 at 10% carries $0.91 of VAT, not $1.00', M.vatIncluded(10, 0.1), 0.91)
eq('zero-rated carries none', M.vatIncluded(10, 0), 0)
const sched = { vatRate: 0.1, vatNext: { rate: 0.12, from: '2027-01-01' } }
eq('the day before the change: 10%', B.vatRateOn(sched, '2026-12-31'), 0.1)
eq('THE DAY the change starts: 12%', B.vatRateOn(sched, '2027-01-01'), 0.12)
eq('after it: 12%', B.vatRateOn(sched, '2027-06-01'), 0.12)
eq('nothing scheduled: the current rate', B.vatRateOn({ vatRate: 0.1, vatNext: null }, '2030-01-01'), 0.1)
eq('a scheduled change is read back as stored', B.readVatNext({ rate: 0.12, from: '2027-01-01' }),
   { rate: 0.12, from: '2027-01-01' })
eq('30 February is not a date', B.readVatNext({ rate: 0.12, from: '2027-02-30' }), null)
eq('a rate out of bounds is ignored, not billed', B.readVatNext({ rate: 12, from: '2027-01-01' }), null)
eq('a missing rate is ignored, not read as 0%', B.readVatNext({ from: '2027-01-01' }), null)
eq('an empty-string rate is ignored, not read as 0%', B.readVatNext({ rate: '', from: '2027-01-01' }), null)
eq('garbage is ignored', B.readVatNext('12% soon'), null)
eq('a stored document without one parses to null', B.parseSettings({ vatRate: 0.1 }).vatNext, null)

// ── Slice 3: splitting the bill ────────────────────────────────────────────
const S = await import(`file://${join(out, 'splits.js')}`)
const C = await import(`file://${join(out, 'checks.js')}`)
const sum = xs => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100

console.log('\nsplit evenly — to the cent, adding up to the bill')
eq('$10.00 three ways: 3.34 + 3.33 + 3.33', S.splitEvenly(10, 3), [3.34, 3.33, 3.33])
eq('...adds up to exactly $10.00', sum(S.splitEvenly(10, 3)), 10)
eq('$0.05 four ways leaves nobody a negative share', S.splitEvenly(0.05, 4), [0.02, 0.01, 0.01, 0.01])
eq('one way is the whole bill', S.splitEvenly(12.34, 1), [12.34])
eq('zero ways is no split', S.splitEvenly(10, 0), [])
eq('a fractional count is whole people', S.splitEvenly(10, 2.9), [5, 5])

const ln = (over = {}) => ({
  id: 'l1', source: 'menu', refId: 'm1', name: 'Item', unitPrice: 4, modifiers: [],
  quantity: 1, seat: null, course: null, station: 'Bar', status: 'sent', note: '',
  addedBy: 'u', addedByEmail: 'u@x', sentAt: null,
  voidReason: null, voidReasonKey: null, voidWasWaste: null, ...over,
})
const table = {
  staffDiscount: null,
  lines: [
    ln({ id: 'a', seat: 1, unitPrice: 4 }),
    ln({ id: 'b', seat: 2, unitPrice: 6, quantity: 2 }),
    ln({ id: 'c', seat: null, unitPrice: 5, station: 'Kitchen' }),
    ln({ id: 'd', seat: 1, unitPrice: 100, status: 'void' }),
  ],
}
console.log('\nsplit by seat — what each seat ordered')
const seats = S.sharesBySeat(table)
eq('seat 1: $4, the voided $100 not counted', seats.find(s => s.seat === 1).usd, 4)
eq('seat 2: two at $6', seats.find(s => s.seat === 2).usd, 12)
eq('unseated lines are the table\'s, not divided', seats.find(s => s.seat === null).usd, 5)
eq('THE SUM of the seat shares is the bill', sum(seats.map(s => s.usd)), C.checkTotals(table).net)
const staffTable = { ...table, staffDiscount: { food: 0.7, drink: 0.5, appliedBy: 'm', appliedByEmail: 'm@x' } }
eq('a staff meal is discounted seat by seat too, and still adds up',
   sum(S.sharesBySeat(staffTable).map(s => s.usd)), C.checkTotals(staffTable).net)
eq('no seats used: only the table share', S.sharesBySeat({ staffDiscount: null, lines: [ln()] }).map(s => s.seat), [null])

console.log('\nsplit by item — what the chosen lines come to')
eq('seat 1 and the shared plate', S.shareForLines(table, ['a', 'c']), 9)
eq('a voided line counts for nothing', S.shareForLines(table, ['d']), 0)
eq('an unknown line counts for nothing', S.shareForLines(table, ['zzz']), 0)

console.log('\nfill — a share becomes the amount to enter, capped at what is owed')
const owed10 = P.balance(10, [], RATE)
eq('a $5 share in dollars is $5', P.fillAmount(5, owed10, { tender: 'cash', currency: 'USD' }, RATE), 5)
eq('a share bigger than what is left is capped at what is left',
   P.fillAmount(12, owed10, { tender: 'card', currency: 'USD' }, RATE), 10)
eq('a $5 share on a card in lira: 447,500', P.fillAmount(5, owed10, { tender: 'card', currency: 'LBP' }, RATE), 447_500)
eq('a $5 share in lira cash rounds up to a note: 448,000',
   P.fillAmount(5, owed10, { tender: 'cash', currency: 'LBP' }, RATE), 448_000)
eq('nothing to fill on a settled check', P.fillAmount(5, P.balance(10, applied(895_000), RATE),
   { tender: 'cash', currency: 'USD' }, RATE), 0)
const fill = P.fillAmount(S.splitEvenly(10, 3)[0], owed10, { tender: 'card', currency: 'USD' }, RATE)
eq('an even share filled on a card is accepted by applyPayment', pay(10, [], card('USD', fill)).ok, true)

console.log('\nsplit with a whole-check discount — still sums to the bill (slice 6)')
const mgr = { reasonKey: 'regular', note: '', by: 'm', byEmail: 'm@x' }
const discTable = { ...table, discount: { kind: 'percent', value: 0.1, ...mgr } }
const dSeats = S.sharesBySeat(discTable)
eq('THE SUM of the seat shares is the discounted bill', sum(dSeats.map(s => s.usd)), C.checkTotals(discTable).net)
eq('each seat carries its share of it: seat 2\'s $12 is $10.80', dSeats.find(s => s.seat === 2).usd, 10.8)
eq('by item, the chosen lines carry the same proportion: $4 is $3.60', S.shareForLines(discTable, ['a']), 3.6)
const oddTable = {
  staffDiscount: null, discount: { kind: 'amount', value: 1, ...mgr },
  lines: [ln({ id: 'x', seat: 1, unitPrice: 1 }), ln({ id: 'y', seat: 2, unitPrice: 1 }), ln({ id: 'z', seat: 3, unitPrice: 1 })],
}
eq('$1 off three $1 seats still sums to exactly $2.00', sum(S.sharesBySeat(oddTable).map(s => s.usd)), 2)

console.log('\nsplit between any number of people, item by item (14 Sep 2026)')
// The table: a $4 item, two $6 items on one line, a $5 plate, a voided $100.
const people3 = S.sharesByPerson(table, 3, { a: [1], b: [2, 3] })
eq('person 1: the $4 item and a third of the shared $5 plate', people3[0].usd, 5.67)
eq('persons 2 and 3 split the $12 line and the rest of the plate, odd cent first', [people3[1].usd, people3[2].usd], [7.67, 7.66])
eq('THE SUM of the people is the bill', sum(people3.map(p => p.usd)), C.checkTotals(table).net)
eq('each person lists what they pay towards', people3[0].lineIds, ['a', 'c'])
eq('nobody tapped for anything: an even split', S.sharesByPerson(table, 2, {}).map(p => p.usd), [10.5, 10.5])
eq('the voided line is nobody\'s, even when tapped', S.sharesByPerson(table, 1, { d: [1] })[0].usd, 21)
eq('someone outside the party is ignored, and the line is shared', S.sharesByPerson(table, 2, { a: [5] }).map(p => p.usd), [10.5, 10.5])
eq('the same person tapped twice counts once', S.sharesByPerson(table, 2, { a: [1, 1] })[0].usd, S.sharesByPerson(table, 2, { a: [1] })[0].usd)
eq('THE SUM with a whole-check discount is the discounted bill',
   sum(S.sharesByPerson(discTable, 3, { a: [1], b: [2] }).map(p => p.usd)), C.checkTotals(discTable).net)
eq('$1 off three $1 items, one each: exactly $2.00 between three people',
   sum(S.sharesByPerson(oddTable, 3, { x: [1], y: [2], z: [3] }).map(p => p.usd)), 2)
eq('twelve people, nothing tapped: still sums to the bill', sum(S.sharesByPerson(table, 12, {}).map(p => p.usd)), C.checkTotals(table).net)
eq('zero people is no split', S.sharesByPerson(table, 0, {}), [])
eq('more than forty is not a split', S.sharesByPerson(table, 41, {}), [])

// ── Slice 4: the branch drawer ─────────────────────────────────────────────
const D = await import(`file://${join(out, 'drawer.js')}`)
const float = { usd: 50, lbp: 200_000 }
const shiftPays = [
  { tender: 'cash', currency: 'USD', amount: 20, changeUsd: 10, changeLbp: 45_000 },
  { tender: 'card', currency: 'USD', amount: 15, changeUsd: 0, changeLbp: 0 },
  { tender: 'cash', currency: 'LBP', amount: 1_000_000, changeUsd: 0, changeLbp: 104_000 },
]

console.log('\nthe drawer — what should be in it')
const dt = D.drawerTotals(float, shiftPays)
eq('cash in: $20 and 1,000,000 LBP', dt.cashIn, { usd: 20, lbp: 1_000_000 })
eq('change out: $10 and 149,000 LBP', dt.change, { usd: 10, lbp: 149_000 })
eq('expected USD: 50 + 20 − 10', dt.expected.usd, 60)
eq('expected LBP: 200,000 + 1,000,000 − 149,000', dt.expected.lbp, 1_051_000)
eq('THE CARD is in the report, not the drawer', [dt.card.usd, dt.expected.usd], [15, 60])
eq('an empty shift expects exactly its float', D.drawerTotals(float, []).expected, float)

console.log('\nrefunds — the drawer goes back to where it was')
const ref = D.refundOf([shiftPays[0]])
eq('refunding $20 paid, $10 + 45,000 back: $10 out', ref.cash.usd, 10)
eq('...and the 45,000 LBP change comes back in (negative out)', ref.cash.lbp, -45_000)
eq('a card refund goes on the card, not out of the drawer', D.refundOf([shiftPays[1]]), { cash: { usd: 0, lbp: 0 }, card: { usd: 15, lbp: 0 } })
eq('sale then refund in one shift: the drawer is back to its float',
   D.drawerTotals(float, [shiftPays[0]], [ref]).expected, float)

console.log('\nthe count — per currency, never netted')
eq('2 × $20 + 1 × $10 = $50', D.countedCash({}, { '20': 2, '10': 1 }).usd, 50)
eq('2 × 100,000 LBP = 200,000', D.countedCash({ '100000': 2 }, {}).lbp, 200_000)
eq('a negative or fractional count is not money', D.countedCash({ '1000': -3 }, { '1': 1.5 }), { usd: 0, lbp: 0 })
eq('a note that does not exist is not counted', D.countedCash({ '250': 4 }, { '3': 2 }), { usd: 0, lbp: 0 })
const diff = D.drawerDifference({ usd: 60, lbp: 1_051_000 }, { usd: 40, lbp: 2_841_000 })
eq('THE BUG this prevents: $20 short is still $20 short', diff.usd, -20)
eq('...even when the lira are over by the same value', diff.lbp, 1_790_000)
eq('the note lists are the end-of-day ones', [D.USD_DENOMS.length, D.LBP_DENOMS.at(-1)], [6, 1000])

console.log('\nEnd of Day — the day\'s drawers as the "system" figure')
const day = D.daySystem([
  { expected: { usd: 60, lbp: 1_051_000 }, open: false },
  { expected: { usd: 50, lbp: 200_000 }, open: true },
], 89_500)
eq('two shifts: $110 and 1,251,000 LBP should be in the drawers', day.expected, { usd: 110, lbp: 1_251_000 })
eq('...which is 11,096,000 LBP at 89,500', day.systemLbp, 11_096_000)
eq('...and it says one shift is still open', [day.shifts, day.open], [2, 1])
eq('THE FLOAT is in it (the count includes the float): an empty shift is its float',
   D.daySystem([{ expected: D.drawerTotals(float, []).expected, open: false }], 89_500).systemLbp,
   50 * 89_500 + 200_000)
eq('THE CARD is not in it: a card-only shift adds nothing beyond its float',
   D.daySystem([{ expected: D.drawerTotals({ usd: 0, lbp: 0 }, [shiftPays[1]]).expected, open: false }], 89_500).systemLbp, 0)
eq('no shifts: nothing from the POS', D.daySystem([], 89_500), { shifts: 0, open: 0, expected: { usd: 0, lbp: 0 }, systemLbp: 0 })

console.log('\nthe float — refused before any shift opens')
eq('a normal float: fine', D.floatProblem({ usd: 50, lbp: 200_000 }), null)
eq('no float at all: fine', D.floatProblem({ usd: 0, lbp: 0 }), null)
eq('negative: refused', typeof D.floatProblem({ usd: -1, lbp: 0 }), 'string')
eq('fractional lira: refused', typeof D.floatProblem({ usd: 0, lbp: 1000.5 }), 'string')
eq('a fraction of a cent: refused', typeof D.floatProblem({ usd: 1.005, lbp: 0 }), 'string')

// ── Slice 5: loyalty at payment ────────────────────────────────────────────
const MC = await import(`file://${join(out, 'memberCode.js')}`)
const LT = await import(`file://${join(out, 'loyaltyTiers.js')}`)

console.log('\npoints for a paid check')
eq('$12.90 earns 120, whole dollars only', LT.pointsForCheck(12.9, false), 120)
eq('$10.00 exactly earns 100 (no float slip to 99)', LT.pointsForCheck(10, false), 100)
eq('a staff meal earns nothing', LT.pointsForCheck(40, true), 0)
eq('a free check earns nothing', LT.pointsForCheck(0, false), 0)
eq('a negative total earns nothing, not negative points', LT.pointsForCheck(-5, false), 0)

console.log('\nmember codes — random, readable, strict')
let seq = 0
const code = MC.newMemberCode(n => (seq++ * 7) % n)
eq('a new code is 10 characters', code.length, 10)
eq('...from the unambiguous alphabet only', [...code].every(c => MC.MEMBER_CODE_ALPHABET.includes(c)), true)
eq('the alphabet has no 0, O, 1, I or L', /[01OIL]/.test(MC.MEMBER_CODE_ALPHABET), false)
eq('it reads back through normalize', MC.normalizeMemberCode(code), code)
eq('typed with dashes and lower case', MC.normalizeMemberCode(MC.formatMemberCode(code).toLowerCase()), code)
eq('typed with spaces', MC.normalizeMemberCode(` ${code.slice(0, 4)} ${code.slice(4)} `), code)
eq('a scanner that read a URL around it', MC.normalizeMemberCode(`https://example.test/m/${code}`), code)
eq('THE LOOK-ALIKE: a code with an O is not a code', MC.normalizeMemberCode('ABCD0FGHJK'.replace('0', 'O')), null)
eq('too short is not a code', MC.normalizeMemberCode(code.slice(0, 9)), null)
eq('a uid is not a code', MC.normalizeMemberCode('xY3kP9qR2tL8mN4vB7cD'), null)
eq('not a string is not a code', MC.normalizeMemberCode(12345), null)
eq('grouped for reading aloud: XXXX-XXXX-XX', MC.formatMemberCode('ABCDEFGHJK'), 'ABCD-EFGH-JK')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
