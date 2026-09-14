// Pictures on the demo menu (owner's request, 14 Sep 2026: images on all menu items).
//
//   node --env-file=.env.local scripts/seed-menu-images.mjs                  # dry run
//   node --env-file=.env.local scripts/seed-menu-images.mjs --apply
//   node --env-file=.env.local scripts/seed-menu-images.mjs --clear --apply  # take them off again
//
// Puts a photograph on each demo dish, in the item's `image` field — the field
// an upload on the admin Menu page fills, so the till renders both the same
// way. For a demo seeded before items had pictures; a fresh `seed:demo` writes
// them itself. The photos are scripts/menu-item-photos.mjs.
//
// Only items with NO picture are touched, so one uploaded on the Menu page is
// never replaced. Matched by the demo's document id (item-<slug>) and then by
// name, so a hand-made "Latte" gets the latte. Everything written is marked
// `imageSeeded: true`, and --clear removes exactly those pictures and nothing
// a person put there.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { MENU_ITEM_PHOTOS, menuPhotoUrl } from './menu-item-photos.mjs'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const CLEAR = process.argv.includes('--clear')

const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. Run with --env-file=.env.local.')
  process.exit(1)
}
const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))
const projectId = sa.project_id

const DEMO_HINTS = ['dev', 'demo', 'test', 'staging', 'sandbox', 'local']
const looksLikeDemo = DEMO_HINTS.some(h => projectId.toLowerCase().includes(h))
const explicitlyAllowed = process.env.SEED_ALLOW_PROJECT === projectId

console.log(`Project: ${projectId}`)

if (!looksLikeDemo && !explicitlyAllowed && !FORCE) {
  console.error(
    `\nREFUSING TO RUN.\n\n` +
    `The project id "${projectId}" doesn't contain any of: ${DEMO_HINTS.join(', ')}.\n` +
    `This script writes to the menu with a credential that bypasses every security rule.\n\n` +
    `If this really is a demo project, add this line to .env.local:\n` +
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

const items = await db.collection('menuItems').get()

if (CLEAR) {
  const seeded = items.docs.filter(d => d.data().imageSeeded === true)
  console.log(`\n${seeded.length} item(s) carry a seeded picture.`)
  if (!APPLY) { console.log('Dry run — nothing removed. Add --apply to remove them.'); process.exit(0) }
  const batch = db.batch()
  for (const d of seeded) batch.update(d.ref, { image: FieldValue.delete(), imageSeeded: FieldValue.delete() })
  if (seeded.length > 0) await batch.commit()
  console.log(`Removed ${seeded.length}.`)
  process.exit(0)
}

const byName = new Map(Object.values(MENU_ITEM_PHOTOS).map(p => [p.name.toLowerCase(), p.photo]))
const plan = []
const skipped = { hasPicture: [], noPhoto: [] }

for (const d of items.docs) {
  const data = d.data()
  const name = String(data.name ?? d.id)
  if (typeof data.image === 'string' && data.image.trim()) { skipped.hasPicture.push(name); continue }
  const slug = d.id.startsWith('item-') ? d.id.slice('item-'.length) : ''
  const photo = MENU_ITEM_PHOTOS[slug]?.photo ?? byName.get(name.toLowerCase())
  if (!photo) { skipped.noPhoto.push(name); continue }
  plan.push({ ref: d.ref, name, url: menuPhotoUrl(photo) })
}

console.log(`\n${items.size} menu item(s).`)
for (const p of plan) console.log(`  + ${p.name}`)
if (skipped.hasPicture.length) console.log(`\nAlready have a picture, left alone: ${skipped.hasPicture.join(', ')}`)
if (skipped.noPhoto.length) console.log(`\nNo demo photo for (upload one on the Menu page): ${skipped.noPhoto.join(', ')}`)

if (!APPLY) {
  console.log(`\nDry run — ${plan.length} picture(s) would be added. Add --apply to write them.`)
  process.exit(0)
}

for (let i = 0; i < plan.length; i += 400) {
  const batch = db.batch()
  for (const p of plan.slice(i, i + 400)) {
    batch.update(p.ref, { image: p.url, imageSeeded: true, updatedAt: FieldValue.serverTimestamp() })
  }
  await batch.commit()
}
console.log(`\nAdded ${plan.length} picture(s).`)
