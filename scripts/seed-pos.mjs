// Seeds closed checks, so the POS has a history to read.
//
//   node --env-file=.env.local scripts/seed-pos.mjs              # dry run
//   node --env-file=.env.local scripts/seed-pos.mjs --apply
//   node --env-file=.env.local scripts/seed-pos.mjs --apply --days=30
//   node --env-file=.env.local scripts/seed-pos.mjs --clear --apply   # remove it again
//
// ── Why this exists ────────────────────────────────────────────────────────
// seed-demo.mjs writes 171 documents and not one closed check, because it
// predates the POS. The consequence is that everything built on top of a
// closed check has never had anything to read: the sales export is empty, the
// closed-checks review is empty, and the receipt — the one screen where a
// Timestamp arriving where a string was expected printed "NaN-NaN-NaN" on
// every real receipt — has no document to render.
//
// A café's history is the thing you cannot fake by clicking around for ten
// minutes, and it is exactly what those screens need before anybody can say
// whether they work.
//
// ── What it deliberately does NOT do ───────────────────────────────────────
// Change. Every seeded payment settles the bill exactly. The change
// arithmetic belongs to the till (shared/src/payments.ts, asserted by
// verify:payments), and a seed that reimplemented it would be writing figures
// the application never produced — which is worse than no data, because it
// looks like evidence.
//
// It also writes no drawer shifts, so these payments belong to no shift. The
// X/Z reading is a live count, not a history, and inventing one would put a
// number on a screen that never counted anything.
//
// Two safety properties, both copied from seed-demo.mjs on purpose:
//   1. it refuses a project that does not look like a demo, and
//   2. it is idempotent — deterministic ids and deterministic receipt numbers,
//      so running it twice is boring.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const DAYS = Number((process.argv.find(a => a.startsWith('--days=')) ?? '--days=14').split('=')[1]) || 14
const CLEAR = process.argv.includes('--clear')

/**
 * Where seeded receipt numbers start.
 *
 * Fixed rather than "carry on from the live counter", because a number that
 * depends on when the script last ran is a number that changes on a re-run,
 * and then the same seeded check has two receipts. The counter is pushed past
 * this block afterwards so a real close never reuses one.
 */
const SEQUENCE_BASE = 9000

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
    `This script writes closed checks and payments with a credential that\n` +
    `bypasses every security rule. Against a real café's project it would put\n` +
    `invented sales into their books.\n\n` +
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

// ── The real receipt-number format, not a copy of it ───────────────────────
// formatInvoiceNumber() takes the period from the café's timezone, and a
// second implementation of that here is how receipts got numbered into the
// wrong month the first time. Transpiled like the verifiers do it.
const out = mkdtempSync(join(tmpdir(), 'seed-pos-'))
execSync(
  `npx tsc shared/src/invoiceFormat.ts --outDir ${out} --module esnext --target es2022 ` +
  `--skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}
const { formatInvoiceNumber, invoicePeriod } = await import(`file://${join(out, 'invoiceFormat.js')}`)

// ── What the café is configured as ─────────────────────────────────────────
const settings = (await db.doc('appSettings/business').get()).data() ?? {}
const exchangeRate = Number(settings.exchangeRate ?? process.env.NEXT_PUBLIC_EXCHANGE_RATE ?? 0)
const vatRate = Number(settings.vatRate ?? process.env.NEXT_PUBLIC_VAT_RATE ?? 0)
const prefix = String(settings.invoicePrefix ?? process.env.NEXT_PUBLIC_INVOICE_PREFIX ?? 'INV')

if (!(exchangeRate > 0)) {
  console.error('\nNo exchange rate is configured. Open Business Settings, or set NEXT_PUBLIC_EXCHANGE_RATE.')
  process.exit(1)
}

// ── Taking it out again ────────────────────────────────────────────────────
// Every seeded check carries `seeded: true`, which is the whole reason it is
// there: demo data you cannot find again is demo data you cannot remove, and
// this one sits in the same collection as real sales. The invoice numbers it
// used are NOT given back — a burnt number is normal in accounting, and far
// better than two checks sharing one.
if (CLEAR) {
  const doomed = await db.collection('checks').where('seeded', '==', true).get()
  console.log(`
${doomed.size} seeded checks found.`)
  if (!APPLY) {
    console.log('Dry run — nothing deleted. Add --apply to remove them.')
    process.exit(0)
  }
  let removed = 0
  for (let i = 0; i < doomed.docs.length; i += 400) {
    const batch = db.batch()
    for (const d of doomed.docs.slice(i, i + 400)) batch.delete(d.ref)
    await batch.commit()
    removed += Math.min(400, doomed.docs.length - i)
    console.log(`  removed ${removed}/${doomed.size}`)
  }
  console.log('\nGone. The invoice counter is left where it is, on purpose.')
  process.exit(0)
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

// ── A deterministic shape for the week ─────────────────────────────────────
// mulberry32: same seed, same café. Re-running must produce the same history,
// or "idempotent" only means the document ids match.
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
      // deliberately crosses local midnight, so the export's café-day handling
      // meets the case it was written for on real documents.
      const closedAt = new Date(dayMs + (16 * 3600 + Math.floor(rand() * 6.5 * 3600)) * 1000)

      const lines = []
      const items = 1 + Math.floor(rand() * 4)
      for (let l = 0; l < items; l++) {
        const item = menu[Math.floor(rand() * menu.length)]
        const quantity = 1 + Math.floor(rand() * 3)
        lines.push({
          id: `l${l + 1}`,
          source: 'menu',
          refId: item.id,
          name: item.name,
          unitPrice: item.price,
          modifiers: [],
          quantity,
          seat: null,
          course: null,
          station: 'Bar',
          status: 'sent',
          note: '',
          addedBy: 'seed',
          addedByEmail: 'till@demo',
          sentAt: Timestamp.fromDate(new Date(closedAt.getTime() - 25 * 60_000)),
          voidReason: null,
          voidReasonKey: null,
          voidWasWaste: null,
        })
      }

      const net = r2(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0))
      if (net <= 0) continue

      // Exact settlements only — see the note at the top about change.
      const how = rand()
      const payments = how < 0.5
        ? [{ tender: 'cash', currency: 'USD', amount: net, appliedLbp: Math.round(net * exchangeRate) }]
        : how < 0.8
          ? [{
              tender: 'cash', currency: 'LBP',
              amount: Math.round(net * exchangeRate / LBP_STEP) * LBP_STEP,
              appliedLbp: Math.round(net * exchangeRate / LBP_STEP) * LBP_STEP,
            }]
          : [{ tender: 'card', currency: 'USD', amount: net, appliedLbp: Math.round(net * exchangeRate) }]

      const id = `demo-${branch.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date(dayMs).toISOString().slice(0, 10)}-${i + 1}`
      const refunded = rand() < 0.04
      sequence += 1

      checks.push({
        id,
        doc: {
          branch,
          tableId: `t${1 + Math.floor(rand() * 12)}`,
          tableNumber: 1 + Math.floor(rand() * 12),
          status: refunded ? 'refunded' : 'closed',
          guestCount: 1 + Math.floor(rand() * 4),
          lines,
          openedBy: 'seed',
          openedByEmail: 'till@demo',
          closedBy: 'seed',
          closedByEmail: 'till@demo',
          closedAt: Timestamp.fromDate(closedAt),
          receiptNumber: formatInvoiceNumber(sequence, closedAt, prefix),
          staffDiscount: null,
          vatRate,
          billRate: exchangeRate,
          payments: payments.map((p, n) => ({
            ...p,
            key: `${id}-p${n + 1}`,
            changeUsd: 0,
            changeLbp: 0,
            changeRounding: 0,
            at: Timestamp.fromDate(closedAt),
            by: 'seed',
            byEmail: 'till@demo',
          })),
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

// ── What it adds up to ─────────────────────────────────────────────────────
const sales = checks.filter(c => c.doc.status === 'closed')
const takings = r2(sales.reduce((s, c) => s + c.doc.lines.reduce((t, l) => t + l.unitPrice * l.quantity, 0), 0))

console.log(`\n${checks.length} checks over ${DAYS} days · ${branches.length} branches`)
console.log(`  ${sales.length} closed, ${checks.length - sales.length} refunded`)
console.log(`  $${takings.toFixed(2)} in sales at a rate of ${exchangeRate.toLocaleString('en-US')}`)
console.log(`  receipts ${formatInvoiceNumber(SEQUENCE_BASE + 1, new Date(), prefix)} onward`)

const counterSnap = await db.doc('appSettings/invoiceCounter').get()
const live = Number(counterSnap.data()?.nextNumber ?? 0)
if (live >= SEQUENCE_BASE) {
  console.error(
    `\nREFUSING: the live invoice counter is already at ${live}, which is inside the\n` +
    `block this script issues from (${SEQUENCE_BASE}+). Seeding would hand out numbers\n` +
    `that have already been used. Raise SEQUENCE_BASE in this script.`
  )
  process.exit(1)
}

if (!APPLY) {
  console.log('\nDry run — nothing written. Add --apply to write it.')
  process.exit(0)
}

// Firestore caps a batch at 500 writes; chunked well under it.
let written = 0
for (let i = 0; i < checks.length; i += 400) {
  const batch = db.batch()
  for (const c of checks.slice(i, i + 400)) batch.set(db.doc(`checks/${c.id}`), c.doc, { merge: true })
  await batch.commit()
  written += Math.min(400, checks.length - i)
  console.log(`  written ${written}/${checks.length}`)
}

// Push the counter past the seeded block, so the next REAL close cannot be
// handed a number this script already used.
const { year } = invoicePeriod(new Date())
await db.doc('appSettings/invoiceCounter').set({ year, nextNumber: sequence }, { merge: true })
console.log(`\nInvoice counter → ${sequence} (year ${year})`)
console.log('Done.')
