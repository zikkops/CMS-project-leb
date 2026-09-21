// Assertions over the tips split — shared/src/tips.ts.
//
//   node scripts/verify-tips.mjs
//   npm run verify:tips
//
// Same shape as the other verifiers: transpile the real module and assert
// against it. Nothing is re-implemented.
//
// ── Why it exists ──────────────────────────────────────────────────────────
// This arithmetic lived in a page, with the deduction as a constant at the top
// of it — so the rate on the Business Settings form did nothing, and every
// payout came out at the hardcoded figure. Nothing failed; a number was just
// slightly wrong, and it was handed to staff. Money that goes to people, split
// in a component where no test can reach it, is the exact shape of the last
// three bugs found in this repo.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'tips-verify-'))
execSync(
  `npx tsc shared/src/tips.ts shared/src/staffPay.ts --outDir ${out} --module esnext --target es2022 ` +
  `--skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const T = await import(`file://${join(out, 'tips.js')}`)
const SP = await import(`file://${join(out, 'staffPay.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}

const shifts = list => list.map(([name, shift]) => ({ name, shift }))

// A deliberately unround rate, so a hardcoded one cannot pass by coincidence.
const RATE = 0.13

console.log('\nthe deduction is whatever the café configured')
{
  const d = T.distributeTips(100, RATE, shifts([['Sara', 'single']]))
  eq('THE TRAP: the configured rate is used', d.deductionRate, 0.13)
  eq('...so the pot is what is left after it', d.netTipsUsd, 87)
  eq('...and what came off is shown', d.deductedUsd, 13)

  const other = T.distributeTips(100, 0.05, shifts([['Sara', 'single']]))
  eq('a different rate gives a different pot', other.netTipsUsd, 95)
}

console.log('\na rate that makes no sense takes nothing')
{
  // Trusting a bad rate means a missing setting can take 100% of the tips and
  // look like an empty pot rather than an error.
  eq('a missing rate', T.distributeTips(100, undefined, shifts([['Sara', 'single']])).netTipsUsd, 100)
  eq('NaN', T.distributeTips(100, Number.NaN, shifts([['Sara', 'single']])).netTipsUsd, 100)
  eq('a rate of 1 would take everything', T.distributeTips(100, 1, shifts([['Sara', 'single']])).netTipsUsd, 100)
  eq('a negative rate', T.distributeTips(100, -0.5, shifts([['Sara', 'single']])).netTipsUsd, 100)
}

console.log('\nshifts are points, and a double counts twice')
{
  const d = T.distributeTips(300, 0, shifts([['Sara', 'double'], ['Ali', 'single']]))
  eq('three points in total', d.totalShiftPoints, 3)
  eq('the double gets two thirds', d.staff.find(s => s.name === 'Sara').earned, 200)
  eq('the single gets one third', d.staff.find(s => s.name === 'Ali').earned, 100)

  const off = T.distributeTips(100, 0, shifts([['Sara', 'single'], ['Ali', 'none']]))
  eq('a day off is not a share', off.staff.map(s => s.name), ['Sara'])
  eq('...so the worker takes the pot', off.staff[0].earned, 100)
}

console.log('\none person, many days')
{
  const d = T.distributeTips(120, 0, shifts([
    ['Sara', 'double'], ['Sara', 'single'], ['Ali', 'single'],
  ]))
  eq('points accumulate into one row', d.staff.length, 2)
  eq('...Sara worked three points', d.staff.find(s => s.name === 'Sara').shiftPoints, 3)
  eq('...and takes three quarters', d.staff.find(s => s.name === 'Sara').earned, 90)
}

console.log('\nthe shares add up to the pot, to the cent')
{
  // 100 / 3 does not divide. The odd cent must land on somebody rather than
  // evaporate — money quietly going missing is the same bug as netting a
  // refund into sales.
  const d = T.distributeTips(100, 0, shifts([['A', 'single'], ['B', 'single'], ['C', 'single']]))
  const sum = Math.round(d.staff.reduce((s, x) => s + x.earned, 0) * 100) / 100
  eq('THE TRAP: nothing is lost to rounding', sum, d.netTipsUsd)
  eq('...and it is 100', sum, 100)
  eq('somebody gets the extra cent', d.staff.map(s => s.earned).sort(), [33.33, 33.33, 33.34])

  const awkward = T.distributeTips(0.07, 0, shifts([['A', 'single'], ['B', 'single']]))
  eq('seven cents between two', awkward.staff.map(s => s.earned).sort(), [0.03, 0.04])
  eq('...still adds up', Math.round(awkward.staff.reduce((s, x) => s + x.earned, 0) * 100) / 100, 0.07)
}

console.log('\nnothing to split')
{
  const none = T.distributeTips(100, RATE, [])
  eq('nobody worked: no shares', none.staff, [])
  eq('...and no division by zero', none.perPoint, 0)
  eq('...the pot is still reported', none.netTipsUsd, 87)

  const noTips = T.distributeTips(0, RATE, shifts([['Sara', 'single']]))
  eq('no tips: everybody gets nothing', noTips.staff[0].earned, 0)
  eq('a negative pot is treated as none', T.distributeTips(-50, 0, shifts([['Sara', 'single']])).netTipsUsd, 0)
}

console.log('\ntip weights (UPGRADE.md T7.18)')
{
  const sum = d => Math.round(d.staff.reduce((s, x) => s + x.earned, 0) * 100) / 100
  const plain = T.distributeTips(100, 0, [{ name: 'Rana', shift: 'single' }, { name: 'Sam', shift: 'single' }])
  eq('no weights: an even split, as before', plain.staff.map(s => s.earned), [50, 50])
  const weighted = T.distributeTips(100, 0, [{ name: 'Rana', shift: 'single', weight: 1.5 }, { name: 'Sam', shift: 'single', weight: 0.5 }])
  eq('weights split the pot by points × weight', weighted.staff.map(s => [s.name, s.earned]), [['Rana', 75], ['Sam', 25]])
  eq('...and say what they split by', [weighted.totalShiftPoints, weighted.totalWeightedPoints], [2, 2])
  const thirds = T.distributeTips(100, 0, [{ name: 'A', shift: 'single', weight: 1.25 }, { name: 'B', shift: 'double', weight: 1 }, { name: 'C', shift: 'single', weight: 0.75 }])
  eq('awkward weights still add up to the pot, to the cent', sum(thirds), 100)
  const out = T.distributeTips(90, 0, [{ name: 'A', shift: 'single' }, { name: 'B', shift: 'single', weight: 0 }, { name: 'C', shift: 'single' }])
  eq('weight 0 is out of the tips, and gets no leftover cent', out.staff.find(s => s.name === 'B').earned, 0)
  eq('...the others share the whole pot', sum(out), 90)
  const bad = T.distributeTips(100, 0, [{ name: 'A', shift: 'single', weight: Number.NaN }, { name: 'B', shift: 'single', weight: 99 }])
  eq('a nonsense weight counts as 1, never 0 or a fortune', bad.staff.map(s => s.earned), [50, 50])
  const raise = T.distributeTips(100, 0, [{ name: 'A', shift: 'single', weight: 1 }, { name: 'A', shift: 'single', weight: 2 }, { name: 'B', shift: 'double', weight: 1 }])
  eq('each day at its own weight: a raise mid-period counts from its day', raise.staff.map(s => [s.name, s.earned]), [['A', 60], ['B', 40]])

  const h = [
    { from: '2026-09-01', hourlyRate: 5, currency: 'USD', tipWeight: 1 },
    { from: '2026-09-16', hourlyRate: 6, currency: 'USD', tipWeight: 1.25 },
  ]
  eq('the rate in force on a day, not today', [SP.hourlyRateOn(h, '2026-09-10'), SP.hourlyRateOn(h, '2026-09-20')], [{ rate: 5, currency: 'USD' }, { rate: 6, currency: 'USD' }])
  eq('before the first entry: rate not set, weight 1', [SP.hourlyRateOn(h, '2026-08-31'), SP.tipWeightOn(h, '2026-08-31')], [null, 1])
  eq('a rate left empty is not set, never $0', SP.hourlyRateOn([{ from: '2026-09-01', hourlyRate: null, currency: 'USD', tipWeight: 1 }], '2026-09-02'), null)
  eq('an entry on the same day replaces the old one', SP.withPayEntry(h, { from: '2026-09-16', hourlyRate: 7, currency: 'USD', tipWeight: 1 }).map(e => e.hourlyRate), [5, 7])
  eq('a later change leaves earlier days as they were', SP.tipWeightOn(SP.withPayEntry(h, { from: '2026-10-01', hourlyRate: 8, currency: 'USD', tipWeight: 2 }), '2026-09-20'), 1.25)
  eq('an admin\'s entry is read and cleaned', SP.readPayEntry({ from: '2026-09-21', hourlyRate: '5.456', currency: 'USD', tipWeight: '1.2' }), { from: '2026-09-21', hourlyRate: 5.46, currency: 'USD', tipWeight: 1.2 })
  eq('a weight over the limit is refused, not capped', typeof SP.readPayEntry({ from: '2026-09-21', tipWeight: 9 }), 'string')
  eq('a day that does not exist is refused', typeof SP.readPayEntry({ from: '2026-02-30', tipWeight: 1 }), 'string')
  eq('a negative rate is refused', typeof SP.readPayEntry({ from: '2026-09-21', hourlyRate: -1 }), 'string')
  const staff = [{ uid: 'u1', email: 'rana@example.com', firstName: 'Rana' }, { uid: 'u2', email: 'sam@example.com', firstName: 'Sam' }, { uid: 'u3', email: 'sam2@example.com', firstName: 'Sam' }]
  eq('an attendance name matches by email or first name', [SP.matchStaffName('RANA@example.com', staff), SP.matchStaffName(' rana ', staff)], ['u1', 'u1'])
  eq('an ambiguous first name matches nobody (weight 1)', SP.matchStaffName('Sam', staff), null)
  eq('...but the email still does', SP.matchStaffName('sam2@example.com', staff), 'u3')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
