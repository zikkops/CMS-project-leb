// Seeds a café's stock and ordering history, so every page in that chain has
// something real to show.
//
//   node --env-file=.env.local scripts/seed-stock.mjs            # dry run
//   node --env-file=.env.local scripts/seed-stock.mjs --apply
//   node --env-file=.env.local scripts/seed-stock.mjs --apply --weeks=12
//   node --env-file=.env.local scripts/seed-stock.mjs --apply --clear
//
// seed-demo.mjs writes the SETUP — supplies, providers, the order template and
// one open order — so the chain can be exercised by hand. It writes no history,
// so Weekly Orders holds one order, Receiving has nothing to look back at, the
// count history is a single day, transfers are empty and the new Inventory and
// Purchases reports have nothing to reconcile between two counts. This fills
// that in: weeks of orders, the deliveries against them, counts, transfers
// between branches and retail sales.
//
// ── It borrows the application's own arithmetic ───────────────────────────
// Every delivery goes through parseDelivery() and postDelivery(), every count
// through saveCount(), every transfer through transferSupplies() and every
// retail sale through createPurchaseOrder(). So stock levels, weighted average
// costs, the expected figure stored on a count line, stock movements and
// invoice numbers are the ones the application would have produced. A seed
// that reimplements any of that writes figures the app never produced — worse
// than no data, because it looks like evidence.
//
// What it does write directly is the weekly orders (a browser writes those
// through a route that needs a signed-in staff member) and the backdating:
// those functions stamp serverTimestamp(), and a history stamped today is not
// a history. Each document is written, then its stamps are set to the day it
// is meant to have happened.
//
// ── Safety ────────────────────────────────────────────────────────────────
// Refuses a project that does not look like a demo, exactly as seed-demo.mjs
// does, and for the same reason. Everything it writes carries `seeded: true`;
// `--clear` removes exactly that, and nothing else.
//
// Re-running is boring: the ids are deterministic and anything already there
// is left alone, so a second run adds only what is missing.

import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const APPLY = process.argv.includes('--apply')
const CLEAR = process.argv.includes('--clear')
const FORCE = process.argv.includes('--force')
const WEEKS = Number((process.argv.find(a => a.startsWith('--weeks=')) ?? '').split('=')[1]) || 8

const { adminDb } = await jiti.import('../shared/src/server/firebaseAdmin.ts')
const { BRAND } = await jiti.import('../shared/src/brand.ts')
const { cafeWeek, todayYmd } = await jiti.import('../shared/src/dates.ts')
const { parseDelivery, postDelivery } = await jiti.import('../shared/src/server/deliveries.ts')
const { saveCount } = await jiti.import('../shared/src/server/inventory.ts')
const { transferSupplies } = await jiti.import('../shared/src/server/supplyTransfer.ts')
const { createPurchaseOrder } = await jiti.import('../shared/src/server/purchases.ts')
const { readSettings } = await jiti.import('../shared/src/server/settings.ts')
const { Timestamp } = await import('firebase-admin/firestore')

const db = adminDb()
// The café's own VAT rate, never a literal: a seeded invoice that carries a
// different rate from a real one is a difference somebody will chase.
const { vatRate: VAT_RATE } = await readSettings()
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
    `SEED_ALLOW_PROJECT does not name it. This writes deliveries, counts and\n` +
    `transfers that MOVE STOCK, with a credential that bypasses every rule.\n\n` +
    `If this really is a demo project, add to .env.local:\n    SEED_ALLOW_PROJECT=${projectId}\n`,
  )
  process.exit(1)
}
console.log(`Project: ${projectId}${APPLY ? '' : '   (dry run — nothing is written)'}`)

const TZ = BRAND.locale.timezone
const BRANCHES = [...BRAND.stockedBranches]
const ACTOR = { uid: 'seed-stock', email: 'seed@example.com' }
const CALLER = { ...ACTOR, role: 'admin', branchIds: [], superadmin: true, isStaff: true }

// Deterministic, so a failed run resumed writes the same documents again.
let seed = 20260922
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = list => list[Math.floor(rnd() * list.length)]
const between = (lo, hi) => lo + rnd() * (hi - lo)
const r2 = n => Math.round(n * 100) / 100

const dayMs = 86_400_000
const ymd = d => new Date(d).toISOString().slice(0, 10)
const at = (day, hour) => Timestamp.fromDate(new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+03:00`))

// ── Clear ─────────────────────────────────────────────────────────────────
const SEEDED_COLLECTIONS = ['deliveries', 'dailyInventoryCounts', 'stockTransfers', 'weeklyOrderReports', 'weeklyOrderLogs', 'productPurchaseOrders']

if (CLEAR) {
  let removed = 0
  for (const name of SEEDED_COLLECTIONS) {
    const snap = await db.collection(name).where('seeded', '==', true).get()
    for (const doc of snap.docs) {
      console.log(`  remove ${name}/${doc.id}`)
      if (APPLY) await doc.ref.delete()
      removed++
    }
  }
  console.log(`\n${APPLY ? 'Removed' : 'Would remove'} ${removed} seeded documents.`)
  console.log('Stock levels are NOT rewound: what a seeded delivery added and a seeded count')
  console.log('set is still on the shelf. Run seed-demo.mjs again to reset the supplies.')
  process.exit(0)
}

// ── What there is to order ────────────────────────────────────────────────
const templateItems = (await db.collection('orderTemplateItems').get()).docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(t => typeof t.supplyId === 'string' && t.supplyId)
const supplies = new Map((await db.collection('supplies').get()).docs.map(d => [d.id, { id: d.id, ...d.data() }]))
const providers = new Map((await db.collection('orderProviders').get()).docs.map(d => [d.id, String(d.data().name ?? '')]))

if (templateItems.length === 0 || supplies.size === 0) {
  console.error('No order template or supplies. Run `npm run seed:demo -- --apply` first.')
  process.exit(1)
}

const DEPARTMENTS = [...new Set(templateItems.map(t => String(t.department ?? 'Other')))].filter(d => d !== 'Other')
const itemsOf = dept => templateItems.filter(t => String(t.department ?? 'Other') === dept)

console.log(`${templateItems.length} template items across ${DEPARTMENTS.join(', ')}; ${supplies.size} supplies; ${BRANCHES.length} branches.`)

// The weeks to fill, oldest first: full weeks behind us, then this one.
const thisWeek = cafeWeek(TZ)
const weeks = []
for (let i = WEEKS - 1; i >= 0; i--) {
  const monday = new Date(`${thisWeek.start}T12:00:00Z`).getTime() - i * 7 * dayMs
  weeks.push(cafeWeek(TZ, new Date(monday)))
}
const TODAY = todayYmd(TZ)
const notFuture = day => (day > TODAY ? TODAY : day)

const made = { orders: 0, logs: 0, deliveries: 0, counts: 0, transfers: 0, sales: 0, skipped: 0 }
const exists = async (col, id) => (await db.doc(`${col}/${id}`).get()).exists

/** Sets the stamps the application wrote as "now" to the day this is meant to have happened. */
async function backdate(path, stamps) {
  if (!APPLY) return
  await db.doc(path).set({ ...stamps, seeded: true }, { merge: true })
}

// ── Weekly orders, and the deliveries against them ────────────────────────
for (const week of weeks) {
  for (const branch of BRANCHES) {
    for (const dept of DEPARTMENTS) {
      const items = itemsOf(dept)
      if (items.length === 0) continue
      // A branch does not order everything every week.
      const ordered = items.filter(() => rnd() < 0.75)
      if (ordered.length === 0) continue

      const orderId = `seed-order-${week.start}-${branch}-${dept}`
      const orderDay = notFuture(week.start)
      // The lines the van delivers against, whether this run wrote the order or
      // found it already there. Read back from the store only when it is there:
      // in a dry run nothing is, and the deliveries would all be skipped.
      let orderItems = []
      if (await exists('weeklyOrderReports', orderId)) {
        made.skipped++
        orderItems = (await db.doc(`weeklyOrderReports/${orderId}`).get()).data()?.items ?? []
      } else {
        const doc = {
          branch,
          weekStart: week.start,
          weekLabel: week.label,
          department: dept,
          items: ordered.map(t => ({
            templateId: t.id,
            name: String(t.name ?? ''),
            department: dept,
            category: String(t.category ?? ''),
            providerId: t.providerId ?? null,
            unit: String(t.unit ?? 'pcs'),
            quantity: Math.max(1, Math.round(between(2, 18))),
          })),
          notes: pick(['', '', 'Call before the van comes.', 'Short last week — please make it up.']),
          submittedBy: ACTOR.uid,
          submittedByEmail: ACTOR.email,
          submittedAt: at(orderDay, 9),
          seeded: true,
        }
        console.log(`  order ${branch} · ${dept} · ${week.label} (${doc.items.length} lines)`)
        if (APPLY) await db.doc(`weeklyOrderReports/${orderId}`).set(doc)
        orderItems = doc.items
        made.orders++

        // Somebody changed a quantity after submitting: the order log exists to show that.
        if (rnd() < 0.3) {
          const line = pick(doc.items)
          const logId = `seed-log-${orderId}-${line.templateId}`
          if (APPLY) {
            await db.doc(`weeklyOrderLogs/${logId}`).set({
              action: 'edit_quantity', reportId: orderId, branch, weekLabel: week.label,
              staffUid: ACTOR.uid, staffEmail: ACTOR.email, itemName: line.name,
              oldQty: line.quantity, newQty: line.quantity + 2, unit: line.unit,
              createdAt: at(orderDay, 11), seeded: true,
            })
          }
          made.logs++
        }
      }

      // The van arrives a day or two later. Sometimes nothing comes at all —
      // an order with no delivery is what the fulfilment bar is for.
      if (rnd() < 0.12) continue
      const deliveryDay = notFuture(ymd(new Date(`${week.start}T12:00:00Z`).getTime() + Math.floor(between(1, 4)) * dayMs))
      const ordersById = new Map(itemsOf(dept).map(t => [t.id, t]))

      // One delivery per supplier on the order: that is how vans arrive.
      const byProvider = new Map()
      for (const line of orderItems) {
        const key = String(line.providerId ?? 'none')
        byProvider.set(key, [...(byProvider.get(key) ?? []), line])
      }

      for (const [providerId, lines] of byProvider) {
        if (lines.length === 0 || rnd() < 0.1) continue
        const deliveryId = `seed-del-${week.start}-${branch}-${dept}-${providerId}`
        if (await exists('deliveries', deliveryId)) { made.skipped++; continue }

        // Mostly dollars; some suppliers invoice in lira, at the rate that day.
        const inLira = rnd() < 0.25
        const rateUsed = inLira ? Math.round(between(87_000, 92_000) / 500) * 500 : 0

        const deliveryLines = lines.map(line => {
          const supply = supplies.get(ordersById.get(line.templateId)?.supplyId ?? '')
          if (!supply) return null
          const baseCost = Number(supply.avgUnitCost) > 0 ? Number(supply.avgUnitCost) : between(1, 12)
          // Costs move a little between weeks; that is what the price-change flag is for.
          const unitCostUsd = r2(baseCost * between(0.92, 1.12))
          const short = rnd() < 0.12
          const rejected = rnd() < 0.06
          const qtyReceived = short ? Math.max(1, Math.round(line.quantity * between(0.4, 0.9))) : line.quantity
          return {
            supplyId: supply.id,
            templateId: line.templateId,
            name: supply.name ?? line.name,
            nameAr: supply.nameAr ?? null,
            unit: supply.unit ?? line.unit,
            qtyOrdered: line.quantity,
            qtyReceived,
            qtyRejected: rejected ? 1 : 0,
            rejectReason: rejected ? pick(['damaged', 'expired', 'wrong-item']) : null,
            unitCostUsd,
            vatable: supply.vatable !== false,
          }
        }).filter(Boolean)
        if (deliveryLines.length === 0) continue

        // The application refuses a unit cost above a million, as a typo guard.
        // A dear item priced in lira passes that, so such an invoice comes in
        // dollars — which is what a supplier would do.
        const dearest = Math.max(...deliveryLines.map(l => l.unitCostUsd))
        const lira = inLira && dearest * rateUsed < 900_000
        for (const line of deliveryLines) {
          line.unitCost = lira ? Math.round(line.unitCostUsd * rateUsed) : line.unitCostUsd
          delete line.unitCostUsd
        }

        const body = {
          branch,
          department: dept,
          providerId: providerId === 'none' ? null : providerId,
          providerName: providers.get(providerId) ?? '',
          orderReportId: orderId,
          invoiceNumber: `F-${String(Math.round(between(10_000, 99_999)))}`,
          // The supplier's own invoice date: usually the day it came, sometimes the day before.
          invoiceDate: rnd() < 0.3 ? ymd(new Date(`${deliveryDay}T12:00:00Z`).getTime() - dayMs) : deliveryDay,
          currency: lira ? 'LBP' : 'USD',
          rateUsed: lira ? rateUsed : 0,
          vatRate: VAT_RATE,
          status: 'received',
          notes: '',
          lines: deliveryLines,
        }

        console.log(`  delivery ${branch} · ${dept} · ${providers.get(providerId) ?? 'no supplier'} · ${deliveryDay} (${deliveryLines.length} lines)`)
        if (APPLY) {
          await postDelivery(parseDelivery(body), ACTOR, undefined, deliveryId)
          await backdate(`deliveries/${deliveryId}`, {
            deliveredAt: at(deliveryDay, 8), stockAppliedAt: at(deliveryDay, 8),
            createdAt: at(deliveryDay, 8), updatedAt: at(deliveryDay, 8),
          })
        }
        made.deliveries++
      }
    }

    // ── The daily count, twice a week ──────────────────────────────────────
    for (const dept of DEPARTMENTS.slice(0, 2)) {
      for (const offset of [2, 5]) {
        const day = ymd(new Date(`${week.start}T12:00:00Z`).getTime() + offset * dayMs)
        if (day > TODAY) continue
        const countId = `${branch}_${day}_${dept}`
        if (await exists('dailyInventoryCounts', countId)) { made.skipped++; continue }

        const counted = itemsOf(dept)
          .map(t => supplies.get(t.supplyId))
          .filter(Boolean)
          .filter(() => rnd() < 0.85)
          .map(supply => {
            // What the shelf actually holds now, then a little drift: the
            // difference between expected and counted is the point of the page.
            const held = Number((supply.quantity ?? {})[branch] ?? 0)
            const drift = rnd() < 0.25 ? between(-2, 1) : 0
            return { supplyId: supply.id, countedQty: Math.max(0, r2(held + drift)) }
          })
        if (counted.length === 0) continue

        console.log(`  count ${branch} · ${dept} · ${day} (${counted.length} lines)`)
        if (APPLY) {
          await saveCount(CALLER, {
            branch, date: day, department: dept, items: counted,
            notes: pick(['', '', 'Fridge two was restocked before counting.']),
            submit: true,
          })
          await backdate(`dailyInventoryCounts/${countId}`, { submittedAt: at(day, 22), updatedAt: at(day, 22) })
          // The count overwrote the stock; keep the local copy in step so the
          // next week's counts start from what the shelf now says.
          for (const line of counted) {
            const supply = supplies.get(line.supplyId)
            supply.quantity = { ...(supply.quantity ?? {}), [branch]: line.countedQty }
          }
        }
        made.counts++
      }
    }
  }

  // ── A transfer between branches, most weeks ────────────────────────────
  if (BRANCHES.length > 1 && rnd() < 0.8) {
    const day = notFuture(ymd(new Date(`${week.start}T12:00:00Z`).getTime() + 3 * dayMs))
    const fromBranch = pick(BRANCHES)
    const toBranch = pick(BRANCHES.filter(b => b !== fromBranch))
    const transferId = `seed-tr-${week.start}-${fromBranch}-${toBranch}`
    if (await exists('stockTransfers', transferId)) {
      made.skipped++
    } else {
      const items = [...supplies.values()]
        .filter(s => Number((s.quantity ?? {})[fromBranch] ?? 0) >= 4)
        .filter(() => rnd() < 0.25)
        .slice(0, 3)
        .map(s => ({ supplyId: s.id, quantity: Math.max(1, Math.round(between(1, 3))) }))
      if (items.length > 0) {
        console.log(`  transfer ${fromBranch} → ${toBranch} · ${day} (${items.length} items)`)
        if (APPLY) {
          await transferSupplies({ fromBranch, toBranch, items }, transferId)
          await backdate(`stockTransfers/${transferId}`, { createdAt: at(day, 15) })
          for (const item of items) {
            const supply = supplies.get(item.supplyId)
            const q = { ...(supply.quantity ?? {}) }
            q[fromBranch] = Number(q[fromBranch] ?? 0) - item.quantity
            q[toBranch] = Number(q[toBranch] ?? 0) + item.quantity
            supply.quantity = q
          }
        }
        made.transfers++
      }
    }
  }
}

// ── Retail sales, so the shop side has a history too ──────────────────────
const products = (await db.collection('products').get()).docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(p => p.available !== false)

const CUSTOMERS = ['Walk-in', 'Rana K.', 'Joe H.', 'Maya S.', 'Office order', 'Lea T.']
for (let i = 0; i < 18 && products.length > 0; i++) {
  const day = notFuture(ymd(Date.now() - Math.floor(between(0, WEEKS * 7)) * dayMs))
  const saleId = `seed-sale-${day}-${i}`
  if (await exists('productPurchaseOrders', saleId)) { made.skipped++; continue }
  const branch = pick(BRANCHES)
  const lines = products
    .filter(p => Number((p.stock ?? {})[branch] ?? 0) > 2)
    .filter(() => rnd() < 0.15)
    .slice(0, 3)
    .map(p => ({ productId: p.id, quantity: Math.max(1, Math.round(between(1, 2))), priceType: 'retail' }))
  if (lines.length === 0) continue
  console.log(`  retail sale ${branch} · ${day} (${lines.length} lines)`)
  if (APPLY) {
    await createPurchaseOrder(CALLER, { branch, customerName: pick(CUSTOMERS), lines }, saleId)
    await backdate(`productPurchaseOrders/${saleId}`, { createdAt: at(day, 16) })
    for (const line of lines) {
      const product = products.find(p => p.id === line.productId)
      product.stock = { ...(product.stock ?? {}), [branch]: Number((product.stock ?? {})[branch] ?? 0) - line.quantity }
    }
  }
  made.sales++
}

console.log(
  `\n${APPLY ? 'Wrote' : 'Would write'}: ${made.orders} weekly orders, ${made.logs} order-log entries, ` +
  `${made.deliveries} deliveries, ${made.counts} counts, ${made.transfers} transfers, ${made.sales} retail sales.` +
  (made.skipped ? `\n${made.skipped} were already there and were left alone.` : ''),
)
if (!APPLY) console.log('\nNothing was written. Run again with --apply.')
process.exit(0)
