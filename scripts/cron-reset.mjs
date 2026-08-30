// Triggers the annual loyalty reset the way a scheduler would.
//
//   npm run cron:reset
//
// The job itself decides whether anything is due — this only knocks on the
// door. See docs/scheduled-jobs.md for the Hostinger cron that should be doing
// this every day, and why the Vercel one stopped.

import { readFileSync, existsSync } from 'node:fs'

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (key in process.env) continue
    process.env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('CRON_SECRET is not set. The route refuses without it, by design.')
  process.exit(1)
}

const base = (process.env.ADMIN_URL ?? 'http://localhost:3001').replace(/\/+$/, '')
const url = `${base}/api/admin/loyalty/reset`

// GET, not POST. POST on this route is the "an admin runs it by hand" path
// and requires a signed-in admin; the scheduled path is GET with the secret.
// Getting that wrong returns 401 "Not signed in", which reads like a bad
// secret and is not.
console.log(`GET ${url}`)
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${secret}` },
})

const body = await res.json().catch(() => null)
console.log(`→ ${res.status}`)
if (body) console.log(JSON.stringify(body, null, 2))

// Non-zero on failure so a scheduler that checks exit codes actually notices.
// A cron reporting success while the job refused is the failure this whole
// file exists because of.
process.exit(res.ok ? 0 : 1)
