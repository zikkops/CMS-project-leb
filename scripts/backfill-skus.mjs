// One-off backfill: give every existing product a SKU, and set the counter that
// app/api/admin/sku/route.ts hands out from afterwards.
//
// Format is ob-<3 letters><0001>, one global sequence — see app/lib/skuFormat.ts.
// Products are numbered ALPHABETICALLY BY NAME so a printed list sorts the same
// way the catalogue does.
//
// Usage (Node 20.6+ for --env-file):
//   node --env-file=.env.local scripts/backfill-skus.mjs          # dry run
//   node --env-file=.env.local scripts/backfill-skus.mjs --apply  # write
//
// Safe to re-run. A product that already carries a valid SKU is skipped, never
// renumbered — a SKU is issued once and then belongs to that product, because it
// ends up on shelf labels and past invoices. Re-running only fills in products
// added since, and leaves the counter at the highest number actually in use.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')

const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. See docs/server-setup.md.')
  console.error('Did you forget --env-file=.env.local ?')
  process.exit(1)
}

const sa = JSON.parse(
  raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
)

initializeApp({
  credential: cert({
    projectId: sa.project_id,
    clientEmail: sa.client_email,
    privateKey: String(sa.private_key).replace(/\\n/g, '\n'),
  }),
})

// Duplicated from app/lib/skuFormat.ts rather than imported: this is a .mjs
// script and that is TypeScript. Keep the two in step — the format is also
// asserted by SKU_PATTERN there.
const SKU_PATTERN = /^ob-[A-Z]{3}\d{4,}$/

function skuLetters(name) {
  const letters = String(name ?? '').replace(/[^a-zA-Z]/g, '').toUpperCase()
  if (letters.length === 0) return 'XXX'
  return letters.slice(0, 3).padEnd(3, 'X')
}

function formatSku(name, sequence) {
  return `ob-${skuLetters(name)}${String(sequence).padStart(4, '0')}`
}

function sequenceOf(sku) {
  if (typeof sku !== 'string' || !SKU_PATTERN.test(sku)) return 0
  return parseInt(sku.slice(6), 10) || 0
}

const db = getFirestore()
const snap = await db.collection('products').get()

const docs = snap.docs.map(d => ({ id: d.id, name: String(d.data().name ?? ''), sku: d.data().sku }))
const already = docs.filter(d => SKU_PATTERN.test(String(d.sku ?? '')))
const todo = docs
  .filter(d => !SKU_PATTERN.test(String(d.sku ?? '')))
  .sort((a, b) => a.name.localeCompare(b.name))

// Continue past anything already issued, so a re-run never reuses a number.
let next = already.reduce((max, d) => Math.max(max, sequenceOf(d.sku)), 0) + 1

console.log(`${docs.length} product(s): ${already.length} already have a SKU, ${todo.length} to assign.`)
console.log(`Numbering continues from ${String(next).padStart(4, '0')}.`)
console.log(APPLY ? 'Mode: APPLY — writing.\n' : 'Mode: DRY RUN — nothing will be written. Re-run with --apply.\n')

const planned = todo.map(d => ({ ...d, newSku: formatSku(d.name, next++) }))

for (const p of planned.slice(0, 20)) {
  console.log(`  ${APPLY ? 'SET  ' : 'WOULD'} ${p.newSku}  ${p.name}`)
}
if (planned.length > 20) console.log(`  … and ${planned.length - 20} more`)

// A collision would mean two products sharing a SKU — refuse rather than write it.
const allSkus = [...already.map(d => String(d.sku)), ...planned.map(p => p.newSku)]
const dupes = allSkus.filter((s, i) => allSkus.indexOf(s) !== i)
if (dupes.length > 0) {
  console.error(`\nAborting: duplicate SKUs would result: ${[...new Set(dupes)].join(', ')}`)
  process.exit(1)
}

if (!APPLY) {
  console.log(`\nWould write: ${planned.length} · Counter would become ${next - 1}.`)
  process.exit(0)
}

// Batched: 355 individual writes is 355 round trips, and a partial failure
// halfway is harder to reason about than a handful of committed batches.
let written = 0
for (let i = 0; i < planned.length; i += 400) {
  const batch = db.batch()
  for (const p of planned.slice(i, i + 400)) {
    batch.update(db.doc(`products/${p.id}`), { sku: p.newSku })
  }
  await batch.commit()
  written += Math.min(400, planned.length - i)
  console.log(`  committed ${written}/${planned.length}`)
}

// Set the counter LAST. If the writes above failed, the counter has not moved
// and a re-run recomputes the same plan.
const highest = next - 1
await db.doc('appSettings/skuCounter').set({ nextNumber: highest }, { merge: true })

console.log(`\nWrote: ${written} · appSettings/skuCounter.nextNumber = ${highest}`)
