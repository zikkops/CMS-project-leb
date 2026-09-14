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
writeFileSync(join(out, 'package.json'), '{ "type": "module" }')
const url = rel => pathToFileURL(resolve(out, rel)).href
const H = await import(url('server/hubStore.js'))

const tmp = mkdtempSync(join(tmpdir(), 'hub-verify-'))

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(76)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}
/** Passes when the call is refused and the error fits: a regex on the message, or a predicate. */
const rejects = async (name, fn, fits) => {
  let err = null
  try { await fn() } catch (e) { err = e }
  const ok = err !== null && (fits instanceof RegExp ? fits.test(String(err.message)) : fits(err))
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(76)} got=${err ? JSON.stringify(err.message) : 'no refusal'}`)
  ok ? pass++ : fail++
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
  sql.close()
  const sql2 = new DatabaseSync(file)
  const again = H.openHubStore(sql2)
  eq('reopened, what was written is there', (await again.doc('a/2').get()).data(), { v: 2 })
  eq('...and what was deleted is still deleted', (await again.doc('a/1').get()).exists, false)
  sql2.close()
}

console.log('\nthe till\'s own server code, unchanged, over the hub')
{
  const file = join(tmp, 'hub.db')
  process.env.BIG_CMS_HUB_DB = file
  const FA = await import(url('server/firebaseAdmin.js'))
  const C = await import(url('server/checks.js'))
  const T = await import(url('server/tickets.js'))
  const D = await import(url('server/drawer.js'))
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

  const sent = await C.sendCheck(staff, checkId)
  eq('Send makes one ticket, for the kitchen', sent.tickets.map(t => `${t.station} ${t.lines}`), ['Kitchen 1'])
  eq('the mug left the shelf, through a dotted increment', (await db.doc('products/p-mug').get()).data().stock[branch], 4)

  const ticketId = sent.tickets[0].id
  await T.advanceTicket(staff, ticketId, 'preparing')
  await T.advanceTicket(staff, ticketId, 'ready')
  eq('ready records when, as a Timestamp', (await db.doc(`kitchenTickets/${ticketId}`).get()).data().readyAt instanceof Timestamp, true)
  const bumps = await Promise.allSettled([T.advanceTicket(staff, ticketId, 'bumped'), T.advanceTicket(staff, ticketId, 'bumped')])
  eq('THE TRAP: two taps on one ticket are one bump and one refusal',
    bumps.map(b => (b.status === 'fulfilled' ? 'ok' : b.reason.status)).sort(), [409, 'ok'])
  eq('the front picking it up afterwards is told it has gone', (await T.pickUpTicket(staff, ticketId)).already, true)

  const pay = C.parsePaymentRequest({ tender: 'cash', currency: 'USD', amount: 21 })
  const paid = await C.addPayment(staff, checkId, pay, 'pay-00000001')
  const repaid = await C.addPayment(staff, checkId, pay, 'pay-00000001')
  const check = (await db.doc(`checks/${checkId}`).get()).data()
  eq('paid in full, into the open shift', [paid.settled, check.shiftIds], [true, [shift.id]])
  eq('THE TRAP: a payment sent twice is taken once', [repaid.duplicate, check.payments.length], [true, 1])
  eq('a payment\'s time is a Timestamp inside an array', check.payments[0].at instanceof Timestamp, true)

  const closed = await C.closeCheck(staff, checkId)
  eq('closing issues a receipt number from the hub\'s own counter',
    [typeof closed.receiptNumber, (await db.doc('appSettings/invoiceCounter').get()).data().nextNumber], ['string', 1])
  await rejects('a closed check does not close twice', () => C.closeCheck(staff, checkId), e => e.status === 409)

  const z = await D.closeShift(staff, shift.id, {}, { 50: 1, 20: 1, 1: 1 }, '')
  eq('the Z close finds the payment through array-contains', z.totals.expected, { usd: 71, lbp: 0 })
  eq('...and the count agrees with it', z.difference, { usd: 0, lbp: 0 })
  eq('the drawer is free again', (await db.doc(`branchDrawers/${branch}`).get()).data().openShiftId, null)

  const sql = new DatabaseSync(file)
  const later = H.openHubStore(sql)
  const stored = (await later.doc(`checks/${checkId}`).get()).data()
  eq('another handle on the same file sees the closed check and its receipt',
    [stored.status, stored.receiptNumber], ['closed', closed.receiptNumber])
  sql.close()
}

} catch (err) {
  console.log(`  FAIL  the run stopped: ${String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ')}`)
  fail++
}

rmSync(out, { recursive: true, force: true })
try { rmSync(tmp, { recursive: true, force: true }) } catch { /* the hub's own handle is still open; the OS cleans temp */ }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
