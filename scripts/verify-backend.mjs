// Assertions over what the till watches — pos/app/lib/backend/queries.ts.
//
//   node scripts/verify-backend.mjs
//   npm run verify:backend
//
// POS software, stage 2. The till asks for a PosQuery; the cloud runs its plan
// as a Firestore listener and the hub (stage 3) runs the SAME plan over its
// local copy. So two things are asserted here: every plan the till can make is
// scoped (an unscoped listener reads a whole collection's history and turns
// into a bill), and running a plan locally gives what Firestore would — the
// right branch, the right statuses, newest first, the limit kept, and a
// document missing the ordered field left out.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'backend-verify-'))
execSync(
  `npx tsc pos/app/lib/backend/queries.ts --outDir ${out} --module esnext --target es2022 ` +
  `--skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}
const Q = await import(`file://${join(out, 'queries.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}

// Timestamps in the fixtures are { ms }; the app passes timestampMs().
const toMs = v => (v && typeof v === 'object' && typeof v.ms === 'number' ? v.ms : Number.NaN)
const branch = 'Main'
const ACTIVE = ['new', 'preparing', 'ready']

console.log('\nevery plan the till can make is scoped')
{
  const everything = [
    { kind: 'openChecks', branch },
    { kind: 'check', checkId: 'c1' },
    { kind: 'stationTickets', branch, station: 'Bar', statuses: ACTIVE },
    { kind: 'stationTickets', branch, station: null, statuses: ACTIVE },
    { kind: 'readyTickets', branch },
    { kind: 'closedChecks', branch, max: 50 },
    { kind: 'checksClosedSince', branch, sinceMs: 1000, ceiling: 2000 },
    { kind: 'recentClosedReceipts', branch },
    { kind: 'openShift', branch },
    { kind: 'menuCategories' }, { kind: 'menuItems' }, { kind: 'modifierGroups' }, { kind: 'products' },
  ]
  eq('THE TRAP: every query reads a bounded slice', everything.filter(q => !Q.isScoped(Q.planQuery(q))).map(q => q.kind), [])
  eq('a plan over checks with no branch is not scoped',
    Q.isScoped({ collection: 'checks', where: [{ field: 'status', op: '==', value: 'open' }] }), false)
  eq('an empty branch is not a branch', Q.isScoped(Q.planQuery({ kind: 'openChecks', branch: '' })), false)
  eq('an empty document id is not a document', Q.isScoped(Q.planQuery({ kind: 'check', checkId: '' })), false)
  eq('the open checks at a branch', Q.planQuery({ kind: 'openChecks', branch }),
    { collection: 'checks', where: [{ field: 'branch', op: '==', value: 'Main' }, { field: 'status', op: '==', value: 'open' }] })
  eq('every station: no station filter',
    Q.planQuery({ kind: 'stationTickets', branch, station: null, statuses: ACTIVE }).where.map(f => f.field), ['branch', 'status'])
  eq('one station: filtered by it',
    Q.planQuery({ kind: 'stationTickets', branch, station: 'Bar', statuses: ACTIVE }).where.map(f => f.field), ['branch', 'station', 'status'])
  eq('refunded checks stay on the review list', Q.planQuery({ kind: 'closedChecks', branch, max: 50 }).where[1].value, ['closed', 'refunded'])
  eq('the receipt watcher reads the newest ten', Q.planQuery({ kind: 'recentClosedReceipts', branch }).limit, 10)
}

console.log('\nthe hub runs a plan the way the cloud does')
{
  const checks = [
    { id: 'a', data: { branch: 'Main', status: 'open', closedAt: null } },
    { id: 'b', data: { branch: 'Main', status: 'closed', closedAt: { ms: 3000 } } },
    { id: 'c', data: { branch: 'Main', status: 'refunded', closedAt: { ms: 5000 } } },
    { id: 'd', data: { branch: 'Other', status: 'closed', closedAt: { ms: 9000 } } },
    { id: 'e', data: { branch: 'Main', status: 'closed', closedAt: { ms: 500 } } },
    { id: 'f', data: { branch: 'Main', status: 'closed' } },
  ]
  const run = q => Q.runPlan(Q.planQuery(q), checks, toMs).map(d => d.id)

  eq('the open checks at a branch', run({ kind: 'openChecks', branch }), ['a'])
  eq('closed and refunded, newest first', run({ kind: 'closedChecks', branch, max: 50 }), ['c', 'b', 'e'])
  eq('THE TRAP: another branch never leaks in', run({ kind: 'closedChecks', branch, max: 50 }).includes('d'), false)
  eq('the limit keeps the newest', run({ kind: 'closedChecks', branch, max: 2 }), ['c', 'b'])
  eq('closed since an instant, compared as a timestamp', run({ kind: 'checksClosedSince', branch, sinceMs: 1000, ceiling: 2000 }), ['c', 'b'])
  eq('a check with no closedAt is not closed since anything',
    run({ kind: 'checksClosedSince', branch, sinceMs: 0, ceiling: 2000 }).includes('f'), false)
  eq('...nor on a list ordered by it', run({ kind: 'closedChecks', branch, max: 50 }).includes('f'), false)
  eq('the receipt watcher sees closed, not refunded', run({ kind: 'recentClosedReceipts', branch }), ['b', 'e'])
  eq('one document by id', run({ kind: 'check', checkId: 'b' }), ['b'])
  eq('a missing document is none', run({ kind: 'check', checkId: 'zzz' }), [])

  const tickets = [
    { id: 't2', data: { branch: 'Main', station: 'Bar', status: 'new', sentAt: { ms: 20 } } },
    { id: 't1', data: { branch: 'Main', station: 'Kitchen', status: 'ready', sentAt: { ms: 10 } } },
    { id: 't3', data: { branch: 'Main', station: 'Bar', status: 'bumped', sentAt: { ms: 5 } } },
    { id: 't4', data: { branch: 'Main', station: 'Bar', status: 'preparing', sentAt: { ms: 20 } } },
  ]
  const runT = q => Q.runPlan(Q.planQuery(q), tickets, toMs).map(d => d.id)
  eq('one station\'s active tickets, oldest first, a tie by id', runT({ kind: 'stationTickets', branch, station: 'Bar', statuses: ACTIVE }), ['t2', 't4'])
  eq('every station, oldest first', runT({ kind: 'stationTickets', branch, station: null, statuses: ACTIVE }), ['t1', 't2', 't4'])
  eq('a bumped ticket is off the pass', runT({ kind: 'stationTickets', branch, station: null, statuses: ACTIVE }).includes('t3'), false)
  eq('ready tickets only', runT({ kind: 'readyTickets', branch }), ['t1'])

  const shifts = [
    { id: 's1', data: { branch: 'Main', status: 'closed' } },
    { id: 's2', data: { branch: 'Main', status: 'closing' } },
  ]
  eq('the open shift includes one being closed', Q.runPlan(Q.planQuery({ kind: 'openShift', branch }), shifts, toMs).map(d => d.id), ['s2'])
  eq('whole collections are whole', Q.runPlan(Q.planQuery({ kind: 'products' }), [{ id: 'p1', data: {} }, { id: 'p2', data: {} }], toMs).map(d => d.id), ['p1', 'p2'])
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
