// One-off backfill: mint Firebase custom claims for every existing staff
// account, so that rules keyed on request.auth.token.* have something to read
// before any rules change lands.
//
// Order of operations matters. Run this BEFORE deploying rules that check
// claims — a rule reading a claim that was never minted denies the write, and
// a rules deploy has no gradual rollout, so "deploy first, backfill after"
// means every staff member is locked out of that collection in between.
//
// Usage (Node 20.6+ for --env-file):
//   node --env-file=.env.local scripts/backfill-claims.mjs          # dry run
//   node --env-file=.env.local scripts/backfill-claims.mjs --apply  # write
//
// Safe to re-run. Idempotent: an account whose claims already match is skipped
// rather than rewritten, so re-running does not needlessly revoke sessions.

import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

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

const auth = getAuth()
const db = getFirestore()

const ALL_ROLES = ['admin', 'manager', 'social', 'gamer', 'kitchen_crew', 'barista']

// Kept in sync by hand with claimsFromUserDoc() in app/lib/server/claims.ts.
// Duplicated rather than imported because this is a plain .mjs script run by
// node directly — importing the TypeScript module would mean adding a loader
// for a script that runs twice in the project's lifetime.
function claimsFromUserDoc(data) {
  if (!data || data.isStaff !== true) return null
  if (!ALL_ROLES.includes(data.role)) return null

  const branchIds = Array.isArray(data.branchIds)
    ? data.branchIds.filter(b => typeof b === 'string')
    : (typeof data.branchId === 'string' && data.branchId ? [data.branchId] : [])

  return {
    staff: true,
    role: data.role,
    branchIds,
    superadmin: data.superadmin === true,
  }
}

function sameClaims(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

const staff = await db.collection('users').where('isStaff', '==', true).get()

console.log(`${staff.size} staff account(s) found.`)
console.log(APPLY ? 'Mode: APPLY — claims will be written.\n' : 'Mode: DRY RUN — nothing will be written. Re-run with --apply.\n')

let written = 0
let skipped = 0
let failed = 0

for (const doc of staff.docs) {
  const data = doc.data()
  const label = data.email ?? doc.id
  const claims = claimsFromUserDoc(data)

  if (!claims) {
    console.log(`  SKIP  ${label} — isStaff is true but role "${data.role}" is not a known role. Fix the document first.`)
    skipped++
    continue
  }

  let existing = null
  try {
    const user = await auth.getUser(doc.id)
    existing = user.customClaims ?? null
  } catch (err) {
    // A users/{uid} document with no matching Auth user — an orphan from the
    // old four-step create flow failing between steps 1 and 3. Worth surfacing:
    // it's a real, previously-invisible data problem, not just a script error.
    console.log(`  FAIL  ${label} — no Firebase Auth user for uid ${doc.id} (${err.code ?? err.message}). Orphaned document?`)
    failed++
    continue
  }

  if (sameClaims(existing, claims)) {
    console.log(`  OK    ${label} — claims already correct (${claims.role}).`)
    skipped++
    continue
  }

  console.log(`  ${APPLY ? 'WRITE' : 'WOULD'} ${label} — ${claims.role}${claims.superadmin ? ' +superadmin' : ''}${claims.dm ? ' +dm' : ''} [${claims.branchIds.join(', ') || 'no branches'}]`)

  if (APPLY) {
    try {
      await auth.setCustomUserClaims(doc.id, claims)
      await doc.ref.update({ claimsUpdatedAt: FieldValue.serverTimestamp() })
      written++
    } catch (err) {
      console.log(`  FAIL  ${label} — ${err.message}`)
      failed++
    }
  } else {
    written++
  }
}

console.log(`\n${APPLY ? 'Written' : 'Would write'}: ${written} · Skipped: ${skipped} · Failed: ${failed}`)

if (APPLY && written > 0) {
  console.log(
    '\nClaims are on the Auth users now, but every signed-in browser still holds an\n' +
    'ID token minted before them. Tokens refresh within the hour on their own;\n' +
    'useAdminUser() also force-refreshes as soon as it sees claimsUpdatedAt is newer\n' +
    'than the token. Do not deploy claim-checking rules until you have confirmed a\n' +
    'real staff login carries the claims — see docs/server-setup.md § Verify.'
  )
}

process.exit(failed > 0 ? 1 : 0)
