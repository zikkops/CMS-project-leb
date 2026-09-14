// Fills a café hub's database with what the cloud is master for. DEVELOPMENT
// ONLY — POS software, stage 3.
//
//   npm run hub:seed                     # into .hub/dev.db
//   npm run hub:seed -- --db=<file>
//
// A real hub never holds the Admin key: it will get the menu and settings
// through the device-authenticated sync in stage 4. Until that exists, a hub on
// a developer's machine has no menu, no settings and every feature switch off,
// so there is nothing to try in a browser. This copies them from the project in
// .env.local, with this machine's key, into a local file. It only READS
// Firestore; it never writes to it.
//
// Not copied, on purpose: checks, tickets, shifts and receipts (the hub is
// master for its own trading), and the invoice counter. A dev hub numbers
// receipts from 1, which is fine on a developer's machine and is exactly the
// collision stage 4's receipt blocks exist to prevent on a real one.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) ?? '').split('=').slice(1).join('=')
const file = resolve(arg('db') || join('.hub', 'dev.db'))

const COLLECTIONS = ['menuCategories', 'menuItems', 'modifierGroups', 'products', 'branchTableLayouts']
const SETTINGS = ['features', 'business', 'printing']

const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. Run it as `npm run hub:seed`, which reads .env.local.')
  process.exit(1)
}
const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))
const cloud = getFirestore(initializeApp({
  credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: String(sa.private_key ?? '').replace(/\\n/g, '\n') }),
}))

// The hub's store, compiled inside the repo so it shares this script's firebase-admin.
const out = join('node_modules', '.cache', `hub-seed-${process.pid}`)
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc shared/src/server/hubStore.ts --outDir ${out} --rootDir shared/src --module esnext --target es2022 ` +
  '--moduleResolution bundler --skipLibCheck --strict --types node',
  { stdio: 'pipe' },
)
const fixImports = dir => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { fixImports(p); continue }
    if (p.endsWith('.js')) {
      writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, (_, spec) => `from '${spec}.js'`))
    }
  }
}
fixImports(out)
writeFileSync(join(out, 'package.json'), '{ "type": "module" }')
const { openHubStore } = await import(pathToFileURL(resolve(out, 'server', 'hubStore.js')).href)

mkdirSync(dirname(file), { recursive: true })
const sql = new DatabaseSync(file)
const hub = openHubStore(sql)

console.log(`\nFrom project ${sa.project_id} into ${file}\n`)
let failed = 0
const copy = async (path, data) => {
  try {
    await hub.doc(path).set(data)
    return true
  } catch (err) {
    failed++
    console.log(`  could not copy ${path}: ${err.message}`)
    return false
  }
}

for (const name of COLLECTIONS) {
  const snap = await cloud.collection(name).get()
  let copied = 0
  for (const d of snap.docs) if (await copy(`${name}/${d.id}`, d.data())) copied++
  console.log(`  ${name.padEnd(20)} ${copied} of ${snap.size}`)
}
for (const id of SETTINGS) {
  const snap = await cloud.doc(`appSettings/${id}`).get()
  const done = snap.exists ? await copy(`appSettings/${id}`, snap.data()) : false
  console.log(`  appSettings/${id.padEnd(8)} ${snap.exists ? (done ? 'copied' : 'FAILED') : 'not in the project'}`)
}

sql.close()
rmSync(out, { recursive: true, force: true })
console.log(failed ? `\n${failed} document(s) could not be copied.` : '\nDone. Start the POS with BIG_CMS_HUB_DB pointing at this file.')
process.exit(failed ? 1 : 0)
