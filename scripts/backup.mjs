// Takes a readable, restorable copy of every collection.
//
//   node --env-file=.env.local scripts/backup.mjs                    # everything
//   node --env-file=.env.local scripts/backup.mjs --collections=checks,users
//   node --env-file=.env.local scripts/backup.mjs --out=D:/backups
//   npm run backup
//
// ── What this is, and what it is not ───────────────────────────────────────
// It is a per-document JSON copy: readable, diffable, restorable one
// collection at a time, and it needs no bucket, no billing change and no
// permissions beyond the service account the server layer already uses. That
// makes it the right tool for "send me a copy of this café's data", for moving
// a dataset between projects, and for the restore drill nobody performs
// because it needs infrastructure.
//
// It is NOT a substitute for `gcloud firestore export` once there is a paying
// customer. A managed export is a consistent point-in-time snapshot taken by
// the database itself; this reads collection by collection while the café may
// still be trading, so two collections can disagree by a few seconds. For
// disaster recovery, use the managed export. For everything else, this.
//
// It reads only, so there is no demo-project guard: backing up production is
// the entire point.
//
// ── The one thing that makes it trustworthy ────────────────────────────────
// The codec. A Firestore document is not JSON — Timestamps, GeoPoints,
// references, bytes and NaN all lose themselves in JSON.stringify, silently,
// and the damage only shows up when somebody restores. shared/src/backupCodec.ts
// tags them, and `npm run verify:backup` holds it to that.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp, GeoPoint, DocumentReference } from 'firebase-admin/firestore'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) ?? '').split('=').slice(1).join('=')
const only = arg('collections').split(',').map(s => s.trim()).filter(Boolean)
const outRoot = arg('out') || 'backups'

const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. Did you forget --env-file=.env.local ?')
  process.exit(1)
}
const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))
const projectId = sa.project_id

const db = getFirestore(initializeApp({
  credential: cert({
    projectId,
    clientEmail: sa.client_email,
    privateKey: String(sa.private_key ?? '').replace(/\\n/g, '\n'),
  }),
}))

// The codec, transpiled — the same module the verifier drives.
const tmp = mkdtempSync(join(tmpdir(), 'backup-'))
execSync(
  `npx tsc shared/src/backupCodec.ts --outDir ${tmp} --module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' },
)
for (const f of readdirSync(tmp).filter(n => n.endsWith('.js'))) {
  const p = join(tmp, f)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}
const { encodeDoc } = await import(`file://${join(tmp, 'backupCodec.js')}`)

/**
 * What the codec needs to recognise. Everything else is ordinary JSON.
 *
 * A sentinel (serverTimestamp and friends) can never appear on a READ — it is
 * a write instruction, not a value — so there is nothing to encode for it.
 */
export const classify = value => {
  if (value instanceof Timestamp) return { kind: 'ts', data: { s: value.seconds, n: value.nanoseconds } }
  if (value instanceof GeoPoint) return { kind: 'geo', data: { lat: value.latitude, lng: value.longitude } }
  if (value instanceof DocumentReference) return { kind: 'ref', data: { path: value.path } }
  if (value instanceof Buffer) return { kind: 'bytes', data: { b64: value.toString('base64') } }
  if (value instanceof Date) return { kind: 'ts', data: { s: Math.floor(value.getTime() / 1000), n: (value.getTime() % 1000) * 1e6 } }
  return null
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dir = join(outRoot, `${projectId}-${stamp}`)
mkdirSync(dir, { recursive: true })

console.log(`\nProject   ${projectId}`)
console.log(`Into      ${dir}\n`)

// listCollections() rather than a hardcoded list: a collection added next
// month is in the backup without anybody remembering to add it here. It sees
// TOP-LEVEL collections only — this schema is flat, and if a subcollection is
// ever introduced, this line is what has to change.
const all = (await db.listCollections()).map(c => c.id).sort()
const wanted = only.length ? all.filter(c => only.includes(c)) : all

const missing = only.filter(c => !all.includes(c))
if (missing.length) console.log(`Not present, skipped: ${missing.join(', ')}\n`)

const counts = {}
let total = 0

for (const name of wanted) {
  const file = join(dir, `${name}.ndjson`)
  writeFileSync(file, '')
  let n = 0
  // Paged rather than one get(): a collection that has grown past memory
  // should slow a backup down, not end it.
  let cursor = null
  for (;;) {
    let q = db.collection(name).orderBy('__name__').limit(500)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break
    const lines = snap.docs.map(d => JSON.stringify(encodeDoc(d.id, d.data(), classify)))
    appendFileSync(file, lines.join('\n') + '\n')
    n += snap.size
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < 500) break
  }
  counts[name] = n
  total += n
  console.log(`  ${String(n).padStart(6)}  ${name}`)
}

writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
  project: projectId,
  takenAt: new Date().toISOString(),
  codec: 1,
  collections: counts,
  total,
  note: 'Per-collection copy, not a point-in-time snapshot. See the head of scripts/backup.mjs.',
}, null, 2) + '\n')

console.log(`\n${total} documents across ${wanted.length} collections.`)
console.log(`Restore or check it with:  npm run restore -- ${dir}\n`)
