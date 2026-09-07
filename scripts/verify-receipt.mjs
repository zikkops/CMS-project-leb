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
  `npx tsc shared/src/receipt.ts shared/src/checks.ts shared/src/money.ts shared/src/modifiers.ts ` +
  `--outDir ${out} --module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' }
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const R = await import(`file://${join(out, 'receipt.js')}`)

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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
