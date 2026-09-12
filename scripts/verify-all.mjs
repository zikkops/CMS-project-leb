// Runs every verifier and audit in the repo, and says what it found.
//
//   npm run verify:all           # type-checks + every verifier + every audit
//   npm run verify:all -- --quick   # skip the type-checks
//
// ── Why this exists ────────────────────────────────────────────────────────
// The ritual in CLAUDE.md lists sixteen commands, each with an "if you touched
// X" condition. That list is honest about intent and useless as a gate: the
// real answer to "did you run the ritual?" is usually "most of it", and the
// list had already drifted — verify:features and verify:hosts existed for
// weeks without appearing in it.
//
// A single command cannot drift, because it discovers the scripts from
// package.json rather than repeating their names. A verifier added tomorrow is
// in this run without anybody remembering to add it.
//
// It does NOT run `npm run build`. Three Next builds take minutes and prove
// compilation, which tsc already proves faster; the build stays a deliberate
// step before a commit that touches an app.

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const QUICK = process.argv.includes('--quick')

const scripts = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).scripts)
  .filter(name => (name.startsWith('verify:') || name.startsWith('audit:')) && name !== 'verify:all')
  .sort()

const tasks = [
  ...(QUICK ? [] : ['pos', 'admin', 'web'].map(app => ({
    label: `tsc ${app}`,
    command: `npx tsc --noEmit -p ${app}`,
  }))),
  ...scripts.map(name => ({ label: name, command: `npm run ${name}` })),
]

function run(task) {
  return new Promise(resolve => {
    const started = Date.now()
    const child = spawn(task.command, { shell: true })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.on('close', code => {
      resolve({ ...task, code, out, ms: Date.now() - started })
    })
  })
}

/**
 * What a task's output says, in one phrase.
 *
 * Every verifier ends with "N passed, M failed"; the audits and the two
 * consistency checks have their own shapes, so they get a plain ok. Reading
 * the count matters beyond decoration: a verifier that silently asserts
 * nothing still exits 0, and "0 assertions" is the only thing that shows it.
 */
function summarise(result) {
  const passed = result.out.match(/(\d+) passed, (\d+) failed/)
  if (passed) {
    const [, ok, bad] = passed
    return { assertions: Number(ok), note: Number(bad) > 0 ? `${bad} FAILED` : `${ok} assertions` }
  }
  if (/Ratchet: \d+ tracked/.test(result.out)) return { assertions: 0, note: 'ratchet held' }
  if (/at or under the baseline/.test(result.out)) return { assertions: 0, note: 'at baseline' }
  if (/Registry and SECTION_ACCESS agree/.test(result.out)) return { assertions: 0, note: 'registry agrees' }
  return { assertions: 0, note: result.code === 0 ? 'ok' : 'failed' }
}

// Four at a time: each verifier spawns its own tsc, so running them one by one
// wastes most of the machine, and running all seventeen at once thrashes it.
const LANES = 4
const results = []
const queue = [...tasks]

console.log(`\nRunning ${tasks.length} checks${QUICK ? ' (type-checks skipped)' : ''}…\n`)

await Promise.all(Array.from({ length: LANES }, async () => {
  for (;;) {
    const task = queue.shift()
    if (!task) return
    const result = await run(task)
    results.push(result)
    const { note } = summarise(result)
    const mark = result.code === 0 ? '  ok ' : 'FAIL '
    console.log(`  ${mark} ${task.label.padEnd(22)} ${note.padEnd(18)} ${(result.ms / 1000).toFixed(1)}s`)
  }
}))

const failed = results.filter(r => r.code !== 0)
const assertions = results.reduce((s, r) => s + summarise(r).assertions, 0)
const verifiers = results.filter(r => summarise(r).assertions > 0).length
const seconds = (results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(0)

console.log(`\n${results.length} checks · ${verifiers} verifiers · ${assertions} assertions · ${seconds}s of work`)

if (failed.length === 0) {
  console.log('Everything passes.\n')
  process.exit(0)
}

console.log(`\n${failed.length} FAILED:\n`)
for (const f of failed) {
  console.log(`── ${f.label} ${'─'.repeat(Math.max(0, 60 - f.label.length))}`)
  // The tail, not the whole run: a verifier prints a line per assertion and
  // the failures are at the end with the summary.
  console.log(f.out.trimEnd().split('\n').slice(-25).join('\n'))
  console.log()
}
process.exit(1)
