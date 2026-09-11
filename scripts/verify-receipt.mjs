// Assertions over the receipt model in shared/src/receipt.ts.
//
// Same shape as verify-checks.mjs and verify-delivery-math.mjs: no test runner
// in this repo yet, so this transpiles the real modules with the project's own
// TypeScript and asserts against them. Nothing is re-implemented.
//
//   node scripts/verify-receipt.mjs
//
// Worth having because a receipt is the one artifact of a service a customer
// takes away and checks. A figure that does not match what they were asked for
// is an argument at the counter, and a line item cut off mid-word is a
// complaint. Both are cheap to catch here and expensive to find on paper.
//
// It also stands in for a printer. The hardware is not chosen yet, so nothing
// downstream of these rows can be tested at all — which makes the rows
// themselves the only thing that CAN be verified, and worth verifying properly.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'receipt-verify-'))
execSync(
  `npx tsc shared/src/receipt.ts shared/src/ticketDoc.ts shared/src/tickets.ts ` +
  `shared/src/checks.ts shared/src/money.ts shared/src/modifiers.ts ` +
  `--outDir ${out} --module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' }
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const R = await import(`file://${join(out, 'receipt.js')}`)
const T = await import(`file://${join(out, 'ticketDoc.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(56)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}

const mod = (name, delta) => ({
  groupId: 'g', groupName: 'Size', optionId: 'o', optionName: name, priceDelta: delta,
})
const line = (over = {}) => ({
  id: 'l1', source: 'menu', refId: 'm1', name: 'Flat White',
  unitPrice: 4, modifiers: [], quantity: 1, seat: null, course: null,
  station: 'Bar', status: 'sent', note: '',
  addedBy: 'u', addedByEmail: 'u@x', sentAt: null,
  voidReason: null, voidReasonKey: null, voidWasWaste: null, ...over,
})
const check = (over = {}) => ({
  id: 'c1', branch: 'Main', tableId: 't1', tableNumber: 12,
  status: 'closed', guestCount: 2, lines: [line()],
  openedBy: 'u1', openedByEmail: 'sara@cafe.example.com',
  closedAt: '2026-09-07T15:30:00', receiptNumber: 'INV-Q3-092026-0007',
  staffDiscount: null, ...over,
})
const opts = {
  businessName: 'Placeholder Cafe', address: '1 Example Street', phone: '+000 00 000 000',
  currency: 'USD', secondaryCurrency: 'LBP', exchangeRate: 89500,
}
const find = (rows, left) => rows.find(r => r.kind === 'pair' && r.left === left)

console.log('\nreceiptBlockedReason — a receipt needs a number')
eq('open check is blocked', typeof R.receiptBlockedReason(check({ status: 'open' })), 'string')
eq('closed with a number is fine', R.receiptBlockedReason(check()), null)
eq('closed without a number is blocked',
   typeof R.receiptBlockedReason(check({ receiptNumber: null })), 'string')
eq('reversed check can still reprint', R.receiptBlockedReason(check({ status: 'reversed' })), null)

console.log('\nbuildReceipt refuses rather than half-prints')
let threw = false
try { R.buildReceipt(check({ status: 'open' }), opts) } catch { threw = true }
eq('open check throws', threw, true)

console.log('\nthe header')
const rows = R.buildReceipt(check(), opts)
eq('business name is centred first', rows[0], { kind: 'center', text: 'Placeholder Cafe', strong: true })
eq('receipt number', find(rows, 'Receipt').right, 'INV-Q3-092026-0007')
eq('table', find(rows, 'Table').right, '12')
eq('guests', find(rows, 'Guests').right, '2')
eq('date comes from closedAt', find(rows, 'Date').right, '2026-09-07 15:30')

// ── closedAt as Firestore actually delivers it ─────────────────────────────
// The fixture above passes a string, which is the one shape Firestore never
// sends. The server writes serverTimestamp(), so a real closed check carries a
// Timestamp — and `new Date(timestamp)` is Invalid Date, which is what printed
// "NaN-NaN-NaN NaN:NaN" on every real receipt while this file passed.
{
  const { createRequire } = await import('node:module')
  const { Timestamp } = createRequire(join(process.cwd(), 'package.json'))('firebase/firestore')
  const at = new Date('2026-09-07T15:30:00')   // local, like the fixture
  const dateFor = closedAt => find(R.buildReceipt(check({ closedAt }), opts), 'Date').right

  eq('a real Timestamp dates the receipt', dateFor(Timestamp.fromDate(at)), '2026-09-07 15:30')
  eq('a {seconds, nanoseconds} copy does too',
     dateFor({ seconds: at.getTime() / 1000, nanoseconds: 0 }), '2026-09-07 15:30')
  eq('an Admin SDK timestamp after Response.json does too',
     dateFor({ _seconds: at.getTime() / 1000, _nanoseconds: 0 }), '2026-09-07 15:30')
  eq('no receipt date is ever NaN',
     [Timestamp.fromDate(at), { seconds: 1 }, 'garbage', null, {}]
       .map(dateFor).some(d => d.includes('NaN')), false)

  const TS = await import(`file://${join(out, 'timestamps.js')}`)
  const ms = at.getTime()
  console.log('\ntimestampMs — every shape a timestamp arrives in')
  eq('Timestamp instance', TS.timestampMs(Timestamp.fromDate(at), 0), ms)
  eq('{seconds, nanoseconds}', TS.timestampMs({ seconds: ms / 1000, nanoseconds: 5e8 }, 0), ms + 500)
  eq('{_seconds, _nanoseconds}', TS.timestampMs({ _seconds: ms / 1000, _nanoseconds: 0 }, 0), ms)
  eq('ISO string', TS.timestampMs(at.toISOString(), 0), ms)
  eq('Date', TS.timestampMs(at, 0), ms)
  eq('number', TS.timestampMs(ms, 0), ms)
  eq('null falls back', TS.timestampMs(null, 42), 42)
  eq('an unparseable string falls back', TS.timestampMs('063924391800.000000000x', 42), 42)
  eq('an empty object falls back', TS.timestampMs({}, 42), 42)
}
eq('server is the local part only', find(rows, 'Served by').right, 'sara')
eq('no mail domain anywhere', R.receiptToText(rows).includes('cafe.example.com'), false)

console.log('\nlines')
const withMods = R.buildReceipt(check({
  lines: [line({ modifiers: [mod('Large', 1.5)], quantity: 2 })],
}), opts)
eq('modifiers are in the price', find(withMods, '2 x Flat White').right, '11.00')
eq('modifiers are described under the line',
   withMods.some(r => r.kind === 'left' && r.text.includes('Large')), true)

const withVoid = R.buildReceipt(check({
  lines: [line(), line({ id: 'l2', name: 'Cancelled Thing', status: 'void', voidReason: 'x' })],
}), opts)
eq('voided lines are omitted', withVoid.some(r => r.kind === 'pair' && r.left.includes('Cancelled')), false)
eq('the surviving line is still there', !!find(withVoid, '1 x Flat White'), true)

console.log('\ntotals')
eq('total USD', find(rows, 'Total USD').right, '4.00')
eq('no subtotal row without a discount', find(rows, 'Subtotal'), undefined)

const staff = R.buildReceipt(check({
  lines: [line({ unitPrice: 10, station: 'Kitchen' })],
  staffDiscount: { food: 0.7, drink: 0.5, appliedBy: 'm', appliedByEmail: 'm@x' },
}), opts)
eq('discounted: gross shown as subtotal', find(staff, 'Subtotal').right, '10.00')
eq('discounted: the discount is its own line', find(staff, 'Staff discount').right, '-7.00')
eq('discounted: total is net', find(staff, 'Total USD').right, '3.00')

// ── Phase 04: how it was paid ──────────────────────────────────────────────
console.log('\npayments — the rate the check was settled at, and the tender')
const payment = (over = {}) => ({
  key: 'k-12345678', tender: 'cash', currency: 'USD', amount: 20,
  appliedLbp: 0, changeUsd: 0, changeLbp: 0, changeRounding: 0,
  at: null, by: 'u', byEmail: 'u@x', ...over,
})
// $4.00 at the check's own 91,000 is 364,000; at today's 89,500 it would be 358,000.
const settled = R.buildReceipt(check({ billRate: 91000 }), opts)
eq('THE BUG: the lira total uses the check\'s rate, not today\'s', find(settled, 'Total LBP').right, '364,000')
eq('...and says which rate it used',
   settled.some(r => r.kind === 'left' && r.text.startsWith('At 91,000 LBP')), true)
eq('a check with no rate of its own uses today\'s', find(rows, 'Total LBP').right, '358,000')

const paid = R.buildReceipt(check({
  billRate: 89500,
  payments: [
    payment({ amount: 20, changeUsd: 10, changeLbp: 45000 }),
    payment({ key: 'k-87654321', tender: 'card', currency: 'LBP', amount: 123456 }),
  ],
}), opts)
eq('cash in dollars is its own line', find(paid, 'Cash USD').right, '20.00')
eq('a card in lira prints without decimals', find(paid, 'Card LBP').right, '123,456')
eq('change in dollars', find(paid, 'Change USD').right, '10.00')
eq('change in lira', find(paid, 'Change LBP').right, '45,000')
eq('no payment lines on a check the old till settled', find(rows, 'Cash USD'), undefined)
eq('...and no change line either', find(rows, 'Change USD'), undefined)
eq('no change line when none was given',
   find(R.buildReceipt(check({ billRate: 89500, payments: [payment({ amount: 4 })] }), opts), 'Change LBP'),
   undefined)

console.log('\nVAT — included in the total, at the rate the check recorded')
const ten = (over = {}) => check({ lines: [line({ unitPrice: 10 })], ...over })
// 10% rather than the café's own rate: the branding audit rightly flags any
// literal of the configured rate, and a fixture is no exception to that.
const vat = R.buildReceipt(ten({ vatRate: 0.1 }), opts)
eq('prices include VAT: $10.00 at 10% shows $0.91 of it', find(vat, 'Incl. VAT 10%').right, '0.91')
eq('...and the total does not move', find(vat, 'Total USD').right, '10.00')
eq('the check\'s own rate: a 12% check shows $1.07',
   find(R.buildReceipt(ten({ vatRate: 0.12 }), opts), 'Incl. VAT 12%').right, '1.07')
eq('no VAT line on a check that never recorded a rate',
   rows.some(r => r.kind === 'pair' && r.left.startsWith('Incl. VAT')), false)
eq('a zero-rated day says so rather than hiding it',
   find(R.buildReceipt(ten({ vatRate: 0 }), opts), 'Incl. VAT 0%').right, '0.00')

console.log('\ndiscounts on the receipt — each its own line (slice 6)')
const mgr = { reasonKey: 'complaint', note: '', by: 'm', byEmail: 'm@x' }
const discounted = R.buildReceipt(check({
  lines: [line({ unitPrice: 10 }), line({ id: 'l2', name: 'Cake', unitPrice: 5, discount: { kind: 'comp', percent: 1, ...mgr } })],
  discount: { kind: 'percent', value: 0.2, ...mgr },
}), opts)
eq('the subtotal is the full price', find(discounted, 'Subtotal').right, '15.00')
eq('the comp is its own line', find(discounted, 'Item discounts').right, '-5.00')
eq('...and is named under the item', discounted.some(r => r.kind === 'left' && r.text.includes('On the house')), true)
eq('20% off the check is its own line', find(discounted, 'Discount 20%').right, '-2.00')
eq('the total is what is owed', find(discounted, 'Total USD').right, '8.00')
eq('no discount lines on an ordinary check', ['Item discounts', 'Discount'].map(l => find(rows, l)), [undefined, undefined])

console.log('\nthe secondary currency')
eq('LBP total is rounded to the nearest 100',
   find(rows, 'Total LBP').right, (Math.round(4 * 89500 / 100) * 100).toLocaleString('en-US'))
eq('rounding row absent when it rounds exactly', find(rows, 'Rounding'), undefined)

const odd = R.buildReceipt(check({ lines: [line({ unitPrice: 3.67 })] }), opts)
eq('rounding row present when there is an adjustment', !!find(odd, 'Rounding'), true)
eq('rounding is signed', find(odd, 'Rounding').right[0], '+')

console.log('\nreceiptToText — a fixed-width roll')
const text = R.receiptToText(rows, 32)
const lines = text.split('\n')
eq('no line exceeds the width', lines.every(l => l.length <= 32), true)
eq('the rule fills the width', lines.some(l => l === '-'.repeat(32)), true)
eq('a figure is right-aligned to the edge',
   lines.some(l => l.startsWith('Total USD') && l.endsWith('4.00') && l.length === 32), true)

const long = R.receiptToText([{ kind: 'pair', left: 'A very long menu item name indeed', right: '123.45' }], 32)
const longLines = long.split('\n')
eq('a long label wraps rather than truncating', longLines.length, 2)
eq('the whole label survives',
   longLines.join(' ').replace(/\s+/g, ' ').includes('A very long menu item name indeed'), true)
eq('the figure ends the last line', longLines[1].endsWith('123.45'), true)
eq('and reaches the right edge', longLines[1].length, 32)

const noSpaces = R.receiptToText(
  [{ kind: 'pair', left: 'Supercalifragilisticexpialidociousaurus', right: '9.00' }], 32)
eq('an unbreakable word is cut only after wrapping fails',
   noSpaces.split('\n')[0].length, 32)
eq('and its figure is still printed', noSpaces.endsWith('9.00'), true)

eq('wide roll is 42', R.RECEIPT_WIDTHS.wide, 42)
eq('narrow roll is 32', R.RECEIPT_WIDTHS.narrow, 32)

// ── The kitchen ticket ─────────────────────────────────────────────────────
// Same layout engine, opposite priorities. A receipt exists so a figure can be
// checked; a ticket has no figures at all and exists so somebody at a pass,
// mid-service, can tell in about a second what to make and for which table.
console.log('\nbuildTicketDoc — what a cook reads')

const tline = (over = {}) => ({
  lineId: 'l1', name: 'Flat White', quantity: 1, modifiers: '',
  seat: null, course: null, note: '', voided: false, ...over,
})
const ticket = (over = {}) => ({
  id: 't1', checkId: 'c1', branch: 'Main', tableNumber: 12, station: 'Kitchen',
  status: 'new', round: 1, lines: [tline()], sentBy: 'sara', sentByEmail: 's@x',
  bumpedAt: null, bumpedBy: null, ...over,
})
const topts = { sentAt: '2026-09-07T19:42:00Z', sentBy: 'sara', timeZone: 'UTC' }
const ttext = (t, w = 32) => T.ticketToText(t, topts, w)

eq('station leads', T.buildTicketDoc(ticket(), topts)[0],
   { kind: 'center', text: 'KITCHEN', strong: true })
eq('then the table', T.buildTicketDoc(ticket(), topts)[1],
   { kind: 'center', text: 'TABLE 12', strong: true })
eq('no round label on the first send', ttext(ticket()).includes('ROUND'), false)
eq('round 2 is labelled, or it gets cooked twice',
   ttext(ticket({ round: 2 })).includes('ROUND 2'), true)
eq('the time it was sent is on it', ttext(ticket()).includes('19:42'), true)
eq('no prices anywhere', /\d+\.\d{2}/.test(ttext(ticket())), false)

eq('quantity leads the line',
   ttext(ticket({ lines: [tline({ quantity: 3 })] })).includes('3  Flat White'), true)
eq('modifiers are indented under it',
   ttext(ticket({ lines: [tline({ modifiers: 'Large, Oat' })] })).includes('      Large, Oat'), true)
eq('a note is indented too',
   ttext(ticket({ lines: [tline({ note: 'no ice' })] })).includes('      no ice'), true)
eq('seat and course are shown when set',
   ttext(ticket({ lines: [tline({ seat: 3, course: 2 })] })).includes('seat 3 · course 2'), true)

eq('VOID goes in front of the name, not after',
   ttext(ticket({ lines: [tline({ voided: true })] })).includes('VOID  1  Flat White'), true)
eq('a voided line is kept rather than dropped',
   ttext(ticket({ lines: [tline({ voided: true })] })).includes('Flat White'), true)
eq('an all-void ticket says so at the top',
   ttext(ticket({ lines: [tline({ voided: true })] })).includes('ALL ITEMS VOIDED'), true)
eq('a partly-void ticket does not',
   ttext(ticket({ lines: [tline(), tline({ lineId: 'l2', voided: true })] }))
     .includes('ALL ITEMS VOIDED'), false)
eq('an empty ticket still prints something', ttext(ticket({ lines: [] })).includes('NO ITEMS'), true)

// The bug these found in receipt.ts: `left` rows were sliced, not wrapped, so
// a long name lost its end. Invisible on a receipt, where the only left rows
// are short modifier lines. A cook guessing at "Halloumi & Zaatar Manou" is
// not invisible.
const longName = ttext(ticket({ lines: [tline({ name: 'Halloumi & Zaatar Manoushe', quantity: 2 })] }))
eq('a long item name wraps rather than being cut', longName.includes('Manoushe'), true)
eq('and no line exceeds the roll', longName.split('\n').every(l => l.length <= 32), true)
eq('an indented line keeps its indent when it wraps',
   ttext(ticket({ lines: [tline({ modifiers: 'Oat milk, extra shot, no sugar, half caff please' })] }))
     .split('\n').filter(l => l.startsWith('      ')).length >= 2, true)
eq('the wide roll is respected too',
   ttext(ticket({ lines: [tline({ name: 'Halloumi & Zaatar Manoushe' })] }), 42)
     .split('\n').every(l => l.length <= 42), true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
