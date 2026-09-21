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
  if (ok) pass++; else fail++
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

// ── The floor's readings — pos/app/lib/floorReadings.ts ────────────────────
// Same rule as the rest of this file: the figures that reach a screen are
// added up where they can be asserted, not inside the component.
console.log('\nthe floor\'s readings')
{
  const outFloor = mkdtempSync(join(tmpdir(), 'floor-verify-'))
  execSync(
    `npx tsc pos/app/lib/floorReadings.ts --outDir ${outFloor} --module esnext --target es2022 ` +
    `--skipLibCheck --moduleResolution bundler --strict`,
    { stdio: 'pipe' },
  )
  const R = await import(`file://${join(outFloor, 'floorReadings.js')}`)
  const today = '2026-09-14'
  const closed = [
    { status: 'closed', day: today, totalUsd: 12.5 },
    { status: 'closed', day: today, totalUsd: 7.25 },
    // Closed last night: not today's, however recent the query was.
    { status: 'closed', day: '2026-09-13', totalUsd: 40 },
    { status: 'refunded', day: today, totalUsd: 9 },
    { status: 'open', day: today, totalUsd: 99 },
    { status: 'closed', day: '', totalUsd: 5 },
  ]
  const r = R.floorReadings([10.1, 0.2, 3], closed, today)
  eq('open tables add up, in cents — 0.1 + 0.2 is not 0.30000000000000004', r.openTotalUsd, 13.3)
  eq('how many are open', r.openCount, 3)
  eq('closed today is today\'s only', [r.closedTodayCount, r.closedTodayUsd], [2, 19.75])
  eq('THE TRAP: a refund is its own reading, never taken off sales', [r.refundsTodayCount, r.refundsTodayUsd], [1, 9])
  eq('the average of what closed today', r.averageTodayUsd, 9.88)
  eq('nothing closed yet: no average, not $0.00', R.floorReadings([], [], today).averageTodayUsd, null)
  eq('a check with no known day counts for no day', R.floorReadings([], [{ status: 'closed', day: '', totalUsd: 5 }], '').closedTodayCount, 0)

  eq('nothing stored: the defaults', R.readReadingChoice(null), ['closedToday', 'openTotal'])
  eq('a stored choice is kept, in the panel\'s order', R.readReadingChoice('["refundsToday","openCount"]'), ['openCount', 'refundsToday'])
  eq('unknown keys and repeats are dropped', R.readReadingChoice('["openTotal","openTotal","profit"]'), ['openTotal'])
  eq('hiding everything is a choice, and is kept', R.readReadingChoice('[]'), [])
  eq('something unreadable falls back to the defaults', R.readReadingChoice('{not json'), ['closedToday', 'openTotal'])
}

console.log('\nwhat the front sees when the kitchen marks a plate ready')
{
  const outPick = mkdtempSync(join(tmpdir(), 'pickups-verify-'))
  execSync(
    `npx tsc pos/app/lib/pickups.ts --outDir ${outPick} --module esnext --target es2022 ` +
    `--skipLibCheck --moduleResolution bundler --strict`,
    { stdio: 'pipe' },
  )
  const P = await import(`file://${join(outPick, 'pickups.js')}`)

  const at = min => 1_000_000_000_000 + min * 60_000
  const now = at(10)
  const ticket = (id, table, readyMin, lines) => ({
    id, tableNumber: table, station: 'Kitchen', round: 1, lines,
    readyAtMs: readyMin === null ? null : at(readyMin), sentAtMs: at(0),
  })
  const burger = { name: 'Burger', quantity: 2, voided: false }
  const fries = { name: 'Fries', quantity: 1, voided: false }

  const cards = P.pickupCards([ticket('b', 12, 8, [fries]), ticket('a', 2, 3, [burger, fries])], now)
  eq('the plate waiting longest comes first', cards.map(c => c.id), ['a', 'b'])
  eq('it says what to carry', cards[0].summary, '2× Burger, 1× Fries')
  eq('THE TRAP: the wait counts from Ready, not from when it was ordered', cards[0].waitingMinutes, 7)
  const partlyVoided = P.pickupCards([ticket('c', 4, 9, [burger, { ...fries, voided: true }])], now)[0]
  eq('a voided line is not food to carry', partlyVoided.summary, '2× Burger')
  eq('...nor counted', partlyVoided.items, 2)
  eq('a ticket from before Ready was timed counts from when it was sent', P.pickupCards([ticket('d', 5, null, [fries])], now)[0].waitingMinutes, 10)
  eq('a clock slightly ahead never shows a negative wait', P.pickupCards([ticket('e', 6, 11, [fries])], now)[0].waitingMinutes, 0)
  eq('everything voided says so, rather than an empty card',
    P.pickupCards([ticket('f', 7, 9, [{ ...fries, voided: true }])], now)[0].summary, 'Every item on it was cancelled')
  eq('the same wait: the lower table first', P.pickupCards([ticket('y', 9, 5, [fries]), ticket('x', 3, 5, [fries])], now).map(c => c.id), ['x', 'y'])

  eq('under two minutes is fresh', P.pickupUrgency(1), 'fresh')
  eq('two minutes is getting cold', P.pickupUrgency(2), 'aging')
  eq('five minutes is late', P.pickupUrgency(5), 'late')

  eq('THE TRAP: plates already waiting when the screen opens do not ring', P.newlyReady(null, ['a', 'b']), [])
  eq('a plate that turns ready rings', P.newlyReady(new Set(['a']), ['a', 'b']), ['b'])
  eq('a plate picked up does not ring', P.newlyReady(new Set(['a', 'b']), ['a']), [])
}

console.log('\nsigning out says what is waiting, and never stops you (UPGRADE.md T6.1)')
{
  const outSign = mkdtempSync(join(tmpdir(), 'signout-verify-'))
  execSync(
    `npx tsc pos/app/lib/signOut.ts --outDir ${outSign} --module esnext --target es2022 ` +
    `--skipLibCheck --moduleResolution bundler --strict`,
    { stdio: 'pipe' },
  )
  const S = await import(`file://${join(outSign, 'signOut.js')}`)
  eq('nothing waiting: no question, straight out', S.signOutWarning({ queued: 0, stuck: false, drafts: 0 }), null)
  eq('unsent lines are named', S.signOutWarning({ queued: 0, stuck: false, drafts: 2 }), '2 lines are on this check and not sent to the kitchen. They stay on this device for the next person to sign in here. Sign out anyway?')
  eq('a queued outbox is named, one change', S.signOutWarning({ queued: 1, stuck: false, drafts: 0 }).startsWith('1 change is waiting on this device'), true)
  eq('a refused change is named too', S.signOutWarning({ queued: 0, stuck: true, drafts: 0 }).startsWith('a change was refused'), true)
  eq('all of it, in one question', S.signOutWarning({ queued: 3, stuck: true, drafts: 1 }).split('; ').length, 3)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
