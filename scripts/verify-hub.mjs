// Assertions over the café hub's database — shared/src/server/hubStore.ts.
//
//   node scripts/verify-hub.mjs
//   npm run verify:hub
//
// POS software, stage 3. On a hub, adminDb() is a SQLite file shaped like
// Firestore, and the till's server code runs over it unchanged. Two things are
// asserted here, in that order:
//
//   1. The store answers as Firestore answers — values, refusals, writes,
//      queries, and above all transactions: a read that changed makes the
//      transaction run again, so no update is lost and no table gets two checks.
//   2. The REAL server code — openCheck, addLines, sendCheck, advanceTicket,
//      addPayment, closeCheck, openShift, closeShift — compiled from
//      shared/src/server and run over the hub, end to end, for one table.
//
// Part 2 is the point. A store that passes its own tests and trips over the
// first transaction checks.ts runs has proved nothing.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'

// Compiled inside the repo, so the server code finds firebase-admin in
// node_modules — and the SAME copy this script imported, which is what lets
// the store recognise the sentinels it is handed.
const out = join('node_modules', '.cache', `verify-hub-${process.pid}`)
rmSync(out, { recursive: true, force: true })
try {
  execSync(
    'npx tsc shared/src/server/hubStore.ts shared/src/server/checks.ts shared/src/server/tickets.ts ' +
    'shared/src/server/hubWatch.ts shared/src/server/hubSession.ts shared/src/server/soldOut.ts shared/src/server/receiptEmail.ts shared/src/server/supplyTransfer.ts ' +
    `shared/src/server/drawer.ts --outDir ${out} --rootDir shared/src --module esnext --target es2022 ` +
    '--moduleResolution bundler --skipLibCheck --strict --types node --lib es2023,dom --resolveJsonModule',
    { stdio: 'pipe' },
  )
} catch (err) {
  console.error(String(err.stdout ?? err))
  process.exit(1)
}
const fixImports = dir => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { fixImports(p); continue }
    if (!p.endsWith('.js')) continue
    writeFileSync(p, readFileSync(p, 'utf8')
      .replace(/(from\s+|import\s*\()'(\.\.?\/[^']+?)'/g, (_, lead, spec) => `${lead}'${spec.endsWith('.js') ? spec : `${spec}.js`}'`))
  }
}
fixImports(out)
// The till's own query plans, compiled on their own: the hub has to answer them as runPlan() does.
const queriesOut = join(out, 'pos-queries')
execSync(
  `npx tsc pos/app/lib/backend/queries.ts --outDir ${queriesOut} --module esnext --target es2022 ` +
  '--skipLibCheck --moduleResolution bundler --strict',
  { stdio: 'pipe' },
)
writeFileSync(join(out, 'package.json'), '{ "type": "module" }')
const url = rel => pathToFileURL(resolve(out, rel)).href
const H = await import(url('server/hubStore.js'))

const tmp = mkdtempSync(join(tmpdir(), 'hub-verify-'))

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(76)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}
/** Passes when the call is refused and the error fits: a regex on the message, or a predicate. */
const rejects = async (name, fn, fits) => {
  let err = null
  try { await fn() } catch (e) { err = e }
  const ok = err !== null && (fits instanceof RegExp ? fits.test(String(err.message)) : fits(err))
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(76)} got=${err ? JSON.stringify(err.message) : 'no refusal'}`)
  if (ok) pass++; else fail++
}
const fresh = () => H.openHubStore(new DatabaseSync(':memory:'))
const turn = () => new Promise(r => setImmediate(r))

// A throw from the store under test is a failure to count, not a crash that
// hides the count: the rest of the run is skipped and the summary still prints.
try {

console.log('\nvalues come back as they went in')
{
  const db = fresh()
  await db.doc('things/a').set({
    at: Timestamp.fromMillis(1_700_000_000_123), when: new Date(1_700_000_000_000), nan: Number.NaN,
    nested: { list: [1, 'two', null, { deep: true }] }, $fs: 'literal',
  })
  const d = (await db.doc('things/a').get()).data()
  eq('a Timestamp comes back as a Timestamp', d.at instanceof Timestamp && d.at.toMillis(), 1_700_000_000_123)
  eq('a Date is stored as a Timestamp, as Firestore stores it', d.when instanceof Timestamp, true)
  eq('NaN survives', Number.isNaN(d.nan), true)
  eq('nested maps and arrays', d.nested, { list: [1, 'two', null, { deep: true }] })
  eq('a field literally called $fs is data, not a tag', d.$fs, 'literal')
  d.nested.list.push('changed')
  eq('data() is a copy: changing it changes nothing stored', (await db.doc('things/a').get()).data().nested.list.length, 4)
  eq('a missing document does not exist', (await db.doc('things/zzz').get()).exists, false)
  eq('an automatic id is twenty letters and digits', /^[A-Za-z0-9]{20}$/.test(db.collection('things').doc().id), true)
  eq('the SDK sentinels are still readable (an upgrade renaming them fails here)',
    [FieldValue.increment(3).methodName, FieldValue.increment(3).operand, FieldValue.arrayUnion('x').elements],
    ['FieldValue.increment', 3, ['x']])
}

console.log('\nit refuses what Firestore refuses')
{
  const db = fresh()
  await rejects('THE TRAP: undefined is refused, never quietly dropped', () => db.doc('x/1').set({ a: undefined }), /undefined/)
  await rejects('a sentinel inside an array is refused', () => db.doc('x/1').set({ a: [FieldValue.serverTimestamp()] }), /inside an array/)
  await rejects('an array inside an array is refused', () => db.doc('x/1').set({ a: [[1]] }), /cannot hold an array/)
  await rejects('update on a missing document: NOT_FOUND, code 5', () => db.doc('x/none').update({ a: 1 }), e => e.code === 5)
  await db.doc('x/2').create({ a: 1 })
  await rejects('create on an existing document: code 6, what idempotency.ts looks for', () => db.doc('x/2').create({ a: 2 }), e => e.code === 6)
  await rejects('delete() in a plain set is refused', () => db.doc('x/3').set({ a: FieldValue.delete() }), /merge/)
  await rejects('a value Firestore cannot store is refused', () => db.doc('x/4').set({ a: new Map() }), /serialize/)
}

console.log('\nwrites land as Firestore lands them')
{
  const db = fresh()
  const ref = db.doc('products/p1')
  await ref.set({ name: 'Mug', stock: { Main: 5, Second: 2 }, tags: ['a'] })
  await ref.update({ 'stock.Main': FieldValue.increment(-2), updatedAt: FieldValue.serverTimestamp() })
  let d = (await ref.get()).data()
  eq('a dotted update changes one branch and leaves the other', d.stock, { Main: 3, Second: 2 })
  eq('serverTimestamp() arrives as a Timestamp', d.updatedAt instanceof Timestamp, true)
  await ref.update({ 'stock.Third': FieldValue.increment(4) })
  eq('increment on a field not there sets the operand', (await ref.get()).data().stock.Third, 4)
  await ref.update({ tags: FieldValue.arrayUnion('a', 'b', 'b') })
  eq('arrayUnion adds only what is missing, once', (await ref.get()).data().tags, ['a', 'b'])
  await ref.update({ tags: FieldValue.arrayRemove('a') })
  eq('arrayRemove takes it out', (await ref.get()).data().tags, ['b'])
  await ref.set({ stock: { Main: 9 }, tags: FieldValue.delete() }, { merge: true })
  d = (await ref.get()).data()
  eq('merge changes a nested field and keeps its siblings', d.stock, { Main: 9, Second: 2, Third: 4 })
  eq('merge keeps the fields it was not given, and deletes on request', [d.name, 'tags' in d], ['Mug', false])
  await ref.set({ name: 'Cup' })
  eq('a plain set replaces the whole document', Object.keys((await ref.get()).data()), ['name'])
  await ref.delete()
  eq('a deleted document is gone', (await ref.get()).exists, false)

  const batch = db.batch()
  batch.set(db.doc('x/a'), { t: FieldValue.serverTimestamp() })
  batch.set(db.doc('x/b'), { t: FieldValue.serverTimestamp() })
  await batch.commit()
  eq('every serverTimestamp in one commit is one instant',
    (await db.doc('x/a').get()).data().t.isEqual((await db.doc('x/b').get()).data().t), true)

  const bad = db.batch()
  bad.set(db.doc('x/c'), { ok: true })
  bad.update(db.doc('x/missing'), { a: 1 })
  await rejects('a batch holding a refused write fails', () => bad.commit(), e => e.code === 5)
  eq('THE TRAP: and writes none of it', (await db.doc('x/c').get()).exists, false)

  const obj = { a: 1 }
  const later = db.batch()
  later.set(db.doc('x/d'), obj)
  obj.a = 2
  await later.commit()
  eq('the write is what was handed over, not the object as it is later', (await db.doc('x/d').get()).data().a, 1)
}

console.log('\nqueries answer as Firestore answers')
{
  const db = fresh()
  const put = (id, data) => db.doc(`checks/${id}`).set(data)
  // Written out of id order, so "ordered by id" cannot pass on insertion order.
  await put('e', { branch: 'Main', status: 'closed', total: '30' })
  await put('c', { branch: 'Main', status: 'refunded', total: 20, closedAt: Timestamp.fromMillis(5000) })
  await put('a', { branch: 'Main', status: 'open', total: 10, shiftIds: ['s1'] })
  await put('d', { branch: 'Other', status: 'closed', total: 99, closedAt: Timestamp.fromMillis(9000) })
  await put('b', { branch: 'Main', status: 'closed', total: 30, closedAt: Timestamp.fromMillis(3000), shiftIds: ['s1', 's2'] })
  const checks = db.collection('checks')
  const ids = async q => (await q.get()).docs.map(s => s.id)
  eq('equality on two fields', await ids(checks.where('branch', '==', 'Main').where('status', '==', 'open')), ['a'])
  eq('in', await ids(checks.where('branch', '==', 'Main').where('status', 'in', ['closed', 'refunded'])), ['b', 'c', 'e'])
  eq('array-contains, as the Z close asks', await ids(checks.where('shiftIds', 'array-contains', 's2')), ['b'])
  eq('THE TRAP: the string "30" is not the number 30', await ids(checks.where('total', '==', 30)), ['b'])
  eq('a range matches only its own type, ordered by that field', await ids(checks.where('total', '>=', 20)), ['c', 'b', 'd'])
  eq('a range on a Timestamp', await ids(checks.where('closedAt', '>=', Timestamp.fromMillis(4000))), ['c', 'd'])
  eq('newest first, and a document without the field is left out',
    await ids(checks.where('branch', '==', 'Main').orderBy('closedAt', 'desc')), ['c', 'b'])
  eq('the limit keeps the first', await ids(checks.orderBy('closedAt', 'desc').limit(2)), ['d', 'c'])
  eq('with no ordering, by document id', await ids(checks), ['a', 'b', 'c', 'd', 'e'])
  eq('!= leaves out a document without the field', await ids(checks.where('closedAt', '!=', Timestamp.fromMillis(3000))), ['c', 'd'])
  eq('another branch never leaks in', (await ids(checks.where('branch', '==', 'Main'))).includes('d'), false)
  eq('THE TRAP: == null does not match a document without the field', await ids(checks.where('closedAt', '==', null)), [])
}

console.log('\ntransactions behave as Firestore transactions')
{
  const db = fresh()
  const ref = db.doc('counters/c')
  await ref.set({ n: 0 })
  await rejects('THE TRAP: a read after a write is refused',
    () => db.runTransaction(async tx => { tx.set(ref, { n: 1 }); await tx.get(ref) }), /before all writes/)
  await rejects('a throw inside the callback is the answer',
    () => db.runTransaction(async tx => { await tx.get(ref); tx.update(ref, { n: 5 }); throw new Error('no') }), /^no$/)
  eq('...and neither wrote anything', (await ref.get()).data().n, 0)

  // A reads, B reads and commits, A commits: A must run again and see B.
  let release
  const gate = new Promise(r => { release = r })
  let runsA = 0
  const a = db.runTransaction(async tx => {
    runsA++
    const n = (await tx.get(ref)).data().n
    if (runsA === 1) await gate
    tx.update(ref, { n: n + 1 })
  })
  await turn(); await turn()
  await db.runTransaction(async tx => { const n = (await tx.get(ref)).data().n; tx.update(ref, { n: n + 10 }) })
  release()
  await a
  eq('THE TRAP: a transaction whose read changed runs again, so no update is lost', (await ref.get()).data().n, 11)
  eq('...it ran twice', runsA, 2)

  // Two waiters open table 8. Both queries find nothing; only running the
  // query again, at commit, finds the check the other one made.
  const tables = db.collection('checks')
  let openRelease
  const openGate = new Promise(r => { openRelease = r })
  let runsX = 0
  const openTable = (who, wait) => db.runTransaction(async tx => {
    if (who === 'x') runsX++
    const found = await tx.get(tables.where('tableId', '==', 't8').where('status', '==', 'open').limit(1))
    if (wait && runsX === 1) await openGate
    if (!found.empty) throw new Error('Table 8 already has an open check.')
    tx.set(tables.doc(), { tableId: 't8', status: 'open', who })
  })
  const x = openTable('x', true).then(() => 'opened', e => e.message)
  await turn(); await turn()
  await openTable('y', false)
  openRelease()
  eq('THE TRAP: two waiters, one table, and the second is told', await x, 'Table 8 already has an open check.')
  eq('...one check on the table', (await tables.where('tableId', '==', 't8').get()).size, 1)
  eq('...because the query ran again', runsX, 2)

  let runs = 0
  await rejects('a transaction that never settles gives up: ABORTED, code 10', () => db.runTransaction(async tx => {
    runs++
    await tx.get(ref)
    await ref.update({ n: FieldValue.increment(1) })
    tx.update(ref, { n: 0 })
  }), e => e.code === 10)
  eq('...after five attempts, as the SDK makes', runs, 5)
}

console.log('\nthe change log, and a file that outlives the process')
{
  const file = join(tmp, 'store.db')
  const sql = new DatabaseSync(file)
  const db = H.openHubStore(sql)
  const heard = []
  const off = db.onChange(changes => heard.push(...changes.map(c => c.path)))
  const start = db.lastSeq()
  await db.doc('a/1').set({ v: 1 })
  const batch = db.batch()
  batch.set(db.doc('a/2'), { v: 2 })
  batch.delete(db.doc('a/1'))
  await batch.commit()
  off()
  await db.doc('a/3').set({ v: 3 })
  eq('a listener hears each commit, and nothing after it leaves', heard, ['a/1', 'a/2', 'a/1'])
  eq('the log lists every write in order, deletes marked',
    db.changesSince(start).map(c => `${c.path}${c.deleted ? ' deleted' : ''}`), ['a/1', 'a/2', 'a/1 deleted', 'a/3'])
  eq('a document\'s version is the write that made it', (await db.doc('a/3').get()).version, db.lastSeq())

  // Trimming (UPGRADE.md T5.2): sent and old goes, the rest stays, and the
  // newest change stays whatever, so lastSeq() never goes backwards.
  const newest = db.lastSeq()
  sql.prepare('UPDATE changes SET at = ?').run(Date.now() - 30 * 86_400_000)
  eq('nothing unsent is trimmed, however old', db.trimChanges(0, Date.now()), 0)
  eq('sent and old: trimmed up to the place, no further', db.trimChanges(start + 2, Date.now() - 7 * 86_400_000), 2)
  eq('...the unsent ones are all still there', db.changesSince(start).map(c => c.path), ['a/1', 'a/3'])
  eq('everything sent and old still keeps the newest change', db.trimChanges(newest, Date.now()), 1)
  eq('...so lastSeq() has not gone back', db.lastSeq(), newest)
  await db.doc('a/4').set({ v: 4 })
  eq('the next change gets a new number, never a trimmed one', db.lastSeq(), newest + 1)
  eq('a document written before the trim keeps its version', (await db.doc('a/3').get()).version, newest)
  db.trimChanges(db.lastSeq(), Date.now() - 7 * 86_400_000)
  eq('a recent change is kept even when sent; the old one before it goes', db.changesSince(0).map(c => c.path), ['a/4'])
  sql.close()
  const sql2 = new DatabaseSync(file)
  const again = H.openHubStore(sql2)
  eq('reopened, what was written is there', (await again.doc('a/2').get()).data(), { v: 2 })
  eq('...and what was deleted is still deleted', (await again.doc('a/1').get()).exists, false)
  sql2.close()
}

// ── A year of checks (UPGRADE.md T5.3) ─────────────────────────────────────
// SQLite narrows before anything is decoded: branch and status by index, a
// shift's checks by the array, today's closings by the Timestamp's seconds.
// Each answer is compared with the same question asked of the seed directly,
// and the rows decoded are counted, because a narrowing that holds back a
// true match is a wrong answer and one that narrows nothing is no narrowing.
console.log('\na year of checks: indexed, narrowed, and still the right answer')
{
  const { Timestamp: TS } = await import('firebase-admin/firestore')
  const sql = new DatabaseSync(join(tmp, 'year.db'))
  const db = H.openHubStore(sql)
  const DAY = 86_400_000
  const now = Date.UTC(2026, 8, 21, 12)
  const seed = []
  for (let i = 0; i < 6000; i++) {
    const closedMs = now - Math.floor(i / 16) * DAY - (i % 16) * 600_000
    seed.push({
      id: `c${String(i).padStart(5, '0')}`,
      branch: i % 5 === 0 ? 'Other' : 'Main',
      status: i % 40 === 0 ? 'refunded' : 'closed',
      shiftIds: [`s${Math.floor(i / 16)}`],
      closedAt: TS.fromMillis(closedMs),
    })
  }
  for (let i = 0; i < 7; i++) seed.push({ id: `open${i}`, branch: i < 5 ? 'Main' : 'Other', status: 'open', shiftIds: ['s0'], openedAt: TS.fromMillis(now) })
  for (let i = 0; i < seed.length; i += 450) {
    const b = db.batch()
    for (const c of seed.slice(i, i + 450)) { const { id, ...data } = c; b.set(db.doc(`checks/${id}`), data) }
    await b.commit()
  }
  const ids = snap => snap.docs.map(d => d.id).sort()
  const want = pred => seed.filter(pred).map(c => c.id).sort()
  const scanned = async run => { const before = db.stats().scanned; const out = await run(); return [out, db.stats().scanned - before] }

  const [open, openRows] = await scanned(() => db.collection('checks').where('branch', '==', 'Main').where('status', '==', 'open').get())
  eq('open checks at a branch: the right five', ids(open), want(c => c.branch === 'Main' && c.status === 'open'))
  eq('...and only those five were decoded, of 6,007', openRows, 5)
  const plan = sql.prepare("EXPLAIN QUERY PLAN SELECT path FROM docs WHERE collection = ? AND json_extract(data, '$.branch') = ? AND json_extract(data, '$.status') = ?").all('checks', 'Main', 'open')
  eq('...found through the branch-and-status index', plan.some(r => /docs_branch_status/.test(String(r.detail))), true)

  const [shift, shiftRows] = await scanned(() => db.collection('checks').where('shiftIds', 'array-contains', 's3').get())
  eq("a shift's checks, for its X or Z reading", ids(shift), want(c => c.shiftIds.includes('s3')))
  eq('...decoding only those', shiftRows, shift.size)

  const [ended, endedRows] = await scanned(() => db.collection('checks').where('branch', '==', 'Main').where('status', 'in', ['closed', 'refunded']).get())
  eq('closed and refunded, by in', ended.size, seed.filter(c => c.branch === 'Main' && c.status !== 'open').length)
  eq('...decoding no open check and no other branch', endedRows, ended.size)

  const since = TS.fromMillis(now - DAY + 1)
  const [today, todayRows] = await scanned(() => db.collection('checks').where('branch', '==', 'Main').where('status', 'in', ['closed', 'refunded'])
    .where('closedAt', '>=', since).orderBy('closedAt', 'desc').limit(2000).get())
  eq("today's closings, newest first", today.docs.map(d => d.id),
    seed.filter(c => c.branch === 'Main' && c.status !== 'open' && c.closedAt.toMillis() >= since.toMillis())
      .sort((a, b) => b.closedAt.toMillis() - a.closedAt.toMillis() || (a.id < b.id ? 1 : -1)).map(c => c.id))
  eq('...decoding a day, not a year', todayRows <= today.size + 16, true)
  const edge = TS.fromMillis(now - 5 * 600_000 + 1)
  const [justAfter] = await scanned(() => db.collection('checks').where('closedAt', '>', edge).get())
  eq('a range on a Timestamp still judges the part of a second SQLite rounds away', ids(justAfter), want(c => c.closedAt && c.closedAt.toMillis() > edge.toMillis()))
  const [before] = await scanned(() => db.collection('checks').where('closedAt', '<', TS.fromMillis(now - 370 * DAY)).get())
  eq('...and from the other side', ids(before), want(c => c.closedAt && c.closedAt.toMillis() < now - 370 * DAY))

  // Within one second: SQLite sees the same whole seconds for both, so only
  // the check here can tell them apart, and the narrowing must let both by.
  const base = Math.floor(now / 1000) * 1000
  await db.doc('stamps/early').set({ at: TS.fromMillis(base + 200) })
  await db.doc('stamps/late').set({ at: TS.fromMillis(base + 700) })
  const mid = TS.fromMillis(base + 500)
  eq('within one second: after', ids(await db.collection('stamps').where('at', '>', mid).get()), ['late'])
  eq('within one second: at or after', ids(await db.collection('stamps').where('at', '>=', mid).get()), ['late'])
  eq('within one second: before', ids(await db.collection('stamps').where('at', '<', mid).get()), ['early'])
  eq('within one second: at or before', ids(await db.collection('stamps').where('at', '<=', mid).get()), ['early'])

  const t0 = performance.now()
  const recent = await db.collection('checks').where('branch', '==', 'Main').where('status', 'in', ['closed', 'refunded']).orderBy('closedAt', 'desc').limit(50).get()
  const ms = performance.now() - t0
  eq('the closed-checks screen over a year: the newest fifty', recent.size, 50)
  eq(`...in well under a second (${Math.round(ms)} ms)`, ms < 1000, true)
  sql.close()
}

console.log('\nthe till\'s own server code, unchanged, over the hub')
{
  const file = join(tmp, 'hub.db')
  process.env.BIG_CMS_HUB_DB = file
  const FA = await import(url('server/firebaseAdmin.js'))
  const C = await import(url('server/checks.js'))
  const T = await import(url('server/tickets.js'))
  const D = await import(url('server/drawer.js'))
  const SO = await import(url('server/soldOut.js'))
  const ER = await import(url('server/receiptEmail.js'))
  const ST = await import(url('server/supplyTransfer.js'))
  const { BRAND } = await import(url('brand.js'))
  const db = FA.adminDb()
  eq('adminDb() is the hub\'s store when BIG_CMS_HUB_DB is set', db instanceof H.HubStore, true)
  let signIn = null
  try { FA.adminAuth() } catch (e) { signIn = e.message }
  eq('THE TRAP: no Firebase sign-in on the hub, so no Admin key is ever needed there', /not used on the café hub/.test(signIn ?? ''), true)

  const branch = BRAND.branches[0]
  const staff = { uid: 'u-till', email: null, role: 'manager', branchIds: [branch], superadmin: false, isStaff: true }
  await db.doc('appSettings/features').set({ pos: { enabled: true }, kds: { enabled: true }, payments: { enabled: true } })
  await db.doc('menuCategories/cat-food').set({ name: 'Food', section: 'Food' })
  await db.doc('menuItems/m-toast').set({ name: 'Toast', price: 4.5, categoryId: 'cat-food', available: true, modifierGroupIds: [] })
  await db.doc('products/p-mug').set({ name: 'Mug', price: 12, stock: { [branch]: 5 } })

  const shift = await D.openShift(staff, branch, { usd: 50, lbp: 0 })
  await rejects('a second drawer at the branch is refused', () => D.openShift(staff, branch, { usd: 50, lbp: 0 }), e => e.status === 409)

  const { id: checkId } = await C.openCheck(staff, { branch, tableNumber: 7, guestCount: 2 })
  await rejects('a second check on table 7 is refused', () => C.openCheck(staff, { branch, tableNumber: 7, guestCount: 2 }), e => e.status === 409)
  const racing = await Promise.allSettled([
    C.openCheck(staff, { branch, tableNumber: 8, guestCount: 1 }),
    C.openCheck(staff, { branch, tableNumber: 8, guestCount: 1 }),
  ])
  eq('two waiters open table 8 at the same moment: one check, one refusal',
    [racing.map(r => (r.status === 'fulfilled' ? 'ok' : r.reason.status)).sort(),
      (await db.collection('checks').where('tableId', '==', 'n:8').get()).size], [[409, 'ok'], 1])

  const lines = C.parseLineRequests({ lines: [{ source: 'menu', refId: 'm-toast', quantity: 2 }, { source: 'product', refId: 'p-mug', quantity: 1 }] })
  const added = await C.addLines(staff, checkId, lines, 'batch-0001')
  const resent = await C.addLines(staff, checkId, lines, 'batch-0001')
  eq('items are priced from the hub\'s own menu', added.lines.map(l => `${l.name} ${l.unitPrice}`), ['Toast 4.5', 'Mug 12'])
  eq('THE TRAP: the same batch sent twice is added once',
    [resent.duplicate, (await db.doc(`checks/${checkId}`).get()).data().lines.length], [true, 2])

  // 86 from the till (UPGRADE.md T3.5), on the hub's own menu.
  const marked = await SO.setSoldOut('m-toast', branch, true)
  eq('marking a dish sold out changes it once', [marked.changed, (await SO.setSoldOut('m-toast', branch, true)).changed], [true, false])
  await rejects('THE TRAP: a sold-out dish cannot be added at that branch today',
    () => C.addLines(staff, checkId, C.parseLineRequests({ lines: [{ source: 'menu', refId: 'm-toast', quantity: 1 }] }), 'batch-0086'),
    e => e.status === 409 && /sold out/.test(e.message))
  const madeOffline = await C.addLines(staff, checkId, C.parseLineRequests({ lines: [{ source: 'menu', refId: 'm-toast', quantity: 1 }] }), 'batch-0087', new Date().toISOString())
  eq('...but an order the kitchen already made during an outage is still recorded', madeOffline.added, 1)
  eq('another branch still sells it', (await db.doc('menuItems/m-toast').get()).data().soldOut, { [branch]: marked.day })
  await SO.setSoldOut('m-toast', branch, false)
  eq('put back on, the mark is gone, not left empty', (await db.doc('menuItems/m-toast').get()).data().soldOut, {})
  await db.doc('menuItems/m-toast').update({ soldOut: { [branch]: '2020-01-01' } })
  const nextDay = await C.addLines(staff, checkId, C.parseLineRequests({ lines: [{ source: 'menu', refId: 'm-toast', quantity: 1 }] }), 'batch-0088')
  eq('a mark from another day has expired by itself', nextDay.added, 1)
  await C.voidLine(staff, checkId, madeOffline.lines[0].id, 'rung-wrong', '')
  await C.voidLine(staff, checkId, nextDay.lines[0].id, 'rung-wrong', '')

  const sent = await C.sendCheck(staff, checkId)
  eq('Send makes one ticket, for the kitchen', sent.tickets.map(t => `${t.station} ${t.lines}`), ['Kitchen 1'])
  eq('the mug left the shelf, through a dotted increment', (await db.doc('products/p-mug').get()).data().stock[branch], 4)
  eq('...and the hub recorded that as a movement for the cloud, in the same commit (stage 4)',
    (await db.collection('hubStockMoves').get()).docs.map(d => d.data()).map(m => [m.collection, m.docId, m.branch, m.delta]),
    [['products', 'p-mug', branch, -1]])

  const ticketId = sent.tickets[0].id

  // Food already sent is a manager's to void, and a line never sent is
  // anyone's (UPGRADE.md T5.1). Judged from the stored line, on the hub too.
  {
    const barista = { ...staff, role: 'barista' }
    const afterSend = (await db.doc(`checks/${checkId}`).get()).data().lines
    const sentLine = afterSend.find(l => l.status === 'sent')
    await rejects('a barista cannot void food already sent to the kitchen', () => C.voidLine(barista, checkId, sentLine.id, 'rung-wrong', ''), e => e.status === 403)
    eq('...and the line is still on the check, still sent', (await db.doc(`checks/${checkId}`).get()).data().lines.find(l => l.id === sentLine.id).status, 'sent')
    const mistap = await C.addLines(staff, checkId, C.parseLineRequests({ lines: [{ source: 'menu', refId: 'm-toast', quantity: 1 }] }), 'batch-mistap-1')
    const voided = await C.voidLine(barista, checkId, mistap.lines[0].id, 'rung-wrong', '')
    eq('a barista can still strike off a line never sent', voided.wasSent, false)
  }

  // Hold and fire (UPGRADE.md T3.11), on a table of its own.
  await db.doc('menuCategories/cat-drinks').set({ name: 'Drinks', section: 'Beverage' })
  await db.doc('menuItems/m-tea').set({ name: 'Tea', price: 2, categoryId: 'cat-drinks', available: true, modifierGroupIds: [] })
  const { id: holdCheck } = await C.openCheck(staff, { branch, tableNumber: 40, guestCount: 2 })
  const both = C.parseLineRequests({ lines: [{ source: 'menu', refId: 'm-tea', quantity: 1 }, { source: 'menu', refId: 'm-toast', quantity: 1 }] })
  await C.addLines(staff, holdCheck, both, 'batch-hold-1')
  await rejects('holding food with the switch off is refused, and nothing is sent', () => C.sendCheck(staff, holdCheck, ['Kitchen']), e => e.status === 403)
  const features = (await db.doc('appSettings/features').get()).data()
  await db.doc('appSettings/features').set({ ...features, holdAndFire: { enabled: true } })
  const heldSend = await C.sendCheck(staff, holdCheck, ['Kitchen'])
  eq('"send the drinks, hold the food": the bar ticket goes now, the kitchen one is held',
    heldSend.tickets.map(t => `${t.station}:${t.held}`).sort(), ['Bar:false', 'Kitchen:true'])
  eq('...and the check knows what is held', (await db.doc(`checks/${holdCheck}`).get()).data().heldStations, ['Kitchen'])
  const heldId = heldSend.tickets.find(t => t.held).id
  await rejects('THE TRAP: the kitchen cannot start held food itself, even with "Back"', () => T.advanceTicket(staff, heldId, 'new'), e => e.status === 409)
  await rejects('...nor move it on', () => T.advanceTicket(staff, heldId, 'preparing'), e => e.status === 409)
  const heldAt = (await db.doc(`kitchenTickets/${heldId}`).get()).data().sentAt.toMillis()
  await new Promise(r => setTimeout(r, 20))
  const fired = await C.fireHeld(staff, holdCheck)
  const firedTicket = (await db.doc(`kitchenTickets/${heldId}`).get()).data()
  eq('fire: the held ticket goes to the pass as new, timed from now', [fired.fired, fired.stations, firedTicket.status, firedTicket.sentAt.toMillis() > heldAt], [1, ['Kitchen'], 'new', true])
  eq('...and nothing is held any more', (await db.doc(`checks/${holdCheck}`).get()).data().heldStations, [])
  await rejects('firing again, with nothing held, says so', () => C.fireHeld(staff, holdCheck), e => e.status === 409)
  await db.doc('appSettings/features').set(features)
  await T.advanceTicket(staff, ticketId, 'preparing')
  await T.advanceTicket(staff, ticketId, 'ready')
  eq('ready records when, as a Timestamp', (await db.doc(`kitchenTickets/${ticketId}`).get()).data().readyAt instanceof Timestamp, true)
  const bumps = await Promise.allSettled([T.advanceTicket(staff, ticketId, 'bumped'), T.advanceTicket(staff, ticketId, 'bumped')])
  eq('THE TRAP: two taps on one ticket are one bump and one refusal',
    bumps.map(b => (b.status === 'fulfilled' ? 'ok' : b.reason.status)).sort(), [409, 'ok'])
  eq('the front picking it up afterwards is told it has gone', (await T.pickUpTicket(staff, ticketId)).already, true)

  // Printing the kitchen tickets again (UPGRADE.md T3.6), even once picked up.
  const again1 = await T.reprintTickets(staff, { checkId })
  const again2 = await T.reprintTickets(staff, { ticketId })
  const reprinted = (await db.doc(`kitchenTickets/${ticketId}`).get()).data()
  eq('a check\'s tickets print again, each count once more, even after the plate went out',
    [again1.count, again1.stations, again2.count, reprinted.reprints, reprinted.reprintRequestedAt instanceof Timestamp], [1, ['Kitchen'], 1, 2, true])
  await rejects('a check with no kitchen ticket has nothing to print again', () => T.reprintTickets(staff, { checkId: 'no-such-check' }), e => e.status === 404)

  // A tip on the card (UPGRADE.md T3.9) needs its switch; off, nothing is taken.
  await rejects('a card tip with the switch off is refused, and nothing is taken',
    () => C.addPayment(staff, checkId, C.parsePaymentRequest({ tender: 'card', currency: 'USD', amount: 5, tipUsd: 1 }), 'pay-tip-0001'), e => e.status === 403)
  const pay = C.parsePaymentRequest({ tender: 'cash', currency: 'USD', amount: 21 })
  const paid = await C.addPayment(staff, checkId, pay, 'pay-00000001')
  const repaid = await C.addPayment(staff, checkId, pay, 'pay-00000001')
  const check = (await db.doc(`checks/${checkId}`).get()).data()
  eq('paid in full, into the open shift', [paid.settled, check.shiftIds], [true, [shift.id]])
  eq('THE TRAP: a payment sent twice is taken once', [repaid.duplicate, check.payments.length], [true, 1])
  eq('a payment\'s time is a Timestamp inside an array', check.payments[0].at instanceof Timestamp, true)

  // On a hub, receipt numbers come from a block the cloud reserved (stage 4).
  const cafeYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: BRAND.locale.timezone, year: 'numeric' }).format(new Date()))
  await rejects('THE TRAP: a hub with no receipt numbers from the cloud does not close, and says why',
    () => C.closeCheck(staff, checkId), e => e.status === 409 && /receipt numbers/.test(e.message))
  await db.doc('hubMeta/receipts').set({ blocks: [{ year: cafeYear, first: 501, last: 1000, next: 501 }] })
  const closed = await C.closeCheck(staff, checkId)
  eq('closing takes the next number from the block the cloud reserved',
    [closed.receiptNumber.endsWith('-0501'), (await db.doc('hubMeta/receipts').get()).data().blocks[0].next], [true, 502])
  eq('...and never keeps a counter of its own', (await db.doc('appSettings/invoiceCounter').get()).exists, false)
  await rejects('a closed check does not close twice', () => C.closeCheck(staff, checkId), e => e.status === 409)
  await rejects('a barista cannot refund a check (T5.1)', () => C.refundCheck({ ...staff, role: 'barista' }, checkId, 'changed-mind', ''), e => e.status === 403)
  eq('...and it stays closed', (await db.doc(`checks/${checkId}`).get()).data().status, 'closed')

  // Emailing the receipt (UPGRADE.md T3.7). No mail key here, ever: a test
  // must not be able to send a real email.
  delete process.env.RESEND_API_KEY
  await rejects('THE TRAP: a phone number is not an address, and nothing is sent', () => ER.emailReceipt(checkId, '70123456'), e => e.status === 400)
  const mailed = await ER.emailReceipt(checkId, 'someone@example.com')
  eq('a hub with no mail key says why, in words, and counts nothing',
    [mailed.sent, /not set up/.test(mailed.reason ?? ''), (await db.doc(`checks/${checkId}`).get()).data().receiptEmails], [false, true, undefined])
  eq('...and the address is kept nowhere on the check', JSON.stringify((await db.doc(`checks/${checkId}`).get()).data()).includes('someone@example.com'), false)

  // Cash that is not a sale (UPGRADE.md T3.1), on the shift itself.
  const drop = { id: 'move-000001', kind: 'safeDrop', usd: 20, lbp: 0, reason: 'Taken to the safe', note: '' }
  const first = await D.recordMovement(staff, shift.id, drop)
  const again = await D.recordMovement(staff, shift.id, drop)
  await D.recordMovement(staff, shift.id, { id: 'move-000002', kind: 'paidOut', usd: 1, lbp: 0, reason: 'Other', note: 'Ice' })
  eq('THE TRAP: a safe drop sent twice is recorded once',
    [first.alreadyRecorded, again.alreadyRecorded, (await db.doc(`drawerShifts/${shift.id}`).get()).data().movements.length], [false, true, 2])
  eq('the X reading counts them: 71 − 20 dropped − 1 paid out', (await D.xReading(shift.id)).totals.expected, { usd: 50, lbp: 0 })
  await rejects('a movement that is not one (a reason off the list) is refused before anything is written',
    () => D.recordMovement(staff, shift.id, { ...drop, id: 'move-000003', reason: 'Lunch' }), e => e.status === 400)

  const z = await D.closeShift(staff, shift.id, {}, { 50: 1 }, '')
  eq('the Z close finds the payment through array-contains, less what left the drawer', z.totals.expected, { usd: 50, lbp: 0 })
  eq('...and the count agrees with it', z.difference, { usd: 0, lbp: 0 })
  await rejects('nothing is recorded on a closed shift',
    () => D.recordMovement(staff, shift.id, { ...drop, id: 'move-000004' }), e => e.status === 409)
  eq('the drawer is free again', (await db.doc(`branchDrawers/${branch}`).get()).data().openShiftId, null)

  // Moving ingredients between branches (UPGRADE.md T3.14), over the same store.
  await db.doc('supplies/s-milk').set({ name: 'Milk', unit: 'L', threshold: 5, quantity: { Main: 10, Second: 2 } })
  await db.doc('supplies/s-beans').set({ name: 'Beans', unit: 'kg', threshold: 2, quantity: { Main: 1, Second: 0 } })
  const moved = await ST.transferSupplies({ fromBranch: 'Main', toBranch: 'Second', items: [{ supplyId: 's-milk', quantity: 2.5 }] }, 'move-req-000001')
  const milkAfter = () => db.doc('supplies/s-milk').get().then(s => s.data().quantity)
  eq('2.5 L of milk leaves Main and arrives at Second', [moved.lines, await milkAfter()], [[{ name: 'Milk', unit: 'L', quantity: 2.5 }], { Main: 7.5, Second: 4.5 }])
  const movedAgain = await ST.transferSupplies({ fromBranch: 'Main', toBranch: 'Second', items: [{ supplyId: 's-milk', quantity: 2.5 }] }, 'move-req-000001')
  eq('THE TRAP: the same Move sent twice moves once', [movedAgain.duplicate, await milkAfter()], [true, { Main: 7.5, Second: 4.5 }])
  await rejects('moving more than the branch holds is refused, naming it',
    () => ST.transferSupplies({ fromBranch: 'Main', toBranch: 'Second', items: [{ supplyId: 's-milk', quantity: 1 }, { supplyId: 's-beans', quantity: 3 }] }), e => e.status === 409 && /Beans/.test(e.message))
  eq('...and then nothing moved at all, the milk included', await milkAfter(), { Main: 7.5, Second: 4.5 })
  await rejects('an item that no longer exists is refused', () => ST.transferSupplies({ fromBranch: 'Main', toBranch: 'Second', items: [{ supplyId: 's-gone', quantity: 1 }] }), e => e.status === 404)
  const refusedTransfer = body => { try { ST.parseSupplyTransfer(body); return null } catch (err) { return err.status } }
  eq('a request is refused before anything is read: the same branch twice, nothing, a repeated line, a fraction past three places',
    [refusedTransfer({ fromBranch: branch, toBranch: branch, items: [{ supplyId: 'x', quantity: 1 }] }), refusedTransfer({ fromBranch: branch, toBranch: 'Nowhere', items: [{ supplyId: 'x', quantity: 1 }] }),
      refusedTransfer({ fromBranch: branch, toBranch: 'x', items: [] })].every(s => s === 400), true)

  // The service charge (UPGRADE.md T3.8): copied onto a check when it opens.
  const { id: plainCheck } = await C.openCheck(staff, { branch, tableNumber: 29, guestCount: 1 })
  eq('with the switch off, a new check carries no service charge', (await db.doc(`checks/${plainCheck}`).get()).data().serviceCharge, undefined)
  await db.doc('appSettings/features').set({ pos: { enabled: true }, kds: { enabled: true }, payments: { enabled: true }, serviceCharge: { enabled: true } })
  await db.doc('appSettings/business').set({ serviceChargeRate: 0.1 }, { merge: true })
  const { id: svcCheck } = await C.openCheck(staff, { branch, tableNumber: 30, guestCount: 2 })
  eq('switched on with a rate, a new check carries it, fixed from then on', (await db.doc(`checks/${svcCheck}`).get()).data().serviceCharge, { rate: 0.1 })
  await db.doc('appSettings/business').set({ serviceChargeRate: 0.2 }, { merge: true })
  eq('THE TRAP: changing the setting later re-prices nothing already open', (await db.doc(`checks/${svcCheck}`).get()).data().serviceCharge.rate, 0.1)
  await C.removeServiceCharge(staff, svcCheck)
  eq('a manager takes it off: kept as none, with who', (await db.doc(`checks/${svcCheck}`).get()).data().serviceCharge, { rate: 0, removedBy: staff.uid, removedByEmail: '' })
  await rejects('taking off a charge that is not there is refused', () => C.removeServiceCharge(staff, svcCheck), e => e.status === 409)
  await rejects('a barista cannot take it off', () => C.removeServiceCharge({ ...staff, role: 'barista' }, plainCheck), e => e.status === 403)

  const sql = new DatabaseSync(file)
  const later = H.openHubStore(sql)
  const stored = (await later.doc(`checks/${checkId}`).get()).data()
  eq('another handle on the same file sees the closed check and its receipt',
    [stored.status, stored.receiptNumber], ['closed', closed.receiptNumber])
  sql.close()
}

console.log('\nhow long a sign-in at the hub lasts')
{
  const S = await import(url('hubSession.js'))
  const until = (signedIn, zone = 'Asia/Beirut') => new Date(S.hubSessionExpiry(Date.parse(signedIn), zone)).toISOString()
  // Beirut is UTC+3 until the clocks go back on 25 Oct 2026, UTC+2 after.
  eq('signed in at 09:00, it lasts until 05:00 the next morning', until('2026-09-14T06:00:00Z'), '2026-09-15T02:00:00.000Z')
  eq('signed in at 23:30, still until 05:00', until('2026-09-14T20:30:00Z'), '2026-09-15T02:00:00.000Z')
  eq('signed in at 01:00, until 05:00 that morning: four hours is enough', until('2026-09-14T22:00:00Z'), '2026-09-15T02:00:00.000Z')
  eq('THE TRAP: signed in at 03:00 to close up, not put out at 05:00', until('2026-09-15T00:00:00Z'), '2026-09-16T02:00:00.000Z')
  eq('across the clocks going back, 05:00 is still 05:00 on the wall', until('2026-10-24T09:00:00Z'), '2026-10-25T03:00:00.000Z')
  eq('judged in the café\'s zone, not the host\'s', until('2026-09-14T10:00:00Z', 'UTC'), '2026-09-15T05:00:00.000Z')
}

console.log('\nsigning in at the hub')
{
  const FA = await import(url('server/firebaseAdmin.js'))
  const HS = await import(url('server/hubSession.js'))
  const AU = await import(url('server/auth.js'))
  const request = token => new Request('http://hub.test/api/pos/checks', { headers: { Authorization: `Bearer ${token}` } })

  const started = await HS.startHubSession({ uid: 'u-night', email: 'night@hub.test', staff: true, role: 'barista', branchIds: ['Main'] })
  eq('a staff sign-in gets a session to the end of the night',
    [started.token.startsWith('hub.'), started.caller.role, started.caller.expiresAt > Date.now()], [true, 'barista', true])
  eq('a route finds the caller from it', (await AU.getCaller(request(started.token)))?.uid, 'u-night')
  const rows = (await FA.adminDb().collection('hubSessions').get()).docs
  eq('THE TRAP: the hub stores a hash of the token, never the token',
    rows.some(d => d.id.includes(started.token.slice(4)) || JSON.stringify(d.data()).includes(started.token.slice(4))), false)
  await rejects('a customer account cannot start one', () => HS.startHubSession({ uid: 'c-1', staff: false, role: null }), e => e.status === 403)
  await rejects('THE TRAP: an account no longer marked staff is refused, whatever role its token still names',
    () => HS.startHubSession({ uid: 'c-3', staff: false, role: 'manager' }), e => e.status === 403)
  await rejects('nor a staff token without a role', () => HS.startHubSession({ uid: 'c-2', staff: true }), e => e.status === 403)
  eq('THE TRAP: a Firebase token sent straight to a hub route is not a caller',
    await AU.getCaller(request('eyJhbGciOiJSUzI1NiJ9.eyJzdGFmZiI6dHJ1ZX0.c2ln')), null)
  eq('a made-up hub token is not a caller', await AU.getCaller(request(`hub.${'x'.repeat(43)}`)), null)
  eq('a session is good a minute before the night ends',
    (await HS.callerFromHubToken(started.token, started.caller.expiresAt - 60_000))?.uid, 'u-night')
  eq('...and over when it does', await HS.callerFromHubToken(started.token, started.caller.expiresAt), null)
  eq('signing out ends it', [await HS.endHubSession(started.token), await AU.getCaller(request(started.token))], [true, null])
  eq('signing out twice finds nothing to end', await HS.endHubSession(started.token), false)
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'hub-verify'
  await rejects('a sign-in that cannot be checked is refused, never trusted', () => HS.signInAtHub('not-a-token'), e => e.status === 401)
}

console.log('\nthe till\'s live queries, answered by the hub')
{
  const W = await import(url('server/hubWatch.js'))
  const Q = await import(pathToFileURL(resolve(queriesOut, 'queries.js')).href)
  const { encodeHubValue } = H
  const db = fresh()
  const ts = ms => Timestamp.fromMillis(ms)
  const put = (path, data) => db.doc(path).set(data)
  await put('checks/c6', { branch: 'Main', status: 'closed', closedAt: ts(3000) })
  await put('checks/c1', { branch: 'Main', status: 'open' })
  await put('checks/c3', { branch: 'Main', status: 'refunded', closedAt: ts(5000) })
  await put('checks/c2', { branch: 'Main', status: 'closed', closedAt: ts(3000) })
  await put('checks/c4', { branch: 'Other', status: 'closed', closedAt: ts(9000) })
  await put('checks/c5', { branch: 'Main', status: 'closed' })
  await put('kitchenTickets/t4', { branch: 'Main', station: 'Bar', status: 'preparing', sentAt: ts(20) })
  await put('kitchenTickets/t1', { branch: 'Main', station: 'Bar', status: 'new', sentAt: ts(20) })
  await put('kitchenTickets/t2', { branch: 'Main', station: 'Kitchen', status: 'ready', sentAt: ts(10) })
  await put('kitchenTickets/t3', { branch: 'Main', station: 'Bar', status: 'bumped', sentAt: ts(5) })
  await put('kitchenTickets/t5', { branch: 'Other', station: 'Bar', status: 'ready', sentAt: ts(1) })
  await put('drawerShifts/s1', { branch: 'Main', status: 'closed' })
  await put('drawerShifts/s2', { branch: 'Main', status: 'closing' })
  await put('menuItems/m2', { name: 'Tea' })
  await put('menuItems/m1', { name: 'Toast' })
  await put('appSettings/features', { pos: { enabled: true } })

  const ACTIVE = ['new', 'preparing', 'ready']
  const queries = [
    { kind: 'openChecks', branch: 'Main' },
    { kind: 'check', checkId: 'c2' },
    { kind: 'check', checkId: 'nope' },
    { kind: 'stationTickets', branch: 'Main', station: 'Bar', statuses: ACTIVE },
    { kind: 'stationTickets', branch: 'Main', station: null, statuses: ACTIVE },
    { kind: 'readyTickets', branch: 'Main' },
    { kind: 'closedChecks', branch: 'Main', max: 50 },
    { kind: 'closedChecks', branch: 'Main', max: 2 },
    { kind: 'checksClosedSince', branch: 'Main', sinceMs: 4000, ceiling: 2000 },
    { kind: 'checksClosedSince', branch: 'Main', sinceMs: 0, ceiling: 1 },
    { kind: 'recentClosedReceipts', branch: 'Main' },
    { kind: 'openShift', branch: 'Main' },
    { kind: 'menuItems' },
    { kind: 'settings', doc: 'features' },
  ]
  const toMs = v => (v instanceof Timestamp ? v.toMillis() : Number.NaN)
  const rows = {}
  const answers = []
  for (const q of queries) {
    const plan = Q.planQuery(q)
    rows[plan.collection] ??= (await db.collection(plan.collection).get()).docs.map(d => ({ id: d.id, data: d.data() }))
    const local = Q.runPlan(plan, rows[plan.collection], toMs).map(d => d.id)
    const hub = (await W.runHubPlan(db, plan)).map(d => d.id)
    answers.push(`${q.kind}: ${hub.join(',')}`)
    if (JSON.stringify(local) !== JSON.stringify(hub)) answers.push(`  DISAGREES with runPlan: ${local.join(',')}`)
  }
  eq('THE TRAP: the hub answers every till query as runPlan does', answers.filter(a => a.includes('DISAGREES')), [])
  eq('...and the answers are the ones meant', answers, [
    'openChecks: c1', 'check: c2', 'check: ', 'stationTickets: t1,t4', 'stationTickets: t2,t1,t4', 'readyTickets: t2',
    'closedChecks: c3,c6,c2', 'closedChecks: c3,c6', 'checksClosedSince: c3', 'checksClosedSince: c3',
    'recentClosedReceipts: c6,c2', 'openShift: s2', 'menuItems: m1,m2', 'settings: features',
  ])

  const open = Q.planQuery({ kind: 'openChecks', branch: 'Main' })
  const one = Q.planQuery({ kind: 'check', checkId: 'c2' })
  eq('a write to the collection may change the query', Q.planTouches(open, { collection: 'checks', id: 'zz' }), true)
  eq('a write elsewhere cannot', Q.planTouches(open, { collection: 'kitchenTickets', id: 'c1' }), false)
  eq('one document is only woken by that document', [Q.planTouches(one, { collection: 'checks', id: 'c2' }), Q.planTouches(one, { collection: 'checks', id: 'c1' })], [true, false])

  // What /api/hub/query sends a till: each document's data tagged.
  const wire = async plan => (await W.runHubPlan(db, plan)).map(d => ({ id: d.id, data: encodeHubValue(d.data) }))
  let step = Q.compareResults(null, await wire(open))
  eq('the first answer is always delivered, and everything in it is new', step.changed, ['c1'])
  eq('an empty first answer is still an answer', Q.compareResults(null, []).changed, [])
  await put('checks/c7', { branch: 'Other', status: 'open' })
  step = Q.compareResults(step.state, await wire(open))
  eq('THE TRAP: another branch opening a table does not wake this till', step.changed, null)
  await put('checks/c8', { branch: 'Main', status: 'open', openedAt: ts(7000) })
  const withNew = await wire(open)
  step = Q.compareResults(step.state, withNew)
  eq('a new open check here is delivered, and only it is marked changed', [withNew.map(d => d.id), step.changed], [['c1', 'c8'], ['c8']])
  eq('a Timestamp travels tagged, so the till gets a Timestamp back', withNew.find(d => d.id === 'c8')?.data.openedAt, { $fs: 'ts', s: 7, n: 0 })
  await db.doc('checks/c1').update({ status: 'closed' })
  const afterClose = await wire(open)
  step = Q.compareResults(step.state, afterClose)
  eq('a check closing leaves the list, and nothing is marked changed for it', [afterClose.map(d => d.id), step.changed], [['c8'], []])
}

} catch (err) {
  console.log(`  FAIL  the run stopped: ${String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ')}`)
  fail++
}

rmSync(out, { recursive: true, force: true })
try { rmSync(tmp, { recursive: true, force: true }) } catch { /* the hub's own handle is still open; the OS cleans temp */ }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
