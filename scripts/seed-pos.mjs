// Seeds closed checks and the drawer shifts they were taken in, so the POS has
// a history to read.
//
//   node --env-file=.env.local scripts/seed-pos.mjs              # dry run
//   node --env-file=.env.local scripts/seed-pos.mjs --apply
//   node --env-file=.env.local scripts/seed-pos.mjs --apply --days=30
//   node --env-file=.env.local scripts/seed-pos.mjs --clear --apply   # remove it again
//
// ── Why this exists ────────────────────────────────────────────────────────
// seed-demo.mjs writes 171 documents and not one closed check, because it
// predates the POS. Everything built on top of a closed check therefore had
// nothing to read: the sales export, the closed-checks review, the receipt,
// the drawer's X and Z readings, and End of Day's "system" figure — which is
// computed from the day's shifts and had never been computed from anything.
//
// ── It borrows the real arithmetic rather than imitating it ────────────────
// Change, the bill rate, the receipt number format and the drawer totals are
// all produced by the application's own functions, transpiled and called here
// (applyPayment, formatInvoiceNumber, drawerTotals, countedCash, cashUpDay).
// A seed that reimplements any of them is writing figures the application
// never produced — worse than no data, because it looks like evidence.
//
// The one thing it invents is which tender a customer chose, and even that is
// constrained by the model: USD notes stop at $1 and lira notes at 1,000, so
// cash amounts are whole notes and the change falls out of applyPayment. That
// is what lets a seeded drawer be counted exactly.
//
// Two safety properties, both from seed-demo.mjs:
//   1. it refuses a project that does not look like a demo, and
//   2. it is idempotent — deterministic ids, deterministic receipt numbers.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const CLEAR = process.argv.includes('--clear')
const DAYS = Number((process.argv.find(a => a.startsWith('--days=')) ?? '--days=14').split('=')[1]) || 14

/**
 * Where seeded receipt numbers start.
 *
 * Fixed rather than "carry on from the live counter", because a number that
 * depends on when the script last ran changes on a re-run, and then one seeded
 * check has two receipts. The counter is pushed past this block afterwards so
 * a real close never reuses one.
 */
const SEQUENCE_BASE = Number((process.argv.find(a => a.startsWith('--base=')) ?? '').split('=')[1]) || 9000

/** What each drawer opens with. Whole notes, so it can be counted. */
const FLOAT = { usd: 100, lbp: 2_000_000 }

const raw = process.env.FIREBASE_SERVICE_ACCOUNT
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. See .env.example.')
  console.error('Did you forget --env-file=.env.local ?')
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
    `This script writes closed checks, payments and drawer shifts with a\n` +
    `credential that bypasses every security rule. Against a real café's\n` +
    `project it would put invented sales into their books.\n\n` +
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

// ── Taking it out again ────────────────────────────────────────────────────
// Every seeded document carries `seeded: true`, which is the whole reason it
// is there: demo data you cannot find again is demo data you cannot remove,
// and these sit in the same collections as real sales. Invoice numbers are NOT
// given back — a burnt number is normal in accounting, and far better than two
// checks sharing one.
if (CLEAR) {
  let removed = 0
  for (const name of ['checks', 'drawerShifts']) {
    const doomed = await db.collection(name).where('seeded', '==', true).get()
    console.log(`\n${doomed.size} seeded ${name}.`)
    if (!APPLY) continue
    for (let i = 0; i < doomed.docs.length; i += 400) {
      const batch = db.batch()
      for (const d of doomed.docs.slice(i, i + 400)) batch.delete(d.ref)
      await batch.commit()
      removed += Math.min(400, doomed.docs.length - i)
    }
  }
  console.log(APPLY
    ? `\nRemoved ${removed}. The invoice counter is left where it is, on purpose.`
    : '\nDry run — nothing deleted. Add --apply to remove them.')
  process.exit(0)
}

// ── The application's own arithmetic, not a copy of it ─────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'seed-pos-'))
execSync(
  `npx tsc shared/src/invoiceFormat.ts shared/src/payments.ts shared/src/drawer.ts shared/src/dates.ts ` +
  `--outDir ${tmp} --module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' },
)
for (const f of readdirSync(tmp).filter(n => n.endsWith('.js'))) {
  const p = join(tmp, f)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}
const { formatInvoiceNumber, invoicePeriod } = await import(`file://${join(tmp, 'invoiceFormat.js')}`)
const { applyPayment } = await import(`file://${join(tmp, 'payments.js')}`)
const { drawerTotals, countedCash, drawerDifference, refundOf, LBP_DENOMS, USD_DENOMS } =
  await import(`file://${join(tmp, 'drawer.js')}`)
const { cashUpDay } = await import(`file://${join(tmp, 'dates.js')}`)

// ── What the café is configured as ─────────────────────────────────────────
const settings = (await db.doc('appSettings/business').get()).data() ?? {}
const exchangeRate = Number(settings.exchangeRate ?? process.env.NEXT_PUBLIC_EXCHANGE_RATE ?? 0)
const vatRate = Number(settings.vatRate ?? process.env.NEXT_PUBLIC_VAT_RATE ?? 0)
const prefix = String(settings.invoicePrefix ?? process.env.NEXT_PUBLIC_INVOICE_PREFIX ?? 'INV')
const timeZone = process.env.NEXT_PUBLIC_TIMEZONE ?? 'Asia/Beirut'

if (!(exchangeRate > 0)) {
  console.error('\nNo exchange rate is configured. Open Business Settings, or set NEXT_PUBLIC_EXCHANGE_RATE.')
  process.exit(1)
}

const menu = (await db.collection('menuItems').limit(60).get()).docs
  .map(d => ({ id: d.id, name: String(d.data().name ?? ''), price: Number(d.data().price ?? 0) }))
  .filter(m => m.name && m.price > 0)

if (menu.length === 0) {
  console.error('\nThere are no menu items to sell. Run `npm run seed:demo -- --apply` first.')
  process.exit(1)
}

const branches = String(process.env.NEXT_PUBLIC_BRANCHES ?? 'Main,Second,Third')
  .split(',').map(s => s.trim()).filter(Boolean)

// ── A deterministic shape for the fortnight ────────────────────────────────
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const r2 = n => Math.round(n * 100) / 100
const LBP_STEP = 1000

/** A note-by-note count of an amount, greedily. Whole notes only, by design. */
function notes(amount, denoms) {
  const count = {}
  let left = Math.round(amount)
  for (const d of denoms) {
    const n = Math.floor(left / d)
    if (n > 0) { count[String(d)] = n; left -= n * d }
  }
  return { count, remainder: left }
}

const day0 = new Date()
day0.setUTCHours(0, 0, 0, 0)

const checks = []
let sequence = SEQUENCE_BASE

for (let back = DAYS - 1; back >= 0; back--) {
  const dayMs = day0.getTime() - back * 86_400_000
  for (const [b, branch] of branches.entries()) {
    const rand = rng(dayMs / 86_400_000 + b * 7919)
    const howMany = 3 + Math.floor(rand() * 4)

    for (let i = 0; i < howMany; i++) {
      // 16:00–22:30 UTC is 19:00–01:30 in Beirut: an evening service that
      // crosses local midnight, so the café-day and cash-up-day rules meet the
      // case they were written for on real documents.
      const closedAt = new Date(dayMs + (16 * 3600 + Math.floor(rand() * 6.5 * 3600)) * 1000)

      const lines = []
      const items = 1 + Math.floor(rand() * 4)
      for (let l = 0; l < items; l++) {
        const item = menu[Math.floor(rand() * menu.length)]
        lines.push({
          id: `l${l + 1}`, source: 'menu', refId: item.id, name: item.name,
          unitPrice: item.price, modifiers: [], quantity: 1 + Math.floor(rand() * 3),
          seat: null, course: null, station: 'Bar', status: 'sent', note: '',
          addedBy: 'seed', addedByEmail: 'till@demo',
          sentAt: Timestamp.fromDate(new Date(closedAt.getTime() - 25 * 60_000)),
          voidReason: null, voidReasonKey: null, voidWasWaste: null,
        })
      }

      const net = r2(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0))
      if (net <= 0) continue

      // The tender is the only thing invented here, and the notes decide the
      // amount: USD stops at $1 and lira at 1,000, so a customer hands over
      // whole notes and applyPayment works out the change.
      const how = rand()
      const req = how < 0.45
        ? { tender: 'cash', currency: 'USD', amount: Math.ceil(net) + (rand() < 0.4 ? 5 : 0) }
        : how < 0.75
          ? { tender: 'cash', currency: 'LBP', amount: Math.ceil(net * exchangeRate / LBP_STEP) * LBP_STEP }
          : { tender: 'card', currency: 'USD', amount: net }

      const outcome = applyPayment(net, [], exchangeRate, req)
      if (!outcome.ok) continue

      const id = `demo-${branch.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date(dayMs).toISOString().slice(0, 10)}-${i + 1}`
      const refunded = rand() < 0.04
      sequence += 1

      checks.push({
        id,
        branch,
        cashUp: cashUpDay(timeZone, closedAt),
        refunded,
        doc: {
          branch,
          tableId: `t${1 + Math.floor(rand() * 12)}`,
          tableNumber: 1 + Math.floor(rand() * 12),
          status: refunded ? 'refunded' : 'closed',
          guestCount: 1 + Math.floor(rand() * 4),
          lines,
          openedBy: 'seed', openedByEmail: 'till@demo',
          closedBy: 'seed', closedByEmail: 'till@demo',
          closedAt: Timestamp.fromDate(closedAt),
          receiptNumber: formatInvoiceNumber(sequence, closedAt, prefix),
          staffDiscount: null,
          vatRate,
          billRate: exchangeRate,
          payments: [{
            key: `${id}-p1`,
            tender: req.tender, currency: req.currency, amount: req.amount,
            appliedLbp: outcome.appliedLbp,
            changeUsd: outcome.changeUsd,
            changeLbp: outcome.changeLbp,
            changeRounding: outcome.changeRounding,
            at: Timestamp.fromDate(closedAt),
            by: 'seed', byEmail: 'till@demo',
          }],
          ...(refunded ? {
            refundedAt: Timestamp.fromDate(new Date(closedAt.getTime() + 20 * 60_000)),
            refundedBy: 'till@demo',
            refundReason: 'Demo data — a customer changed their mind.',
          } : {}),
          seeded: true,
        },
      })
    }
  }
}

// ── One drawer shift per branch per cash-up day ────────────────────────────
// Grouped by cashUpDay, not by calendar day: a check closed at 01:30 belongs
// to the night before, and so does the shift that took its money. That rule
// lives in dates.ts and is called, not copied.
const shifts = new Map()
for (const c of checks) {
  const key = `${c.branch}|${c.cashUp}`
  if (!shifts.has(key)) {
    shifts.set(key, {
      id: `demo-shift-${c.branch.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${c.cashUp}`,
      branch: c.branch,
      cashUpDay: c.cashUp,
      checks: [],
    })
  }
  shifts.get(key).checks.push(c)
}

const shiftDocs = []
let short = 0

for (const shift of shifts.values()) {
  const payments = shift.checks.flatMap(c => c.doc.payments)
  const refunds = shift.checks.filter(c => c.refunded).map(c => refundOf(c.doc.payments))
  const totals = drawerTotals(FLOAT, payments, refunds)

  // Counted note by note, from what the drawer should hold. Every figure lands
  // on a real note because the payments were made in them.
  const usd = notes(totals.expected.usd, USD_DENOMS)
  const lbp = notes(totals.expected.lbp, LBP_DENOMS)

  // One shift in every fourteen is counted short by a single note, so the
  // over/short display has something real to show. Said out loud in the note
  // rather than left as a mystery.
  const deliberatelyShort = shiftDocs.length % 14 === 13 && (usd.count['5'] ?? 0) > 0
  if (deliberatelyShort) { usd.count['5'] -= 1; short += 1 }

  const counted = countedCash(lbp.count, usd.count)
  const difference = drawerDifference(totals.expected, counted)

  // Every stamp the drawer reads: the payment names its shift, the check lists
  // the shifts it was paid across, and a refund names the shift it came out of.
  for (const c of shift.checks) {
    c.doc.payments = c.doc.payments.map(p => ({ ...p, shiftId: shift.id }))
    c.doc.shiftIds = [shift.id]
    if (c.refunded) c.doc.refundShiftId = shift.id
  }

  const opened = new Date(`${shift.cashUpDay}T15:00:00.000Z`)
  shiftDocs.push({
    id: shift.id,
    doc: {
      branch: shift.branch,
      status: 'closed',
      float: FLOAT,
      cashUpDay: shift.cashUpDay,
      openedAt: Timestamp.fromDate(opened),
      openedBy: 'seed', openedByEmail: 'till@demo',
      countLbp: lbp.count, countUsd: usd.count,
      counted, totals, difference,
      note: deliberatelyShort
        ? 'Demo data — counted one $5 note short, so the difference has something to show.'
        : 'Demo data.',
      closedAt: Timestamp.fromDate(new Date(opened.getTime() + 11 * 3600_000)),
      closedBy: 'seed', closedByEmail: 'till@demo',
      seeded: true,
    },
  })
}

// ── What it adds up to ─────────────────────────────────────────────────────
const sales = checks.filter(c => !c.refunded)
const takings = r2(sales.reduce((s, c) => s + c.doc.lines.reduce((t, l) => t + l.unitPrice * l.quantity, 0), 0))
const changeGiven = r2(checks.reduce((s, c) => s + c.doc.payments[0].changeUsd, 0))

console.log(`\n${checks.length} checks over ${DAYS} days · ${branches.length} branches`)
console.log(`  ${sales.length} closed, ${checks.length - sales.length} refunded`)
console.log(`  $${takings.toFixed(2)} in sales at a rate of ${exchangeRate.toLocaleString('en-US')}`)
console.log(`  $${changeGiven.toFixed(2)} of change handed back, worked out by applyPayment()`)
console.log(`  ${shiftDocs.length} drawer shifts, ${short} of them counted deliberately short`)
console.log(`  receipts ${formatInvoiceNumber(SEQUENCE_BASE + 1, new Date(), prefix)} onward`)

const counterSnap = await db.doc('appSettings/invoiceCounter').get()
const live = Number(counterSnap.data()?.nextNumber ?? 0)
if (live >= SEQUENCE_BASE && !CLEAR) {
  console.error(
    `\nREFUSING: the live invoice counter is already at ${live}, which is inside the\n` +
    `block this script issues from (${SEQUENCE_BASE}+). Seeding would hand out numbers\n` +
    `that have already been used — including by an earlier run of this script,\n` +
    `whose numbers are burnt even after --clear, exactly as a real one would be.\n\n` +
    `Start a fresh block above the counter:\n` +
    `    npm run seed:pos -- --apply --base=${Math.ceil((live + 100) / 100) * 100}`
  )
  process.exit(1)
}

if (!APPLY) {
  console.log('\nDry run — nothing written. Add --apply to write it.')
  process.exit(0)
}

let written = 0
const all = [
  ...checks.map(c => ({ path: `checks/${c.id}`, doc: c.doc })),
  ...shiftDocs.map(s => ({ path: `drawerShifts/${s.id}`, doc: s.doc })),
]
for (let i = 0; i < all.length; i += 400) {
  const batch = db.batch()
  for (const d of all.slice(i, i + 400)) batch.set(db.doc(d.path), d.doc, { merge: true })
  await batch.commit()
  written += Math.min(400, all.length - i)
  console.log(`  written ${written}/${all.length}`)
}

const { year } = invoicePeriod(new Date())
await db.doc('appSettings/invoiceCounter').set({ year, nextNumber: sequence }, { merge: true })
console.log(`\nInvoice counter → ${sequence} (year ${year})`)
console.log('Done.')
