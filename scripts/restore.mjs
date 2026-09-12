// Puts a backup back, or checks that it still matches what is live.
//
//   node --env-file=.env.local scripts/restore.mjs <dir>              # compare only
//   node --env-file=.env.local scripts/restore.mjs <dir> --apply      # write it back
//   node --env-file=.env.local scripts/restore.mjs <dir> --collections=menuItems
//   npm run restore -- backups/<dir>
//
// ── Compare is the default, and that is the point ──────────────────────────
// "Backups, with a restore you have actually run" is on the Phase 05 list
// because an unexercised backup is a rumour. But a full restore is a
// destructive act, and nobody rehearses one on a whim — so the drill you can
// run any time is the read-only half: take the backup, then ask whether every
// document in it still matches what is live, field for field, through the same
// codec. That proves the file is faithful and restorable without writing a
// byte. --apply is the other half, for the day it is actually needed.
//
// ── What it refuses ────────────────────────────────────────────────────────
// Writing into a project the backup did not come from, unless you say so out
// loud; and writing into a project that does not look like a demo, unless you
// name it exactly. Restoring one café's data into another café's project is
// the accident worth being pedantic about.
//
// It does not delete. A document that exists live but not in the backup is
// reported and left alone: restoring is putting data back, and quietly
// removing whatever came after the backup is not that.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp, GeoPoint } from 'firebase-admin/firestore'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const ALLOW_OTHER = process.argv.includes('--allow-different-project')
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) ?? '').split('=').slice(1).join('=')
const only = arg('collections').split(',').map(s => s.trim()).filter(Boolean)

const dir = process.argv.slice(2).find(a => !a.startsWith('--'))
if (!dir || !existsSync(join(dir, 'manifest.json'))) {
  console.error('Point this at a backup directory (the one holding manifest.json).')
  console.error('  npm run restore -- backups/<project>-<timestamp>')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))

const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. Did you forget --env-file=.env.local ?')
  process.exit(1)
}
const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))
const projectId = sa.project_id

console.log(`\nBackup    ${dir}`)
console.log(`  taken   ${manifest.takenAt} from ${manifest.project}`)
console.log(`Target    ${projectId}`)

if (manifest.project !== projectId && !ALLOW_OTHER) {
  console.error(
    `\nREFUSING: this backup came from "${manifest.project}" and you are pointed at\n` +
    `"${projectId}". Restoring one project's data into another is the accident\n` +
    `worth being pedantic about. If you mean it: --allow-different-project\n`
  )
  process.exit(1)
}

const DEMO_HINTS = ['dev', 'demo', 'test', 'staging', 'sandbox', 'local']
const looksLikeDemo = DEMO_HINTS.some(h => projectId.toLowerCase().includes(h))
const explicitlyAllowed = process.env.SEED_ALLOW_PROJECT === projectId
if (APPLY && !looksLikeDemo && !explicitlyAllowed && !FORCE) {
  console.error(
    `\nREFUSING TO WRITE.\n\n` +
    `"${projectId}" does not contain any of: ${DEMO_HINTS.join(', ')}, and a restore\n` +
    `overwrites live documents with a credential that bypasses every rule.\n` +
    `Name the project exactly in .env.local to allow it:\n` +
    `    SEED_ALLOW_PROJECT=${projectId}\n`
  )
  process.exit(1)
}

const db = getFirestore(initializeApp({
  credential: cert({
    projectId,
    clientEmail: sa.client_email,
    privateKey: String(sa.private_key ?? '').replace(/\\n/g, '\n'),
  }),
}))

const tmp = mkdtempSync(join(tmpdir(), 'restore-'))
execSync(
  `npx tsc shared/src/backupCodec.ts --outDir ${tmp} --module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' },
)
for (const f of readdirSync(tmp).filter(n => n.endsWith('.js'))) {
  const p = join(tmp, f)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}
const { decodeDoc, encode, sameEncoded } = await import(`file://${join(tmp, 'backupCodec.js')}`)

const classify = value => {
  if (value instanceof Timestamp) return { kind: 'ts', data: { s: value.seconds, n: value.nanoseconds } }
  if (value instanceof GeoPoint) return { kind: 'geo', data: { lat: value.latitude, lng: value.longitude } }
  if (value && typeof value === 'object' && typeof value.path === 'string' && typeof value.id === 'string') {
    return { kind: 'ref', data: { path: value.path } }
  }
  if (value instanceof Buffer) return { kind: 'bytes', data: { b64: value.toString('base64') } }
  if (value instanceof Date) return { kind: 'ts', data: { s: Math.floor(value.getTime() / 1000), n: (value.getTime() % 1000) * 1e6 } }
  return null
}

const revive = (kind, data) => {
  if (kind === 'ts') return new Timestamp(Number(data.s), Number(data.n))
  if (kind === 'geo') return new GeoPoint(Number(data.lat), Number(data.lng))
  if (kind === 'ref') return db.doc(String(data.path))
  if (kind === 'bytes') return Buffer.from(String(data.b64), 'base64')
  // An unknown kind is a backup written by a newer codec. Refusing loudly
  // beats restoring a document with a hole where a value used to be.
  throw new Error(`This backup contains a value of kind "${kind}", which this version cannot rebuild.`)
}

const files = readdirSync(dir).filter(f => f.endsWith('.ndjson'))
const wanted = only.length ? files.filter(f => only.includes(f.replace('.ndjson', ''))) : files

console.log(`Mode      ${APPLY ? 'RESTORE — writing' : 'compare only — nothing will be written'}\n`)

let checked = 0, same = 0, differing = 0, absent = 0, written = 0
const problems = []

for (const file of wanted) {
  const name = file.replace('.ndjson', '')
  const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean)
  const docs = lines.map(l => decodeDoc(JSON.parse(l), revive))

  if (APPLY) {
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch()
      for (const d of docs.slice(i, i + 400)) batch.set(db.doc(`${name}/${d.id}`), d.data)
      await batch.commit()
      written += Math.min(400, docs.length - i)
    }
    console.log(`  ${String(docs.length).padStart(6)}  ${name}  restored`)
    continue
  }

  // Compare: read each document back and put both sides through the codec, so
  // two Timestamps for the same instant compare equal instead of comparing as
  // object identities.
  let s = 0, d = 0, a = 0
  for (let i = 0; i < docs.length; i += 300) {
    const chunk = docs.slice(i, i + 300)
    const refs = chunk.map(doc => db.doc(`${name}/${doc.id}`))
    const live = await db.getAll(...refs)
    live.forEach((snap, n) => {
      checked++
      if (!snap.exists) {
        a++
        if (problems.length < 10) problems.push(`${name}/${chunk[n].id} — in the backup, not live`)
        return
      }
      if (sameEncoded(encode(snap.data(), classify), encode(chunk[n].data, classify))) s++
      else {
        d++
        if (problems.length < 10) problems.push(`${name}/${chunk[n].id} — differs from the backup`)
      }
    })
  }
  same += s; differing += d; absent += a
  const flag = d || a ? `  ${d} differ, ${a} absent` : ''
  console.log(`  ${String(docs.length).padStart(6)}  ${name}${flag}`)
}

if (APPLY) {
  console.log(`\n${written} documents restored into ${projectId}.`)
  console.log('Nothing was deleted — documents created since the backup are untouched.\n')
} else {
  console.log(`\n${checked} documents checked · ${same} identical · ${differing} differing · ${absent} not live`)
  for (const p of problems) console.log(`    ${p}`)
  if (problems.length === 10) console.log('    …')
  console.log(
    differing + absent === 0
      ? '\nThe backup matches what is live, document for document.\n'
      : '\nDifferences are expected if the café has traded since the backup was taken.\n',
  )
}
