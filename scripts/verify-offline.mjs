// Assertions over the counter device's outbox in pos/app/lib/outbox.ts.
//
// Same shape as the other verifiers: transpile the real module with the
// project's own TypeScript and assert against it. Nothing is re-implemented.
//
//   node scripts/verify-offline.mjs
//
// The outbox is what stands between an outage and lost orders. The cases
// below are the ways a reconnect goes wrong: sending out of order, dropping
// something on a dropped connection, and pressing on after the server said
// no — which turns one problem into a string of confusing ones.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'offline-verify-'))
execSync(
  // --strict, as the app itself is compiled: the outbox narrows on `ok`, and
  // without strictNullChecks TypeScript does not narrow a boolean discriminant.
  `npx tsc pos/app/lib/outbox.ts --outDir ${out} --module esnext --target es2022 --skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' }
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const O = await import(`file://${join(out, 'outbox.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}

const at = '2026-09-12T20:00:00.000Z'
const open = (id, checkId) => ({ kind: 'open', id, checkId, branch: 'Main', tableNumber: 4, guestCount: 2, at })
const lines = (id, checkId) => ({ kind: 'lines', id, checkId, batchKey: `b-${id}-000000`, lines: [{ refId: 'm1', quantity: 1 }], at })
const pay = (id, checkId) => ({ kind: 'pay', id, checkId, paymentKey: `p-${id}-000000`, payment: { tender: 'cash', currency: 'USD', amount: 10 }, at })

// A queue: open table A, two lots of items on it, a payment, then table B.
const queue = [open('1', 'A'), lines('2', 'A'), lines('3', 'A'), pay('4', 'A'), open('5', 'B')]
let state = queue.reduce(O.enqueue, O.EMPTY_OUTBOX)
const ids = s => s.queue.map(a => a.id)

// A fake server: records what arrives, and answers by a script.
const run = async (s, answers) => {
  const seen = []
  const r = await O.replay(s, async a => { seen.push(a.id); return answers(a) })
  return { r, seen }
}

console.log('\nreplay — in order, and nothing lost')
{
  const { r, seen } = await run(state, () => ({ ok: true }))
  eq('everything is sent, in the order it happened', seen, ['1', '2', '3', '4', '5'])
  eq('...and the queue is empty after', ids(r), [])
  eq('...nothing is stuck', r.stuck, null)
  eq('...and it counts what went', r.sent, 5)
}

console.log('\nthe connection drops mid-replay')
{
  const { r, seen } = await run(state, a => a.id === '3' ? { ok: false, retry: true, reason: 'offline' } : { ok: true })
  eq('it stops at the action that got no answer', seen, ['1', '2', '3'])
  eq('THE BUG: that action and everything after stay queued', ids(r), ['3', '4', '5'])
  eq('no answer is not a refusal — nothing is stuck', r.stuck, null)
  const again = await run(r, () => ({ ok: true }))
  eq('the next replay picks up exactly where it stopped', again.seen, ['3', '4', '5'])
}

console.log('\nthe server says no')
{
  const refused = await run(state, a => a.id === '1' ? { ok: false, retry: false, reason: 'Table 4 already has an open check.' } : { ok: true })
  eq('it stops at the refusal — does not press on to items for that table', refused.seen, ['1'])
  eq('...names the action and the reason', refused.r.stuck, { id: '1', reason: 'Table 4 already has an open check.' })
  eq('...and keeps everything queued', ids(refused.r), ['1', '2', '3', '4', '5'])
  const blocked = await run(refused.r, () => ({ ok: true }))
  eq('a stuck queue sends nothing until a person looks', blocked.seen, [])
  eq('a stuck queue still takes new actions', ids(O.enqueue(refused.r, pay('6', 'B'))), ['1', '2', '3', '4', '5', '6'])

  const dropped = O.resolveStuck(refused.r, 'drop')
  eq('dropping a refused open drops everything for that check', ids(dropped), ['5'])
  eq('...and the queue flows again', dropped.stuck, null)
  const retried = O.resolveStuck(refused.r, 'retry')
  eq('retrying keeps everything and unsticks it', [ids(retried), retried.stuck], [['1', '2', '3', '4', '5'], null])

  const payRefused = await run(state, a => a.id === '4' ? { ok: false, retry: false, reason: 'Open the drawer first.' } : { ok: true })
  const payDropped = O.resolveStuck(payRefused.r, 'drop')
  eq('dropping a refused payment drops only that payment', ids(payDropped), ['5'])

  // The check exists — only the payment was refused. Items rung up after it
  // are still real orders and must still be sent.
  const after = [open('1', 'A'), pay('2', 'A'), lines('3', 'A'), open('4', 'B')].reduce(O.enqueue, O.EMPTY_OUTBOX)
  const payFirst = await run(after, a => a.id === '2' ? { ok: false, retry: false, reason: 'Open the drawer first.' } : { ok: true })
  eq('...and keeps later items on that same check', ids(O.resolveStuck(payFirst.r, 'drop')), ['3', '4'])
}

console.log('\nthe change the counter handed over')
{
  const same = { changeUsd: 2, changeLbp: 5000 }
  eq('no expectation recorded — nothing to say', O.changeDiffers(undefined, same), false)
  eq('the same change is not a difference', O.changeDiffers({ changeUsd: 2, changeLbp: 5000 }, same), false)
  eq('a rounding artefact is not a difference', O.changeDiffers({ changeUsd: 2.001, changeLbp: 5000.4 }, same), false)
  eq('a dollar out IS a difference', O.changeDiffers({ changeUsd: 1, changeLbp: 5000 }, same), true)
  eq('a lira note out IS a difference', O.changeDiffers({ changeUsd: 2, changeLbp: 4000 }, same), true)
  eq('...whichever way round it is', O.changeDiffers({ changeUsd: 2, changeLbp: 6000 }, same), true)
}

console.log('\nthe service worker itself')
{
  // Nothing compiles public/ — it is copied as it stands — so a syntax error
  // in the worker ships, and a worker that cannot parse simply never
  // registers. The till carries on working, and quietly stops working
  // offline, which is then discovered during an outage. One parse is cheap.
  const swPath = 'pos/public/pos/sw.js'
  let parses = true
  try { execSync(`node --check ${swPath}`, { stdio: 'pipe' }) } catch { parses = false }
  eq('it parses — nothing else in the build would tell us', parses, true)

  const src = readFileSync(swPath, 'utf8')
  eq('nothing under /api/ is ever cached', src.includes("url.pathname.startsWith('/api/')"), true)
  eq('a GET is the only thing it answers for', src.includes("request.method !== 'GET'"), true)
}

console.log('\ncounting what is waiting')
eq('table A has four things waiting', O.waitingFor(state, 'A'), 4)
eq('table B has one', O.waitingFor(state, 'B'), 1)
eq('an unknown check has none', O.waitingFor(state, 'Z'), 0)
eq('enqueue does not change the state it was given', ids(O.EMPTY_OUTBOX), [])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
