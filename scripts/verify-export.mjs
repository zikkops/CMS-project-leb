// Assertions over the accountant's export — shared/src/salesExport.ts.
//
//   node scripts/verify-export.mjs
//   npm run verify:export
//
// Same shape as the other verifiers: transpile the real module with the
// project's own TypeScript and assert against it. Nothing is re-implemented.
//
// ── What this is really guarding ───────────────────────────────────────────
// An export is the one artefact that leaves the building. It goes to an
// accountant who cannot check it against a drawer, in a month when nobody
// remembers the service, and it is believed. Every case below is a way a
// figure could be quietly wrong and still look completely ordinary:
//
//   the day    judged in the HOST's zone, a sale at 01:30 in Beirut files
//              itself under yesterday — and yesterday may be last month
//   the VAT    added to a total instead of extracted from one, on menu
//              prices that already include it
//   the rate   today's rate applied to last year's lira figure, so the same
//              export never produces the same numbers twice
//   refunds    netted into sales, hiding both halves

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'export-verify-'))
execSync(
  `npx tsc shared/src/salesExport.ts shared/src/loyaltyExport.ts shared/src/reportPeriods.ts shared/src/reportFile.ts shared/src/salesSummary.ts shared/src/tenderSummary.ts shared/src/vatReport.ts shared/src/cashUpReport.ts shared/src/receiptSequence.ts --outDir ${out} ` +
  `--module esnext --target es2022 --skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}

const X = await import(`file://${join(out, 'salesExport.js')}`)
const RP = await import(`file://${join(out, 'reportPeriods.js')}`)
const RF = await import(`file://${join(out, 'reportFile.js')}`)
const SS = await import(`file://${join(out, 'salesSummary.js')}`)
const TS = await import(`file://${join(out, 'tenderSummary.js')}`)
const VR = await import(`file://${join(out, 'vatReport.js')}`)
const CU = await import(`file://${join(out, 'cashUpReport.js')}`)
const RS = await import(`file://${join(out, 'receiptSequence.js')}`)
const L = await import(`file://${join(out, 'loyaltyExport.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}

// Beirut, and a zone that is deliberately NOT the machine's, so a case cannot
// pass by accident on a developer's laptop.
const BEIRUT = 'Asia/Beirut'
const OPTS = { timeZone: BEIRUT, fallbackRate: 100_000 }

const line = (over = {}) => ({
  id: 'l1', source: 'menu', refId: 'm1', name: 'Flat White',
  unitPrice: 10, modifiers: [], quantity: 1, seat: null, course: null,
  station: 'Bar', status: 'sent', note: '',
  addedBy: 'u', addedByEmail: 'u@x', sentAt: null,
  voidReason: null, voidReasonKey: null, voidWasWaste: null, ...over,
})

const check = (over = {}) => ({
  id: 'c1', branch: 'Main', tableId: 't1', tableNumber: 4, status: 'closed',
  guestCount: 2, lines: [line()], openedBy: 'u', openedByEmail: 'u@x',
  closedAt: '2026-09-12T20:00:00.000Z', receiptNumber: '1041',
  staffDiscount: null, vatRate: 0.1, billRate: 91_000, ...over,
})

const pay = (over = {}) => ({
  key: 'p1', tender: 'cash', currency: 'USD', amount: 10,
  appliedLbp: 910_000, changeUsd: 0, changeLbp: 0, changeRounding: 0,
  at: null, by: 'u', byEmail: 'u@x', ...over,
})

console.log('\nthe day belongs to the café, not to the server')
{
  // 22:30 UTC is 01:30 the NEXT day in Beirut. A host in UTC files this sale
  // under the 12th; the café closed it on the 13th, and in three weeks' time
  // that is the difference between one month's takings and another's.
  const late = X.checkRow(check({ closedAt: '2026-09-12T22:30:00.000Z' }), OPTS)
  eq('THE TRAP: a sale after midnight is the next café day', late.day, '2026-09-13')
  eq('...and the time is local too', late.time, '01:30')

  const evening = X.checkRow(check({ closedAt: '2026-09-12T20:00:00.000Z' }), OPTS)
  eq('an evening sale stays on its own day', evening.day, '2026-09-12')

  eq('a check with no close time has no day', X.checkRow(check({ closedAt: null }), OPTS).day, '')
}

console.log('\nVAT comes out of the price, never on top of it')
{
  const row = X.checkRow(check(), OPTS)
  eq('net is the menu price, unchanged', row.net, 10)
  eq('THE TRAP: VAT is extracted from it', row.vat, 0.91)
  eq('...so it is less than the price times the rate', row.vat < row.net * 0.1 + 0.0001, true)
  eq('the rate is recorded beside it', row.vatRate, 0.1)

  const old = X.checkRow(check({ vatRate: undefined }), OPTS)
  eq('a check from before VAT was recorded gets none', old.vat, 0)
  eq('...and says so rather than guessing', old.vatRate, null)
}

console.log('\nlira figures use the rate that check was settled at')
{
  eq('the check’s own rate', X.checkRow(check(), OPTS).netLbp, 910_000)
  eq('...which is not the rate passed in', X.checkRow(check(), OPTS).rate, 91_000)
  const unsettled = X.checkRow(check({ billRate: null }), OPTS)
  eq('only a check that never had one falls back', unsettled.netLbp, 1_000_000)
}

console.log('\nwhat was taken, split the way a drawer is counted')
{
  const row = X.checkRow(check({
    payments: [
      pay({ amount: 4 }),
      pay({ key: 'p2', currency: 'LBP', amount: 500_000 }),
      pay({ key: 'p3', tender: 'card', amount: 2 }),
    ],
  }), OPTS)
  eq('cash dollars', row.cashUsd, 4)
  eq('cash lira, never converted into the dollar column', row.cashLbp, 500_000)
  eq('card', row.card, 2)

  const rows = X.paymentRows(check({ payments: [pay(), pay({ key: 'p2', currency: 'LBP', amount: 910_000 })] }), OPTS)
  eq('one row per payment', rows.length, 2)
  eq('...carrying the check’s rate, not today’s', rows[0].rate, 91_000)
  eq('...and the day it was taken', rows[1].day, '2026-09-12')
}

console.log('\nwhat is in an export at all')
{
  eq('an open check is not', X.isExportable({ status: 'open', receiptNumber: null }), false)
  eq('a closed one is', X.isExportable({ status: 'closed', receiptNumber: '1041' }), true)
  eq('a refunded one is — it still happened', X.isExportable({ status: 'refunded', receiptNumber: '1041' }), true)
  eq('a closed check with no number is not', X.isExportable({ status: 'closed', receiptNumber: null }), false)
}

console.log('\nthe service charge (UPGRADE.md T3.8)')
{
  const row = X.checkRow(check({ serviceCharge: { rate: 0.1 } }), OPTS)
  eq('a service charge is its own column, and inside net', [row.service, row.net], [1, 11])
  eq('THE VAT comes out of the whole bill, service included: prices and service both include it', row.vat, 1)
  const days = X.dayRows([row, X.checkRow(check({ id: 'c2', receiptNumber: '1042' }), OPTS)])
  eq('the day adds the service up apart, and it is part of the day\'s net', [days[0].service, days[0].net], [1, 21])
}

console.log('\nthe day summary')
{
  // Beirut is UTC+3 in September, so 21:00Z is already midnight on the 13th.
  // Getting that wrong while WRITING this test is the same mistake the test
  // exists to catch — which is the argument for pinning an explicit zone.
  const built = X.buildExport([
    check({ id: 'a', receiptNumber: '1', closedAt: '2026-09-12T20:00:00.000Z' }),   // 23:00 on the 12th
    check({ id: 'b', receiptNumber: '2', closedAt: '2026-09-12T21:00:00.000Z' }),   // 00:00 on the 13th
    // Same instant, other branch — a day row is per branch, because a drawer is.
    check({ id: 'c', receiptNumber: '3', branch: 'Second', closedAt: '2026-09-12T21:00:00.000Z' }),
    check({ id: 'd', receiptNumber: '4', closedAt: '2026-09-12T22:30:00.000Z' }),   // 01:30 on the 13th
    check({ id: 'e', receiptNumber: '5', status: 'refunded', closedAt: '2026-09-12T20:30:00.000Z' }),
    check({ id: 'f', receiptNumber: null, status: 'open' }),
  ], OPTS)

  eq('the open check is left out; the refunded one is a sale and a refund', built.checks.length, 6)
  eq('rows read in the order they happened', built.checks.map(c => c.receipt), ['1', '5', '5', '2', '3', '4'])
  eq('three day-and-branch rows', built.days.map(d => `${d.day} ${d.branch}`),
    ['2026-09-12 Main', '2026-09-13 Main', '2026-09-13 Second'])

  const main12 = built.days[0]
  eq('two sales on the 12th: a refunded check still happened (T7.4)', main12.checks, 2)
  eq('...their net', main12.net, 20)
  eq('...their VAT', main12.vat, 1.82)
  eq('THE TRAP: the refund is its own column, not netted off', [main12.refunds, main12.refundedChecks], [10, 1])

  eq('THE TRAP: sales after midnight land on the next café day', built.days[1].checks, 2)
  eq('...and the other branch keeps its own row', built.days[2].branch, 'Second')
}

console.log('\na refund is a credit in the period it is given (UPGRADE.md T7.4)')
{
  const refunded = check({
    id: 'r', receiptNumber: '77', status: 'refunded',
    closedAt: '2026-08-30T12:00:00.000Z', refundedAt: '2026-09-02T09:00:00.000Z',
    payments: [pay({ tender: 'cash', currency: 'USD', amount: 20, changeUsd: 10, changeLbp: 0 })],
  })
  const august = X.buildExport([refunded], { ...OPTS, from: '2026-08-01', to: '2026-08-31' })
  eq('August keeps the sale, untouched by a refund in September', [august.days[0]?.checks, august.days[0]?.net, august.days[0]?.refunds], [1, 10, 0])
  eq('...with its payment', august.payments.length, 1)
  const september = X.buildExport([refunded], { ...OPTS, from: '2026-09-01', to: '2026-09-30' })
  const credit = september.checks[0]
  eq('September has the refund as a credit row, naming the sale\'s day', [september.checks.length, credit.kind, credit.day, credit.originalDay, credit.receipt], [1, 'refund', '2026-09-02', '2026-08-30', '77'])
  eq('...its figures are the sale\'s, negated', [credit.net, credit.vat], [-10, -0.91])
  eq('...and what went back: cash less its change', credit.cashUsd, -10)
  eq('September\'s day shows no sale, one refund given, and its VAT reversed', [september.days[0].checks, september.days[0].refundedChecks, september.days[0].refunds, september.days[0].refundVat], [0, 1, 10, 0.91])
  eq('...and none of the sale\'s payments', september.payments.length, 0)
  const old = X.buildExport([check({ id: 'o', receiptNumber: '78', status: 'refunded', closedAt: '2026-09-05T12:00:00.000Z' })], OPTS)
  eq('a refund from before refundedAt was read is credited on its close day', old.checks.map(r => [r.kind, r.day]), [['sale', '2026-09-05'], ['refund', '2026-09-05']])
}

console.log('\nthe sales summary adds up the way an accountant reads it (UPGRADE.md T7.3)')
{
  const checks = [
    // $20 of goods, a 10% check discount, 10% service, VAT 10%, a $2 card tip.
    check({ id: 's1', receiptNumber: '1', lines: [line({ unitPrice: 20 })], discount: { kind: 'percent', value: 0.1, reasonKey: 'regular', note: '', by: 'u', byEmail: 'u@x' },
      serviceCharge: { rate: 0.1 }, payments: [pay({ tender: 'card', amount: 19.8, tipUsd: 2 })] }),
    // A staff meal at half price.
    check({ id: 's2', receiptNumber: '2', lines: [line({ unitPrice: 10 })], staffDiscount: { food: 0.5, drink: 0.5, appliedBy: 'u', appliedByEmail: 'u@x' } }),
    // From before VAT was recorded.
    check({ id: 's3', receiptNumber: '3', branch: 'Second', vatRate: undefined, lines: [line({ unitPrice: 8 })] }),
    // Sold on the 12th, refunded on the 13th.
    check({ id: 's4', receiptNumber: '4', status: 'refunded', refundedAt: '2026-09-13T09:00:00.000Z', lines: [line({ unitPrice: 11 })] }),
  ]
  const built = X.buildExport(checks, OPTS)
  const s = SS.salesSummary(built.checks, ['Main', 'Second'])
  const t = s.total
  const add = (k) => Math.round(s.byBranch.reduce((n, b) => n + b.figures[k], 0) * 100) / 100
  eq('the total is the sum of the branches, figure by figure', Object.keys(t).every(k => Math.abs(add(k) - t[k]) < 0.005), true)
  eq('gross − discounts + service = billed', Math.round((t.grossSales - t.staffMeals - t.itemDiscounts - t.checkDiscounts + t.serviceCharge) * 100) / 100, t.billed)
  eq('net sales + VAT on sales + service = billed (to the cent)', Math.abs(t.netSales + t.goodsVat + t.serviceCharge - t.billed) < 0.011, true)
  eq('VAT output = VAT on sales + VAT on service', Math.round((t.goodsVat + t.serviceVat) * 100) / 100, t.vatOutput)
  eq('service charge and its VAT, on their own lines', [t.serviceCharge, t.serviceVat], [1.8, 0.16])
  eq('card tips are shown apart, never inside billed', [t.cardTips, t.billed], [2, 43.8])
  eq('a check with no VAT rate adds no VAT and is counted', [s.byBranch[1].figures.vatOutput, t.checksWithoutVatRate], [0, 1])
  eq('the refunded check is still a sale, and its refund a credit on its own day', [t.checks, t.refundsGiven, t.refundsBilled], [4, 1, 11])
  eq('net sales after refunds = net sales − refunded net sales', Math.round((t.netSales - t.refundsNetSales) * 100) / 100, t.netSalesAfterRefunds)
  eq('billed in lira at each check\'s own rate', t.billedLbp, built.checks.filter(r => r.kind === 'sale').reduce((n, r) => n + r.netLbp, 0))
  eq('by order type: every sale in one type', s.byOrderType.reduce((n, o) => n + o.checks, 0), 4)
  eq('the average check is billed ÷ checks', s.averageCheck, Math.round(t.billed / t.checks * 100) / 100)
  const refundDay = SS.salesSummary(X.buildExport(checks, { ...OPTS, from: '2026-09-13', to: '2026-09-13' }).checks, ['Main', 'Second']).total
  eq('the refund\'s day shows the refund and no sale', [refundDay.checks, refundDay.refundsGiven, refundDay.netSalesAfterRefunds], [0, 1, -10])
}

console.log('\npayments and tenders, each currency on its own (UPGRADE.md T7.5)')
{
  const checks = [
    check({ id: 't1', receiptNumber: '11', payments: [pay({ tender: 'cash', currency: 'USD', amount: 20, changeUsd: 10, appliedLbp: 910_000 })] }),
    check({ id: 't2', receiptNumber: '12', payments: [pay({ tender: 'card', currency: 'LBP', amount: 910_000, appliedLbp: 910_000 })] }),
    check({ id: 't3', receiptNumber: '13', branch: 'Second', payments: [pay({ tender: 'card', currency: 'USD', amount: 10, tipUsd: 2, appliedLbp: 910_000 })] }),
    check({ id: 't4', receiptNumber: '14', status: 'refunded', payments: [pay({ tender: 'cash', currency: 'USD', amount: 10, appliedLbp: 910_000 })] }),
    check({ id: 't5', receiptNumber: '15' }),
  ]
  const built = X.buildExport(checks, OPTS)
  eq('the export keeps card taken in lira in its own column, never dropped', built.checks.find(r => r.receipt === '12').cardLbp, 910_000)
  eq('...and a card tip on its payment row', built.payments.find(p => p.receipt === '13').tipUsd, 2)
  const s = TS.tenderSummary(built.payments, built.checks, ['Main', 'Second'])
  const t = s.total
  eq('cash handed over, change and kept, in dollars', [t.cashUsdTendered, t.changeUsd, t.cashUsdKept], [30, 10, 20])
  eq('card in each currency, never converted', [t.cardUsd, t.cardLbp], [10, 910_000])
  eq('card tips apart, owed to staff', t.cardTips, 2)
  eq('the refund went back in cash, on its day', t.refundCashUsd, 10)
  eq('a check with no payment is counted, not guessed', t.checksWithoutPayment, 1)
  eq('applied to bills = billed on the paid checks, tips left out', [t.appliedUsd, t.billedPaid, TS.tendersReconcile(t, 4)], [40, 40, true])
  eq('the total is the sum of the branches', Object.keys(t).every(k => Math.abs(s.byBranch.reduce((n, b) => n + b.figures[k], 0) - t[k]) < 0.005), true)
  eq('a tip counted as a sale would not reconcile', TS.tendersReconcile({ ...t, appliedUsd: t.appliedUsd + t.cardTips }, 1), false)
}

console.log('\nthe VAT report: by rate, reversals in their period, input VAT (UPGRADE.md T7.6)')
{
  const checks = [
    check({ id: 'v1', receiptNumber: '21', vatRate: 0.1, lines: [line({ unitPrice: 11 })] }),
    // The rate changed mid-period: a second line, never merged at today's rate.
    check({ id: 'v2', receiptNumber: '22', vatRate: 0.12, lines: [line({ unitPrice: 11.2 })] }),
    // Service charge at 10%, VAT on it.
    check({ id: 'v3', receiptNumber: '23', vatRate: 0.1, lines: [line({ unitPrice: 22 })], serviceCharge: { rate: 0.1 } }),
    check({ id: 'v4', receiptNumber: '24', vatRate: undefined, lines: [line({ unitPrice: 5 })] }),
    check({ id: 'v5', receiptNumber: '25', status: 'refunded', vatRate: 0.1, lines: [line({ unitPrice: 11 })] }),
  ]
  const deliveries = [
    { branch: 'Main', day: '2026-09-12', supplier: 'A', invoiceNumber: 'X1', currency: 'USD', rateUsed: 0, vatRate: 0.1, taxableSubtotal: 50, subtotal: 60, vat: 5, grand: 65 },
    { branch: 'Main', day: '2026-09-12', supplier: 'B', invoiceNumber: 'X2', currency: 'LBP', rateUsed: 100_000, vatRate: 0.1, taxableSubtotal: 1_000_000, subtotal: 1_000_000, vat: 100_000, grand: 1_100_000 },
  ]
  const built = X.buildExport(checks, OPTS)
  const r = VR.vatReport(built.checks, deliveries, ['Main', 'Second'])
  const t = r.total
  eq('output VAT is one line per rate the checks closed at, plus no rate', t.output.map(l => VR.rateLabel(l.rate)), ['No rate recorded', '10%', '12%'])
  eq('each rate extracted at its own rate', t.output.find(l => l.rate === 0.12).goodsVat, 1.2)
  eq('the service charge and its VAT are apart', [t.output.find(l => l.rate === 0.1).serviceNet, t.output.find(l => l.rate === 0.1).serviceVat], [2, 0.2])
  eq('a check with no rate carries no VAT and is counted', [t.checksWithoutVatRate, t.output[0].billedWithoutVat], [1, 5])
  eq('the refund reverses its VAT, at its rate', [t.refunds.length, t.refunds[0].vat], [1, 1])
  eq('input VAT from deliveries; one in lira at its own rate', [t.input[0].deliveries, t.input[0].vatUsd], [2, 6])
  eq('net VAT = output − reversed − input', t.netVat, Math.round((t.outputVat - t.refundVat - t.inputVat) * 100) / 100)
  eq('output VAT here = the sales summary\'s VAT output', t.outputVat, SS.salesSummary(built.checks, ['Main', 'Second']).total.vatOutput)
  eq('the total is the sum of the branches', r.byBranch.reduce((n, b) => n + b.figures.netVat, 0).toFixed(2), t.netVat.toFixed(2))
}

console.log('\ncash-up and drawer: per shift, per currency, never netted (UPGRADE.md T7.7)')
{
  const m = (usd, lbp) => ({ usd, lbp })
  const totals = (over = {}) => ({ float: m(50, 500_000), cashIn: m(100, 1_000_000), change: m(10, 0), refunds: m(0, 0), card: m(40, 0), cardTips: 3,
    paidOuts: m(5, 0), payIns: m(0, 0), safeDrops: m(20, 0), expected: m(115, 1_500_000), payments: 8, ...over })
  const shifts = [
    { id: 's1', branch: 'Main', cashUpDay: '2026-09-20', status: 'closed', openedTime: '17:02', openedByEmail: 'rana@example.com', closedByEmail: 'sam@example.com', totals: totals(), counted: m(110, 1_500_000), note: 'one $5 short' },
    { id: 's2', branch: 'Main', cashUpDay: '2026-09-21', status: 'open', openedTime: '09:40', openedByEmail: 'rana@example.com', closedByEmail: '', totals: totals({ expected: m(80, 0) }), counted: null, note: '' },
    { id: 's3', branch: 'Second', cashUpDay: '2026-09-20', status: 'closed', openedTime: '18:00', openedByEmail: 'lea@example.com', closedByEmail: 'lea@example.com', totals: totals({ expected: m(60, 200_000) }), counted: m(60, 250_000), note: '' },
  ]
  const eod = [{ branch: 'Main', date: '2026-09-20', countedUsd: 110, countedLbp: 1_500_000 }]
  const r = CU.cashUpReport(shifts, eod, ['Main', 'Second'])
  eq('a Z is named by branch, cash-up day and opening time', r.shifts[0].z, 'Main 2026-09-20 17:02')
  eq('the difference is per currency, never netted at a rate', [r.shifts.find(s => s.id === 's1').difference, r.shifts.find(s => s.id === 's3').difference], [m(-5, 0), m(0, 50_000)])
  eq('an open shift shows what it should hold and no count', [r.shifts.find(s => s.id === 's2').counted, r.shifts.find(s => s.id === 's2').difference], [null, null])
  eq('totals count closed shifts only for counted and difference', [r.total.counted, r.total.difference, r.total.openShifts], [m(170, 1_750_000), m(-5, 50_000), 1])
  eq('card and card tips are shown, never in the drawer', [r.total.card, r.total.cardTips], [m(120, 0), 9])
  eq('each day\'s End of Day count sits beside its shifts', r.days.find(d => d.branch === 'Main' && d.cashUpDay === '2026-09-20').eodCounted, m(110, 1_500_000))
  eq('the total is the sum of the branches', r.byBranch.reduce((n, b) => n + b.totals.difference.lbp, 0), r.total.difference.lbp)
}

console.log('\nthe receipt sequence: gaps, duplicates and numbers with no record (UPGRADE.md T7.10)')
{
  const n = (seq, year = 2026) => `BC-Q3-09${year}-${String(seq).padStart(4, '0')}`
  eq('a number is read from its end, whatever dashes the prefix holds', [RS.parseReceiptNumber('MY-CAFE-Q1-012026-12345'), RS.parseReceiptNumber('BC-0042'), RS.parseReceiptNumber('BC-Q3-132026-0001')],
    [{ year: 2026, sequence: 12345 }, null, null])
  const use = (seq, over = {}) => ({ number: n(seq), kind: 'check', id: `c${seq}`, branch: 'Main', day: '2026-09-20', ...over })
  const r = RS.receiptSequence(
    [use(10), use(11, { branch: 'Second' }), use(12, { kind: 'wholesale', branch: '' }), use(14, { kind: 'retail' }), use(14, { id: 'c14b' }),
      use(30), use(31), use(40), { number: 'handwritten', kind: 'check', id: 'x', branch: 'Main', day: '2026-09-20' }],
    [13, 14, 30, 31, 40].map(s => ({ year: 2026, sequence: s, number: n(s), purpose: s === 13 ? 'check c99' : 'x', day: '2026-09-20' })),
    [{ year: 2026, first: 20, last: 29, branch: 'Main', name: 'Counter PC' }],
    { branches: ['Main'] },
  )
  const row = seq => r.rows.find(x => x.sequence === seq)
  eq('every number from the lowest to the highest is one row', [r.rows.length, r.years[0].first, r.years[0].last], [31, 10, 40])
  eq('another branch\'s number is not a gap, and is counted, not shown', [row(11).status, row(11).id, row(11).number], ['used elsewhere', '', ''])
  eq('a wholesale invoice takes a number from the same counter', row(12).status, 'wholesale')
  eq('issued, and nothing carries it: listed with what it was for', [row(13).status, row(13).note], ['issued, no record', 'issued for check c99'])
  eq('THE TRAP: one number on two records is a duplicate', [r.duplicates.length, r.duplicates[0].sequence, r.years[0].duplicates], [1, 14, 1])
  eq('numbers a hub reserved and never used are expected, named with the block', r.gaps.find(g => g.from === 20), { year: 2026, from: 20, to: 29, count: 10, status: 'gap in hub block', note: 'Counter PC at Main, block 20–29' })
  eq('never seen, above the first logged number (13): missing', r.gaps.find(g => g.to === 19), { year: 2026, from: 15, to: 19, count: 5, status: 'gap', note: '' })
  eq('a gap inside the logged span is missing, and counted', [r.gaps.find(g => g.from === 32).status, r.years[0].missing], ['gap', 13])
  eq('a number not in the format sits in no sequence, and is said', r.unreadable.map(u => u.number), ['handwritten'])
  const early = RS.receiptSequence([use(1), use(5)], [{ year: 2026, sequence: 5, number: n(5), purpose: 'x', day: '2026-09-21' }], [], { branches: ['Main'] })
  eq('never seen and below the first logged number: before the log', early.gaps.map(g => [g.from, g.to, g.status]), [[2, 4, 'gap before the log']])
  const years = RS.receiptSequence([use(3), { ...use(1), number: n(1, 2027) }], [], [], { branches: ['Main'] })
  eq('each year is its own sequence, since the counter restarts', years.years.map(y => [y.year, y.first, y.last]), [[2026, 3, 3], [2027, 1, 1]])
}

console.log('\nthe sheets are declared once, for the UI and the file both')
{
  eq('every check column names a real field', X.SHEETS.checks.every(([k]) => k in X.checkRow(check(), OPTS)), true)
  eq('every day column names a real field', X.SHEETS.days.every(([k]) => k in X.dayRows([X.checkRow(check(), OPTS)])[0]), true)
  eq('every payment column names a real field',
    X.SHEETS.payments.every(([k]) => k in X.paymentRows(check({ payments: [pay()] }), OPTS)[0]), true)
}

// ── The other half of what leaves the building: points ─────────────────────
// Points are a liability, so the figures below are somebody's promise to give
// something away. The first case is the one that would have been wrong.

const tx = (over = {}) => ({
  id: 't1', type: 'event', status: 'approved', branchId: 'Main',
  userId: ['u1'], pointsAmount: 10, submittedBy: 'u', approvedBy: 'm',
  createdAt: '2026-09-12T20:00:00.000Z', ...over,
})

const red = (over = {}) => ({
  id: 'r1', userId: 'u1', itemName: 'Free coffee', coinCost: 50,
  status: 'redeemed', branchId: 'Main',
  createdAt: '2026-09-12T20:00:00.000Z', confirmedAt: '2026-09-12T20:30:00.000Z', ...over,
})

console.log('\npoints are credited per person, not per transaction')
{
  // shared/src/server/loyalty.ts increments EVERY user in the array by the
  // full pointsAmount. A report that sums the field says 10 where the café
  // gave away 50.
  const party = L.pointsRow(tx({ userId: ['u1', 'u2', 'u3', 'u4', 'u5'] }), OPTS)
  eq('THE TRAP: five attendees at ten points is fifty', party.issued, 50)
  eq('...and the per-person figure is kept beside it', party.perPerson, 10)
  eq('...with the headcount', party.people, 5)
  eq('one attendee is just the amount', L.pointsRow(tx(), OPTS).issued, 10)
  eq('nobody attached issues nothing', L.pointsRow(tx({ userId: [] }), OPTS).issued, 0)
}

console.log('\nonly what actually moved a balance counts')
{
  eq('a pending submission is a request, not a liability', L.pointsRow(tx({ status: 'pending' }), OPTS).issued, 0)
  eq('a rejected one issues nothing', L.pointsRow(tx({ status: 'rejected' }), OPTS).issued, 0)
  eq('a cancelled one issues nothing', L.pointsRow(tx({ status: 'cancelled' }), OPTS).issued, 0)

  const back = L.pointsRow(tx({ status: 'reversed', userId: ['u1', 'u2'] }), OPTS)
  eq('a refunded check reverses, in its own column', [back.issued, back.reversed], [0, 20])
}

console.log('\na redemption counts when it is handed over')
{
  eq('redeemed spends the cost', L.redemptionRow(red(), OPTS).spent, 50)
  eq('pending spends nothing', L.redemptionRow(red({ status: 'pending', confirmedAt: null }), OPTS).spent, 0)
  eq('rejected spends nothing', L.redemptionRow(red({ status: 'rejected' }), OPTS).spent, 0)
  eq('...but the cost is still shown', L.redemptionRow(red({ status: 'rejected' }), OPTS).cost, 50)
  eq('dated by when it was handed over', L.redemptionRow(red(), OPTS).day, '2026-09-12')
  // 21:00Z is already the 13th in Beirut — the same boundary the sales export
  // has, and the reason both take an explicit zone.
  eq('THE TRAP: dated in the café’s zone', L.redemptionRow(red({ confirmedAt: '2026-09-12T21:00:00.000Z' }), OPTS).day, '2026-09-13')
  eq('a request never confirmed falls back to when it was asked for',
    L.redemptionRow(red({ status: 'pending', confirmedAt: null }), OPTS).day, '2026-09-12')
}

console.log('\nwhat the liability did, by day and branch')
{
  const built = L.buildLoyaltyExport(
    [
      tx({ id: 'a', userId: ['u1', 'u2'] }),                                   // +20
      tx({ id: 'b', status: 'pending' }),                                      // nothing
      tx({ id: 'c', status: 'reversed' }),                                     // −10
      tx({ id: 'd', branchId: 'Second' }),                                     // +10, other branch
      tx({ id: 'e', createdAt: '2026-09-12T21:00:00.000Z' }),                  // next café day
    ],
    [red({ id: 'r1' }), red({ id: 'r2', status: 'pending', confirmedAt: null })],
    OPTS,
  )

  eq('a day row per branch', built.days.map(d => `${d.day} ${d.branch}`),
    ['2026-09-12 Main', '2026-09-12 Second', '2026-09-13 Main'])

  const main = built.days[0]
  eq('issued on the 12th at Main', main.issued, 20)
  eq('...reversed', main.reversed, 10)
  eq('...spent', main.spent, 50)
  eq('net is issued minus reversed minus spent', main.net, -40)
  eq('every transaction is counted, even the ones that moved nothing', main.transactions, 3)
  eq('and both redemptions are listed', main.redemptions, 2)
  eq('the after-midnight one is its own day', built.days[2].issued, 10)
}

console.log('\nthe loyalty sheets are declared once')
{
  const p = L.pointsRow(tx(), OPTS)
  const r = L.redemptionRow(red(), OPTS)
  const d = L.loyaltyDayRows([p], [r])[0]
  eq('every points column names a real field', L.LOYALTY_SHEETS.points.every(([k]) => k in p), true)
  eq('every redemption column names a real field', L.LOYALTY_SHEETS.redemptions.every(([k]) => k in r), true)
  eq('every day column names a real field', L.LOYALTY_SHEETS.days.every(([k]) => k in d), true)
}

console.log('\nthe periods and branches a report is asked for (UPGRADE.md T7.1)')
{
  // 21 Sep 2026 is a Monday.
  const T = '2026-09-21'
  eq('today and yesterday', [RP.quickRange('today', T), RP.quickRange('yesterday', T)], [{ from: T, to: T }, { from: '2026-09-20', to: '2026-09-20' }])
  eq('this week starts on Monday (ISO 8601) and ends today', RP.quickRange('thisWeek', T), { from: '2026-09-21', to: T })
  eq('this week from a Sunday still starts on the Monday before', RP.quickRange('thisWeek', '2026-09-27'), { from: '2026-09-21', to: '2026-09-27' })
  eq('last week is Monday to Sunday', RP.quickRange('lastWeek', T), { from: '2026-09-14', to: '2026-09-20' })
  eq('last month, across a year end', RP.quickRange('lastMonth', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' })
  eq('last month ends on its real last day (February)', RP.quickRange('lastMonth', '2028-03-05'), { from: '2028-02-01', to: '2028-02-29' })
  eq('this quarter', RP.quickRange('thisQuarter', T), { from: '2026-07-01', to: T })
  eq('last quarter, from the first quarter', RP.quickRange('lastQuarter', '2026-02-10'), { from: '2025-10-01', to: '2025-12-31' })
  eq('year to date and last year (calendar fiscal year)', [RP.quickRange('yearToDate', T), RP.quickRange('lastYear', T)], [{ from: '2026-01-01', to: T }, { from: '2025-01-01', to: '2025-12-31' }])
  eq('the same days a year earlier; 29 February becomes the 28th', RP.sameRangeLastYear('2028-02-01', '2028-02-29'), { from: '2027-02-01', to: '2027-02-28' })
  eq('days counted, both ends included', [RP.dayCount('2026-09-01', '2026-09-30'), RP.dayCount(T, T)], [30, 1])
  const own = ['Main', 'Second', 'Third']
  eq('no branch, or all, is every branch of theirs', [RP.readBranchList('', own), RP.readBranchList('all', own)], [own, own])
  eq('several branches, in the café\'s order, without repeats', RP.readBranchList('Third, Main,Main', own), ['Main', 'Third'])
  eq('a branch that is not theirs refuses the request', typeof RP.readBranchList('Main,Elsewhere', ['Main']), 'string')
  // Long ranges are read a month of café days at a time (T7.2).
  const year = RP.rangeChunks('2026-01-01', '2026-12-31')
  eq('a year in pieces of at most 31 days, first to last', [year.length, year[0], year[year.length - 1].to], [12, { from: '2026-01-01', to: '2026-01-31' }, '2026-12-31'])
  eq('...with no day missed and none twice', year.reduce((n, p) => n + RP.dayCount(p.from, p.to), 0), 365)
  eq('...each piece starting the day after the last', year.every((p, i) => i === 0 || p.from === RP.addDays(year[i - 1].to, 1)), true)
  eq('one day is one piece; an upside-down range none', [RP.rangeChunks('2026-09-21', '2026-09-21').length, RP.rangeChunks('2026-09-22', '2026-09-21').length], [1, 0])
  eq('a year and a quarter is the longest a report asks for', RP.MAX_REPORT_DAYS >= 365 + 92, true)
}

console.log('\nevery download opens with the same header block (UPGRADE.md T7.1b)')
{
  const h = { business: 'Placeholder Cafe', report: 'Voids & Discounts', branches: ['Main', 'Second'], from: '2026-09-01', to: '2026-09-30', dayRule: 'calendar', generatedAt: '2026-09-21T10:00:00.000Z' }
  eq('the header names business, report, branches, period, currencies, days, time and definitions',
    RF.headerRows(h).map(r => r[0]), ['Business', 'Report', 'Branches', 'Period', 'Currencies', 'Days', 'Generated', 'Definitions'])
  eq('one day reads as one date', RF.headerRows({ ...h, to: h.from })[3][1], '2026-09-01')
  const csv = RF.reportCsv(h, [{ label: 'Item', value: r => r.item }, { label: 'USD', value: r => r.usd }], [
    { item: 'Latte, large', usd: 4.5 }, { item: 'Say "hi"', usd: 3 }, { item: '=HYPERLINK("x")', usd: 1 / 3 },
  ])
  const lines = csv.split('\r\n')
  eq('then a blank line and the table', [lines[8], lines[9]], ['', 'Item,USD'])
  eq('a comma or quote is quoted, never splitting a column', [lines[10], lines[11]], ['"Latte, large",4.5', '"Say ""hi""",3'])
  eq('a cell that looks like a formula is never run as one', lines[12].startsWith("\"'=HYPERLINK"), true)
  eq('numbers are plain, to the cent', lines[12].endsWith(',0.33'), true)
  eq('the file name sorts by period', RF.reportFileName('Voids & Discounts', '2026-09-01', '2026-09-30', 'csv'), 'voids-and-discounts_2026-09-01_2026-09-30.csv')
}

console.log('\na read that hit its ceiling says so (UPGRADE.md T5.8)')
eq('under the cap: whole', X.exportCutShort(19_999, 20_000, '2026-09-10'), null)
eq('at the cap: cut short, whole only through the day before the last read', X.exportCutShort(20_000, 20_000, '2026-09-10'), { cap: 20_000, completeThrough: '2026-09-09' })
eq('...across a month end', X.exportCutShort(20_000, 20_000, '2026-03-01').completeThrough, '2026-02-28')
eq('the export cap is the one every read uses', X.EXPORT_CHECK_CAP, 20_000)
eq('the message names the day and what to do', /2026-09-09/.test(X.cutShortMessage({ cap: 20_000, completeThrough: '2026-09-09' })) && /shorter range/.test(X.cutShortMessage({ cap: 20_000, completeThrough: '2026-09-09' })), true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
