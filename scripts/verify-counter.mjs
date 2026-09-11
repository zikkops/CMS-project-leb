// Assertions over what the counter till may charge for — pos/app/lib/counterTotals.ts.
//
//   node scripts/verify-counter.mjs
//   npm run verify:counter
//
// This verifier exists because of two bugs, not in anticipation of one. Both
// shipped through tsc, three builds, five verifiers and a look in a browser,
// and both were the same shape: the arithmetic in shared/src/payments.ts was
// correct, and the wrong FIGURE was passed into it from a React component
// where nothing could assert on it.
//
//   1. The screen counted DRAFT lines — items tapped, never sent — in the
//      total it took payment against. A card worked out that way is refused by
//      the server ("charged what is owed, never more"), and a refusal stops
//      the whole outbox queue. Cash was quieter: change handed back against a
//      bill that was short.
//   2. Queued lines were priced by looking each item up in the menu, which on
//      this device is a cache that can be cold after a mid-outage reload. A
//      missing item priced at 0 and the bill came out short, silently.
//
// So the cases below are mostly about money that must NOT be charged.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'counter-verify-'))
execSync(
  `npx tsc pos/app/lib/counterTotals.ts --outDir ${out} --module esnext --target es2022 ` +
  `--skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const C = await import(`file://${join(out, 'counterTotals.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}

const at = '2026-09-12T20:00:00.000Z'
const batch = (id, checkId, lines, displayUsd) => ({
  kind: 'lines', id, checkId, batchKey: `b-${id}-000000`, lines, at,
  ...(displayUsd === undefined ? {} : { displayUsd }),
})
const pay = (id, checkId, amount, currency = 'USD') => ({
  kind: 'pay', id, checkId, paymentKey: `p-${id}-000000`,
  payment: { tender: 'cash', currency, amount }, at,
})

// A menu that knows about the espresso and nothing else.
const menu = refId => (refId === 'espresso' ? 3.5 : null)

console.log('\nthe bill is what is on the check')
{
  const queue = [batch('1', 'A', [{ refId: 'espresso', quantity: 2 }], 7)]
  const q = C.queuedUsd(queue, 'A', menu)
  eq('what the queue carries is the bill', q, { usd: 7, unknown: false })
  eq('a check on the server adds to it', C.checkDue(12.25, q), 19.25)
  eq('another table sees none of it', C.queuedUsd(queue, 'B', menu), { usd: 0, unknown: false })

  eq('drafts are counted for the screen', C.draftsUsd([{ unitPrice: 3.5, quantity: 2 }, { unitPrice: 1.25, quantity: 1 }]), 8.25)
  // checkDue does not take drafts at all — the bug it was written after could
  // not be reintroduced without changing its signature, which is the point.
  eq('THE BUG: drafts cannot reach the bill', C.checkDue(0, C.queuedUsd([], 'A', menu)), 0)
}

console.log('\na total with a hole in it is not a total')
{
  const cold = [batch('1', 'A', [{ refId: 'flat-white', quantity: 2 }])]
  eq('THE BUG: an unpriceable line is not free', C.queuedUsd(cold, 'A', menu), { usd: 0, unknown: true })

  const mixed = [
    batch('1', 'A', [{ refId: 'espresso', quantity: 1 }]),
    batch('2', 'A', [{ refId: 'flat-white', quantity: 1 }]),
  ]
  eq('one bad line makes the whole total unknown', C.queuedUsd(mixed, 'A', menu).unknown, true)
  eq('...and what IS priced still adds up', C.queuedUsd(mixed, 'A', menu).usd, 3.5)

  const carried = [batch('1', 'A', [{ refId: 'flat-white', quantity: 2 }], 9)]
  eq('a batch that carried its price needs no menu', C.queuedUsd(carried, 'A', menu), { usd: 9, unknown: false })
  eq('the carried price wins over the menu', C.queuedUsd([batch('1', 'A', [{ refId: 'espresso', quantity: 99 }], 4)], 'A', menu).usd, 4)
  eq('a nonsense carried price is not trusted', C.batchUsd(batch('1', 'A', [{ refId: 'espresso', quantity: 2 }], Number.NaN), menu), { usd: 7, unknown: false })
}

console.log('\nwhen the till refuses to take money')
{
  const clean = { draftCount: 0, totalUnknown: false, settled: false }
  eq('nothing in the way', C.takeBlocked(clean), null)
  eq('drafts stop it, and say what to do', C.takeBlocked({ ...clean, draftCount: 1 })?.startsWith('Ring the items up first'), true)
  eq('an unknown total stops it', C.takeBlocked({ ...clean, totalUnknown: true })?.includes('not known'), true)
  eq('a settled check stops it', C.takeBlocked({ ...clean, settled: true })?.includes('paid in full'), true)
  eq('the drafts come first — it is the one they can fix', C.takeBlocked({ draftCount: 1, totalUnknown: true, settled: true })?.startsWith('Ring the items up'), true)
}

console.log('\nwhat has already been paid')
{
  // Stands in for shared/src/payments.applyPayment: takes what is left, and
  // refuses anything once the bill is covered.
  const apply = (due, list, rate, payment) => {
    const paid = list.reduce((s, p) => s + p.appliedLbp, 0)
    const left = due * rate - paid
    if (left <= 0) return { ok: false }
    return { ok: true, appliedLbp: Math.min(payment.amount * rate, left) }
  }
  const queue = [pay('1', 'A', 5), pay('2', 'A', 5), pay('3', 'B', 99)]

  const list = C.replayApplied([], queue, 'A', 20, 1000, apply)
  eq('queued payments count towards the bill', list, [{ appliedLbp: 5000 }, { appliedLbp: 5000 }])
  eq('another table is not paying this one', C.replayApplied([], queue, 'B', 20, 1000, apply), [{ appliedLbp: 20000 }])

  const already = C.replayApplied([{ appliedLbp: 20000 }], queue, 'A', 20, 1000, apply)
  eq('THE BUG: a payment the arithmetic refuses is not on the check', already, [{ appliedLbp: 20000 }])

  const partly = C.replayApplied([{ appliedLbp: 18000 }], queue, 'A', 20, 1000, apply)
  eq('...and one that is only partly possible takes only what is left', partly, [{ appliedLbp: 18000 }, { appliedLbp: 2000 }])
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
