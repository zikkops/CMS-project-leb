// Checks .env.local before you waste time on a confusing runtime failure.
//
// The mistake this exists for: the client config and the service account are
// copied from two different pages of the Firebase console, so it is genuinely
// easy to end up with the browser talking to one project and the server
// talking to another. Nothing errors. Reads come back empty, writes seem to
// succeed, and you lose an afternoon before noticing.
//
// The other mistake it catches is worse: pointing this demo at the live café's
// project. The service account bypasses every security rule.
//
//   node --env-file=.env.local scripts/check-env.mjs
//   npm run check:env
//
// Exits non-zero on any error. Warnings don't fail.

const errors = []
const warnings = []
const notes = []

const need = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'FIREBASE_SERVICE_ACCOUNT',
]

for (const key of need) {
  if (!process.env[key]) errors.push(`${key} is not set.`)
}

// THE PASTE-FROM-CONSOLE TRAP.
//
// Firebase's console shows the config as a JavaScript object:
//
//   const firebaseConfig = {
//     projectId: "my-project-abc12",
//   };
//
// Copying a value out of that keeps the quotes and the trailing comma, and a
// .env file is not JavaScript. dotenv strips quotes only when the value is
// FULLY quoted — a trailing comma breaks that, so the variable ends up as the
// literal `"my-project-abc12",` including punctuation.
//
// Nothing errors. The app builds, static pages render, and every Firestore
// call fails against a project id that doesn't exist. Worth an explicit check
// because the symptom points nowhere near the cause.
for (const key of need) {
  const v = process.env[key]
  if (!v) continue
  if (/^["']/.test(v) || /["'],?$/.test(v) || /,$/.test(v)) {
    errors.push(
      `${key} has quotes or a trailing comma: ${v.slice(0, 40)}\n` +
      `      You pasted it from the console's JavaScript object. Values in a\n` +
      `      .env file are bare — no quotes, no commas. Fix all of them with:\n` +
      `        (Get-Content .env.local) -replace '="(.*)",?\\s*$', '=$1' | Set-Content .env.local`
    )
  }
}

const clientProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? ''
let saProject = ''

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  let sa
  try {
    const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    sa = JSON.parse(json)
  } catch {
    errors.push(
      'FIREBASE_SERVICE_ACCOUNT could not be parsed. It must be the whole ' +
      'service-account JSON, base64-encoded (recommended) or pasted raw.'
    )
  }

  if (sa) {
    saProject = sa.project_id ?? ''
    if (!sa.project_id || !sa.client_email || !sa.private_key) {
      errors.push('FIREBASE_SERVICE_ACCOUNT parsed but is missing project_id, client_email or private_key.')
    }
    // Catches the raw-paste newline mangling before it becomes an opaque
    // "Invalid PEM formatted message" at the first Admin SDK call.
    if (sa.private_key && !String(sa.private_key).includes('BEGIN')) {
      errors.push('The service account private_key looks malformed — no BEGIN header. Re-copy and base64 the whole JSON file.')
    }
  }
}

// THE MISMATCH CHECK — the reason this script exists.
if (clientProject && saProject && clientProject !== saProject) {
  errors.push(
    `PROJECT MISMATCH.\n` +
    `      Browser talks to : ${clientProject}\n` +
    `      Server talks to  : ${saProject}\n` +
    `      Reads and writes would go to different databases. Fix one of them.`
  )
}

// Demo-safety checks. Warnings, not errors — a real tenant deployment legitimately
// trips all of these, and this script shouldn't block that.
const DEMO_HINTS = ['dev', 'demo', 'test', 'staging', 'sandbox', 'local']
const project = clientProject || saProject
if (project && !DEMO_HINTS.some(h => project.toLowerCase().includes(h))) {
  warnings.push(
    `Project "${project}" doesn't look like a demo (no ${DEMO_HINTS.join('/')} in the name).\n` +
    `      If this is the live café's project, stop — the service account here\n` +
    `      bypasses every security rule. If it's a demo, rename it or expect\n` +
    `      seed:demo to refuse to run.`
  )
}

if (process.env.RESEND_API_KEY) {
  warnings.push(
    'RESEND_API_KEY is set. The code cannot tell it is a demo, so testing any\n' +
    '      email flow will send to real addresses. Blank it unless you mean it.'
  )
}

if (process.env.NEXT_PUBLIC_BRAND_NAME) {
  notes.push(
    `Brand is set to "${process.env.NEXT_PUBLIC_BRAND_NAME}" — the demo banner is\n` +
    '      OFF and search indexing is ON. Correct for a real tenant, not for a demo.'
  )
} else {
  notes.push('Placeholder branding — demo banner shown, indexing blocked. Correct for a demo.')
}

if (!process.env.IMGBB_API_KEY) {
  notes.push('No imgbb key — image uploads will fail with a clear error. Nothing else affected.')
}

// The near-miss that costs an afternoon: the key is present, under a name
// nothing reads. Anything NEXT_PUBLIC_ is inlined into the client bundle, so
// this spelling is both broken AND the one that would publish the key if some
// client file ever referenced it.
if (!process.env.IMGBB_API_KEY && process.env.NEXT_PUBLIC_IMGBB_API_KEY) {
  errors.push(
    'NEXT_PUBLIC_IMGBB_API_KEY is set but IMGBB_API_KEY is not. Nothing reads the\n' +
    '           NEXT_PUBLIC_ one, so uploads fail — and that prefix is what would put the\n' +
    '           key in every visitor\'s JS bundle. Drop the prefix.'
  )
}

// ── The hostnames ──────────────────────────────────────────────────────────
// All four unset is a working single-domain deployment, so none of this is an
// error. What IS worth saying out loud is which half is configured, because
// the two pairs fail in opposite directions: the HOST pair without the URL
// pair is a split nobody can navigate to, and the URL pair without the HOST
// pair is a link to a hostname that is not serving anything different.
const hostAdmin = (process.env.ADMIN_HOST ?? '').trim()
const hostPos = (process.env.POS_HOST ?? '').trim()
const urlAdmin = (process.env.NEXT_PUBLIC_ADMIN_URL ?? '').trim()
const urlPos = (process.env.NEXT_PUBLIC_POS_URL ?? '').trim()

if (!hostAdmin && !hostPos && !urlAdmin && !urlPos) {
  notes.push('No hostname split — every path served on every host. Correct for one domain.')
} else {
  if (hostAdmin) notes.push(`/admin is served only on ${hostAdmin}; elsewhere it 404s.`)
  if (hostPos) notes.push(`/pos is served only on ${hostPos}; elsewhere it 404s.`)

  if (urlAdmin && !hostAdmin) {
    warnings.push(
      'NEXT_PUBLIC_ADMIN_URL is set but ADMIN_HOST is not. The customer site links to\n' +
      '           that hostname, but nothing stops /admin being served on every host too.'
    )
  }
  if (hostAdmin && !urlAdmin) {
    notes.push('No admin link on the customer site — staff type the URL. Deliberate if you want it undiscoverable.')
  }
  if (urlPos) {
    notes.push('NEXT_PUBLIC_POS_URL is set, but nothing imports posUrl() yet — it links from nowhere.')
  }
  if (urlAdmin || urlPos) {
    notes.push('NEXT_PUBLIC_ values are inlined at build time — rebuild after changing them.')
  }
}

const branches = (process.env.NEXT_PUBLIC_BRANCHES ?? '').split(',').map(s => s.trim()).filter(Boolean)
if (branches.length > 0) notes.push(`Branches: ${branches.join(', ')}`)

// ── Report ─────────────────────────────────────────────────────────────────
console.log('')
for (const e of errors)   console.log(`  ERROR    ${e}`)
for (const w of warnings) console.log(`  WARN     ${w}`)
for (const n of notes)    console.log(`  ok       ${n}`)

console.log('')
if (errors.length > 0) {
  console.log(`${errors.length} error(s). Fix these before running anything else.`)
  process.exit(1)
}
console.log(
  warnings.length > 0
    ? `No blocking errors, ${warnings.length} warning(s) — read them.`
    : 'Environment looks good.'
)
process.exit(0)
