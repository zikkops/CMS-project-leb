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
  `npx tsc shared/src/payments.ts shared/src/money.ts shared/src/businessSettings.ts ` +
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
eq('$10.00 at 11% carries $0.99 of VAT, not $1.10', M.vatIncluded(10, 0.11), 0.99)
eq('zero-rated carries none', M.vatIncluded(10, 0), 0)
const sched = { vatRate: 0.11, vatNext: { rate: 0.12, from: '2027-01-01' } }
eq('the day before the change: 11%', B.vatRateOn(sched, '2026-12-31'), 0.11)
eq('THE DAY the change starts: 12%', B.vatRateOn(sched, '2027-01-01'), 0.12)
eq('after it: 12%', B.vatRateOn(sched, '2027-06-01'), 0.12)
eq('nothing scheduled: the current rate', B.vatRateOn({ vatRate: 0.11, vatNext: null }, '2030-01-01'), 0.11)
eq('a scheduled change is read back as stored', B.readVatNext({ rate: 0.12, from: '2027-01-01' }),
   { rate: 0.12, from: '2027-01-01' })
eq('30 February is not a date', B.readVatNext({ rate: 0.12, from: '2027-02-30' }), null)
eq('a rate out of bounds is ignored, not billed', B.readVatNext({ rate: 12, from: '2027-01-01' }), null)
eq('a missing rate is ignored, not read as 0%', B.readVatNext({ from: '2027-01-01' }), null)
eq('an empty-string rate is ignored, not read as 0%', B.readVatNext({ rate: '', from: '2027-01-01' }), null)
eq('garbage is ignored', B.readVatNext('12% soon'), null)
eq('a stored document without one parses to null', B.parseSettings({ vatRate: 0.11 }).vatNext, null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
