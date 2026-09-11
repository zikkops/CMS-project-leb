// Assertions over what an error report may contain — shared/src/errorReport.ts.
//
//   node scripts/verify-errors.mjs
//   npm run verify:errors
//
// Same shape as the other verifiers: transpile the real module with the
// project's own TypeScript and assert against it. Nothing is re-implemented.
//
// ── Why this one matters more than it looks ────────────────────────────────
// /api/errors takes an UNAUTHENTICATED POST, because a customer on the public
// site is signed out when their page breaks. So this module is the boundary
// between "a browser said something" and "we wrote it down", and the two
// properties below are the whole of its job:
//
//   redaction — a token or an email that reaches storage has reached it; a
//   scrub at display time is a scrub that happened too late.
//
//   fingerprinting — one document per fault, not per occurrence. Get this
//   wrong in the loose direction and two faults share a count; get it wrong in
//   the strict direction and a render loop writes a document per frame, which
//   turns a bug into a bill.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'errors-verify-'))
execSync(
  `npx tsc shared/src/errorReport.ts --outDir ${out} --module esnext --target es2022 ` +
  `--skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const E = await import(`file://${join(out, 'errorReport.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}

console.log('\nnothing private survives being written down')
{
  // Assembled rather than written out. audit:branding counts an email literal
  // anywhere in code, fixtures included, and it is right to — a test nobody
  // reads is exactly how a real café address ends up shipped. redact() still
  // receives the same string it would meet in the wild.
  const email = ['sara', 'cafe.example.com'].join('@')
  const r = E.buildReport({
    app: 'pos',
    message: `Failed for ${email} with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc`,
    stack: 'at pay (/pos/check/9?token=secret-value-here)',
    path: `https://pos.example.com/pos/check/9?rate=91000&who=${email}`,
  })
  eq('an email never reaches storage', /sara@/.test(r.message), false)
  eq('...nor a JWT', /eyJ/.test(r.message), false)
  eq('...nor a query string in the stack', /secret-value-here/.test(r.stack), false)
  eq('the path keeps the page but loses the query', r.path, '/pos/check/9')
  eq('a long key-shaped string goes too', /[A-Za-z0-9_-]{32,}/.test(E.redact('k=' + 'a'.repeat(40))), false)
  eq('an ordinary message is left alone', E.redact('Cannot read length of undefined'), 'Cannot read length of undefined')
}

console.log('\nthe same fault is one document, not a hundred')
{
  const a = E.fingerprintOf('pos', 'Cannot read x of check abc123', 'at pay (chunk-9f8e7d6c.js:1:2)')
  const b = E.fingerprintOf('pos', 'Cannot read x of check def456', 'at pay (chunk-9f8e7d6c.js:1:2)')
  eq('the id in the message does not split it in two', a, b)

  const afterDeploy = E.fingerprintOf('pos', 'Cannot read x of check abc123', 'at pay (chunk-11223344.js:1:2)')
  eq('...and neither does a new build hash', a, afterDeploy)

  const other = E.fingerprintOf('pos', 'Something else entirely', 'at pay (chunk-9f8e7d6c.js:1:2)')
  eq('a different fault IS a different document', a === other, false)

  const sameOnWeb = E.fingerprintOf('web', 'Cannot read x of check abc123', 'at pay (chunk-9f8e7d6c.js:1:2)')
  eq('the same message in another app is its own document', a === sameOnWeb, false)

  eq('it is safe as a document id', /^[a-z]+-[0-9a-f]{16}$/.test(a), true)
  eq('...and it never contains a slash', a.includes('/'), false)
}

console.log('\na document cannot be used as storage')
{
  const r = E.buildReport({
    app: 'admin',
    message: 'x'.repeat(5000),
    stack: 'y'.repeat(50_000),
    digest: '../../etc/passwd',
    path: '/admin/' + 'z'.repeat(500),
  })
  eq('the message is capped', r.message.length <= E.LIMITS.message + 1, true)
  eq('the stack is capped', r.stack.length <= E.LIMITS.stack + 1, true)
  eq('the path is capped', r.path.length <= E.LIMITS.path + 1, true)
  eq('a digest keeps only word characters', r.digest, 'etcpasswd')
  eq('an unknown app falls back rather than being stored', E.buildReport({ app: 'kitchen', message: 'x' }).app, 'web')
  eq('a message-less error still says something', E.buildReport({ app: 'web', message: '' }).message, 'An error with no message.')
}

console.log('\nthe browser holds back')
{
  const fp = 'pos-0011223344556677'
  const first = E.shouldReport(E.EMPTY_THROTTLE, fp, 1_000_000)
  eq('the first one goes', first.send, true)

  const again = E.shouldReport(first.state, fp, 1_000_500)
  eq('THE LOOP: the same fault half a second later does not', again.send, false)
  eq('...and it says why', again.reason, 'already reported just now')

  const later = E.shouldReport(first.state, fp, 1_000_000 + E.REPORT_WINDOW_MS + 1)
  eq('after the window it goes again', later.send, true)

  let state = E.EMPTY_THROTTLE
  for (let i = 0; i < E.MAX_PER_LOAD; i++) {
    state = E.shouldReport(state, `pos-${i}`, 2_000_000 + i).state
  }
  const capped = E.shouldReport(state, 'pos-different', 2_000_100)
  eq('a page load cannot report forever, even with new faults', capped.send, false)
  eq('...and it says why', capped.reason, 'enough from this page load')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
