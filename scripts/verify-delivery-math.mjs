// Assertions over the money and stock calculations in app/lib/deliveries.ts.
//
// This repo has no test runner and adding one wasn't in scope for Phase 01, so
// this is a plain script with no new dependency: it transpiles the real module
// with the project's own TypeScript and asserts against it. Nothing is
// re-implemented — a bug in the shipped code fails here.
//
//   node scripts/verify-delivery-math.mjs
//
// Worth having because these are the numbers a café owner makes decisions
// with. Weighted average cost feeds food cost %, food cost % feeds pricing,
// and a rounding bug in the middle is the kind of thing nobody notices until
// the figures have been wrong for a quarter.
//
// When a real test runner lands (see docs/rules-rollout.md — the rules need
// one too), fold these cases into it and delete this file.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// deliveryMath.ts imports nothing from Firebase, so it transpiles and runs
// standalone — no stripping, no stubs. That property is the whole reason the
// pure calculations live in their own module.
const out = mkdtempSync(join(tmpdir(), 'onboard-verify-'))
execSync(
  `npx tsc app/lib/deliveryMath.ts --outDir ${out} --module esnext --target es2022 ` +
  `--skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' }
)

// tsc emits bundler-style extensionless specifiers ("./branches"); Node's ESM
// loader requires the extension. One rewrite is cheaper than a second tsconfig.
const emitted = join(out, 'deliveryMath.js')
writeFileSync(emitted, readFileSync(emitted, 'utf8').replace(/from '\.\/branches'/, "from './branches.js'"))

const {
  weightedAverageCost, computeTotals, shortfall, isShort, priceChange,
  seedLinesFromOrder, costOfGoodsUsd, foodCostPercent, fulfilmentByTemplateId,
} = await import(`file://${join(out, 'deliveryMath.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = typeof got === 'number' && typeof want === 'number'
    ? Math.abs(got - want) < 1e-9
    : got === want
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(48)} got=${got} want=${want}`)
  ok ? pass++ : fail++
}

console.log('\nweightedAverageCost')
// Weighted average, not last-price-paid: 40L at $4 plus 10L at $6 is $4.40 oil,
// not $6.00 oil. Getting this wrong overstates food cost on every recipe after.
eq('40L@$4 + 10L@$6 = $4.40', weightedAverageCost(40, 4.00, 10, 6.00), 4.40)
eq('no stock on hand: new price is the average', weightedAverageCost(0, 0, 10, 4.20), 4.20)
// A delivery where everything was rejected must not touch cost at all.
eq('all rejected: cost must not move', weightedAverageCost(40, 4.00, 0, 99), 4.00)
// An over-count can leave stock negative; the average must not invert.
eq('negative on-hand does not invert the average', weightedAverageCost(-10, 4.00, 10, 5.00), 5.00)

console.log('\ncomputeTotals (VAT 11%)')
const t = computeTotals([{ qtyReceived: 17, unitCost: 4.20 }, { qtyReceived: 3, unitCost: 10 }])
eq('subtotal 17x4.20 + 3x10', t.subtotal, 101.40)
eq('vat', t.vat, 11.15)
eq('grand', t.grand, 112.55)
// Without rounding at each step, a dozen lines accumulate float error and the
// total disagrees with the supplier's paper bill by a cent.
const many = computeTotals(Array.from({ length: 12 }, () => ({ qtyReceived: 0.1, unitCost: 0.2 })), 0)
eq('12 lines of 0.1x0.2 == 0.24 exactly', many.subtotal, 0.24)

console.log('\nshortfall / isShort')
eq('ordered 20, received 17', shortfall({ qtyOrdered: 20, qtyReceived: 17 }), 3)
eq('over-delivery is not negative', shortfall({ qtyOrdered: 20, qtyReceived: 25 }), 0)
eq('unplanned line is not "short"', isShort({ qtyOrdered: 0, qtyReceived: 5 }), false)

console.log('\npriceChange')
eq('4.20 -> 5.12 is +21.9%', Math.round(priceChange(4.20, 5.12) * 1000) / 1000, 0.219)
eq('no previous cost -> null', priceChange(0, 5), null)

console.log('\nseedLinesFromOrder (confirm-and-fix pre-fill)')
const seeded = seedLinesFromOrder([
  { templateId: 't1', supplyId: 's1', name: 'Olive Oil', unit: 'liter', quantity: 20, currentAvgCost: 4.20 },
  { templateId: 't2', supplyId: null, name: 'Napkins', unit: 'box', quantity: 5, currentAvgCost: 1 },
])
// An unlinked template item can move no stock. Dropping it is the point —
// receiving it would look successful and do nothing.
eq('unstocked item dropped, not silently received', seeded.length, 1)
eq('qtyReceived pre-filled from qtyOrdered', seeded[0].qtyReceived, 20)
eq('lineTotal seeded from current avg cost', seeded[0].lineTotal, 84)

console.log('\ncostOfGoodsUsd (mixed currency)')
eq('$100 + 9,000,000 LBP@90k, draft excluded', costOfGoodsUsd([
  { status: 'received', currency: 'USD', rateUsed: 0, totals: { grand: 100 } },
  { status: 'received', currency: 'LBP', rateUsed: 90000, totals: { grand: 9000000 } },
  { status: 'draft', currency: 'USD', rateUsed: 0, totals: { grand: 500 } },
]), 200)
// A zero rate would divide to Infinity and poison the whole food-cost figure.
eq('LBP with no rate does not become Infinity', costOfGoodsUsd([
  { status: 'received', currency: 'LBP', rateUsed: 0, totals: { grand: 9000000 } },
]), 0)

console.log('\nfoodCostPercent')
eq('200 cogs / 800 sales', foodCostPercent(200, 800), 0.25)
eq('zero sales -> null', foodCostPercent(200, 0), null)

console.log('\nfulfilmentByTemplateId (suppliers split shipments)')
eq('two shipments sum, draft ignored', fulfilmentByTemplateId([
  { status: 'received', lines: [{ templateId: 't1', qtyReceived: 12 }] },
  { status: 'received', lines: [{ templateId: 't1', qtyReceived: 5 }] },
  { status: 'draft', lines: [{ templateId: 't1', qtyReceived: 99 }] },
]).t1, 17)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
