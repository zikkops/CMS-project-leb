// Assertions over pairing a café hub, pulling from the cloud, and receipt
// number blocks — POS software, stage 4.
//
//   node scripts/verify-hub-sync.mjs
//   npm run verify:hub-sync
//
// Four parts:
//   1. The pure rules (shared/src/hubSync.ts, shared/src/receiptBlocks.ts):
//      codes, the hub's credential, what a staff record may carry, what a pull
//      writes, and how a block of receipt numbers is reserved and used.
//   2. The cloud's side (shared/src/server/hubDevices.ts) over a Firestore-shaped
//      store: a code works once, a credential is checked, an unpaired hub is
//      refused, a snapshot carries exactly what the cloud is master for, and a
//      block comes off the cloud's own receipt counter.
//   3. The hub's side (shared/src/server/hubSync.ts, invoiceNumber.ts): a
//      snapshot taken into a second database, where the hub's own stock and
//      receipt counter survive every pull; hub sessions obeying the staff records
//      pulled; receipts numbered only from blocks; and a hub fetching a block
//      through its real pairing and refill code, over a fake connection to the cloud.
//
// Fixture contact details are placeholders that are not shaped like an email
// or a phone number. The tests only care that those FIELDS never reach a hub,
// and audit:branding rightly flags anything that looks like a real one.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'

const out = join('node_modules', '.cache', `verify-hub-sync-${process.pid}`)
rmSync(out, { recursive: true, force: true })
try {
  execSync(
    'npx tsc shared/src/hubSync.ts shared/src/receiptBlocks.ts shared/src/server/hubDevices.ts shared/src/server/hubSync.ts ' +
    'shared/src/server/hubSession.ts shared/src/server/invoiceNumber.ts ' +
    `--outDir ${out} --rootDir shared/src --module esnext --target es2022 ` +
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

const tmp = mkdtempSync(join(tmpdir(), 'hub-sync-verify-'))
// The "cloud" in parts 2 and 3 is a Firestore-shaped store: the cloud code
// uses nothing else of Firestore, and verify:hub holds the store to Firestore.
process.env.BIG_CMS_HUB_DB = join(tmp, 'cloud.db')

const P = await import(url('hubSync.js'))
const R = await import(url('receiptBlocks.js'))
const H = await import(url('server/hubStore.js'))
const FA = await import(url('server/firebaseAdmin.js'))
const D = await import(url('server/hubDevices.js'))
const S = await import(url('server/hubSync.js'))
const HS = await import(url('server/hubSession.js'))
const I = await import(url('server/invoiceNumber.js'))
const { BRAND } = await import(url('brand.js'))
const branch = BRAND.branches[0]
const otherBranch = BRAND.branches[1]
const cafeYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: BRAND.locale.timezone, year: 'numeric' }).format(new Date()))

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(80)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}
const rejects = async (name, fn, fits) => {
  let err = null
  try { await fn() } catch (e) { err = e }
  const ok = err !== null && (fits instanceof RegExp ? fits.test(String(err.message)) : fits(err))
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(80)} got=${err ? JSON.stringify(err.message) : 'no refusal'}`)
  ok ? pass++ : fail++
}

try {

console.log('\npairing codes')
{
  eq('ten letters from ten bytes', P.pairingCodeFromBytes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 'ABCDEFGHJK')
  eq('each byte picks one of 32 letters fairly: 31 is the last, 32 wraps to the first',
    [P.pairingCodeFromBytes(Array(10).fill(31))[0], P.pairingCodeFromBytes(Array(10).fill(32))[0], P.pairingCodeFromBytes(Array(10).fill(255))[0]], ['9', 'A', '9'])
  eq('shown in two groups of five', P.formatPairingCode('ABCDEFGHJK'), 'ABCDE-FGHJK')
  eq('typed in any case, with a dash or spaces', [P.normalizePairingCode('abcde-fghjk'), P.normalizePairingCode(' ABCDE FGHJK ')], ['ABCDEFGHJK', 'ABCDEFGHJK'])
  eq('THE TRAP: a letter a code never has makes it not a code (0, O, 1, I)',
    ['ABCDEFGHJ0', 'ABCDEFGHJO', 'ABCDEFGHJ1', 'ABCDEFGHJI'].map(P.normalizePairingCode), [null, null, null, null])
  eq('too short, too long, or not text', [P.normalizePairingCode('ABCDEFGHJ'), P.normalizePairingCode('ABCDEFGHJKL'), P.normalizePairingCode(1234567890)], [null, null, null])
  let threw = false
  try { P.pairingCodeFromBytes([1, 2, 3]) } catch { threw = true }
  eq('too few random bytes is refused, never a short code', threw, true)
}

console.log('\nthe hub\'s credential')
{
  const id = 'AbCdEfGhIjKlMnOpQrSt'
  const secret = 'a'.repeat(43)
  eq('read back from the header a hub sends', P.parseDeviceAuth(P.deviceAuthHeader(id, secret)), { deviceId: id, secret })
  eq('THE TRAP: a staff member\'s Bearer token is not a hub\'s credential', P.parseDeviceAuth(`Bearer ${id}.${secret}`), null)
  eq('a missing or short secret is not a credential', [P.parseDeviceAuth(`Hub ${id}`), P.parseDeviceAuth(`Hub ${id}.${'a'.repeat(42)}`)], [null, null])
  eq('an id that is not a device id is not a credential', [P.parseDeviceAuth(`Hub short.${secret}`), P.parseDeviceAuth(`Hub ${id}/x.${secret}`)], [null, null])
  eq('a third part is not a credential', P.parseDeviceAuth(`Hub ${id}.${secret}.x`), null)
}

console.log('\nwhat a staff record may carry to a hub')
{
  const full = {
    isStaff: true, role: 'manager', branchIds: [branch], superadmin: false, sectionGrants: ['kds'],
    email: 'placeholder-address', phone: 'placeholder-number', displayName: 'Rana', points: 120, pointsEarned: 400,
  }
  eq('THE TRAP: no name, email, phone or points go to a café PC', Object.keys(P.staffRecord(full)).sort(), ['branchIds', 'isStaff', 'role', 'sectionGrants', 'superadmin'])
  eq('a customer is not sent at all',
    [P.staffRecord({ isStaff: false, email: 'placeholder-address' }), P.staffRecord({ email: 'placeholder-address' })], [null, null])
  eq('the older single branch field still travels', P.staffRecord({ isStaff: true, role: 'barista', branchId: branch }), { isStaff: true, role: 'barista', branchId: branch })
}

console.log('\nwhat a pull writes')
{
  const spec = P.pullSpec(branch)
  eq('the settings pulled are the till\'s three, and the table layout is this branch\'s',
    [spec.find(s => s.collection === 'appSettings').ids, spec.find(s => s.collection === 'branchTableLayouts').ids], [['features', 'business', 'printing'], [branch]])
  const json = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const local = new Map(Object.entries({
    'menuItems/m1': { name: 'Toast', price: 4 },
    'menuItems/gone': { name: 'Old dish' },
    'products/p1': { name: 'Mug', price: 12, stock: { [branch]: 3 } },
    'products/p2': { name: 'Tote', price: 20 },
    'appSettings/invoiceCounter': { year: 2026, nextNumber: 41 },
    'appSettings/features': { pos: { enabled: true } },
    'checks/c1': { branch, status: 'open' },
    [`branchTableLayouts/${otherBranch}`]: { tables: [] },
  }))
  const snapshot = [
    { collection: 'menuItems', id: 'm1', data: { name: 'Toast', price: 4 } },
    { collection: 'menuItems', id: 'm2', data: { name: 'Soup', price: 6 } },
    { collection: 'products', id: 'p1', data: { name: 'Mug', price: 13, stock: { [branch]: 50 } } },
    { collection: 'products', id: 'p2', data: { name: 'Tote', price: 20, stock: { [branch]: 9 } } },
    { collection: 'products', id: 'p3', data: { name: 'Beans', price: 15, stock: { [branch]: 7 } } },
    { collection: 'appSettings', id: 'features', data: { pos: { enabled: true } } },
    { collection: 'appSettings', id: 'invoiceCounter', data: { year: 2026, nextNumber: 1 } },
    { collection: 'checks', id: 'c9', data: { branch, status: 'open' } },
    { collection: 'branchTableLayouts', id: branch, data: { tables: [{ id: 't1', number: 1 }] } },
    { collection: 'branchTableLayouts', id: otherBranch, data: { tables: [{ id: 'x', number: 9 }] } },
  ]
  const writes = P.planPull(spec, local, snapshot, json)
  const said = writes.map(w => `${w.kind} ${w.collection}/${w.id}`).sort()
  eq('a new dish, a changed product, a new product, this branch\'s tables, and a dish taken off',
    said, [`delete menuItems/gone`, `set branchTableLayouts/${branch}`, 'set menuItems/m2', 'set products/p1', 'set products/p3'].sort())
  eq('THE TRAP: the hub\'s stock count is kept, the cloud\'s price is taken',
    writes.find(w => w.id === 'p1').data, { name: 'Mug', price: 13, stock: { [branch]: 3 } })
  eq('a product the hub holds with no stock stays without, and is not rewritten', said.includes('set products/p2'), false)
  eq('a product new to the hub arrives with the cloud\'s stock', writes.find(w => w.id === 'p3').data.stock, { [branch]: 7 })
  eq('THE TRAP: the hub\'s receipt counter is never written, whatever the cloud sends', said.some(s => s.includes('invoiceCounter')), false)
  eq('nor a check, nor another branch\'s tables, nor removing them', said.some(s => s.includes('checks/') || s.includes(otherBranch)), false)
  eq('nothing unchanged is written', said.includes('set menuItems/m1') || said.includes('set appSettings/features'), false)
  eq('an id with a slash in a snapshot is ignored', P.planPull(spec, new Map(), [{ collection: 'menuItems', id: 'a/b', data: {} }], json), [])
}

console.log('\nreceipt number blocks')
{
  const y = 2026
  eq('the first block of a year starts at 1, and the counter moves to its end',
    R.reserveBlock(undefined, y), { block: { year: y, first: 1, last: 500, next: 1 }, counter: { year: y, nextNumber: 500 } })
  eq('a block starts right after the cloud\'s last number', R.reserveBlock({ year: y, nextNumber: 41 }, y).block, { year: y, first: 42, last: 541, next: 42 })
  eq('a counter from last year starts this year again at 1', R.reserveBlock({ year: y - 1, nextNumber: 900 }, y).block.first, 1)
  const a = R.takeReceipt([R.reserveBlock({ year: y, nextNumber: 41 }, y).block], y)
  const b = R.takeReceipt(a.blocks, y)
  eq('receipts are taken in order from the block', [a.sequence, b.sequence, R.receiptsLeft(b.blocks, y)], [42, 43, 498])
  eq('THE TRAP: a block from last year never numbers this year\'s receipts', R.takeReceipt([{ year: y - 1, first: 1, last: 500, next: 10 }], y).ok, false)
  eq('used up, it refuses rather than inventing a number', R.takeReceipt([{ year: y, first: 1, last: 1, next: 2 }], y).ok, false)
  eq('more are asked for below 100 left, not at 100',
    [R.needsReceipts([{ year: y, first: 1, last: 500, next: 402 }], y), R.needsReceipts([{ year: y, first: 1, last: 500, next: 401 }], y)], [true, false])
  eq('an older block is used up before a newer one',
    R.takeReceipt([{ year: y, first: 501, last: 1000, next: 501 }, { year: y, first: 1, last: 500, next: 499 }], y).sequence, 499)
  eq('THE TRAP: a malformed block issues nothing',
    R.readBlocks([{ year: y, first: 10, last: 5, next: 10 }, { year: '2026', first: 1, last: 5, next: 1 }, { year: y, first: 1, last: 5, next: 0 }, null, 'x']), [])
  eq('a new block drops used-up blocks and other years\'',
    R.addBlock([{ year: y - 1, first: 1, last: 500, next: 20 }, { year: y, first: 1, last: 500, next: 501 }], { year: y, first: 501, last: 1000, next: 501 }),
    [{ year: y, first: 501, last: 1000, next: 501 }])
}

console.log('\nthe cloud pairs a hub')
const db = FA.adminDb()
const admin = { uid: 'u-admin', email: 'admin-placeholder', role: 'admin', branchIds: [], superadmin: false, isStaff: true }
let device = null
{
  const made = await D.createPairingCode(admin, { branch, name: 'Counter PC' })
  eq('a code for a branch and a name', [made.code.length, made.branch, made.name, made.expiresAt > Date.now()], [10, branch, 'Counter PC', true])
  const codes = (await db.collection('hubPairingCodes').get()).docs
  eq('THE TRAP: the code is stored as a hash, never as itself',
    codes.some(d => d.id.includes(made.code) || JSON.stringify(d.data()).includes(made.code)), false)
  await rejects('a branch that does not exist is refused', () => D.createPairingCode(admin, { branch: 'Nowhere', name: 'PC' }), e => e.status === 400)
  await rejects('a hub needs a name', () => D.createPairingCode(admin, { branch, name: '   ' }), e => e.status === 400)

  const paired = await D.pairDevice(P.formatPairingCode(made.code).toLowerCase())
  eq('the code is swapped for the hub\'s own credential',
    [/^[A-Za-z0-9]{20}$/.test(paired.deviceId), paired.secret.length, paired.branch, paired.name, paired.pairedBy.uid], [true, 43, branch, 'Counter PC', 'u-admin'])
  eq('...a credential the hub can send', P.parseDeviceAuth(P.deviceAuthHeader(paired.deviceId, paired.secret)) !== null, true)
  await rejects('THE TRAP: a code works once', () => D.pairDevice(made.code), e => e.status === 400)
  const old = await D.createPairingCode(admin, { branch, name: 'Late PC' }, Date.now() - 16 * 60_000)
  await rejects('a code older than fifteen minutes is refused', () => D.pairDevice(old.code), e => e.status === 400)
  const answers = []
  for (const c of [made.code, old.code, 'ZZZZZZZZZZ']) {
    try { await D.pairDevice(c) } catch (e) { answers.push(e.message) }
  }
  eq('used, run out and never made get one answer, so a guesser learns nothing', [answers.length, new Set(answers).size], [3, 1])
  await rejects('a typo is told as a typo', () => D.pairDevice('ABC'), /not a pairing code/)
  const devices = (await db.collection('hubDevices').get()).docs
  eq('THE TRAP: the cloud keeps a hash of the hub\'s secret, never the secret', devices.some(d => JSON.stringify(d.data()).includes(paired.secret)), false)

  const req = header => new Request('https://cloud.test/api/hub-sync/pull', { headers: header ? { Authorization: header } : {} })
  device = await D.deviceFromRequest(req(P.deviceAuthHeader(paired.deviceId, paired.secret)))
  eq('the cloud knows the hub by its credential', [device.id, device.branch, device.name], [paired.deviceId, branch, 'Counter PC'])
  await rejects('THE TRAP: the right hub with the wrong secret is refused',
    () => D.deviceFromRequest(req(P.deviceAuthHeader(paired.deviceId, 'b'.repeat(43)))), e => e.status === 401)
  await rejects('no credential, or a person\'s token, is refused',
    async () => { await D.deviceFromRequest(req('Bearer abc.def.ghi')) }, e => e.status === 401)
  const listed = await D.listDevices()
  eq('THE TRAP: the admin list never carries a secret or its hash',
    JSON.stringify(listed).includes(paired.secret) || JSON.stringify(listed).includes('secretHash'), false)
  eq('...and says which hub, who paired it, and that it is paired', [listed[0].name, listed[0].pairedByEmail, listed[0].revoked], ['Counter PC', 'admin-placeholder', false])

  const lost = await D.pairDevice((await D.createPairingCode(admin, { branch, name: 'Lost PC' })).code)
  const revoked = await D.revokeDevice(admin, lost.deviceId)
  eq('an admin unpairs a hub', [revoked.name, revoked.already], ['Lost PC', false])
  eq('unpairing twice is an answer, not an error', (await D.revokeDevice(admin, lost.deviceId)).already, true)
  await rejects('THE TRAP: an unpaired hub is refused, and told so',
    () => D.deviceFromRequest(req(P.deviceAuthHeader(lost.deviceId, lost.secret))), e => e.status === 401 && /unpaired/i.test(e.message))
}

console.log('\nwhat the cloud sends a hub')
{
  const ts = Timestamp.fromMillis(1_700_000_000_000)
  const put = (path, data) => db.doc(path).set(data)
  await put('menuCategories/c1', { name: 'Food', section: 'Food' })
  await put('menuItems/m1', { name: 'Toast', price: 4.5, categoryId: 'c1' })
  await put('menuItems/m2', { name: 'Soup', price: 6, categoryId: 'c1' })
  await put('modifierGroups/g1', { name: 'Milk', options: [] })
  await put('products/p1', { name: 'Mug', price: 12, stock: { [branch]: 40 }, updatedAt: ts })
  await put('users/u-staff', { isStaff: true, role: 'manager', branchIds: [branch], email: 'staff-placeholder', phone: 'staff-number', points: 120 })
  await put('users/u-customer', { isStaff: false, email: 'customer-placeholder', points: 5 })
  await put('appSettings/features', { pos: { enabled: true } })
  await put('appSettings/business', { exchangeRate: 60000 })
  await put('appSettings/invoiceCounter', { year: 2026, nextNumber: 900 })
  await put('appSettings/errorBudget', { day: '2026-09-14', count: 3 })
  await put(`branchTableLayouts/${branch}`, { tables: [{ id: 't1', number: 1 }] })
  await put(`branchTableLayouts/${otherBranch}`, { tables: [{ id: 't9', number: 9 }] })
  await put('checks/c1', { branch, status: 'open' })

  const snap = await D.buildPullSnapshot(device)
  const paths = snap.map(d => `${d.collection}/${d.id}`).sort()
  eq('exactly what the cloud is master for, for this branch', paths, [
    'appSettings/business', 'appSettings/features', `branchTableLayouts/${branch}`, 'menuCategories/c1',
    'menuItems/m1', 'menuItems/m2', 'modifierGroups/g1', 'products/p1', 'users/u-staff',
  ])
  eq('THE TRAP: a staff record arrives without email, phone or points',
    Object.keys(snap.find(d => d.id === 'u-staff').data).sort(), ['branchIds', 'isStaff', 'role'])
  eq('THE TRAP: never the receipt counter, the error budget, a check, a customer, or another branch\'s tables',
    paths.filter(p => /invoiceCounter|errorBudget|checks\/|u-customer|hubDevices|hubPairingCodes/.test(p) || p.includes(otherBranch)), [])
  const enc = D.encodeSnapshot(snap)
  eq('a Timestamp travels tagged', enc.docs.find(d => d.id === 'p1').data.updatedAt, { $fs: 'ts', s: 1_700_000_000, n: 0 })
  eq('the same snapshot has the same digest', D.encodeSnapshot(await D.buildPullSnapshot(device)).digest, enc.digest)
  await db.doc('menuItems/m1').update({ price: 5 })
  eq('a price changed in the cloud changes the digest', D.encodeSnapshot(await D.buildPullSnapshot(device)).digest !== enc.digest, true)
}

console.log('\na hub takes it in')
{
  const hub = H.openHubStore(new DatabaseSync(':memory:'))
  const first = D.encodeSnapshot(await D.buildPullSnapshot(device))
  const r1 = await S.applySnapshot(hub, branch, first.docs)
  eq('the first pull writes the menu, settings, tables and staff', [r1.written, r1.deleted], [9, 0])
  eq('a Timestamp arrives as a Timestamp', (await hub.doc('products/p1').get()).data().updatedAt instanceof Timestamp, true)

  // The hub trades: a mug sold, receipts issued.
  await hub.doc('products/p1').update({ [`stock.${branch}`]: FieldValue.increment(-1) })
  await hub.doc('appSettings/invoiceCounter').set({ year: 2026, nextNumber: 41 })
  // The cloud changes: a price, and a dish taken off the menu.
  await db.doc('products/p1').update({ price: 13 })
  await db.doc('menuItems/m2').delete()

  const second = D.encodeSnapshot(await D.buildPullSnapshot(device))
  const r2 = await S.applySnapshot(hub, branch, second.docs)
  const p1 = (await hub.doc('products/p1').get()).data()
  eq('the cloud\'s new price arrives, one product and one dish', [p1.price, r2.written, r2.deleted], [13, 1, 1])
  eq('THE TRAP: the hub\'s own stock count is not overwritten by the cloud\'s', p1.stock, { [branch]: 39 })
  eq('a dish taken off the menu comes off the till', (await hub.doc('menuItems/m2').get()).exists, false)
  eq('THE TRAP: the hub\'s receipt counter survives every pull', (await hub.doc('appSettings/invoiceCounter').get()).data().nextNumber, 41)
  const seq = hub.lastSeq()
  const r3 = await S.applySnapshot(hub, branch, second.docs)
  eq('the same snapshot again writes nothing and wakes no screen', [r3.written, r3.deleted, hub.lastSeq()], [0, 0, seq])

  eq('where the cloud is: an https origin, never a path',
    [S.cloudBaseUrl('https://pos.example.test/api/anything'), S.cloudBaseUrl('http://localhost:3002/'), S.cloudBaseUrl('http://127.0.0.1:3002')],
    ['https://pos.example.test', 'http://localhost:3002', 'http://127.0.0.1:3002'])
  eq('THE TRAP: plain http across a network is refused: the hub sends its secret there',
    [S.cloudBaseUrl('http://192.168.1.10:3002'), S.cloudBaseUrl('ftp://pos.example.test'), S.cloudBaseUrl(undefined)], [null, null, null])
}

console.log('\nstaff records from the cloud reach a hub session')
{
  // The database here is a hub's as well: users/u-staff is a pulled record.
  const before = await HS.startHubSession({ uid: 'u-new', staff: true, role: 'barista', branchIds: [branch] })
  eq('before any record is pulled, the token\'s claims stand', (await HS.callerFromHubToken(before.token))?.role, 'barista')

  const s = await HS.startHubSession({ uid: 'u-staff', email: 'staff-placeholder', staff: true, role: 'manager', branchIds: [branch] })
  eq('with the record pulled, the session is the record\'s', (await HS.callerFromHubToken(s.token))?.role, 'manager')
  await db.doc('users/u-staff').update({ role: 'barista', branchIds: [otherBranch] })
  const demoted = await HS.callerFromHubToken(s.token)
  eq('a role changed in the cloud is the role at the till after the next pull', [demoted?.role, demoted?.branchIds], ['barista', [otherBranch]])
  await db.doc('users/u-staff').update({ isStaff: false })
  eq('THE TRAP: an account locked in the cloud is refused at the hub after the next pull, not at 05:00',
    await HS.callerFromHubToken(s.token), null)
}

console.log('\nthe cloud reserves receipt numbers for a hub')
{
  await db.doc('appSettings/invoiceCounter').set({ year: cafeYear, nextNumber: 900 })
  const block = await D.reserveReceiptBlock(device, 0)
  eq('a block of 500 right after the cloud\'s last receipt', [block.first, block.last, block.next, block.year], [901, 1400, 901, cafeYear])
  eq('THE TRAP: the cloud\'s own next receipt comes after the block', (await db.doc('appSettings/invoiceCounter').get()).data().nextNumber, 1400)
  await rejects('a hub that still has 100 or more is refused another block', () => D.reserveReceiptBlock(device, 100), e => e.status === 409)
  const logged = (await db.collection('hubReceiptBlocks').get()).docs.map(d => d.data())
  eq('every block is written down: which hub, which numbers', logged.map(l => [l.name, l.branch, l.first, l.last]), [['Counter PC', branch, 901, 1400]])
}

console.log('\na hub numbers receipts only from its blocks')
{
  await rejects('THE TRAP: with no block, a hub refuses to number a receipt rather than count from 1',
    () => I.issueInvoiceNumber(), e => e.status === 409 && /no receipt numbers/.test(e.message))
  await db.doc('hubMeta/receipts').set({ blocks: [{ year: cafeYear, first: 901, last: 902, next: 901 }] })
  const one = await I.issueInvoiceNumber()
  const two = await I.issueInvoiceNumber()
  eq('numbers come from the block, in order, in the café\'s format', [one.sequence, two.sequence, one.invoiceNumber.endsWith('-0901')], [901, 902, true])
  await rejects('used up, the next close is refused until more arrive', () => I.issueInvoiceNumber(), e => e.status === 409 && /used all/.test(e.message))
  eq('THE TRAP: a hub numbering receipts never moves the cloud\'s counter', (await db.doc('appSettings/invoiceCounter').get()).data().nextNumber, 1400)
}

console.log('\na hub pairs and fetches receipt numbers through its own code')
{
  process.env.BIG_CMS_CLOUD_URL = 'https://cloud.test'
  const asked = []
  // The cloud's routes, in-process: the same functions the routes call.
  const cloud = async (href, init = {}) => {
    const target = new URL(href)
    asked.push(target.pathname)
    const request = new Request(href, { method: init.method ?? 'GET', headers: init.headers, body: init.body })
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    try {
      if (target.pathname === '/api/hub-sync/pair') return reply(200, await D.pairDevice(JSON.parse(init.body).code))
      if (target.pathname === '/api/hub-sync/receipts') {
        return reply(200, await D.reserveReceiptBlock(await D.deviceFromRequest(request), JSON.parse(init.body).have))
      }
      return reply(404, { error: 'Not found.' })
    } catch (e) {
      return reply(e.status ?? 500, { error: e.message })
    }
  }
  const code = (await D.createPairingCode(admin, { branch, name: 'Hub under test' })).code
  const pairing = await S.pairHub(code, cloud, false)
  eq('the hub pairs through the cloud\'s pairing', [pairing.branch, pairing.name, pairing.revoked], [branch, 'Hub under test', false])
  await rejects('a paired hub refuses to pair again', () => S.pairHub(code, cloud, false), e => e.status === 409)

  await db.doc('hubMeta/receipts').delete()
  const first = await S.refillReceipts(cloud)
  eq('a hub with none fetches a block of 500', [first.added, first.left], [true, 500])
  const again = await S.refillReceipts(cloud)
  eq('with 500 left it does not ask again', [again.added, asked.filter(p => p === '/api/hub-sync/receipts').length], [false, 1])
  const next = await I.issueInvoiceNumber()
  eq('its next receipt is the first of that block', next.sequence, 1401)
  eq('its page says how many are left', (await S.hubSyncStatus()).receiptsLeft, 499)
}

console.log('\nwhat a hub sends up: the rules')
{
  const PU = await import(url('hubPush.js'))
  eq('a sale off a product\'s branch stock is a movement',
    PU.moveFromIncrement('products', 'p1', `stock.${branch}`, -2), { collection: 'products', docId: 'p1', branch, delta: -2 })
  eq('...and so is an ingredient off a supply',
    PU.moveFromIncrement('supplies', 's1', `quantity.${branch}`, -0.25), { collection: 'supplies', docId: 's1', branch, delta: -0.25 })
  eq('an increment that is not a branch\'s stock is not a movement',
    [PU.moveFromIncrement('products', 'p1', 'price', 1), PU.moveFromIncrement('users', 'u1', 'points', 5),
      PU.moveFromIncrement('products', 'p1', `stock.${branch}.extra`, 1), PU.moveFromIncrement('products', 'p1', `stock.${branch}`, 0)],
    [null, null, null, null])
  eq('...nor a branch-shaped field that is not that collection\'s count: a price per branch, or a supply\'s "stock"',
    [PU.moveFromIncrement('products', 'p1', `price.${branch}`, 1), PU.moveFromIncrement('supplies', 's1', `stock.${branch}`, -1),
      PU.moveFromIncrement('products', 'p1', `quantity.${branch}`, -1)],
    [null, null, null])

  const move = { id: 'AbCdEfGhIjKlMnOpQrSt', collection: 'products', docId: 'p1', branch, delta: -1 }
  eq('a movement for this hub\'s branch is taken', PU.moveProblem(move, branch), null)
  eq('THE TRAP: a hub cannot move another branch\'s stock', PU.moveProblem({ ...move, branch: otherBranch }, branch) !== null, true)
  eq('nor anything but product and supply stock, nor an absurd or missing number, nor without an id',
    [PU.moveProblem({ ...move, collection: 'users' }, branch) !== null, PU.moveProblem({ ...move, delta: 1e9 }, branch) !== null,
      PU.moveProblem({ ...move, delta: Number.NaN }, branch) !== null, PU.moveProblem({ ...move, id: '' }, branch) !== null],
    [true, true, true, true])

  eq('this branch\'s check, ticket, shift and drawer are taken, and activity',
    [PU.pushProblem({ collection: 'checks', id: 'c1', data: { branch } }, branch),
      PU.pushProblem({ collection: 'kitchenTickets', id: 't1', data: { branch } }, branch),
      PU.pushProblem({ collection: 'drawerShifts', id: 's1', data: { branch } }, branch),
      PU.pushProblem({ collection: 'branchDrawers', id: branch, data: {} }, branch),
      PU.pushProblem({ collection: 'activityLog', id: 'a1', data: { label: 'Took cash' } }, branch)],
    [null, null, null, null, null])
  eq('THE TRAP: another branch\'s check, or its drawer, is refused',
    [PU.pushProblem({ collection: 'checks', id: 'c1', data: { branch: otherBranch } }, branch) !== null,
      PU.pushProblem({ collection: 'branchDrawers', id: otherBranch, data: {} }, branch) !== null], [true, true])
  eq('nothing a hub is not master for, never a deletion, never a path',
    [PU.pushProblem({ collection: 'menuItems', id: 'm1', data: {} }, branch) !== null,
      PU.pushProblem({ collection: 'users', id: 'u1', data: {} }, branch) !== null,
      PU.pushProblem({ collection: 'checks', id: 'c1', data: null }, branch) !== null,
      PU.pushProblem({ collection: 'checks', id: 'a/b', data: { branch } }, branch) !== null],
    [true, true, true, true])

  const spec = P.pullSpec(branch)
  const json = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const local = new Map([['products/p1', { name: 'Mug', stock: { [branch]: 3 } }]])
  const snap = [{ collection: 'products', id: 'p1', data: { name: 'Mug', stock: { [branch]: 12 } } }]
  eq('THE TRAP: with its movements sent, a hub takes the cloud\'s count, deliveries included',
    P.planPull(spec, local, snap, json, () => false)[0].data.stock, { [branch]: 12 })
  eq('with movements still waiting, it keeps its own', P.planPull(spec, local, snap, json, () => true).length, 0)
}

console.log('\nthe hub\'s database records stock movements as it commits them')
{
  const PU = await import(url('hubPush.js'))
  const turn = () => new Promise(r => setImmediate(r))
  const store = H.openHubStore(new DatabaseSync(':memory:'), { journal: PU.moveFromIncrement, journalCollection: PU.MOVES_COLLECTION })
  const movesIn = async () => (await store.collection(PU.MOVES_COLLECTION).get()).docs.map(d => d.data())
  await store.doc('products/p1').set({ name: 'Mug', price: 12, stock: { [branch]: 10 } })
  const before = store.lastSeq()
  await store.doc('products/p1').update({ [`stock.${branch}`]: FieldValue.increment(-2), updatedAt: FieldValue.serverTimestamp() })
  const moves = await movesIn()
  eq('a sale is a movement, written in the same commit as the sale',
    [moves.length, moves[0]?.delta, moves[0]?.docId, moves[0]?.branch, store.changesSince(before).length], [1, -2, 'p1', branch, 2])
  await store.doc('products/p1').update({ price: FieldValue.increment(1) })
  eq('a price going up is not a movement', (await movesIn()).length, 1)

  const bad = store.batch()
  bad.update(store.doc('products/p1'), { [`stock.${branch}`]: FieldValue.increment(-1) })
  bad.update(store.doc('products/missing'), { a: 1 })
  await rejects('a commit with a refused write fails', () => bad.commit(), e => e.code === 5)
  eq('THE TRAP: a refused commit records no movement either', (await movesIn()).length, 1)

  let release
  const gate = new Promise(r => { release = r })
  let runs = 0
  const sale = store.runTransaction(async tx => {
    runs++
    await tx.get(store.doc('products/p1'))
    if (runs === 1) await gate
    tx.update(store.doc('products/p1'), { [`stock.${branch}`]: FieldValue.increment(-1) })
  })
  await turn(); await turn()
  await store.doc('products/p1').update({ name: 'Big mug' })
  release()
  await sale
  eq('THE TRAP: a transaction that runs again records its movement once', [runs, (await movesIn()).length], [2, 2])
  eq('...and the count is what was sold', (await store.doc('products/p1').get()).data().stock, { [branch]: 7 })
}

console.log('\nthe cloud takes in what a hub sends')
{
  const cloudData = H.openHubStore(new DatabaseSync(':memory:'))
  await cloudData.doc('products/p1').set({ name: 'Mug', price: 13, stock: { [branch]: 40 } })
  for (const d of (await db.collection('hubStockMoves').get()).docs) await d.ref.delete()
  // From here on: the sections above wrote plenty, none of it a hub's trading.
  db.writeMeta('pushedSeq', String(db.lastSeq()))

  await db.doc('checks/hub-check-1').set({ branch, status: 'closed', tableNumber: 4, lines: [], closedAt: Timestamp.fromMillis(1_700_000_000_000) })
  await db.doc('kitchenTickets/hub-ticket-1').set({ branch, station: 'Kitchen', status: 'bumped' })
  await db.doc(`branchDrawers/${branch}`).set({ openShiftId: null, since: null })
  await db.collection('activityLog').add({ action: 'create', section: 'POS', label: 'Took cash', userId: 'u-till', userEmail: null })
  await db.doc('products/p1').update({ [`stock.${branch}`]: FieldValue.increment(-1) })
  await db.doc('hubSessions/not-sent').set({ uid: 'u-till' })

  const batch = await S.collectPush(db, Number(db.readMeta('pushedSeq')))
  eq('the batch carries this branch\'s check, ticket, drawer and activity, as they stand',
    batch.docs.map(d => d.collection).sort(), ['activityLog', 'branchDrawers', 'checks', 'kitchenTickets'])
  eq('...and the sale as a movement, never a count', batch.moves.map(m => [m.collection, m.docId, m.branch, m.delta]), [['products', 'p1', branch, -1]])
  eq('THE TRAP: never the hub\'s sessions, its products or its own bookkeeping',
    batch.docs.some(d => ['hubSessions', 'products', 'hubMeta', 'hubStockMoves'].includes(d.collection)), false)
  eq('the batch covers everything written, sent or not', batch.toSeq, db.lastSeq())
  eq('a Timestamp travels tagged', batch.docs.find(d => d.collection === 'checks').data.closedAt, { $fs: 'ts', s: 1_700_000_000, n: 0 })

  const r1 = await D.applyPush(device, { seq: batch.toSeq, docs: batch.docs, moves: batch.moves }, cloudData)
  eq('the cloud writes the documents and applies the movement', [r1.docs, r1.moves, r1.movesAlreadyApplied], [4, 1, 0])
  const check = (await cloudData.doc('checks/hub-check-1').get()).data()
  eq('the check arrives as the hub has it, its Timestamp a Timestamp', [check.tableNumber, check.closedAt instanceof Timestamp], [4, true])
  eq('THE TRAP: the cloud adds the sale to its own count', (await cloudData.doc('products/p1').get()).data().stock, { [branch]: 39 })
  const activity = (await cloudData.collection('activityLog').get()).docs.map(d => d.data())
  eq('activity says which hub it came from', [activity[0].label, activity[0].hubId, activity[0].branch], ['Took cash', device.id, branch])

  const r2 = await D.applyPush(device, { seq: batch.toSeq, docs: batch.docs, moves: batch.moves }, cloudData)
  eq('THE TRAP: the same push again takes nothing twice',
    [r2.moves, r2.movesAlreadyApplied, (await cloudData.doc('products/p1').get()).data().stock[branch]], [0, 1, 39])
  eq('the cloud records how far the hub has sent', (await db.doc(`hubDevices/${device.id}`).get()).data().pushedSeq, batch.toSeq)

  const gone = await D.applyPush(device, {
    seq: batch.toSeq, docs: [], moves: [{ id: 'ZyXwVuTsRqPoNmLkJiHg', collection: 'products', docId: 'no-such-product', branch, delta: -1 }],
  }, cloudData)
  eq('a movement for a product the cloud no longer has is marked, not an error', [gone.moves, (await cloudData.doc('products/no-such-product').get()).exists], [1, false])

  const mixed = [
    { collection: 'checks', id: 'hub-check-2', data: { branch, status: 'open' } },
    { collection: 'checks', id: 'other-branch-check', data: { branch: otherBranch, status: 'open' } },
  ]
  await rejects('THE TRAP: one item from another branch refuses the whole push',
    () => D.applyPush(device, { seq: batch.toSeq + 1, docs: mixed, moves: [] }, cloudData), e => e.status === 400)
  eq('...and none of it is written', [(await cloudData.doc('checks/hub-check-2').get()).exists, (await cloudData.doc('checks/other-branch-check').get()).exists], [false, false])

  await rejects('THE TRAP: a movement off another branch\'s shelf refuses the whole push',
    () => D.applyPush(device, {
      seq: batch.toSeq + 1,
      docs: [{ collection: 'checks', id: 'hub-check-3', data: { branch, status: 'open' } }],
      moves: [{ id: 'QwErTyUiOpAsDfGhJkLz', collection: 'products', docId: 'p1', branch: otherBranch, delta: -5 }],
    }, cloudData), e => e.status === 400)
  eq('...and neither shelf nor check is touched',
    [(await cloudData.doc('checks/hub-check-3').get()).exists, (await cloudData.doc('products/p1').get()).data().stock], [false, { [branch]: 39 }])
}

console.log('\nthe hub\'s own sync sends up, then takes the cloud\'s count back')
{
  const cloudData = H.openHubStore(new DatabaseSync(':memory:'))
  await cloudData.doc('products/p1').set({ name: 'Mug', price: 13, stock: { [branch]: 40 } })
  const cloud = async (href, init = {}) => {
    const target = new URL(href)
    const request = new Request(href, { method: init.method ?? 'GET', headers: init.headers, body: init.body })
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    try {
      if (target.pathname === '/api/hub-sync/push') {
        return reply(200, await D.applyPush(await D.deviceFromRequest(request), JSON.parse(init.body), cloudData))
      }
      return reply(404, { error: 'Not found.' })
    } catch (e) {
      return reply(e.status ?? 500, { error: e.message })
    }
  }
  for (const d of (await db.collection('hubStockMoves').get()).docs) await d.ref.delete()
  db.writeMeta('pushedSeq', String(db.lastSeq()))

  // The hub paired above ("Hub under test") sells two mugs and closes a check.
  await db.doc('products/p1').update({ [`stock.${branch}`]: FieldValue.increment(-2) })
  await db.doc('checks/hub-check-3').set({ branch, status: 'closed', tableNumber: 9 })
  eq('a sale waits as a movement until it is sent', [(await S.pendingStock(db)).has('products/p1'), (await S.hubSyncStatus()).movesWaiting], [true, 1])

  const sent = await S.pushToCloud(cloud)
  eq('the hub sends its check and its movement', [sent.docs, sent.moves], [1, 1])
  eq('the cloud has them', [(await cloudData.doc('checks/hub-check-3').get()).exists, (await cloudData.doc('products/p1').get()).data().stock[branch]], [true, 38])
  eq('THE TRAP: once the cloud has a movement, the hub no longer holds it', [(await S.pendingStock(db)).size, (await S.hubSyncStatus()).movesWaiting], [0, 0])
  const seq = db.lastSeq()
  const again = await S.pushToCloud(cloud)
  eq('THE TRAP: with nothing new, sending again sends nothing and writes nothing', [again.docs, again.moves, db.lastSeq()], [0, 0, seq])

  // Meanwhile a delivery of ten mugs is received in admin, in the cloud.
  await cloudData.doc('products/p1').update({ [`stock.${branch}`]: FieldValue.increment(10) })
  const snapshot = D.encodeSnapshot([{ collection: 'products', id: 'p1', data: (await cloudData.doc('products/p1').get()).data() }])
  await S.applySnapshot(db, branch, snapshot.docs, await S.pendingStock(db))
  eq('THE TRAP: the hub takes the cloud\'s count, with the delivery and its own sales in it',
    (await db.doc('products/p1').get()).data().stock[branch], 48)
  await db.doc('products/p1').update({ [`stock.${branch}`]: FieldValue.increment(-1) })
  await S.applySnapshot(db, branch, snapshot.docs, await S.pendingStock(db))
  eq('...but while a sale is still waiting to go up, it keeps its own count', (await db.doc('products/p1').get()).data().stock[branch], 47)
}

} catch (err) {
  console.log(`  FAIL  the run stopped: ${String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ')}`)
  fail++
}

rmSync(out, { recursive: true, force: true })
try { rmSync(tmp, { recursive: true, force: true }) } catch { /* the store's handle is still open; the OS cleans temp */ }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
