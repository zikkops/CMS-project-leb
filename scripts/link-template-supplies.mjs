// One-off migration: give every orderTemplateItem a durable `supplyId`.
//
// ── The problem this fixes ─────────────────────────────────────────────────
// `orderTemplateItems` (what you order) and `supplies` (what you count) are
// separate collections with separate ids and nothing linking them. The only
// bridge is seedFromTemplates() in app/admin/supplies/page.tsx, which matches
// on `name.toLowerCase()` at the moment you press the button — and stores the
// provider as a NAME string on the supply while the template keeps a
// providerId.
//
// So a weekly order line knows its templateId, and moving stock needs a
// supplyId, and the two are connected only by a string that either side can
// change. Rename "Olive Oil" to "Olive Oil 5L" in Supplies and the next
// delivery of it silently moves no stock: no error, no warning, the number
// just stays where it was until someone notices the count is wrong.
//
// Receiving is the step that has to bridge order and stock, so it can't be
// built on a name match. This writes the link down once.
//
// Usage (Node 20.6+ for --env-file):
//   node --env-file=.env.local scripts/link-template-supplies.mjs          # dry run
//   node --env-file=.env.local scripts/link-template-supplies.mjs --apply  # write
//
// Safe to re-run. Items that already have a supplyId pointing at a supply that
// still exists are left alone.

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

const db = getFirestore()

// Deliberately the SAME normalization seedFromTemplates() uses — lowercase and
// trim, nothing cleverer. Fuzzy matching here would create wrong links that
// look right, and a wrong link silently moves stock onto the wrong item, which
// is far worse than an unmatched item you can see and fix by hand.
const key = s => String(s ?? '').trim().toLowerCase()

const [templateSnap, supplySnap] = await Promise.all([
  db.collection('orderTemplateItems').get(),
  db.collection('supplies').get(),
])

console.log(`${templateSnap.size} template item(s), ${supplySnap.size} supply item(s).`)
console.log(APPLY ? 'Mode: APPLY — links will be written.\n' : 'Mode: DRY RUN — nothing will be written. Re-run with --apply.\n')

// Build the name index, and detect duplicates first. Two supplies with the
// same name mean the match is a coin flip; those must be resolved by a human,
// not by whichever document Firestore happened to return second.
const byName = new Map()
const duplicateNames = new Set()
for (const doc of supplySnap.docs) {
  const k = key(doc.data().name)
  if (!k) continue
  if (byName.has(k)) duplicateNames.add(k)
  else byName.set(k, { id: doc.id, name: doc.data().name })
}

if (duplicateNames.size > 0) {
  console.log('⚠  Duplicate supply names — these cannot be linked automatically:')
  for (const n of duplicateNames) console.log(`     "${n}"`)
  console.log('   Merge or rename them in Supplies first, then re-run.\n')
}

const supplyIdsThatExist = new Set(supplySnap.docs.map(d => d.id))

let linked = 0, alreadyOk = 0, ambiguous = 0, unmatched = 0
const unmatchedItems = []

for (const doc of templateSnap.docs) {
  const t = doc.data()
  const label = `${t.department ?? '—'} / ${t.name}`
  const k = key(t.name)

  // Already linked and the target still exists — nothing to do.
  if (t.supplyId && supplyIdsThatExist.has(t.supplyId)) {
    alreadyOk++
    continue
  }

  // Linked to something that has since been deleted. Worth calling out
  // separately from "never linked": it means stock has been silently failing
  // to move for this item.
  if (t.supplyId && !supplyIdsThatExist.has(t.supplyId)) {
    console.log(`  STALE ${label} — supplyId ${t.supplyId} no longer exists, relinking by name`)
  }

  if (duplicateNames.has(k)) {
    console.log(`  AMBIG ${label} — more than one supply is called "${t.name}"`)
    ambiguous++
    continue
  }

  const match = byName.get(k)
  if (!match) {
    unmatched++
    unmatchedItems.push(label)
    continue
  }

  console.log(`  ${APPLY ? 'LINK ' : 'WOULD'} ${label}  →  supplies/${match.id}`)
  if (APPLY) {
    await doc.ref.update({ supplyId: match.id })
  }
  linked++
}

console.log(`\n${APPLY ? 'Linked' : 'Would link'}: ${linked} · Already correct: ${alreadyOk} · Ambiguous: ${ambiguous} · Unmatched: ${unmatched}`)

if (unmatchedItems.length > 0) {
  console.log('\nUnmatched template items — no supply with this name exists:')
  for (const label of unmatchedItems) console.log(`  · ${label}`)
  console.log(
    '\nThese are ordered but not stocked, so a delivery of them can move no stock.\n' +
    'Either add them in Supplies (the "import from Weekly Orders" button seeds\n' +
    'missing ones), or leave them unlinked if they genuinely are not counted —\n' +
    'the receiving form will show them as unstocked rather than failing.'
  )
}

if ((ambiguous > 0 || unmatched > 0) && APPLY) {
  console.log('\nRe-run this script after fixing the items above.')
}

process.exit(0)
