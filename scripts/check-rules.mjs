// Compares the LIVE Firestore ruleset with firestore.rules in this repo.
//
//   node --env-file=.env.local scripts/check-rules.mjs
//   node --env-file=.env.local scripts/check-rules.mjs --strict   # exit 1 on drift
//   npm run rules:live
//
// ── Why this exists ────────────────────────────────────────────────────────
// CLAUDE.md tells the reader twice to "check the live ruleset before the
// code", and until now there was no way to do that without opening the
// console and reading by eye. The repo has been bitten by exactly this: for
// weeks the live rules were a revision behind the file, and the symptom was
// not an error — it was a settings page that read as "every printer is off".
// A rule that is written but not deployed looks identical to a rule that is
// wrong, from the application's side.
//
// This only READS. It fetches the deployed ruleset through the Firebase Rules
// API with the service account already used by the server layer, and prints
// what differs. It cannot deploy anything — deploying stays a deliberate
// `firebase deploy --only firestore:rules`, because a rules deploy has no
// gradual rollout.
//
// Drift is not automatically a fault: between editing the file and deploying
// it, drift is the correct state. So this exits 0 and reports, unless you ask
// for --strict (for CI, where "the file and the world agree" is the point).

import { initializeApp, cert } from 'firebase-admin/app'
import { readFileSync } from 'node:fs'

const STRICT = process.argv.includes('--strict')

const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. See docs/server-setup.md.')
  console.error('Did you forget --env-file=.env.local ?')
  process.exit(1)
}

let account
try {
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  account = JSON.parse(json)
} catch {
  console.error('FIREBASE_SERVICE_ACCOUNT could not be parsed. Run `npm run check:env`.')
  process.exit(1)
}

const projectId = account.project_id
if (!projectId) {
  console.error('The service account JSON has no project_id.')
  process.exit(1)
}

// The credential is only ever used to mint a read token. Nothing from the
// service account is printed — the project id is, because which project is
// being read is the first thing to check (see the isolation rules in FORK.md).
const credential = cert({
  projectId,
  clientEmail: account.client_email,
  privateKey: String(account.private_key ?? '').replace(/\\n/g, '\n'),
})
initializeApp({ credential })

const { access_token: token } = await credential.getAccessToken()

async function api(path) {
  const res = await fetch(`https://firebaserules.googleapis.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Rules API ${res.status} on ${path}${body ? ` — ${body.slice(0, 200)}` : ''}`)
  }
  return res.json()
}

// Collections a ruleset governs, by their match blocks. Compared as sets
// because "which collections are covered" is the question asked in practice —
// a collection with no rule at all is denied, which reads to the app exactly
// like a permissions bug.
function collectionsIn(source) {
  return new Set(
    [...source.matchAll(/match\s+\/([A-Za-z0-9_]+)\/\{/g)].map(m => m[1]),
  )
}

const release = await api(`projects/${projectId}/releases/cloud.firestore`)
const ruleset = await api(release.rulesetName)
const liveFile = (ruleset.source?.files ?? []).find(f => /firestore/i.test(f.name ?? '')) ?? ruleset.source?.files?.[0]
const live = String(liveFile?.content ?? '')

// CRLF on Windows would otherwise make every line differ.
const norm = s => s.replace(/\r\n/g, '\n').trimEnd()
const local = norm(readFileSync('firestore.rules', 'utf8'))
const liveNorm = norm(live)

// The RULESET's createTime, not the release's. A release is created once and
// updated on every deploy, so release.createTime is the day rules were first
// ever published — which reads as "deployed 28 Aug" forever, and is exactly
// the wrong answer for somebody asking whether today's rule is live.
const stamp = t => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'unknown')
const when = stamp(ruleset.createTime)
const released = stamp(release.updateTime ?? release.createTime)

console.log(`\nProject      ${projectId}`)
console.log(`Live ruleset ${String(ruleset.name ?? '').split('/').pop()}`)
console.log(`Deployed     ${when}`)
console.log(`Released     ${released}`)
console.log(`Lines        live ${liveNorm.split('\n').length} · file ${local.split('\n').length}`)

if (liveNorm === local) {
  console.log('\nIDENTICAL — what is deployed is what is in firestore.rules.\n')
  process.exit(0)
}

const liveCols = collectionsIn(liveNorm)
const localCols = collectionsIn(local)
const onlyLocal = [...localCols].filter(c => !liveCols.has(c)).sort()
const onlyLive = [...liveCols].filter(c => !localCols.has(c)).sort()

console.log('\nDRIFT — the deployed rules are not the file in this repo.\n')

if (onlyLocal.length) {
  console.log('  In the file but NOT deployed (these collections are denied to everyone):')
  for (const c of onlyLocal) console.log(`    - ${c}`)
  console.log('    Deploy with: firebase deploy --only firestore:rules')
}
if (onlyLive.length) {
  console.log('  Deployed but NOT in the file (someone edited the console, or the file moved on):')
  for (const c of onlyLive) console.log(`    - ${c}`)
}
if (!onlyLocal.length && !onlyLive.length) {
  console.log('  The same collections are covered on both sides — the difference is inside the')
  console.log('  rules themselves (a condition, a helper, or a comment). Diff them to be sure:')
  const liveLines = liveNorm.split('\n')
  const localLines = local.split('\n')
  let shown = 0
  for (let i = 0; i < Math.max(liveLines.length, localLines.length) && shown < 6; i++) {
    if (liveLines[i] !== localLines[i]) {
      console.log(`    line ${i + 1}`)
      console.log(`      live: ${(liveLines[i] ?? '(absent)').trim().slice(0, 90)}`)
      console.log(`      file: ${(localLines[i] ?? '(absent)').trim().slice(0, 90)}`)
      shown++
    }
  }
}

console.log('')
process.exit(STRICT ? 1 : 0)
