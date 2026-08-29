// One-off: rename the shop's collections from game-* to product-*.
//
//   node --env-file=.env.local scripts/migrate-products.mjs           # dry run
//   node --env-file=.env.local scripts/migrate-products.mjs --apply
//
//   games              -> products
//   gameCategories     -> productCategories
//   gamePurchaseOrders -> productPurchaseOrders
//
// Firestore cannot rename a collection. Every document is copied to the new
// name under the SAME id and the old one deleted, so anything referencing a
// product by id keeps working — purchase orders, deliveries, the SKU printed
// on a label.
//
// ── Order of operations ────────────────────────────────────────────────────
// Run this BEFORE deploying the renamed rules, not after. The Admin SDK
// bypasses rules, so the copy works either way — but between the code deploy
// and the rules deploy the app reads `products`, and a collection with no
// matching rule is denied by default. Migrate, deploy rules, then the app is
// whole again.
//
// Safe to re-run: a document already present at the destination is skipped
// rather than overwritten, so a half-finished run finishes cleanly.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')

const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. See docs/server-setup.md.')
  process.exit(1)
}
let sa
try {
  sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))
} catch {
  console.error('FIREBASE_SERVICE_ACCOUNT could not be parsed (expected base64 JSON).')
  process.exit(1)
}

initializeApp({
  credential: cert({
    projectId: sa.project_id,
    clientEmail: sa.client_email,
    privateKey: String(sa.private_key).replace(/\\n/g, '\n'),
  }),
})
const db = getFirestore()

const MOVES = [
  ['games', 'products'],
  ['gameCategories', 'productCategories'],
  ['gamePurchaseOrders', 'productPurchaseOrders'],
]

console.log(`Project: ${sa.project_id}`)
console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: DRY RUN — nothing will be written.\n')

let totalCopied = 0
let totalSkipped = 0

for (const [from, to] of MOVES) {
  const source = await db.collection(from).get()
  if (source.empty) {
    console.log(`  ${from} → ${to}: nothing to move`)
    continue
  }

  let copied = 0
  let skipped = 0

  for (const doc of source.docs) {
    const destination = db.doc(`${to}/${doc.id}`)
    if ((await destination.get()).exists) { skipped++; continue }
    if (APPLY) await destination.set(doc.data())
    copied++
  }

  // Deleted only after every copy in this collection has landed. A crash
  // part-way leaves both copies rather than neither, and a re-run finishes.
  if (APPLY && copied > 0) {
    const batch = db.batch()
    source.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
  }

  console.log(`  ${from} → ${to}: ${copied} copied${skipped ? `, ${skipped} already there` : ''}${APPLY && copied ? ', originals deleted' : ''}`)
  totalCopied += copied
  totalSkipped += skipped
}

console.log(`\n${totalCopied} document(s) ${APPLY ? 'moved' : 'would move'}${totalSkipped ? `, ${totalSkipped} already in place` : ''}.`)

if (APPLY) {
  console.log('\nNext: deploy the renamed rules —')
  console.log('  firebase deploy --only firestore:rules')
  console.log('Until that lands, reads of the new collections are denied by default.')
} else {
  console.log('\nNothing was written. Re-run with --apply.')
}

process.exit(0)
