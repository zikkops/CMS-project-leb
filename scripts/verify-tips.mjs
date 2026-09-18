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
  `npx tsc shared/src/tips.ts --outDir ${out} --module esnext --target es2022 ` +
  `--skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const T = await import(`file://${join(out, 'tips.js')}`)

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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
