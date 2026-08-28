// Repairs .env.local in place, and optionally installs the service account.
//
// ── Why this exists ───────────────────────────────────────────────────────
// Firebase's console shows the client config as a JavaScript object:
//
//   const firebaseConfig = {
//     projectId: "my-project-abc12",
//   };
//
// Copying values out of it keeps the quotes and the trailing comma — and a
// .env file is not JavaScript. dotenv only strips quotes when a value is
// FULLY quoted, so a trailing comma defeats it and the variable ends up as the
// literal `"my-project-abc12",`, punctuation included.
//
// Nothing errors. The app builds, static pages render, and every Firestore
// call quietly fails against a project that doesn't exist. It is a genuinely
// horrible half hour, and it happens to almost everyone once.
//
// ── Usage ─────────────────────────────────────────────────────────────────
//   node scripts/fix-env.mjs                    # preview, writes nothing
//   node scripts/fix-env.mjs --apply
//   node scripts/fix-env.mjs --apply --service-account "C:\\path\\to\\key.json"
//   node scripts/fix-env.mjs --apply --allow-seed
//
// The service-account JSON is read and base64-encoded ON THIS MACHINE and
// written straight into .env.local. The private key is never printed, never
// echoed, and never leaves the machine.
//
// A timestamped backup is written before any change.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'

const APPLY = process.argv.includes('--apply')
const ALLOW_SEED = process.argv.includes('--allow-seed')

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : null
}
const saPath = argValue('--service-account')

const ENV = '.env.local'
if (!existsSync(ENV)) {
  console.error(`No ${ENV} in ${process.cwd()}. Copy docs/env-local.template.txt first.`)
  process.exit(1)
}

const original = readFileSync(ENV, 'utf8')
let lines = original.split(/\r?\n/)
const changes = []

// ── 1. Strip quotes and trailing commas ───────────────────────────────────
lines = lines.map(line => {
  if (!line.trim() || line.trimStart().startsWith('#') || !line.includes('=')) return line
  const eq = line.indexOf('=')
  const key = line.slice(0, eq)
  let value = line.slice(eq + 1).trim()
  const before = value

  value = value.replace(/,\s*$/, '')                 // trailing comma
  value = value.replace(/^(['"])([\s\S]*)\1$/, '$2') // matched wrapping quotes

  if (value !== before) changes.push(`${key.trim()}: removed quotes/comma`)
  return `${key}=${value}`
})

// ── 2. Service account ────────────────────────────────────────────────────
function upsert(key, value, note) {
  const i = lines.findIndex(l => l.startsWith(`${key}=`))
  if (i !== -1) {
    if (lines[i] === `${key}=${value}`) return
    lines[i] = `${key}=${value}`
    changes.push(`${key}: replaced (${note})`)
  } else {
    lines.push(`${key}=${value}`)
    changes.push(`${key}: added (${note})`)
  }
}

let saProject = null
if (saPath) {
  if (!existsSync(saPath)) {
    console.error(`Service account file not found:\n  ${saPath}`)
    process.exit(1)
  }
  const rawJson = readFileSync(saPath)
  let parsed
  try {
    parsed = JSON.parse(rawJson.toString('utf8'))
  } catch {
    console.error('That file is not valid JSON. Re-download the key from the Firebase console.')
    process.exit(1)
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    console.error('That JSON is missing project_id / client_email / private_key.')
    process.exit(1)
  }
  saProject = parsed.project_id
  // Base64 of the whole file — the multi-line PEM survives intact, which is
  // the entire reason for encoding rather than pasting raw.
  upsert('FIREBASE_SERVICE_ACCOUNT', rawJson.toString('base64'), `${saProject}, base64`)
}

// ── 3. Seed authorisation ─────────────────────────────────────────────────
const projectLine = lines.find(l => l.startsWith('NEXT_PUBLIC_FIREBASE_PROJECT_ID='))
const clientProject = projectLine ? projectLine.split('=')[1].trim() : ''

if (ALLOW_SEED) {
  if (!clientProject) {
    console.error('Cannot set SEED_ALLOW_PROJECT — NEXT_PUBLIC_FIREBASE_PROJECT_ID is empty.')
    process.exit(1)
  }
  upsert('SEED_ALLOW_PROJECT', clientProject, 'names this exact project')
}

// ── 4. Report, and refuse to write a broken pairing ───────────────────────
console.log(`\n${ENV} — ${changes.length} change(s)\n`)
for (const c of changes) console.log(`  ${c}`)
if (changes.length === 0) console.log('  (nothing to fix)')

if (clientProject) console.log(`\n  client config project : ${clientProject}`)
if (saProject) console.log(`  service account project: ${saProject}`)

// The mismatch that costs an afternoon: browser talking to one project, server
// to another. Nothing errors — reads come back empty, writes appear to work.
if (clientProject && saProject && clientProject !== saProject) {
  console.error(
    `\nPROJECT MISMATCH — refusing to write.\n` +
    `  The client config points at "${clientProject}" but the service account\n` +
    `  belongs to "${saProject}". The browser and the server would be talking to\n` +
    `  different databases, and nothing would error. Fix one of them first.\n`
  )
  process.exit(1)
}

if (!APPLY) {
  console.log('\nPreview only — nothing written. Re-run with --apply.')
  process.exit(0)
}

if (changes.length > 0) {
  const backup = `${ENV}.backup-${Date.now()}`
  copyFileSync(ENV, backup)
  writeFileSync(ENV, lines.join('\n'))
  console.log(`\nWritten. Backup: ${backup}`)
  console.log('Now run:  npm run check:env')
} else {
  console.log('\nNothing to write.')
}
