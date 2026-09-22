// Seeds a café's staff and the shifts they worked, so the people side of the
// admin panel has something real to show.
//
//   node --env-file=.env.local scripts/seed-staff.mjs            # dry run
//   node --env-file=.env.local scripts/seed-staff.mjs --apply
//   node --env-file=.env.local scripts/seed-staff.mjs --apply --weeks=12
//   node --env-file=.env.local scripts/seed-staff.mjs --apply --clear
//
// The demo had two staff accounts, no first names, no pay rates and not one
// clock-in ever recorded. So Staff Accounts was almost empty, Staff Pay listed
// nobody, the Timesheet was blank, the Labour report had no hours to cost and
// the tips split had nobody to split between — five screens that look broken
// and are only unused.
//
// This writes a roster across the branches, what each is paid, and eight weeks
// of shifts:
//
//   users/{uid}           the staff account, as the Staff Accounts page makes it
//   staffProfiles/{uid}   the first name (server-only, S18)
//   staffPay/{uid}        hourly rate and tip weight, WITH history
//   timeEntries           a clock-in and a clock-out per shift
//   endOfDayReports       attendance filled in, so the tips split has names
//
// ── It writes what the application writes ─────────────────────────────────
// An account is created exactly as `/api/admin/accounts` creates one —
// createUser, then the Firestore document, then syncClaims — including the
// rollback: if the Firestore write fails, the Auth user is deleted. Without
// that a failed run leaves an account that can sign in, has no profile, and
// has taken the email address so the run cannot simply be repeated.
//
// The pay history goes through readPayEntry(), the application's own
// validator, so a rate this writes is a rate the Staff Pay form would accept.
//
// A time entry carries the fields a café hub writes (uid, name, branch,
// direction, at). `name` is the first name, which is what a hub has: the pull
// adds firstName to the staff record it copies down, which is why the hub's
// clock can read it off users/{uid} when the cloud's copy has no such field.
//
// ── Passwords ─────────────────────────────────────────────────────────────
// One is generated per account and written to a gitignored file, never
// printed, exactly as seed-demo.mjs does it. A password on a terminal ends up
// in scrollback, screenshots and shell history, none of which anyone
// remembers to clear.
//
// ── Safety ────────────────────────────────────────────────────────────────
// Refuses a project that does not look like a demo, as the other seeds do.
// Everything it writes carries `seeded: true`; `--clear` removes exactly that
// and nothing else, and it will not touch a staff account it did not create.
//
// Re-running is boring: accounts are matched by email and shifts have
// deterministic ids, so a second run adds only what is missing.

import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const APPLY = process.argv.includes('--apply')
const CLEAR = process.argv.includes('--clear')
const FORCE = process.argv.includes('--force')
// Six by default, not eight: the seeded POS history is about a month, and
// hours on days with no sales leave the labour percentage blank, which reads
// as a broken report rather than a café that was shut.
const WEEKS = Number((process.argv.find(a => a.startsWith('--weeks=')) ?? '').split('=')[1]) || 6

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('No FIREBASE_SERVICE_ACCOUNT. Did you forget --env-file=.env.local ?')
  process.exit(1)
}

const { adminDb, adminAuth } = await jiti.import('../shared/src/server/firebaseAdmin.ts')
const { BRAND } = await jiti.import('../shared/src/brand.ts')
const { syncClaims } = await jiti.import('../shared/src/server/claims.ts')
const { readPayEntry } = await jiti.import('../shared/src/staffPay.ts')
const { Timestamp, FieldValue } = await import('firebase-admin/firestore')

const db = adminDb()
const auth = adminAuth()

const projectId = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT.trim().startsWith('{')
    ? process.env.FIREBASE_SERVICE_ACCOUNT
    : Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8'),
).project_id

const DEMO_HINTS = ['dev', 'demo', 'test', 'staging', 'sandbox', 'local']
const looksLikeDemo = DEMO_HINTS.some(h => projectId.toLowerCase().includes(h))
if (!looksLikeDemo && process.env.SEED_ALLOW_PROJECT !== projectId && !FORCE) {
  console.error(
    `\nREFUSING TO RUN.\n\nThe project id "${projectId}" does not look like a demo, and\n` +
    `SEED_ALLOW_PROJECT does not name it. This CREATES SIGN-IN ACCOUNTS with a\n` +
    `credential that bypasses every rule.\n\n` +
    `If this really is a demo project, add to .env.local:\n    SEED_ALLOW_PROJECT=${projectId}\n`,
  )
  process.exit(1)
}
console.log(`Project: ${projectId}${APPLY ? '' : '   (dry run — nothing is written)'}`)

const BRANCHES = [...BRAND.branches]
const ACTOR_UID = 'seed-staff'
// .test is reserved by the IETF and can never be delivered to, so no seeded
// account can ever be mailed by accident.
const DOMAIN = 'placeholder.test'

const dayMs = 86_400_000
const ymd = d => new Date(d).toISOString().slice(0, 10)
/** A stamp on a café day at a wall-clock time, in the café's own zone. */
const at = (day, hour, minute) =>
  Timestamp.fromDate(new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`))

// Deterministic, so a run resumed after a failure writes the same documents.
let seed = 20260923
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const jitter = n => Math.round((rnd() * 2 - 1) * n)

// ── The roster ────────────────────────────────────────────────────────────
// A small café's shape: a manager, two baristas and a kitchen hand per branch,
// plus somebody on retail at the main one. Rates are a mix of USD and LBP on
// purpose — the labour report costs both and converts at the business rate,
// and a demo where everybody is paid in dollars never exercises that.
//
// `rota` is which shift they work; `off` is their days off, as weekday numbers
// (0 = Sunday), so two people at one branch are never both away on the same
// day and the branch is always covered.
const SHIFTS = {
  opening: { label: 'Opening', in: [6, 50], out: [15, 5] },
  closing: { label: 'Closing', in: [14, 45], out: [23, 15] },
  kitchen: { label: 'Kitchen', in: [8, 50], out: [17, 10] },
  day: { label: 'Day', in: [9, 0], out: [18, 0] },
  short: { label: 'Middle', in: [10, 0], out: [16, 0] },
}

const ROSTER = [
  // Main
  { key: 'rana', first: 'Rana', last: 'Haddad', branch: 'Main', role: 'manager', rota: 'day', off: [0, 1], rate: 8, currency: 'USD', weight: 1 },
  { key: 'sam', first: 'Sam', last: 'Khoury', branch: 'Main', role: 'barista', rota: 'opening', off: [2, 3], rate: 5, currency: 'USD', weight: 1.25 },
  { key: 'nour', first: 'Nour', last: 'Aoun', branch: 'Main', role: 'barista', rota: 'closing', off: [0, 4], rate: 4.25, currency: 'USD', weight: 1 },
  { key: 'jad', first: 'Jad', last: 'Saliba', branch: 'Main', role: 'kitchen_crew', rota: 'kitchen', off: [1, 2], rate: 400_000, currency: 'LBP', weight: 1 },
  { key: 'maya', first: 'Maya', last: 'Fares', branch: 'Main', role: 'retail', rota: 'short', off: [0, 1, 2], rate: 4.75, currency: 'USD', weight: 1 },
  // Second
  { key: 'karim', first: 'Karim', last: 'Nassar', branch: 'Second', role: 'manager', rota: 'day', off: [0, 3], rate: 7.5, currency: 'USD', weight: 1 },
  { key: 'lea', first: 'Lea', last: 'Ghanem', branch: 'Second', role: 'barista', rota: 'opening', off: [1, 5], rate: 4.5, currency: 'USD', weight: 1 },
  { key: 'tarek', first: 'Tarek', last: 'Zeidan', branch: 'Second', role: 'barista', rota: 'closing', off: [2, 6], rate: 3.5, currency: 'USD', weight: 0.5 },
  { key: 'hiba', first: 'Hiba', last: 'Chami', branch: 'Second', role: 'kitchen_crew', rota: 'kitchen', off: [0, 4], rate: 380_000, currency: 'LBP', weight: 1 },
  // Third
  { key: 'ziad', first: 'Ziad', last: 'Matar', branch: 'Third', role: 'manager', rota: 'day', off: [1, 2], rate: 7.5, currency: 'USD', weight: 1 },
  { key: 'yara', first: 'Yara', last: 'Rizk', branch: 'Third', role: 'barista', rota: 'opening', off: [0, 5], rate: 4.75, currency: 'USD', weight: 1.25 },
  { key: 'omar', first: 'Omar', last: 'Deeb', branch: 'Third', role: 'barista', rota: 'closing', off: [3, 6], rate: 4.25, currency: 'USD', weight: 1 },
  { key: 'dana', first: 'Dana', last: 'Sleiman', branch: 'Third', role: 'kitchen_crew', rota: 'kitchen', off: [2, 5], rate: 380_000, currency: 'LBP', weight: 1 },
].filter(p => BRANCHES.includes(p.branch))

const emailOf = p => `${p.key}.${p.last.toLowerCase()}@${DOMAIN}`

// A rise partway through the span for two people, so the history is not a
// single row. The point of keeping history is that last month's labour cost is
// worked out at last month's rate; with one entry each, nothing shows that.
const RISES = { sam: 5.5, lea: 5 }

// ── Clear ─────────────────────────────────────────────────────────────────
if (CLEAR) {
  let entries = 0, accounts = 0, attendance = 0
  const clock = await db.collection('timeEntries').where('seeded', '==', true).get()
  for (const doc of clock.docs) {
    if (APPLY) await doc.ref.delete()
    entries++
  }
  const eod = await db.collection('endOfDayReports').where('attendanceSeeded', '==', true).get()
  for (const doc of eod.docs) {
    if (APPLY) await doc.ref.update({ attendance: [], attendanceSeeded: FieldValue.delete() })
    attendance++
  }
  // Only accounts this seed created: `seeded: true` AND the seeded domain.
  // Never anything an admin made by hand, whatever else it looks like.
  const staff = await db.collection('users').where('seeded', '==', true).get()
  for (const doc of staff.docs) {
    const email = String(doc.data().email ?? '')
    if (!email.endsWith(`@${DOMAIN}`) || doc.data().isStaff !== true) continue
    console.log(`  remove ${email}`)
    if (APPLY) {
      await db.doc(`staffPay/${doc.id}`).delete().catch(() => {})
      await db.doc(`staffProfiles/${doc.id}`).delete().catch(() => {})
      await doc.ref.delete()
      await auth.deleteUser(doc.id).catch(err => {
        console.error(`  ! the sign-in account for ${email} (${doc.id}) was not removed:`, err.message)
      })
    }
    accounts++
  }
  console.log(`\n${APPLY ? 'Removed' : 'Would remove'} ${accounts} staff accounts and ${entries} clock entries, and emptied attendance on ${attendance} end-of-day reports.`)
  process.exit(0)
}

// ── The accounts ──────────────────────────────────────────────────────────
const today = new Date(`${ymd(Date.now())}T12:00:00Z`).getTime()
const firstDay = ymd(today - (WEEKS * 7 - 1) * dayMs)
const lastDay = ymd(today)
console.log(`Roster of ${ROSTER.length} across ${BRANCHES.length} branches, ${firstDay} to ${lastDay}.\n`)

const passwords = []
const people = []

for (const p of ROSTER) {
  const email = emailOf(p)
  const existing = await auth.getUserByEmail(email).catch(() => null)
  if (existing) {
    console.log(`  account ${email} already there — left alone`)
    people.push({ ...p, uid: existing.uid, email, made: false })
    continue
  }
  console.log(`  account ${email} · ${p.role} · ${p.branch}`)
  if (!APPLY) { people.push({ ...p, uid: `dry-${p.key}`, email, made: true }); continue }

  const password = randomBytes(12).toString('base64url')
  const user = await auth.createUser({ email, password, displayName: `${p.first} ${p.last}` })
  const uid = user.uid
  // From here the Auth user exists, so every failure path must clean it up —
  // the same rollback /api/admin/accounts does, for the same reason: a half
  // made account has taken the email and cannot simply be made again.
  try {
    await db.doc(`users/${uid}`).set({
      email,
      isStaff: true,
      role: p.role,
      branchIds: [p.branch],
      pointsEarned: 0,
      points: 0,
      seeded: true,
      createdAt: Timestamp.fromMillis(new Date(`${firstDay}T09:00:00+03:00`).getTime()),
    })
    await syncClaims(uid)
    // Server-only, never on users/{uid}, which its owner may edit (S18).
    await db.doc(`staffProfiles/${uid}`).set({
      firstName: p.first, updatedAt: FieldValue.serverTimestamp(), updatedBy: ACTOR_UID, seeded: true,
    })
  } catch (err) {
    await auth.deleteUser(uid).catch(cleanupErr => {
      console.error(`  ! rollback failed for orphaned auth user ${uid}:`, cleanupErr.message)
    })
    throw err
  }
  passwords.push({ email, password, who: `${p.first} ${p.last}`, role: p.role, branch: p.branch })
  people.push({ ...p, uid, email, made: true })
}

// ── What each is paid ─────────────────────────────────────────────────────
// Through readPayEntry(), the Staff Pay form's own validator, so nothing here
// can store a rate the form would refuse.
let payRows = 0
for (const p of people) {
  const raise = RISES[p.key]
  const entries = [{ from: firstDay, hourlyRate: p.rate, currency: p.currency, tipWeight: p.weight }]
  if (raise) entries.push({ from: ymd(today - (WEEKS * 7 - 22) * dayMs), hourlyRate: raise, currency: p.currency, tipWeight: p.weight })

  const history = entries.map(e => {
    const clean = readPayEntry(e)
    if (typeof clean === 'string') {
      console.error(`REFUSED for ${p.first}: ${clean}`)
      process.exit(1)
    }
    return { ...clean, setBy: ACTOR_UID, setAt: new Date(`${clean.from}T09:00:00+03:00`).toISOString() }
  })
  const label = history.map(h => `${h.currency === 'LBP' ? `${h.hourlyRate.toLocaleString('en-US')} LBP` : `$${h.hourlyRate}`} from ${h.from}`).join(', then ')
  console.log(`  pay    ${p.first.padEnd(6)} ${label} · tip weight ${p.weight}`)
  if (APPLY) await db.doc(`staffPay/${p.uid}`).set({ history, seeded: true, updatedAt: FieldValue.serverTimestamp() })
  payRows++
}

// ── The shifts ────────────────────────────────────────────────────────────
// Three deliberate exceptions, each of which is a thing the Labour report has
// a panel for and nothing to put in it:
//   · two shifts with no clock-out, on old days — somebody forgot
//   · one clocked out the next evening, which is longer than the report will
//     trust and is listed rather than costed
// They are chosen by position in the run so they are the same every time.
const NO_CLOCK_OUT = new Set(['sam|12', 'hiba|27'])
const TOO_LONG = new Set(['omar|19'])

const shiftDays = []
for (let i = 0; i < WEEKS * 7; i++) shiftDays.push(ymd(today - (WEEKS * 7 - 1 - i) * dayMs))

const attendanceBy = new Map() // `${branch}|${day}` -> [{ name, shift }]
let wrote = 0, already = 0, open = 0, long = 0

for (const p of people) {
  const shift = SHIFTS[p.rota]
  let worked = 0
  for (const day of shiftDays) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
    if (p.off.includes(weekday)) continue
    worked++

    const key = `${p.key}|${worked}`
    const inAt = at(day, shift.in[0], Math.max(0, shift.in[1] + jitter(8)))
    const id = `seed-clock-${p.key}-${day}`

    const row = { uid: p.uid, name: p.first, branch: p.branch, direction: 'in', at: inAt, via: 'seed', seeded: true }
    if (APPLY) {
      const ref = db.doc(`timeEntries/${id}-in`)
      if ((await ref.get()).exists) { already++ } else { await ref.set(row); wrote++ }
    } else { wrote++ }

    // The attendance line the tips split matches names against.
    const k = `${p.branch}|${day}`
    attendanceBy.set(k, [...(attendanceBy.get(k) ?? []), { name: p.first, shift: shift.label }])

    if (NO_CLOCK_OUT.has(key)) { open++; continue }

    const tooLong = TOO_LONG.has(key)
    const outDay = tooLong ? ymd(new Date(`${day}T12:00:00Z`).getTime() + dayMs) : day
    const outAt = at(outDay, tooLong ? 19 : shift.out[0], Math.max(0, shift.out[1] + jitter(12)))
    if (tooLong) long++

    const outRow = { uid: p.uid, name: p.first, branch: p.branch, direction: 'out', at: outAt, via: 'seed', seeded: true }
    if (APPLY) {
      const ref = db.doc(`timeEntries/${id}-out`)
      if ((await ref.get()).exists) { already++ } else { await ref.set(outRow); wrote++ }
    } else { wrote++ }
  }
  console.log(`  shifts ${p.first.padEnd(6)} ${worked} over ${WEEKS} weeks · ${shift.label} at ${p.branch}`)
}

// ── Attendance on the end-of-day reports ──────────────────────────────────
// The tips split reads these names, not the clock: End of Day is where tips
// are recorded and who shared them is recorded beside them. Without this the
// seeded tips have nobody to go to and the Tips Calculator is empty.
// Only a report that is seeded and has nobody on it yet is touched, and the
// marker is what --clear looks for.
let filled = 0
const eodSnap = await db.collection('endOfDayReports').get()
for (const doc of eodSnap.docs) {
  const d = doc.data()
  const existing = Array.isArray(d.attendance) ? d.attendance : []
  if (existing.length > 0) continue
  const names = attendanceBy.get(`${String(d.branch)}|${String(d.date)}`)
  if (!names || names.length === 0) continue
  console.log(`  attendance ${d.branch} ${d.date}: ${names.map(n => n.name).join(', ')}`)
  if (APPLY) await doc.ref.update({ attendance: names, attendanceSeeded: true })
  filled++
}

// ── The passwords ─────────────────────────────────────────────────────────
if (APPLY && passwords.length > 0) {
  writeFileSync(
    'demo-staff.txt',
    'Seeded staff accounts for the demo café.\n\n' +
    passwords.map(p => `  ${p.who} — ${p.role} at ${p.branch}\n    email     ${p.email}\n    password  ${p.password}\n`).join('\n') +
    '\nThese are real sign-in accounts on the demo project. They are not real people\n' +
    'and the .test domain can never receive mail.\n\n' +
    'This file is gitignored. Delete it once the passwords are somewhere sensible.\n',
  )
}

// Hours the sales cannot be divided into are not wrong, but they are worth
// saying out loud: labour % is blank on those days, and a blank in a report is
// what people mistake for a bug.
const newest = await db.collection('checks').orderBy('closedAt', 'desc').limit(1).get()
const lastSale = newest.empty || !newest.docs[0].data().closedAt ? null : ymd(newest.docs[0].data().closedAt.toMillis())

console.log(
  `\n${APPLY ? 'Wrote' : 'Would write'}: ${people.filter(p => p.made).length} staff accounts, ${payRows} pay records, ` +
  `${wrote} clock entries, attendance on ${filled} end-of-day reports.`,
)
if (lastSale && lastSale < lastDay) {
  console.log(`The seeded sales stop at ${lastSale}; hours after that have nothing to divide into, so labour % is blank for those days.`)
}
console.log(
  '\nNOTE: the Labour report will read a labour percentage far above anything real.\n' +
  'That is the sales seed, not this one: seed:pos writes a very quiet café — about\n' +
  '$93 a day a branch, four checks a day — and no roster that looks like employment\n' +
  'divides into that. The hours, rates and costs here are right; the denominator is\n' +
  'small. Seed a busier sales history for the ratio to look like a real café.',
)
if (already > 0) console.log(`${already} clock entries were already there and were left alone.`)
console.log(`Deliberate: ${open} shifts with no clock-out and ${long} longer than the report trusts, so the Labour report's flagged panel has something real.`)
if (APPLY && passwords.length > 0) {
  console.log(`\n${passwords.length} passwords written to demo-staff.txt (gitignored, not printed here).`)
}
if (!APPLY) console.log('\nNothing was written. Add --apply.')
process.exit(0)
