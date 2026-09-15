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
    'shared/src/server/hubSession.ts shared/src/server/invoiceNumber.ts shared/src/server/hubLock.ts ' +
    'shared/src/server/staffKeys.ts shared/src/server/keyAttestation.ts shared/src/server/hubKeySignIn.ts shared/src/server/hubApprovals.ts ' +
    'shared/src/server/hubCounterSignIn.ts ' +
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
  await put('staffProfiles/u-staff', { firstName: '  Sara \n', updatedBy: 'u-admin' })
  await put('staffProfiles/u-customer', { firstName: 'Not staff' })
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
  eq('THE TRAP: a staff record arrives without email, phone or points: only its first name joins it (S15)',
    Object.keys(snap.find(d => d.id === 'u-staff').data).sort(), ['branchIds', 'firstName', 'isStaff', 'role'])
  eq('...the first name as an admin set it, tidied, and no profile of its own travels', [snap.find(d => d.id === 'u-staff').data.firstName, paths.some(p => p.startsWith('staffProfiles/'))], ['Sara', false])
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

console.log('\nwhile a café hub trades a branch, the online till is view-only there (S10)')
{
  const L = await import(url('server/hubLock.js'))
  const cloudData = H.openHubStore(new DatabaseSync(':memory:'))
  const refused = async (target, onHub = false) => {
    try { await L.refuseWhileHubbed(target, { db: cloudData, onHub }); return null } catch (e) { return e.status ?? String(e) }
  }
  await cloudData.doc('checks/c-here').set({ branch, status: 'open', tableNumber: 3 })
  await cloudData.doc('checks/c-there').set({ branch: otherBranch, status: 'open', tableNumber: 3 })
  await cloudData.doc('kitchenTickets/t-here').set({ branch, status: 'ready' })
  await cloudData.doc('drawerShifts/s-here').set({ branch, status: 'open' })

  eq('with no hub, the online till changes anything', [await refused({ branch }), await refused({ checkId: 'c-here' })], [null, null])

  await cloudData.doc('hubDevices/h-here').set({ branch, name: 'Counter PC', secretHash: 'x', revokedAt: null })
  eq('THE TRAP: with a hub paired, opening a table, a check, a ticket and the drawer there are all refused, 409',
    [await refused({ branch }), await refused({ checkId: 'c-here' }), await refused({ ticketId: 't-here' }), await refused({ shiftId: 's-here' })],
    [409, 409, 409, 409])
  let message = ''
  try { await L.refuseWhileHubbed({ branch }, { db: cloudData, onHub: false }) } catch (e) { message = e.message }
  eq('the refusal names the branch and the hub, and says where to go', [message.includes(branch), message.includes('Counter PC'), message.includes('view-only')], [true, true, true])
  eq('another branch, with no hub of its own, is not touched', [await refused({ branch: otherBranch }), await refused({ checkId: 'c-there' })], [null, null])
  eq('a document that is not there is left to the write itself to refuse', [await refused({ checkId: 'no-such' }), await refused({ checkId: 'a/b' })], [null, null])
  eq('THE TRAP: on the hub itself nothing is refused — it is the master', [await refused({ branch }, true), await refused({ checkId: 'c-here' }, true)], [null, null])

  await cloudData.doc('hubDevices/h-here').update({ revokedAt: Timestamp.fromMillis(1_700_000_000_000) })
  eq('once an admin unpairs the hub, the online till is open again', [await refused({ branch }), await L.branchHub(branch, cloudData)], [null, null])
  await cloudData.doc('hubDevices/h-new').set({ branch, name: '', revokedAt: null })
  eq('...and a hub paired again, with no name, locks it again, found past the unpaired one',
    [await refused({ checkId: 'c-here' }), (await L.branchHub(branch, cloudData))?.id], [409, 'h-new'])
  eq('a hub row for another branch is not this branch\'s hub, whatever rows a caller hands over',
    [L.activeHubFor([{ id: 'h-there', data: { branch: otherBranch, name: 'Other PC', revokedAt: null } }], branch),
      L.activeHubFor([{ id: 'h-there', data: { branch: otherBranch, revokedAt: null } }, { id: 'h-here', data: { branch, name: 'PC' } }], branch)?.id],
    [null, 'h-here'])
  eq('a message without a hub name reads cleanly', L.hubOnlyMessage(branch, { id: 'h', name: '' }).includes('()'), false)

  // The lock is only as good as the routes that call it: every till write in
  // the cloud, about the right thing, before its first write.
  const guards = [
    // Opening a table names a branch; adding to a check names the check.
    ['checks', 'POST', /await refuseWhileHubbed\(checkId \? \{ checkId \} : \{ branch: /g, 1],
    ['checks', 'PATCH', /await refuseWhileHubbed\(\{ checkId \}\)/g, 1],
    // Two writes, the front's pickup and the kitchen's, each checked.
    ['tickets', 'PATCH', /await refuseWhileHubbed\(\{ ticketId \}\)/g, 2],
    ['drawer', 'POST', /await refuseWhileHubbed\(\{ branch \}\)/g, 1],
    ['drawer', 'PATCH', /await refuseWhileHubbed\(\{ shiftId \}\)/g, 1],
  ]
  const WRITES = /\b(openCheck|addLines|sendCheck|voidLine|moveCheck|closeCheck|refundCheck|addPayment|openShift|closeShift|advanceTicket|pickUpTicket)\(/
  const unguarded = []
  for (const [name, method, guard, needed] of guards) {
    const src = readFileSync(`pos/app/api/pos/${name}/route.ts`, 'utf8')
    const body = src.split(`export async function ${method}(`)[1]?.split('export async function')[0] ?? ''
    const found = [...body.matchAll(guard)]
    const firstWrite = body.search(WRITES)
    if (found.length < needed || firstWrite < 0 || found[0].index > firstWrite) unguarded.push(`${name} ${method}`)
  }
  eq('THE TRAP: every till write route in the cloud asks about the right thing before it writes', unguarded, [])
}

console.log('\na broken counter PC: its branch trades online, what it sends is held, and the branch goes back clean (S21–S23)')
{
  const FB = await import(url('hubFallback.js'))
  const L = await import(url('server/hubLock.js'))
  const at = ms => Timestamp.fromMillis(ms)

  // ── The rules ──
  eq('a paired hub locks its branch; unpaired, or switched to the online till, it does not',
    [FB.hubLocksBranch({ revokedAt: null }), FB.hubLocksBranch({ revokedAt: at(1) }), FB.hubLocksBranch({ revokedAt: null, onlineSince: at(1_700_000_000_000) })],
    [true, false, false])
  eq('a hub is caught up only when it has sent to the end of its change log',
    [FB.caughtUp('9', '9'), FB.caughtUp('10', '9'), FB.caughtUp('8', '9'), FB.caughtUp(null, '9'), FB.caughtUp('', ''), FB.caughtUp('x', 'x'), FB.caughtUp('-1', '-1'), FB.caughtUp('1.5', '1')],
    [true, true, false, false, false, false, false, false])
  const clear = { branch, revoked: false, onlineSince: 1000, caughtUpAt: 2000, openChecks: 0, openShift: false, heldWaiting: 0 }
  eq('a branch goes back when the hub caught up since going online and nothing is open or waiting', FB.handBackProblem(clear), null)
  eq('THE TRAP: not while the counter PC has not been in touch since the branch went online — it may hold unsent sales',
    [/not been in touch/.test(FB.handBackProblem({ ...clear, caughtUpAt: null })), /not been in touch/.test(FB.handBackProblem({ ...clear, caughtUpAt: 999 }))], [true, true])
  eq('...nor with a table open online, the drawer shift open, or anything held still waiting (S23)',
    [FB.handBackProblem({ ...clear, openChecks: 1 }), FB.handBackProblem({ ...clear, openChecks: 3 }), /drawer shift/.test(FB.handBackProblem({ ...clear, openShift: true })), /Held Hub Sales/.test(FB.handBackProblem({ ...clear, heldWaiting: 2 }))],
    [`A table is still open at ${branch} on the online till. Close it first.`, `3 tables are still open at ${branch} on the online till. Close them first.`, true, true])
  eq('...and not for an unpaired hub, or a branch that is not online',
    [/unpaired/.test(FB.handBackProblem({ ...clear, revoked: true })), /not trading online/.test(FB.handBackProblem({ ...clear, onlineSince: null }))], [true, true])
  eq('a held item is one plain line for the manager',
    [FB.heldSummary('checks', { tableNumber: 7, status: 'open', lines: [{ status: 'sent' }, { status: 'void' }] }), FB.heldSummary('kitchenTickets', { station: 'Bar', status: 'ready' }),
      FB.heldSummary('branchDrawers', { openShiftId: 's' }), FB.heldSummary('products', null, { collection: 'products', docId: 'mug', delta: -2 })],
    ['Table 7, open, 1 line', 'Bar ticket, ready', 'Drawer: a shift open', 'Stock -2 of mug (products)'])

  // ── The lock, both ways ──
  const lockData = H.openHubStore(new DatabaseSync(':memory:'))
  const lockRefused = async (target, onHub = false) => {
    try { await L.refuseWhileHubbed(target, { db: lockData, onHub }); return null } catch (e) { return e.status ?? String(e) }
  }
  await lockData.doc('hubDevices/h-broken').set({ branch, name: 'Broken PC', revokedAt: null, onlineSince: at(Date.now()) })
  eq('THE TRAP: switched to the online till, a paired hub no longer makes its branch view-only (S21)',
    [await lockRefused({ branch }), await L.branchHub(branch, lockData)], [null, null])
  eq('on the hub itself, while it has not heard, nothing is refused', await lockRefused({ branch }, true), null)
  await lockData.doc('hubMeta/device').set({ branch, tradingOnline: true })
  let hubMessage = ''
  try { await L.refuseWhileHubbed({ branch }, { db: lockData, onHub: true }) } catch (e) { hubMessage = e.message }
  eq('THE TRAP: once the hub hears its branch trades online, the hub refuses its own till writes, 409, and says why',
    [await lockRefused({ branch }, true), await lockRefused({ checkId: 'anything' }, true), hubMessage.includes(branch), /online till/.test(hubMessage)], [409, 409, true, true])
  await lockData.doc('hubMeta/device').set({ branch, tradingOnline: false })
  eq('...and once it hears the branch is back, it trades again', await lockRefused({ branch }, true), null)

  // ── The cloud ──
  const fbPair = await D.pairDevice((await D.createPairingCode(admin, { branch, name: 'Broken PC' })).code)
  const fbAuth = new Request('https://cloud.test/api/hub-sync/pull', { headers: { Authorization: P.deviceAuthHeader(fbPair.deviceId, fbPair.secret) } })
  const fbDevice = () => D.deviceFromRequest(fbAuth)
  const manager = { uid: 'u-mgr', email: 'mgr-placeholder', role: 'manager', branchIds: [branch], superadmin: false, isStaff: true }
  const elsewhere = { ...manager, uid: 'u-mgr2', branchIds: [otherBranch] }
  await db.doc('products/fb-mug').set({ name: 'Mug', stock: { [branch]: 20 } })
  for (const d of (await db.collection('checks').where('branch', '==', branch).where('status', '==', 'open').get()).docs) await d.ref.update({ status: 'closed' })
  await db.doc(`branchDrawers/${branch}`).set({ openShiftId: null, since: null })

  eq('before the switch the hub trades its branch', (await fbDevice()).onlineSince, null)
  await rejects('an unpaired hub\'s branch is not switched: it trades online already',
    async () => D.startOnlineTrading(admin, (await D.pairDevice((await D.createPairingCode(admin, { branch, name: 'Gone PC' })).code).then(async p => { await D.revokeDevice(admin, p.deviceId); return p })).deviceId, db),
    e => e.status === 409)
  await rejects('a hub that is not one is refused', () => D.startOnlineTrading(admin, 'nope', db), e => e.status === 400)
  const switched = await D.startOnlineTrading(admin, fbPair.deviceId, db)
  const online = await fbDevice()
  eq('an admin switches the branch to the online till (S21), and switching twice is an answer',
    [switched.already, (await D.startOnlineTrading(admin, fbPair.deviceId, db)).already, typeof online.onlineSince], [false, true, 'number'])
  const row = (await D.listDevices(db)).find(r => r.id === fbPair.deviceId)
  eq('the admin list says so, and who', [typeof row.onlineSince, row.onlineByEmail, row.caughtUpAt, row.heldWaiting], ['number', 'admin-placeholder', null, 0])

  const sentCheck = { collection: 'checks', id: 'fb-check-1', data: { branch, status: 'open', tableNumber: 7, lines: [{ status: 'sent' }], openedAt: { $fs: 'ts', s: 1_700_000_000, n: 0 } } }
  const sentActivity = { collection: 'activityLog', id: 'fb-act-1', data: { action: 'create', section: 'POS', label: 'Opened table 7' } }
  const sentMove = { id: 'fbMoveOne', collection: 'products', docId: 'fb-mug', branch, delta: -2 }
  await db.doc(`hubAppliedMoves/${fbPair.deviceId}_fbMoveEarlier`).set({ applied: true })
  const earlierMove = { ...sentMove, id: 'fbMoveEarlier' }
  const heldPush = await D.applyPush(online, { seq: 40, docs: [sentCheck, sentActivity], moves: [sentMove, earlierMove] }, db)
  eq('THE TRAP: while the branch trades online, what the hub sends is held, not applied (S22)',
    [heldPush.docs, heldPush.moves, heldPush.held, heldPush.tradingOnline, (await db.doc('checks/fb-check-1').get()).exists, (await db.doc('products/fb-mug').get()).data().stock[branch]],
    [0, 0, 2, true, false, 20])
  eq('...activity is kept as history, marked with the hub', [(await db.doc('activityLog/fb-act-1').get()).data()?.hubId], [fbPair.deviceId])
  eq('...and a movement the cloud applied before the switch is not held again',
    (await db.doc(`hubHeldItems/${fbPair.deviceId}_move_fbMoveEarlier`).get()).exists, false)
  await D.applyPush(online, { seq: 41, docs: [sentCheck], moves: [sentMove] }, db)
  const heldNow = (await db.collection('hubHeldItems').where('deviceId', '==', fbPair.deviceId).get()).docs
  eq('the same push again holds nothing twice', heldNow.length, 2)
  await rejects('THE TRAP: held or not, another branch\'s check still refuses the whole push',
    () => D.applyPush(online, { seq: 42, docs: [{ collection: 'checks', id: 'x', data: { branch: otherBranch, status: 'open' } }], moves: [] }, db), e => e.status === 400)

  await rejects('THE TRAP: the branch is not handed back while the counter PC has not caught up since',
    () => D.handBackToHub(admin, fbPair.deviceId, db), e => e.status === 409 && /not been in touch/.test(e.message))
  eq('a hub with changes still to send is not caught up', await D.noteCaughtUp(online, '38', '41', db), false)
  eq('...one with nothing left is, and it is written once per spell online',
    [await D.noteCaughtUp(online, '41', '41', db), await D.noteCaughtUp(await fbDevice(), '41', '41', db)], [true, false])
  eq('...and a hub trading its own branch is never noted', await D.noteCaughtUp({ ...online, onlineSince: null }, '1', '1', db), false)

  await db.doc('checks/fb-online-1').set({ branch, status: 'open', tableNumber: 2 })
  await rejects('THE TRAP: not handed back with a table open on the online till (S23)',
    () => D.handBackToHub(admin, fbPair.deviceId, db), e => e.status === 409 && /still open/.test(e.message))
  await db.doc('checks/fb-online-1').update({ status: 'closed' })
  await db.doc(`branchDrawers/${branch}`).set({ openShiftId: 'fb-shift', since: null })
  await rejects('...nor with its drawer shift open', () => D.handBackToHub(admin, fbPair.deviceId, db), e => e.status === 409 && /drawer shift/.test(e.message))
  await db.doc(`branchDrawers/${branch}`).set({ openShiftId: null, since: null })
  await rejects('...nor while held items wait for a manager', () => D.handBackToHub(admin, fbPair.deviceId, db), e => e.status === 409 && /Held Hub Sales/.test(e.message))

  const listed = (await D.listHeldItems(db)).filter(i => i.deviceId === fbPair.deviceId)
  const heldCheck = listed.find(i => i.kind === 'doc')
  eq('the manager sees what the PC sent, and that the cloud has no copy of it',
    [heldCheck?.summary, heldCheck?.cloudNow, heldCheck?.status, listed.find(i => i.kind === 'move')?.summary],
    ['Table 7, open, 1 line', null, 'waiting', 'Stock -2 of fb-mug (products)'])
  await rejects('THE TRAP: a manager at another branch decides nothing here', () => D.decideHeldItem(elsewhere, heldCheck.id, 'apply', db), e => e.status === 403)
  await rejects('a decision is apply or dismiss', () => D.decideHeldItem(manager, heldCheck.id, 'maybe', db), e => e.status === 400)
  await D.decideHeldItem(manager, heldCheck.id, 'apply', db)
  const applied = (await db.doc('checks/fb-check-1').get()).data()
  eq('applying writes the counter PC\'s version, its Timestamp a Timestamp', [applied?.tableNumber, applied?.openedAt instanceof Timestamp], [7, true])
  await rejects('THE TRAP: an item is decided once', () => D.decideHeldItem(manager, heldCheck.id, 'dismiss', db), e => e.status === 409)
  const heldMove = listed.find(i => i.kind === 'move')
  await D.decideHeldItem(manager, heldMove.id, 'apply', db)
  eq('applying a movement moves the cloud\'s count once', (await db.doc('products/fb-mug').get()).data().stock[branch], 18)
  const late = await D.applyPush({ ...online, onlineSince: null }, { seq: 43, docs: [], moves: [sentMove] }, db)
  eq('...and the same movement sent again later is not applied twice', [late.moves, late.movesAlreadyApplied, (await db.doc('products/fb-mug').get()).data().stock[branch]], [0, 1, 18])
  await db.doc(`hubAppliedMoves/${fbPair.deviceId}_fbMoveTwice`).set({ applied: true })
  await db.doc(`hubHeldItems/${fbPair.deviceId}_move_fbMoveTwice`).set({
    deviceId: fbPair.deviceId, hubName: 'Broken PC', branch, status: 'waiting', kind: 'move', collection: 'products', docId: 'fb-mug', data: null,
    move: { id: 'fbMoveTwice', collection: 'products', docId: 'fb-mug', branch, delta: -5 }, summary: 'x', heldAt: at(Date.now()),
  })
  await D.decideHeldItem(admin, `${fbPair.deviceId}_move_fbMoveTwice`, 'apply', db)
  eq('THE TRAP: applying a held movement the cloud already has moves nothing', (await db.doc('products/fb-mug').get()).data().stock[branch], 18)
  await db.doc(`hubHeldItems/${fbPair.deviceId}_checks_forged`).set({
    deviceId: fbPair.deviceId, hubName: 'Broken PC', branch, status: 'waiting', kind: 'doc', collection: 'checks', docId: 'forged',
    data: { branch: otherBranch, status: 'open' }, move: null, summary: 'x', heldAt: at(Date.now()),
  })
  await rejects('THE TRAP: applying still refuses a document for another branch', () => D.decideHeldItem(admin, `${fbPair.deviceId}_checks_forged`, 'apply', db), e => e.status === 400)
  await D.decideHeldItem(admin, `${fbPair.deviceId}_checks_forged`, 'dismiss', db)
  eq('dismissing leaves the cloud as it is', (await db.doc('checks/forged').get()).exists, false)

  await rejects('an open check a manager applied is an open table like any other: closed before the branch goes back',
    () => D.handBackToHub(admin, fbPair.deviceId, db), e => e.status === 409 && /still open/.test(e.message))
  await db.doc('checks/fb-check-1').update({ status: 'closed' })
  const handed = await D.handBackToHub(admin, fbPair.deviceId, db)
  const back = await fbDevice()
  eq('with all of that done, the branch goes back to its hub', [handed.id, back.onlineSince, back.caughtUpAt], [fbPair.deviceId, null, null])
  const normal = await D.applyPush(back, { seq: 44, docs: [{ ...sentCheck, id: 'fb-check-2' }], moves: [] }, db)
  eq('...which is master again: what it sends is applied', [normal.docs, normal.held, normal.tradingOnline, (await db.doc('checks/fb-check-2').get()).exists], [1, 0, false, true])
  await rejects('handing back twice is refused', () => D.handBackToHub(admin, fbPair.deviceId, db), e => e.status === 409 && /not trading online/.test(e.message))
  await D.startOnlineTrading(admin, fbPair.deviceId, db)
  await rejects('THE TRAP: a new spell online needs the hub to catch up again, whatever it said before',
    () => D.handBackToHub(admin, fbPair.deviceId, db), e => e.status === 409 && /not been in touch/.test(e.message))
  await D.revokeDevice(admin, fbPair.deviceId)

  // ── The hub ──
  const staleSeq = db.lastSeq()
  db.writeMeta('pushedSeq', String(staleSeq))
  eq('the hub follows the cloud: switched online', [await S.followTradingOnline(db, true), await S.followTradingOnline(db, true), (await S.hubSyncStatus()).tradingOnline], ['online', 'unchanged', true])
  await rejects('...and from then refuses its own till writes', () => L.refuseWhileHubbed({ branch }, { db, onHub: true }), e => e.status === 409)
  await db.doc('checks/stale-open').set({ branch, status: 'open', tableNumber: 5 })
  await db.doc('kitchenTickets/stale').set({ branch, status: 'new' })
  await db.doc('drawerShifts/stale').set({ branch, status: 'open' })
  await db.doc(`branchDrawers/${branch}`).set({ openShiftId: 'stale', since: null })
  await db.doc('hubStockMoves/stale').set({ collection: 'products', docId: 'fb-mug', branch, delta: -1 })
  await db.doc('activityLog/hub-history').set({ label: 'Opened table 5' })
  db.writeMeta('pushedSeq', String(db.lastSeq()))
  const beforeClear = db.lastSeq()
  eq('THE TRAP: handed back, the hub clears its old tables, tickets, shifts, drawer and movements before trading again (S23)',
    [await S.followTradingOnline(db, false),
      ...(await Promise.all(['checks', 'kitchenTickets', 'drawerShifts', 'branchDrawers', 'hubStockMoves'].map(async c => (await db.collection(c).get()).size))),
      (await db.doc('activityLog/hub-history').get()).exists, (await S.hubSyncStatus()).tradingOnline],
    ['handedBack', 0, 0, 0, 0, 0, true, false])
  const afterClear = await S.collectPush(db, beforeClear)
  eq('...and none of those removals goes up', [afterClear.docs.length, afterClear.moves.length, afterClear.toSeq > beforeClear], [0, 0, true])

  const calls = []
  const fakeCloud = async (href, init = {}) => {
    const u = new URL(href)
    calls.push(u)
    const body = u.pathname === '/api/hub-sync/push'
      ? { docs: 0, moves: 0, movesAlreadyApplied: 0, held: 1, tradingOnline: true, seq: 1 }
      : { unchanged: true, digest: 'd', tradingOnline: calls.filter(c => c.pathname === '/api/hub-sync/pull').length > 1 ? false : true }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  db.writeMeta('pushedSeq', String(db.lastSeq()))
  await db.doc('checks/sold-offline').set({ branch, status: 'closed', tableNumber: 8 })
  await S.pushToCloud(fakeCloud)
  eq('THE TRAP: a push held by the cloud stops the hub taking orders at once, not at the next pull',
    [(await S.hubSyncStatus()).tradingOnline, await L.refuseWhileHubbed({ branch }, { db, onHub: true }).then(() => null, e => e.status)], [true, 409])
  // Somebody signs in between the push and the pull: a change with nothing to send.
  await db.doc('hubSessions/between-push-and-pull').set({ uid: 'u-till' })
  await S.pullFromCloud(fakeCloud)
  const pullUrl = calls.find(c => c.pathname === '/api/hub-sync/pull')
  eq('...and its pull tells the cloud it has nothing left to send, a change with nothing to send not counted',
    [pullUrl.searchParams.get('sent'), pullUrl.searchParams.get('sent') === pullUrl.searchParams.get('latest')], [String(db.lastSeq()), true])
  await db.doc('checks/unsent').set({ branch, status: 'open', tableNumber: 1 })
  await S.pullFromCloud(fakeCloud)
  const second = calls.filter(c => c.pathname === '/api/hub-sync/pull')[1]
  eq('a hub with a check still unsent does not say it is caught up', Number(second.searchParams.get('sent')) < Number(second.searchParams.get('latest')), true)
  eq('...and hearing it is handed back, it clears and trades again', [(await S.hubSyncStatus()).tradingOnline, (await db.doc('checks/unsent').get()).exists], [false, false])
}

console.log('\nstaff phones register a key, and sign in at the hub with it (S12–S14)')
{
  const K = await import(url('server/staffKeys.js'))
  const KS = await import(url('server/hubKeySignIn.js'))
  const SK = await import(url('staffKeys.js'))
  const KA = await import(url('keyAttestation.js'))
  const KV = await import(url('server/keyAttestation.js'))
  const { generateKeyPairSync, createHash, X509Certificate, sign: signWith } = await import('node:crypto')
  // A phone: a P-256 key pair, as Android's Keystore makes, and the signing it does after a fingerprint.
  const phone = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const der = publicKey.export({ type: 'spki', format: 'der' })
    return {
      publicKey: der.toString('base64'),
      keyId: K.keyIdFor(der),
      key: publicKey,
      privateKey,
      sign: message => signWith('sha256', Buffer.from(message, 'utf8'), { key: privateKey, dsaEncoding: 'der' }).toString('base64'),
    }
  }

  // ── A stand-in for Google's attestation, built here byte by byte (S20) ──
  // A made-up root and batch certificate sign each phone's key certificate,
  // with the attestation extension as a real phone writes it. The cloud is told
  // to trust this root instead of Google's, and nothing else changes.
  const tlv = (tag, content) => {
    const n = content.length
    const len = n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255]
    return Buffer.concat([Buffer.from([].concat(tag)), Buffer.from(len), content])
  }
  const seq = (...items) => tlv(0x30, Buffer.concat(items))
  const set = (...items) => tlv(0x31, Buffer.concat(items))
  const int = n => {
    let hex = n.toString(16)
    if (hex.length % 2) hex = `0${hex}`
    let b = Buffer.from(hex, 'hex')
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b])
    return tlv(0x02, b)
  }
  const enumerated = n => { const b = int(n); b[0] = 0x0a; return b }
  const octets = b => tlv(0x04, Buffer.from(b))
  const bool = v => tlv(0x01, Buffer.from([v ? 0xff : 0]))
  const oid = dotted => {
    const p = dotted.split('.').map(Number)
    const bytes = [40 * p[0] + p[1]]
    for (const v of p.slice(2)) {
      const s = [v & 0x7f]
      for (let x = Math.floor(v / 128); x > 0; x = Math.floor(x / 128)) s.unshift((x & 0x7f) | 0x80)
      bytes.push(...s)
    }
    return tlv(0x06, Buffer.from(bytes))
  }
  const tagged = (n, inner) => {
    if (n < 31) return tlv(0xa0 | n, inner)
    const s = [n & 0x7f]
    for (let x = n >> 7; x > 0; x >>= 7) s.unshift((x & 0x7f) | 0x80)
    return tlv([0xbf, ...s], inner)
  }
  const authorizations = f => seq(...[
    f.purpose && tagged(1, set(...f.purpose.map(int))),
    f.algorithm !== undefined && tagged(2, int(f.algorithm)),
    f.keySize !== undefined && tagged(3, int(f.keySize)),
    f.ecCurve !== undefined && tagged(10, int(f.ecCurve)),
    f.noAuthRequired && tagged(503, Buffer.from([0x05, 0x00])),
    f.userAuthType !== undefined && tagged(504, int(f.userAuthType)),
    f.authTimeout !== undefined && tagged(505, int(f.authTimeout)),
    f.origin !== undefined && tagged(702, int(f.origin)),
    f.rootOfTrust && tagged(704, seq(octets(Buffer.alloc(32, 7)), bool(f.rootOfTrust.deviceLocked), enumerated(f.rootOfTrust.verifiedBootState), octets(Buffer.alloc(32, 9)))),
    f.osPatchLevel !== undefined && tagged(706, int(f.osPatchLevel)),
    f.packages && tagged(709, octets(seq(set(...f.packages.map(name => seq(octets(Buffer.from(name)), int(1)))), set(octets(Buffer.alloc(32, 1)))))),
    ...(f.extra ?? []),
  ].filter(Boolean))
  // What a Pixel's secure area writes for the staff app's key.
  const GOOD_HW = { purpose: [2], algorithm: 3, keySize: 256, ecCurve: 1, userAuthType: 2, origin: 0, rootOfTrust: { deviceLocked: true, verifiedBootState: 0 }, osPatchLevel: 202609 }
  const GOOD_SW = { packages: [KA.STAFF_APP_PACKAGE] }
  const keyDescription = ({ challenge, level = 1, keyLevel = level, hw = {}, sw = {} }) =>
    seq(int(300), enumerated(level), int(300), enumerated(keyLevel), octets(challenge), octets(Buffer.alloc(0)),
      authorizations({ ...GOOD_SW, ...sw }), authorizations({ ...GOOD_HW, ...hw }))
  const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'))
  const nameOf = cn => seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn)))))
  const utcTime = d => tlv(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`))
  const extensionOf = (id, value) => seq(oid(id), octets(value))
  let nextSerial = 1000
  const certificate = ({ subject, issuer, publicKey, signer, extensions = [], serial = nextSerial++ }) => {
    const tbs = seq(tlv(0xa0, int(2)), int(serial), ECDSA_SHA256, nameOf(issuer),
      seq(utcTime(new Date(Date.now() - 86_400_000)), utcTime(new Date(Date.now() + 365 * 86_400_000))), nameOf(subject),
      publicKey.export({ type: 'spki', format: 'der' }), ...(extensions.length ? [tlv(0xa3, seq(...extensions))] : []))
    return seq(tbs, ECDSA_SHA256, tlv(0x03, Buffer.concat([Buffer.from([0]), signWith('sha256', tbs, signer)])))
  }
  const authority = (cn = 'Test attestation root') => {
    const root = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const batch = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const ca = [extensionOf('2.5.29.19', seq(bool(true)))]
    const rootDer = certificate({ subject: cn, issuer: cn, publicKey: root.publicKey, signer: root.privateKey, extensions: ca })
    return {
      pem: `-----BEGIN CERTIFICATE-----\n${rootDer.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`,
      rootDer,
      batch,
      batchDer: certificate({ subject: 'Test batch', issuer: cn, publicKey: batch.publicKey, signer: root.privateKey, extensions: ca, serial: 0x0abc }),
    }
  }
  const CA = authority()
  const keyCertificate = (p, description, { ca = CA, signer = ca.batch.privateKey, extensions } = {}) => certificate({
    subject: 'Android Keystore Key', issuer: 'Test batch', publicKey: p.key, signer,
    extensions: extensions ?? [extensionOf(KA.ATTESTATION_OID, keyDescription(description))],
  })
  /** The chain a phone sends: its key certificate, the batch certificate, the root. */
  const attest = (p, challenge, { ca = CA, ...how } = {}) =>
    [keyCertificate(p, { challenge: Buffer.from(challenge, 'base64url'), ...how }, { ca, ...how }), ca.batchDer, ca.rootDer].map(b => b.toString('base64'))
  const compromisedSerials = new Set()
  const attestOptions = { roots: [CA.pem], statusList: async () => compromisedSerials }

  const person = (uid, role = 'barista') => ({ uid, email: null, role, branchIds: [branch], superadmin: false, isStaff: true })
  const enrol = async (caller, p, extra = {}, how = {}) => {
    const { challenge } = await K.startStaffKeyEnrolment(caller, db)
    return K.enrolStaffKey(caller, { publicKey: p.publicKey, proof: p.sign(SK.enrolMessage(caller.uid, p.keyId)), chain: attest(p, challenge, how), deviceName: 'Pixel 8', ...extra }, db, attestOptions)
  }
  const sara = person('u-phone')
  await db.doc('users/u-phone').set({ isStaff: true, role: 'barista', branchIds: [branch] })
  await db.doc('users/u-colleague').set({ isStaff: true, role: 'barista', branchIds: [branch] })

  const p1 = phone()
  const first = await enrol(sara, p1)
  const stored = (await db.doc(`staffKeys/${p1.keyId}`).get()).data()
  eq('a staff member registers their phone: its public key on their account, nothing secret',
    [first.keyId, first.already, stored.uid, stored.publicKey === p1.publicKey, stored.deviceName, stored.revokedAt], [p1.keyId, false, 'u-phone', true, 'Pixel 8', null])
  eq('sending the same registration again is an answer, not a second key', (await enrol(sara, p1)).already, true)

  const p2 = phone()
  await rejects('THE TRAP: a public key the phone cannot prove it holds is refused',
    () => K.enrolStaffKey(sara, { publicKey: p2.publicKey, proof: p1.sign(SK.enrolMessage('u-phone', p2.keyId)) }, db), e => e.status === 400)
  await rejects('...and so is a proof made for somebody else',
    () => K.enrolStaffKey(sara, { publicKey: p2.publicKey, proof: p2.sign(SK.enrolMessage('u-colleague', p2.keyId)) }, db), e => e.status === 400)
  // Each wrong kind of key comes with a genuine proof made by that key, so only
  // the kind of key can be what refuses it.
  const otherKey = (type, options) => {
    const { publicKey, privateKey } = generateKeyPairSync(type, options)
    const der = publicKey.export({ type: 'spki', format: 'der' })
    const keyId = K.keyIdFor(der)
    return { publicKey: der.toString('base64'), proof: signWith('sha256', Buffer.from(SK.enrolMessage('u-phone', keyId), 'utf8'), { key: privateKey, dsaEncoding: 'der' }).toString('base64') }
  }
  for (const [label, key] of [['another curve (secp256k1)', otherKey('ec', { namedCurve: 'secp256k1' })], ['a P-384 key', otherKey('ec', { namedCurve: 'secp384r1' })], ['an RSA key', otherKey('rsa', { modulusLength: 2048 })]]) {
    await rejects(`THE TRAP: nothing but a P-256 key, even with a genuine proof: ${label}`, () => K.enrolStaffKey(sara, key, db), e => e.status === 400)
  }
  await rejects('...nor something that is not base64 at all', () => K.enrolStaffKey(sara, { publicKey: 'not a key!', proof: 'AAAA' }, db), e => e.status === 400)
  await rejects('a customer account registers no phone',
    () => enrol({ ...person('u-customer'), isStaff: false, role: null }, phone()), e => e.status === 403)
  await rejects('THE TRAP: a key already registered to somebody else is not taken over', () => enrol(person('u-colleague'), p1), e => e.status === 409)

  await enrol(sara, p2)
  const p3 = phone()
  await enrol(sara, p3)
  await rejects(`a fourth phone is refused (${SK.MAX_KEYS_PER_STAFF} at once)`, () => enrol(sara, phone()), e => e.status === 409)
  await rejects('THE TRAP: a colleague cannot remove my phone', () => K.revokeStaffKey(person('u-colleague'), p3.keyId, db), e => e.status === 403)
  const removed = await K.revokeStaffKey(sara, p3.keyId, db)
  eq('its owner removes a phone, and removing it again is an answer', [removed.already, (await K.revokeStaffKey(sara, p3.keyId, db)).already], [false, true])
  eq('...and an admin may remove anybody\'s', (await K.revokeStaffKey(person('u-boss', 'admin'), p2.keyId, db)).already, false)
  await enrol(sara, p2).catch(() => {})
  eq('a removed key stays removed: registering it again is refused, not revived',
    (await db.doc(`staffKeys/${p2.keyId}`).get()).data().revokedAt !== null, true)

  eq('stored with what the attestation said: the key is in the secure area, at this patch level (S20)',
    [stored.attestation?.securityLevel, stored.attestation?.osPatchLevel, first.securityLevel], ['tee', 202609, 'tee'])
  eq('the app asks whether a key it holds is registered to this person: mine in use yes; removed, or somebody else\'s, no',
    [await K.staffKeyRegistered(sara, p1.publicKey, db), await K.staffKeyRegistered(sara, p3.publicKey, db), await K.staffKeyRegistered(person('u-colleague'), p1.publicKey, db)],
    [true, false, false])

  console.log('\n  the phone\'s attestation, checked at registration (S20)')
  {
    const ana = person('u-attest')
    const attempt = async (how = {}, p = phone(), change = body => body, options = attestOptions) => {
      const { challenge } = await K.startStaffKeyEnrolment(ana, db)
      const body = { publicKey: p.publicKey, proof: p.sign(SK.enrolMessage(ana.uid, p.keyId)), chain: attest(p, challenge, how), deviceName: 'Pixel 9' }
      return K.enrolStaffKey(ana, change(body, challenge, p), db, options)
    }
    // Registering with a challenge already in hand, without asking for another.
    const withChallenge = (challenge, p = phone()) => K.enrolStaffKey(ana,
      { publicKey: p.publicKey, proof: p.sign(SK.enrolMessage(ana.uid, p.keyId)), chain: attest(p, challenge), deviceName: 'Pixel 9' }, db, attestOptions)
    const refusedFor = words => e => e.status === 403 && words.test(e.message)
    const brokenChain = e => e.status === 400 && /genuine statement/.test(e.message)

    const strong = await attempt({ level: 2 })
    eq('a key in StrongBox registers, and is recorded as StrongBox', strong.securityLevel, 'strongbox')

    for (const [label, how, words] of [
      ['THE TRAP: a key kept in software (S20a)', { level: 0 }, /in software/],
      ['THE TRAP: a statement from secure hardware about a key that is itself in software', { keyLevel: 0 }, /in software/],
      ['THE TRAP: a statement made in software, claiming the key is in secure hardware', { level: 0, keyLevel: 1 }, /in software/],
      ['a security level Android does not have', { level: 3 }, /in software/],
      ['a key imported into the phone, not made there', { hw: { origin: 2 } }, /not made inside/],
      ['a key that is not P-256 ECDSA: RSA', { hw: { algorithm: 1 } }, /not the till/],
      ['...another curve', { hw: { ecCurve: 2 } }, /not the till/],
      ['...a key that cannot sign', { hw: { purpose: [3] } }, /not the till/],
      ['THE TRAP: a key that needs no unlocking at all', { hw: { noAuthRequired: true } }, /not locked to a fingerprint/],
      ['a key unlocked by the PIN only', { hw: { userAuthType: 1 } }, /not locked to a fingerprint/],
      ['THE TRAP: a key unlocked by a fingerprint OR the PIN (S12)', { hw: { userAuthType: 3 } }, /PIN/],
      ['...or by any authenticator at all', { hw: { userAuthType: 0xffffffff } }, /PIN/],
      ['THE TRAP: the fingerprint lock claimed only in the software list, which the phone\'s system writes', { hw: { userAuthType: undefined }, sw: { userAuthType: 2 } }, /not locked to a fingerprint/],
      ['a key that stays unlocked for five minutes after a fingerprint', { hw: { authTimeout: 300 } }, /stays unlocked/],
      ['THE TRAP: an unlocked bootloader (S20b)', { hw: { rootOfTrust: { deviceLocked: false, verifiedBootState: 0 } } }, /unlocked or modified/],
      ['...a system signed by somebody other than the maker', { hw: { rootOfTrust: { deviceLocked: true, verifiedBootState: 1 } } }, /unlocked or modified/],
      ['...a system that failed verification', { hw: { rootOfTrust: { deviceLocked: true, verifiedBootState: 2 } } }, /unlocked or modified/],
      ['...no root of trust in the hardware list', { hw: { rootOfTrust: undefined } }, /unlocked or modified/],
      ['THE TRAP: a root of trust claimed only in the software list', { hw: { rootOfTrust: undefined }, sw: { rootOfTrust: { deviceLocked: true, verifiedBootState: 0 } } }, /unlocked or modified/],
      ['THE TRAP: a key made by another app', { sw: { packages: ['com.example.lookalike'] } }, /not made by the BIG CMS staff app/],
      ['...a key shared with another app', { sw: { packages: [KA.STAFF_APP_PACKAGE, 'com.example.other'] } }, /not made by the BIG CMS staff app/],
      ['...a key that names no app', { sw: { packages: undefined } }, /not made by the BIG CMS staff app/],
    ]) {
      const p = phone()
      await rejects(`refused: ${label}`, () => attempt(how, p), refusedFor(words))
    }
    const nothingStored = phone()
    await attempt({ level: 0 }, nothingStored).catch(() => {})
    eq('...and a refused phone leaves nothing behind', (await db.doc(`staffKeys/${nothingStored.keyId}`).get()).exists, false)

    await rejects('THE TRAP: an authorization given twice, saying two things, is not read at all',
      () => attempt({ hw: { extra: [tagged(504, int(3))] } }), brokenChain)
    await rejects('no chain at all', () => attempt({}, phone(), b => ({ ...b, chain: undefined })), brokenChain)
    await rejects('...one certificate, or nine', () => attempt({}, phone(), b => ({ ...b, chain: b.chain.slice(0, 1) })), brokenChain)
    await rejects('...', () => attempt({}, phone(), b => ({ ...b, chain: Array(9).fill(b.chain[0]) })), brokenChain)
    await rejects('...not base64', () => attempt({}, phone(), b => ({ ...b, chain: ['not base64!', ...b.chain.slice(1)] })), brokenChain)
    await rejects('...base64 that is not a certificate', () => attempt({}, phone(), b => ({ ...b, chain: ['AAAA', ...b.chain.slice(1)] })), brokenChain)

    const stranger = authority('Somebody else\'s root')
    await rejects('THE TRAP: a chain to a root the cloud does not trust',
      () => attempt({ ca: stranger }), e => e.status === 400 && /not one Google vouches for/.test(e.message))
    await rejects('...and a chain that stops short of any root',
      () => attempt({}, phone(), b => ({ ...b, chain: b.chain.slice(0, 2) })), e => e.status === 400 && /not one Google vouches for/.test(e.message))
    const notTheBatch = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    await rejects('THE TRAP: a key certificate the batch certificate did not sign', () => attempt({ signer: notTheBatch.privateKey }), brokenChain)
    const other = phone()
    await rejects('THE TRAP: a genuine chain for another key',
      () => attempt({}, phone(), (b, challenge) => ({ ...b, chain: attest(other, challenge) })), brokenChain)
    await rejects('a key certificate with no statement', () => attempt({ extensions: [] }), brokenChain)
    await rejects('...or with it twice',
      () => attempt({}, phone(), (b, challenge, p) => {
        const ext = extensionOf(KA.ATTESTATION_OID, keyDescription({ challenge: Buffer.from(challenge, 'base64url') }))
        return { ...b, chain: [keyCertificate(p, null, { extensions: [ext, ext] }), CA.batchDer, CA.rootDer].map(x => x.toString('base64')) }
      }), brokenChain)

    // A genuine phone's key can sign a certificate saying anything. The forgery
    // is refused only because the real statement sits one step closer to the root.
    await rejects('THE TRAP: a certificate signed by another genuine attested key, carrying a statement of its own',
      async () => {
        const attacker = phone()
        const genuine = await K.startStaffKeyEnrolment(person('u-attacker'), db)
        const attackerCert = keyCertificate(attacker, { challenge: Buffer.from(genuine.challenge, 'base64url') })
        return attempt({}, phone(), (b, challenge, p) => ({
          ...b,
          chain: [
            certificate({ subject: 'Android Keystore Key', issuer: 'Android Keystore Key', publicKey: p.key, signer: attacker.privateKey,
              extensions: [extensionOf(KA.ATTESTATION_OID, keyDescription({ challenge: Buffer.from(challenge, 'base64url') }))] }),
            attackerCert, CA.batchDer, CA.rootDer,
          ].map(x => x.toString('base64')),
        }))
      }, brokenChain)

    const stale = e => e.status === 400 && /not started just now/.test(e.message)
    await rejects('THE TRAP: a challenge the cloud never gave', () => withChallenge(Buffer.alloc(32, 5).toString('base64url')), stale)
    const colleagues = await K.startStaffKeyEnrolment(person('u-colleague'), db)
    await rejects('THE TRAP: a challenge the cloud gave somebody else', () => withChallenge(colleagues.challenge), stale)
    const late = await K.startStaffKeyEnrolment(ana, db, Date.now() - KA.ENROL_CHALLENGE_MS - 1000)
    await rejects('a challenge used too late', () => withChallenge(late.challenge), stale)
    let used = ''
    await attempt({}, phone(), (b, challenge) => { used = challenge; return b })
    await rejects('THE TRAP: a challenge used for one registration cannot register another phone',
      () => withChallenge(used), stale)
    let refusedWith = ''
    await attempt({ level: 0 }, phone(), (b, challenge) => { refusedWith = challenge; return b }).catch(() => {})
    await rejects('...and a refused attempt used its challenge up: the phone starts again',
      () => withChallenge(refusedWith), stale)
    const c1 = await K.startStaffKeyEnrolment(ana, db)
    const c2 = await K.startStaffKeyEnrolment(ana, db)
    await rejects('asking again replaces the last challenge', () => withChallenge(c1.challenge), stale)
    eq('...and the new one works', (await withChallenge(c2.challenge)).already, false)
    await rejects('a customer account is given no challenge', () => K.startStaffKeyEnrolment({ ...person('u-customer'), isStaff: false, role: null }, db), e => e.status === 403)

    const compromised = e => e.status === 403 && /compromised/.test(e.message)
    compromisedSerials.add('abc')
    await rejects('THE TRAP: a chain whose batch certificate Google lists as compromised (S20c), serial written without its leading zero',
      () => attempt(), compromised)
    compromisedSerials.clear()
    await rejects('...or whose key certificate is listed', () => attempt({}, phone(), (b, challenge, p) => {
      const chain = attest(p, challenge)
      compromisedSerials.add(KA.normalizeSerial(new X509Certificate(Buffer.from(chain[0], 'base64')).serialNumber))
      return { ...b, chain }
    }), compromised)
    compromisedSerials.clear()
    const unreachable = { ...attestOptions, statusList: KV.createStatusList(async () => { throw new TypeError('fetch failed') }) }
    const waiting = phone()
    await rejects('THE TRAP: Google\'s list cannot be fetched and there is no copy: registering waits (S20c)',
      () => attempt({}, waiting, b => b, unreachable), e => e.status === 503 && /Try registering again/.test(e.message))
    eq('...storing nothing', (await db.doc(`staffKeys/${waiting.keyId}`).get()).exists, false)

    await rejects('THE TRAP: without a test root, the cloud trusts only Google\'s',
      () => attempt({}, phone(), b => b, { statusList: attestOptions.statusList }), e => e.status === 400 && /not one Google vouches for/.test(e.message))
    eq('...which are pinned by their public keys: Google\'s RSA root and its ECDSA root of February 2026',
      KV.GOOGLE_ATTESTATION_ROOTS.map(pem => createHash('sha256').update(new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' })).digest('hex')),
      ['feb2ea7551ee316ed4bb443c8293b884dbfdea40b603ee3e4f4a897e4580fbae', '3ee44512a1af2beb39c889490c60ea3f82e43f5d5a5532f5ab9419f676cd07ec'])

    // Google's list, fetched and kept for as long as it says.
    let clock = 1_000_000
    let fetches = 0
    let reply = () => new Response(JSON.stringify({ entries: { '0ABC': { status: 'REVOKED' }, c35747a0: { status: 'SUSPENDED' } } }), { headers: { 'cache-control': 'public, max-age=7200' } })
    const list = KV.createStatusList(async () => { fetches++; return reply() }, () => clock)
    const firstList = await list()
    eq('the list is read with its serials as they would be compared, suspended as well as revoked', [...firstList].sort(), ['abc', 'c35747a0'])
    reply = () => { throw new TypeError('fetch failed') }
    clock += 7100_000
    eq('...kept, not fetched again, while its Cache-Control says it is fresh', [(await list()).size, fetches], [2, 1])
    clock += 200_000
    await rejects('THE TRAP: once out of date, a list that cannot be fetched again is not used', () => list(), e => e.status === 503)
    for (const [label, bad] of [
      ['an error answer', () => new Response('{}', { status: 500 })],
      ['something that is not the list', () => new Response(JSON.stringify({ entries: [] }))],
      ['an entry with no status', () => new Response(JSON.stringify({ entries: { abc: {} } }))],
      ['a serial that is not hex', () => new Response(JSON.stringify({ entries: { 'not-hex': { status: 'REVOKED' } } }))],
    ]) {
      const fresh = KV.createStatusList(async () => bad(), () => 0)
      await rejects(`...nor is ${label}`, () => fresh(), e => e.status === 503)
    }
    eq('a list is kept at least an hour and at most a day, whatever it says',
      [KA.statusListSeconds('max-age=60'), KA.statusListSeconds('public, max-age=86400'), KA.statusListSeconds('max-age=999999'), KA.statusListSeconds(null)], [3600, 86400, 86400, 3600])
  }

  await db.doc(`staffKeys/${phone().keyId}`).set({ uid: 'u-leaver', publicKey: phone().publicKey, deviceName: 'Old phone', attestation: { securityLevel: 'tee' }, revokedAt: null })
  const unchecked = phone()
  await db.doc(`staffKeys/${unchecked.keyId}`).set({ uid: 'u-phone', publicKey: unchecked.publicKey, deviceName: 'Never checked', revokedAt: null })
  const snapshot = await D.buildPullSnapshot({ id: 'hub-keys', branch, name: 'Keys hub' })
  const pulledKeys = snapshot.filter(d => d.collection === 'staffKeys')
  eq('THE TRAP: a hub pulls only keys in use, of people still staff, whose attestation was checked: never a removed phone, a leaver\'s, or a key stored without one',
    pulledKeys.map(d => d.id).sort(), [p1.keyId])
  eq('...and only the key, its owner and its name', Object.keys(pulledKeys[0]?.data ?? {}).sort(), ['deviceName', 'publicKey', 'uid'])

  const FP = Array(32).fill('AB').join(':')
  const fpHex = 'ab'.repeat(32)
  const answer = (p, nonce, fp = fpHex) => ({ keyId: p.keyId, nonce, signature: p.sign(SK.signInMessage(fp, p.keyId, nonce)) })
  const hub = { db, hubFingerprint: FP }

  const c1 = await KS.issueChallenge(p1.keyId, { db })
  const signedIn = await KS.signInWithKey(answer(p1, c1.nonce), hub)
  const session = await HS.callerFromHubToken(signedIn.token)
  eq('the phone signs the hub\'s challenge, and the hub opens a session for its owner, with the pulled role',
    [session?.uid, session?.role, session?.expiresAt === signedIn.caller.expiresAt], ['u-phone', 'barista', true])
  eq('...lasting until 05:00, like every hub sign-in (S14)', signedIn.caller.expiresAt - Date.now() >= 4 * 3600_000, true)
  await rejects('THE TRAP: the same challenge cannot be answered twice', () => KS.signInWithKey(answer(p1, c1.nonce), hub), e => e.status === 401)

  const c2 = await KS.issueChallenge(p1.keyId, { db })
  await rejects('THE TRAP: a signature made for another certificate (a machine pretending to be the hub) is refused',
    () => KS.signInWithKey(answer(p1, c2.nonce, 'cd'.repeat(32)), hub), e => e.status === 401)
  await rejects('...and that wrong answer used the challenge up', () => KS.signInWithKey(answer(p1, c2.nonce), hub), e => e.status === 401)

  const c3 = await KS.issueChallenge(p1.keyId, { db })
  const p4 = phone()
  await rejects('another key\'s signature over the right message is refused',
    () => KS.signInWithKey({ ...answer(p4, c3.nonce), keyId: p1.keyId, signature: p4.sign(SK.signInMessage(fpHex, p1.keyId, c3.nonce)) }, hub), e => e.status === 401)

  const p5 = phone()
  await enrol(person('u-colleague'), p5)
  const c8 = await KS.issueChallenge(p1.keyId, { db })
  await rejects('THE TRAP: a challenge given to one phone cannot be answered by another registered phone',
    () => KS.signInWithKey(answer(p5, c8.nonce), hub), e => e.status === 401)
  const genuine = (await db.doc(`staffKeys/${p1.keyId}`).get()).data()
  await db.doc(`staffKeys/${p1.keyId}`).update({ publicKey: p4.publicKey })
  const c9 = await KS.issueChallenge(p1.keyId, { db })
  await rejects('a key record holding another key than the one its id names signs nobody in',
    () => KS.signInWithKey({ keyId: p1.keyId, nonce: c9.nonce, signature: p4.sign(SK.signInMessage(fpHex, p1.keyId, c9.nonce)) }, hub), e => e.status === 401)
  await db.doc(`staffKeys/${p1.keyId}`).update({ publicKey: genuine.publicKey })

  const old = await KS.issueChallenge(p1.keyId, { db, now: Date.now() - 2 * SK.CHALLENGE_MS })
  await rejects('a challenge answered too late is refused', () => KS.signInWithKey(answer(p1, old.nonce), hub), e => e.status === 401)

  const c4 = await KS.issueChallenge(p1.keyId, { db })
  const c5 = await KS.issueChallenge(p1.keyId, { db })
  await rejects('asking again replaces the last challenge: one outstanding per phone', () => KS.signInWithKey(answer(p1, c4.nonce), hub), e => e.status === 401)
  eq('...and the new one works', Boolean((await KS.signInWithKey(answer(p1, c5.nonce), hub)).token), true)

  await rejects('a removed phone is not even given a challenge', () => KS.issueChallenge(p3.keyId, { db }), e => e.status === 401)
  await db.doc('users/u-phone').update({ isStaff: false })
  const c6 = await KS.issueChallenge(p1.keyId, { db })
  await rejects('THE TRAP: an account no longer staff in the pulled record is not signed in, whatever the phone signs',
    () => KS.signInWithKey(answer(p1, c6.nonce), hub), e => e.status === 403)
  await db.doc('users/u-phone').update({ isStaff: true })
  const c7 = await KS.issueChallenge(p1.keyId, { db })
  await rejects('a hub with no café-wifi door signs no phone in', () => KS.signInWithKey(answer(p1, c7.nonce), { db, hubFingerprint: undefined }), e => e.status === 503)
  await rejects('a malformed request is refused before anything is looked up',
    () => KS.signInWithKey({ keyId: 'short', nonce: c7.nonce, signature: 'x' }, hub), e => e.status === 400)

  const listed = (await K.listStaffKeys(db)).filter(r => r.uid === 'u-phone')
  const firstRow = listed.find(r => r.keyId === p1.keyId)
  eq('the admin list shows each phone, whose it is, and in use before removed',
    [firstRow?.deviceName, firstRow?.owner, firstRow?.revoked, typeof firstRow?.createdAt, listed[0]?.revoked, listed.some(r => r.revoked)],
    ['Pixel 8', 'u-phone', false, 'number', false, true])
  eq('...and never carries the key itself', listed.some(r => 'publicKey' in r), false)

  const handed = SK.handoffHash(signedIn.token)
  eq('the app hands the till page its session in the fragment, and the page reads it back', SK.tokenFromHandoff(handed), signedIn.token)
  eq('THE TRAP: any other fragment is not a session: another name, not a hub token, too short, or none',
    [SK.tokenFromHandoff(`#other=${encodeURIComponent(signedIn.token)}`), SK.tokenFromHandoff('#key-session=firebase-id-token-looking-thing'),
      SK.tokenFromHandoff('#key-session=hub.short'), SK.tokenFromHandoff('#key-session=%E0%A4%A'), SK.tokenFromHandoff(''), SK.tokenFromHandoff(null)],
    [null, null, null, null, null, null])

  const SP = await import(url('staffProfiles.js'))
  eq('a first name is one short line, and until an admin sets one a manager sees the role (S18)',
    [SP.readFirstName('  Sara\n'), SP.readFirstName('x'.repeat(60)).length, SP.readFirstName(42), SP.staffLabel('', 'Barista'), SP.staffLabel(' Sara ', 'Barista')],
    ['Sara', 40, '', 'a barista', 'Sara'])

  eq('a phone\'s name is short and one line, and never empty',
    [SK.deviceName('  Pixel\n8  '), SK.deviceName(''), SK.deviceName('x'.repeat(80)).length], ['Pixel 8', 'Phone', 60])
}

console.log('\na manager approves a sign-in for a phone with no fingerprint (S6, S15–S17)')
{
  const K = await import(url('server/staffKeys.js'))
  const KS = await import(url('server/hubKeySignIn.js'))
  const A = await import(url('server/hubApprovals.js'))
  const SA = await import(url('staffApprovals.js'))
  const { generateKeyPairSync, sign: signWith } = await import('node:crypto')
  const phone = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const der = publicKey.export({ type: 'spki', format: 'der' })
    return {
      publicKey: der.toString('base64'),
      keyId: K.keyIdFor(der),
      sign: message => signWith('sha256', Buffer.from(message, 'utf8'), { key: privateKey, dsaEncoding: 'der' }).toString('base64'),
    }
  }
  const FP = Array(32).fill('AB').join(':')
  const fpHex = 'ab'.repeat(32)
  const hub = { db, hubFingerprint: FP }
  await db.doc('users/u-sam').set({ isStaff: true, role: 'barista', branchIds: [branch], firstName: 'Sam' })
  await db.doc('users/u-boss').set({ isStaff: true, role: 'manager', branchIds: [branch], firstName: 'Rana' })
  await db.doc('users/u-barista2').set({ isStaff: true, role: 'barista', branchIds: [branch] })
  const boss = phone()
  await db.doc(`staffKeys/${boss.keyId}`).set({ uid: 'u-boss', publicKey: boss.publicKey, deviceName: 'Manager phone', revokedAt: null })
  const colleague = phone()
  await db.doc(`staffKeys/${colleague.keyId}`).set({ uid: 'u-barista2', publicKey: colleague.publicKey, deviceName: 'Barista phone', revokedAt: null })
  const approveWith = async (p, id, fp = fpHex) => {
    const { nonce } = await KS.issueChallenge(p.keyId, { db })
    return { id, keyId: p.keyId, nonce, signature: p.sign(SA.approveMessage(fp, id, p.keyId, nonce)) }
  }

  const people = await A.listPeople({ db })
  eq('who can ask is the staff the hub pulled, by first name, or by role for someone with no name yet',
    ['Sam', 'Rana', 'a barista'].every(label => people.some(p => p.label === label)), true)
  eq('...and nothing else about them', Object.keys(people[0]).sort(), ['label', 'uid'])

  const asked = await A.askApproval({ uid: 'u-sam', deviceName: 'Samsung A12' }, { db })
  eq('a staff member asks; the hub keeps only a hash of the asking phone\'s secret',
    [SA.isApprovalId(asked.id), SA.isApprovalSecret(asked.secret), (await db.doc(`hubApprovals/${asked.id}`).get()).data().secretHash !== asked.secret, asked.label],
    [true, true, true, 'Sam'])
  eq('a manager sees it waiting, by first name and phone',
    (await A.listWaiting({ db })).filter(w => w.id === asked.id).map(w => [w.label, w.deviceName]), [['Sam', 'Samsung A12']])
  eq('collecting before anyone approves only says it is waiting', (await A.collectApproval({ id: asked.id, secret: asked.secret }, { db })).status, 'waiting')
  await rejects('THE TRAP: the wrong secret collects nothing', () => A.collectApproval({ id: asked.id, secret: 'x'.repeat(43) }, { db }), e => e.status === 401)
  await rejects('THE TRAP: a barista cannot approve anybody', async () => A.approveRequest(await approveWith(colleague, asked.id), hub), e => e.status === 403)
  await rejects('THE TRAP: an approval signed for another hub is refused', async () => A.approveRequest(await approveWith(boss, asked.id, 'cd'.repeat(32)), hub), e => e.status === 401)
  const other = await A.askApproval({ uid: 'u-barista2', deviceName: 'Other phone' }, { db })
  await rejects('THE TRAP: an approval signed for another request does not approve this one',
    async () => A.approveRequest({ ...(await approveWith(boss, other.id)), id: asked.id }, hub), e => e.status === 401)

  const madeUp = 'n'.repeat(43)
  await rejects('THE TRAP: an approval signed over a challenge the hub never gave is refused',
    () => A.approveRequest({ id: asked.id, keyId: boss.keyId, nonce: madeUp, signature: boss.sign(SA.approveMessage(fpHex, asked.id, boss.keyId, madeUp)) }, hub),
    e => e.status === 401)
  await db.doc('users/u-boss').update({ isStaff: false })
  await rejects('THE TRAP: a manager no longer staff in the pulled record approves nobody, whatever their phone signs',
    async () => A.approveRequest(await approveWith(boss, asked.id), hub), e => e.status === 403)
  await db.doc('users/u-boss').update({ isStaff: true })

  const approved = await A.approveRequest(await approveWith(boss, asked.id), hub)
  eq('the manager approves with their own phone\'s signature, and both names are there for the log',
    [approved.approverLabel, approved.requestedLabel, approved.deviceName, approved.approverRole], ['Rana', 'Sam', 'Samsung A12', 'manager'])
  await rejects('...and the same request cannot be approved twice', async () => A.approveRequest(await approveWith(boss, asked.id), hub), e => e.status === 409)

  const collected = await A.collectApproval({ id: asked.id, secret: asked.secret }, { db })
  const session = await HS.callerFromHubToken(collected.token)
  eq('THE TRAP: the asking phone collects a session for the person approved, never the manager, until 05:00',
    [collected.status, session?.uid, session?.role, collected.caller.expiresAt - Date.now() >= 4 * 3600_000], ['approved', 'u-sam', 'barista', true])
  const second = await A.collectApproval({ id: asked.id, secret: asked.secret }, { db })
  eq('collecting again gets no second session', [second.status, 'token' in second], ['collected', false])

  const denyWith = async (p, id, fp = fpHex) => {
    const { nonce } = await KS.issueChallenge(p.keyId, { db })
    return { id, keyId: p.keyId, nonce, signature: p.sign(SA.denyMessage(fp, id, p.keyId, nonce)) }
  }
  const toDeny = await A.askApproval({ uid: 'u-barista2', deviceName: 'Turned-down phone' }, { db })
  await rejects('THE TRAP: an approval\'s signature does not turn a request down',
    async () => A.denyRequest(await approveWith(boss, toDeny.id), hub), e => e.status === 401)
  await rejects('THE TRAP: ...and a refusal\'s signature does not approve one',
    async () => A.approveRequest(await denyWith(boss, toDeny.id), hub), e => e.status === 401)
  await rejects('a barista cannot turn anybody down either', async () => A.denyRequest(await denyWith(colleague, toDeny.id), hub), e => e.status === 403)
  const turnedDown = await A.denyRequest(await denyWith(boss, toDeny.id), hub)
  eq('a manager turns a request down with their fingerprint, and the asking phone is told so',
    [turnedDown.decision, turnedDown.approverLabel, turnedDown.requestedLabel, (await A.collectApproval({ id: toDeny.id, secret: toDeny.secret }, { db })).status],
    ['denied', 'Rana', 'a barista', 'denied'])
  await rejects('...and a request turned down cannot be approved afterwards', async () => A.approveRequest(await approveWith(boss, toDeny.id), hub), e => e.status === 409)

  const self = await A.askApproval({ uid: 'u-boss', deviceName: 'Spare phone' }, { db })
  await rejects('THE TRAP: nobody approves their own sign-in', async () => A.approveRequest(await approveWith(boss, self.id), hub), e => e.status === 403)
  const late = await A.askApproval({ uid: 'u-barista2', deviceName: 'Late phone' }, { db, now: Date.now() - 2 * SA.APPROVAL_MS })
  await rejects('a request approved too late is refused', async () => A.approveRequest(await approveWith(boss, late.id), hub), e => e.status === 409)
  eq('...and the phone that asked is told it ran out', (await A.collectApproval({ id: late.id, secret: late.secret }, { db })).status, 'expired')
  await rejects('only the staff the hub pulled may ask', () => A.askApproval({ uid: 'u-nobody', deviceName: 'x' }, { db }), e => e.status === 400)

  await A.askApproval({ uid: 'u-sam', deviceName: 'First try' }, { db })
  await A.askApproval({ uid: 'u-sam', deviceName: 'Second try' }, { db })
  eq('asking again replaces the last request: one waiting per person',
    (await A.listWaiting({ db })).filter(w => w.label === 'Sam').map(w => w.deviceName), ['Second try'])

  const demoted = await A.askApproval({ uid: 'u-barista2', deviceName: 'Demoted phone' }, { db })
  await A.approveRequest(await approveWith(boss, demoted.id), hub)
  await db.doc('users/u-barista2').update({ isStaff: false })
  await rejects('THE TRAP: somebody no longer staff by the time they collect gets no session',
    () => A.collectApproval({ id: demoted.id, secret: demoted.secret }, { db }), e => e.status === 403)
  await db.doc('users/u-barista2').update({ isStaff: true })

  eq('the rule itself: a manager or an admin, approving somebody else',
    [SA.approvalProblem({ uid: 'a', role: 'manager' }, 'b'), SA.approvalProblem({ uid: 'a', role: 'admin' }, 'b'),
      SA.approvalProblem({ uid: 'a', role: 'barista' }, 'b') !== null, SA.approvalProblem({ uid: 'a', role: 'manager' }, 'a') !== null],
    [null, null, true, true])
}

console.log('\na kitchen screen: a manager approves a shared tablet, which reaches the kitchen display only (S19)')
{
  const KS = await import(url('server/hubKeySignIn.js'))
  const A = await import(url('server/hubApprovals.js'))
  const SA = await import(url('staffApprovals.js'))
  const AU = await import(url('server/auth.js'))
  const K = await import(url('server/staffKeys.js'))
  const { generateKeyPairSync, sign: signWith } = await import('node:crypto')
  const FP = Array(32).fill('AB').join(':')
  const fpHex = 'ab'.repeat(32)
  const hub = { db, hubFingerprint: FP }
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const der = publicKey.export({ type: 'spki', format: 'der' })
  const keyId = K.keyIdFor(der)
  await db.doc('users/u-screen-boss').set({ isStaff: true, role: 'manager', branchIds: [branch], firstName: 'Nour' })
  await db.doc(`staffKeys/${keyId}`).set({ uid: 'u-screen-boss', publicKey: der.toString('base64'), deviceName: 'Manager phone', revokedAt: null })
  const approveBody = async id => {
    const { nonce } = await KS.issueChallenge(keyId, { db })
    const signature = signWith('sha256', Buffer.from(SA.approveMessage(fpHex, id, keyId, nonce), 'utf8'), { key: privateKey, dsaEncoding: 'der' }).toString('base64')
    return { id, keyId, nonce, signature }
  }
  const asRequest = token => new Request('http://hub.local/api', { headers: { authorization: `Bearer ${token}` } })

  const asked = await A.askApproval({ kind: 'screen', deviceName: 'Kitchen tablet' }, { db })
  eq('a tablet asks to be a kitchen screen, with nobody chosen', [asked.kind, asked.label], ['screen', 'a kitchen screen'])
  eq('a manager sees it waiting as a kitchen screen',
    (await A.listWaiting({ db })).filter(w => w.id === asked.id).map(w => [w.kind, w.label, w.deviceName]), [['screen', 'a kitchen screen', 'Kitchen tablet']])
  const approved = await A.approveRequest(await approveBody(asked.id), hub)
  eq('the manager approves it with their fingerprint, as for a person',
    [approved.kind, approved.approverLabel, approved.requestedUid.startsWith(SA.SCREEN_UID_PREFIX)], ['screen', 'Nour', true])

  const collected = await A.collectApproval({ id: asked.id, secret: asked.secret }, { db })
  const screen = await HS.callerFromHubToken(collected.token)
  eq('THE TRAP: the session is the screen\'s, not a person\'s: kitchen crew, the kds scope, until 05:00',
    [screen?.uid.startsWith(SA.SCREEN_UID_PREFIX), screen?.role, screen?.scope, collected.caller.expiresAt - Date.now() >= 4 * 3600_000],
    [true, 'kitchen_crew', 'kds', true])
  eq('...which the kitchen display accepts', (await AU.requireSection(asRequest(collected.token), 'kds')).uid, screen?.uid)
  await rejects('THE TRAP: and every other section refuses it: no tables, checks, payments or drawer',
    () => AU.requireSection(asRequest(collected.token), 'pos'), e => e.status === 403)

  const person = await HS.startHubSession({ uid: 'u-screen-boss', staff: true, role: 'manager', branchIds: [branch] })
  eq('a person\'s session has no scope, and keeps every section its role allows',
    [person.caller.scope, (await AU.requireSection(asRequest(person.token), 'pos')).uid], [null, 'u-screen-boss'])
  const scopedManager = await HS.startHubSession({ uid: 'screen:odd', staff: true, role: 'manager', scope: 'kds', branchIds: [branch] })
  await rejects('THE TRAP: the scope decides, whatever the role would allow',
    () => AU.requireSection(asRequest(scopedManager.token), 'pos'), e => e.status === 403)
}

console.log('\nthe counter PC signs in with the person\'s own phone, and signs out after 15 minutes idle (S24–S25)')
{
  const CS = await import(url('counterSignIn.js'))
  const HC = await import(url('server/hubCounterSignIn.js'))
  const KS = await import(url('server/hubKeySignIn.js'))
  const SK = await import(url('staffKeys.js'))
  const SA = await import(url('staffApprovals.js'))
  const K = await import(url('server/staffKeys.js'))
  const { generateKeyPairSync, sign: signWith } = await import('node:crypto')
  const phoneFor = async uid => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const der = publicKey.export({ type: 'spki', format: 'der' })
    const keyId = K.keyIdFor(der)
    await db.doc(`staffKeys/${keyId}`).set({ uid, publicKey: der.toString('base64'), deviceName: 'Pixel', revokedAt: null })
    return { keyId, sign: message => signWith('sha256', Buffer.from(message, 'utf8'), { key: privateKey, dsaEncoding: 'der' }).toString('base64') }
  }
  const FP = Array(32).fill('AB').join(':')
  const fpHex = 'ab'.repeat(32)
  const hub = { db, hubFingerprint: FP }
  const COUNTER = 'localhost:3100'

  // ── The rules ──
  eq('a code is four digits from four random bytes',
    [CS.counterCodeFromBytes(Uint8Array.from([0, 0, 0, 7])), CS.counterCodeFromBytes(Uint8Array.from([255, 255, 255, 255])), CS.isCounterCode('0421'), CS.isCounterCode('421'), CS.isCounterCode('04a1')],
    ['0007', '7295', true, false, false])
  eq('...read off a phone keyboard as its digits', [CS.readCounterCode(' 04 21x9'), CS.readCounterCode(null)], ['0421', ''])
  eq('THE TRAP: a counter sign-in signature is never a phone sign-in or a manager\'s approval',
    new Set([CS.counterSignInMessage(fpHex, '0421', 'k', 'n'), SK.signInMessage(fpHex, 'k', 'n'), SA.approveMessage(fpHex, '0421', 'k', 'n')]).size, 3)
  eq('only the counter PC itself asks: localhost, never the hub\'s address on the wifi',
    ['localhost:3100', '127.0.0.1:3004', '[::1]:3100', 'LOCALHOST:3100', '192.168.1.20:3443', '10.0.2.2:3443', 'localhost.example.com', '', null].map(CS.isCounterHost),
    [true, true, true, true, false, false, false, false, false])
  eq('idle is judged from the last tap', [CS.idleOver(1000, 900_000, 900_999), CS.idleOver(1000, 900_000, 901_000), CS.idleOver(0, 900_000, 1)], [false, true, true])

  // ── The hub ──
  await db.doc('users/u-counter').set({ isStaff: true, role: 'barista', branchIds: [branch], firstName: 'Nour' })
  await db.doc('users/u-counter-2').set({ isStaff: true, role: 'barista', branchIds: [branch], firstName: 'Joe' })
  const nour = await phoneFor('u-counter')
  const joe = await phoneFor('u-counter-2')
  const approve = async (p, code, { message, fp = fpHex } = {}) => {
    const { nonce } = await KS.issueChallenge(p.keyId, { db })
    return HC.approveCounterSignIn({ code, keyId: p.keyId, nonce, signature: p.sign(message ? message(nonce) : CS.counterSignInMessage(fp, code, p.keyId, nonce)) }, hub)
  }

  await rejects('THE TRAP: a phone on the café wifi cannot start a counter sign-in', () => HC.askCounterSignIn({ uid: 'u-counter' }, { db, host: '192.168.1.20:3443' }), e => e.status === 403)
  await rejects('somebody the hub does not know is refused', () => HC.askCounterSignIn({ uid: 'u-nobody' }, { db, host: COUNTER }), e => e.status === 400)
  const asked = await HC.askCounterSignIn({ uid: 'u-counter' }, { db, host: COUNTER })
  eq('tapping a name gives the counter a four-digit code and names the person', [CS.isCounterCode(asked.code), asked.label], [true, 'Nour'])
  const stored = JSON.stringify((await db.doc(`hubCounterRequests/${asked.id}`).get()).data())
  eq('THE TRAP: the hub keeps neither the code nor the secret, only hashes', [stored.includes(`"${asked.code}"`), stored.includes(asked.secret)], [false, false])
  eq('before the phone answers, the counter is told to wait', (await HC.collectCounterSignIn({ id: asked.id, secret: asked.secret }, { db })).status, 'waiting')

  const wrong = asked.code === '0000' ? '0001' : '0000'
  await rejects('a wrong code approves nothing', () => approve(nour, wrong), e => e.status === 404)
  await rejects('THE TRAP: another person\'s phone, with the right code, signs nobody in', () => approve(joe, asked.code), e => e.status === 404)
  await rejects('THE TRAP: a phone sign-in signature over the same challenge is not a counter approval',
    () => approve(nour, asked.code, { message: nonce => SK.signInMessage(fpHex, nour.keyId, nonce) }), e => e.status === 401)
  await rejects('...nor a manager\'s approval signature', () => approve(nour, asked.code, { message: nonce => SA.approveMessage(fpHex, asked.code, nour.keyId, nonce) }), e => e.status === 401)
  await rejects('...nor a signature made for another hub', () => approve(nour, asked.code, { fp: 'cd'.repeat(32) }), e => e.status === 401)
  await rejects('a challenge the hub never gave is refused',
    () => HC.approveCounterSignIn({ code: asked.code, keyId: nour.keyId, nonce: 'A'.repeat(43), signature: nour.sign(CS.counterSignInMessage(fpHex, asked.code, nour.keyId, 'A'.repeat(43))) }, hub), e => e.status === 401)
  await db.doc('users/u-counter').update({ isStaff: false })
  await rejects('THE TRAP: a phone whose owner is no longer staff approves nothing', () => approve(nour, asked.code), e => e.status === 403)
  await db.doc('users/u-counter').update({ isStaff: true })

  await approve(nour, asked.code)
  await rejects('THE TRAP: the counter collects only with its own secret', () => HC.collectCounterSignIn({ id: asked.id, secret: 'b'.repeat(43) }, { db }), e => e.status === 401)
  const collected = await HC.collectCounterSignIn({ id: asked.id, secret: asked.secret }, { db })
  eq('approved on the phone, the counter signs in as that person, with an idle limit of 15 minutes (S25)',
    [collected.status, collected.caller?.uid, collected.caller?.role, collected.caller?.idleMs, typeof collected.token], ['approved', 'u-counter', 'barista', CS.COUNTER_IDLE_MS, 'string'])
  eq('collecting twice gets nothing', [(await HC.collectCounterSignIn({ id: asked.id, secret: asked.secret }, { db })).status, (await HC.collectCounterSignIn({ id: asked.id, secret: asked.secret }, { db })).token], ['collected', undefined])

  let first = await HC.askCounterSignIn({ uid: 'u-counter' }, { db, host: COUNTER })
  let second = await HC.askCounterSignIn({ uid: 'u-counter' }, { db, host: COUNTER })
  while (second.code === first.code) second = await HC.askCounterSignIn({ uid: 'u-counter' }, { db, host: COUNTER })
  await rejects('tapping your name again replaces the last code', () => approve(nour, first.code), e => e.status === 404)
  const old = await HC.askCounterSignIn({ uid: 'u-counter-2' }, { db, host: COUNTER, now: Date.now() - CS.COUNTER_REQUEST_MS - 1000 })
  await rejects('a code approved too late approves nothing', () => approve(joe, old.code), e => e.status === 404)
  eq('...and that request tells the counter it ran out', (await HC.collectCounterSignIn({ id: old.id, secret: old.secret }, { db })).status, 'expired')
  await approve(nour, second.code)
  await db.doc('users/u-counter').update({ isStaff: false })
  await rejects('THE TRAP: somebody no longer staff by collection time gets no session', () => HC.collectCounterSignIn({ id: second.id, secret: second.secret }, { db }), e => e.status === 403)
  await db.doc('users/u-counter').update({ isStaff: true })

  // ── Idle (S25) ──
  const t0 = Date.now()
  const idleSession = await HS.startHubSession({ uid: 'u-counter', staff: true, role: 'barista', idleMs: CS.COUNTER_IDLE_MS }, t0)
  const at = ms => HS.callerFromHubToken(idleSession.token, t0 + ms)
  eq('a counter session lasts through 14 minutes without a tap, and not through 15',
    [Boolean(await at(14 * 60_000)), await at(15 * 60_000)], [true, null])
  eq('a tap starts the count again', [await HS.touchHubSession(idleSession.token, t0 + 10 * 60_000), Boolean(await at(24 * 60_000)), await at(25 * 60_000)], [true, true, null])
  eq('THE TRAP: taps closer together than 30 seconds are not each a write',
    [await HS.touchHubSession(idleSession.token, t0 + 10 * 60_000 + 10_000), await at(25 * 60_000 + 5_000)], [true, null])
  eq('a session already idle cannot be touched back to life', await HS.touchHubSession(idleSession.token, t0 + 30 * 60_000), false)
  const nightSession = await HS.startHubSession({ uid: 'u-counter', staff: true, role: 'barista' }, t0)
  eq('THE TRAP: a phone\'s own sign-in has no idle limit: it lasts the night (S14)',
    [Boolean(await HS.callerFromHubToken(nightSession.token, t0 + 60 * 60_000)), (await HS.callerFromHubToken(nightSession.token, t0))?.idleMs], [true, null])
  eq('...and touching it changes nothing', await HS.touchHubSession(nightSession.token, t0 + 60_000), true)
  eq('an idle limit outside a minute to twelve hours is not an idle limit',
    [(await HS.startHubSession({ uid: 'u-counter', staff: true, role: 'barista', idleMs: 5 }, t0)).caller.idleMs,
      (await HS.startHubSession({ uid: 'u-counter', staff: true, role: 'barista', idleMs: '900000' }, t0)).caller.idleMs], [null, null])
  // What the Windows app asks before installing an update (S27): nobody signed in.
  const quiet = await HS.startHubSession({ uid: 'u-counter', staff: true, role: 'barista', idleMs: CS.COUNTER_IDLE_MS }, t0)
  const withIt = [await HS.liveHubSessions(t0 + 60_000), await HS.liveHubSessions(t0 + 16 * 60_000)]
  await HS.endHubSession(quiet.token)
  const without = [await HS.liveHubSessions(t0 + 60_000), await HS.liveHubSessions(t0 + 16 * 60_000)]
  eq('a live session counts as somebody signed in; signed out, or idle past its limit, it does not',
    [withIt[0] - without[0], withIt[1] - without[1]], [1, 0])
  await HS.endHubSession(idleSession.token)
  eq('a signed-out session cannot be touched', await HS.touchHubSession(idleSession.token, t0 + 60_000), false)
}

console.log('\nwhere phones find the hub on the café wifi, and what its QR says (S11)')
{
  const N = await import(url('hubNetwork.js'))
  eq('private addresses are the café network; public, loopback and link-local are not',
    ['10.0.0.1', '172.16.0.1', '172.31.255.1', '192.168.68.148', '172.32.0.1', '8.8.8.8', '127.0.0.1', '169.254.1.1', '192.168.1.256', 'hub'].map(N.isPrivateIPv4),
    [true, true, true, true, false, false, false, false, false, false])
  const interfaces = {
    'Wi-Fi': [{ address: '192.168.1.20', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
    'Loopback': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    'vEthernet': [{ address: '172.20.0.1', family: 4, internal: false }],
    'Modem': [{ address: '81.2.69.160', family: 'IPv4', internal: false }],
  }
  eq('the addresses phones can use: private IPv4, on the encrypted port, never a public one',
    N.lanAddresses(interfaces, 3443), ['https://172.20.0.1:3443', 'https://192.168.1.20:3443'])

  const FP = Array(32).fill('AB').join(':')
  const link = N.hubLink('https://192.168.1.20:3443', FP)
  eq('the QR says where the hub is and which certificate to trust', link, `bigcms-hub:https://192.168.1.20:3443#sha256=${'ab'.repeat(32)}`)
  eq('...and the app reads it back', N.parseHubLink(link), { address: 'https://192.168.1.20:3443', fingerprint: 'ab'.repeat(32) })
  eq('THE TRAP: a QR is anything stuck on a counter: plain http, a public address, a path, a login, a short fingerprint or another QR is not a hub',
    [`bigcms-hub:http://192.168.1.20:3443#sha256=${'ab'.repeat(32)}`, `bigcms-hub:https://81.2.69.160:3443#sha256=${'ab'.repeat(32)}`,
      `bigcms-hub:https://192.168.1.20:3443/steal#sha256=${'ab'.repeat(32)}`, `bigcms-hub:https://staff${'@'}192.168.1.20:3443#sha256=${'ab'.repeat(32)}`,
      'bigcms-hub:https://192.168.1.20:3443#sha256=abcd', `https://192.168.1.20:3443#sha256=${'ab'.repeat(32)}`, null].map(N.parseHubLink),
    [null, null, null, null, null, null, null])
  eq('no link is made from a bad address or fingerprint', [N.hubLink('http://192.168.1.20:3443', FP), N.hubLink('https://192.168.1.20:3443', 'nope')], [null, null])

  const lan = S.hubLanStatus({ BIG_CMS_HUB_LAN_PORT: '3443', BIG_CMS_HUB_CERT_SHA256: FP }, interfaces)
  eq('the hub page is told the door\'s addresses and a QR for each', [lan.port, lan.addresses, lan.links.length, lan.fingerprint], [3443, ['https://172.20.0.1:3443', 'https://192.168.1.20:3443'], 2, FP])
  eq('THE TRAP: with no door, or a malformed one, the hub is on this PC only and says nothing about the wifi',
    [S.hubLanStatus({}, interfaces), S.hubLanStatus({ BIG_CMS_HUB_LAN_PORT: '3443', BIG_CMS_HUB_CERT_SHA256: 'AB:CD' }, interfaces), S.hubLanStatus({ BIG_CMS_HUB_LAN_PORT: '80', BIG_CMS_HUB_CERT_SHA256: FP }, interfaces)],
    [null, null, null])
}

} catch (err) {
  console.log(`  FAIL  the run stopped: ${String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ')}`)
  fail++
}

rmSync(out, { recursive: true, force: true })
try { rmSync(tmp, { recursive: true, force: true }) } catch { /* the store's handle is still open; the OS cleans temp */ }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
