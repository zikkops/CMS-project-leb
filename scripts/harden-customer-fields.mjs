// Moves personal fields off users/{uid} into the staff-only private sub-docs.
//
//   node --env-file=.env.local scripts/harden-customer-fields.mjs           # dry run
//   node --env-file=.env.local scripts/harden-customer-fields.mjs --apply
//
// ── What this is for ──────────────────────────────────────────────────────
// users/{uid} is readable by ANY signed-in customer — friend search needs it.
// So a phone number or a legal name sitting on that document is readable by
// every other customer of the café. They belong in users/{uid}/private/*,
// which firestore.rules restricts to the owner and staff.
//
//   phoneNumber, avatarDeleteUrl  →  users/{uid}/private/contact | avatar
//   firstName, lastName           →  users/{uid}/private/contact
//
// Run it after importing customers from another system, which is the case
// that still produces documents in the old shape.
//
// ── Why this is a script and not a passive migration ──────────────────────
// This replaces migratePrivateFieldsOnce() and migrateNameFieldsOnce(), which
// lived in app/lib/customerManagement.ts and ran IN THE BROWSER, triggered by
// whichever admin happened to load the dashboard first.
//
// They shared a bug with the old annual points reset: each set its
// `done` flag BEFORE doing the work. Close that tab midway and the flag says
// finished while the remaining accounts keep their phone numbers on the
// public document — permanently, since nothing would ever retry. For a
// migration whose entire purpose is to stop exposing personal data, failing
// silently in the exposed direction is the wrong way round.
//
// This version needs no flag at all. It queries for documents that still
// have the fields, so anything already moved drops out of the set and a run
// that dies partway simply has less to do next time.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')

const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. Did you forget --env-file=.env.local ?')
  process.exit(1)
}
const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))

initializeApp({
  credential: cert({
    projectId: sa.project_id,
    clientEmail: sa.client_email,
    privateKey: String(sa.private_key).replace(/\\n/g, '\n'),
  }),
})
const db = getFirestore()

console.log(`Project: ${sa.project_id}`)
console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: DRY RUN — nothing written. Re-run with --apply.\n')

const CONTACT = ['phoneNumber', 'firstName', 'lastName']
const AVATAR = ['avatarDeleteUrl']

const snap = await db.collection('users').get()
let moved = 0

for (const d of snap.docs) {
  const data = d.data()

  const contact = {}
  for (const f of CONTACT) if (data[f] !== undefined) contact[f] = data[f]

  const avatar = {}
  for (const f of AVATAR) if (data[f] !== undefined) avatar[f] = data[f]

  const fields = [...Object.keys(contact), ...Object.keys(avatar)]
  if (fields.length === 0) continue

  console.log(`  ${data.email || data.username || d.id}: ${fields.join(', ')}`)
  moved++
  if (!APPLY) continue

  // Sub-doc written before the main doc is stripped. The reverse order would
  // delete the only copy first, and a failure between the two would lose the
  // value outright rather than merely leaving it exposed for another run.
  if (Object.keys(contact).length > 0) {
    await d.ref.collection('private').doc('contact').set(contact, { merge: true })
  }
  if (Object.keys(avatar).length > 0) {
    await d.ref.collection('private').doc('avatar').set(avatar, { merge: true })
  }
  await d.ref.update(Object.fromEntries(fields.map(f => [f, FieldValue.delete()])))
}

console.log(
  moved === 0
    ? '\nNothing to move — no customer document carries these fields on the main doc.'
    : `\n${moved} customer document(s) ${APPLY ? 'hardened' : 'would be hardened'}.`
)
if (!APPLY && moved > 0) console.log('Re-run with --apply.')
