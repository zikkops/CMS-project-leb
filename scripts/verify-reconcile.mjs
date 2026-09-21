// The reconciliation check (UPGRADE.md T7.16), run in CI over a generated café
// history, so the reports are proved to agree without a database.
//
// The history is built with the application's own arithmetic, never an
// imitation of it: every payment through applyPayment(), every drawer total
// through drawerTotals(), every bill through checkTotals(). Two branches, two
// weeks, a few hundred checks with staff meals, comps, check discounts, service,
// card tips, lira cash with change, checks with no VAT rate, refunds after
// midnight on later days, and the odd check closed without payments.
//
// Then reconcile() must find every pair in agreement, and must find the
// difference when one side is tampered with: a check that passes whatever the
// data says proves nothing.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'reconcile-verify-'))
execSync(
  `npx tsc shared/src/reconcile.ts shared/src/payments.ts shared/src/drawer.ts shared/src/journal.ts --outDir ${out} ` +
  `--module esnext --target es2022 --skipLibCheck --moduleResolution bundler --strict`,
  { stdio: 'pipe' },
)
for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
  const p = join(out, file)
  writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
}
const R = await import(`file://${join(out, 'reconcile.js')}`)
const P = await import(`file://${join(out, 'payments.js')}`)
const D = await import(`file://${join(out, 'drawer.js')}`)
const J = await import(`file://${join(out, 'journal.js')}`)
const C = await import(`file://${join(out, 'checks.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(70)} got=${JSON.stringify(got)}`)
  if (ok) pass++; else fail++
}

// A small deterministic generator, so a failure is the same failure every run.
let seed = 20260921
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = list => list[Math.floor(rnd() * list.length)]

const TZ = 'Asia/Beirut'
const RATE = 89_500
const MENU = [
  { refId: 'm-latte', price: 4.5, cat: 'Coffee' }, { refId: 'm-espresso', price: 2.75, cat: 'Coffee' },
  { refId: 'm-club', price: 11, cat: 'Food' }, { refId: 'm-salad', price: 9.25, cat: 'Food' },
  { refId: 'm-cake', price: 5.5, cat: 'Sweets' }, { refId: 'm-gone', price: 7, cat: null },
]
const categoryOf = Object.fromEntries(MENU.filter(m => m.cat).map(m => [m.refId, m.cat]))
const BRANCHES = ['Main', 'Second']
const DAYS = Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)

const closed = []
const shifts = []
let receipt = 1000
let n = 0
for (const day of DAYS) {
  for (const branch of BRANCHES) {
    const shiftId = `shift-${branch}-${day}`
    const shiftPayments = []
    const count = 8 + Math.floor(rnd() * 10)
    for (let k = 0; k < count; k++) {
      n++
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => {
        const m = pick(MENU)
        const l = {
          id: `l${i}`, source: 'menu', refId: m.refId, name: m.refId, unitPrice: m.price, modifiers: [], quantity: 1 + Math.floor(rnd() * 2),
          seat: null, course: null, station: 'Bar', status: 'sent', note: '', addedBy: 'u', addedByEmail: 'sam@example.com',
          sentAt: '2026-09-01T10:00:00.000Z', voidReason: null, voidReasonKey: null, voidWasWaste: null,
        }
        if (rnd() < 0.08) l.discount = { kind: rnd() < 0.5 ? 'comp' : 'percent', percent: 0.25, reasonKey: 'regular', note: '', by: 'm', byEmail: 'rana@example.com' }
        if (rnd() < 0.05) Object.assign(l, { status: 'void', voidReason: 'Rung wrong', voidReasonKey: 'rung-wrong', voidWasWaste: false })
        return l
      })
      // 17:00 to 02:00 café time: some checks close after midnight, on the next café day.
      const minutes = 17 * 60 + Math.floor(rnd() * 9 * 60)
      const closedAt = new Date(Date.parse(`${day}T00:00:00+03:00`) + minutes * 60_000).toISOString()
      const check = {
        id: `c${n}`, branch, tableId: 't', tableNumber: 1 + Math.floor(rnd() * 20), status: 'closed', guestCount: 2, lines,
        openedBy: 'u', openedByEmail: 'sam@example.com', closedAt, receiptNumber: `BC-Q3-092026-${String(receipt++).padStart(4, '0')}`,
        staffDiscount: rnd() < 0.05 ? { food: 0.5, drink: 0.5, appliedBy: 'm', appliedByEmail: 'rana@example.com' } : null,
        vatRate: rnd() < 0.05 ? undefined : 0.11, billRate: RATE, shiftIds: [shiftId],
      }
      if (rnd() < 0.1) check.discount = rnd() < 0.5
        ? { kind: 'amount', value: 2, reasonKey: 'wait', note: '', by: 'm', byEmail: 'rana@example.com' }
        : { kind: 'percent', value: 0.1, reasonKey: 'complaint', note: '', by: 'm', byEmail: 'rana@example.com' }
      if (rnd() < 0.2) check.serviceCharge = { rate: 0.1 }
      const due = C.checkTotals(check).net
      const payments = []
      if (rnd() >= 0.04 && due > 0) {
        // The application's own payment arithmetic, until the bill is settled.
        for (let guard = 0; guard < 4 && !P.balance(due, payments, RATE).settled; guard++) {
          const left = P.balance(due, payments, RATE)
          const style = rnd()
          const req = style < 0.35 ? { tender: 'card', currency: 'USD', amount: left.remainingUsd, ...(rnd() < 0.3 ? { tipUsd: 2 } : {}) }
            : style < 0.7 ? { tender: 'cash', currency: 'USD', amount: Math.ceil(left.remainingUsd / 5) * 5 }
            : { tender: 'cash', currency: 'LBP', amount: Math.ceil(left.remainingLbp / 100_000) * 100_000 }
          const o = P.applyPayment(due, payments, RATE, req)
          if (!o.ok) break
          payments.push({ ...req, key: `p${payments.length}`, appliedLbp: o.appliedLbp, changeUsd: o.changeUsd, changeLbp: o.changeLbp, changeRounding: o.changeRounding, at: closedAt, by: 'u', byEmail: 'sam@example.com', shiftId })
        }
      }
      check.payments = payments
      shiftPayments.push(...payments)
      // One in twelve refunded, one to three days later, some after midnight.
      if (rnd() < 0.08) {
        check.status = 'refunded'
        check.refundedAt = new Date(Date.parse(closedAt) + (1 + Math.floor(rnd() * 3)) * 86_400_000 + Math.floor(rnd() * 5) * 3_600_000).toISOString()
        check.refundReasonKey = 'changed-mind'
        check.refundWasWaste = rnd() < 0.5
      }
      closed.push(check)
    }
    shifts.push({ id: shiftId, branch, status: 'closed', totals: D.drawerTotals({ usd: 50, lbp: 500_000 }, shiftPayments) })
  }
}

const range = { from: '2026-09-03', to: '2026-09-12' }
const dayOf = iso => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const inRange = d => d >= range.from && d <= range.to
const input = {
  closed: closed.filter(c => inRange(dayOf(c.closedAt))),
  refunded: closed.filter(c => c.status === 'refunded' && inRange(dayOf(c.refundedAt))),
  deliveries: [],
  // Only the period's shifts, but every check offered: payments into other shifts must be left out.
  shifts: shifts.filter(sh => inRange(sh.id.slice(-10))),
  shiftChecks: closed,
  categoryOf,
  codes: J.DEFAULT_ACCOUNT_CODES,
  branches: BRANCHES,
  timeZone: TZ,
  fallbackRate: RATE,
  ...range,
}

console.log(`\nthe reports agree on a generated history (${closed.length} checks, ${closed.filter(c => c.status === 'refunded').length} refunded, ${shifts.length} shifts)`)
const result = R.reconcile(input)
for (const l of result.lines) eq(`${l.label}: ${l.left} = ${l.right}`, l.ok, true)
eq('every pair agrees', result.ok, true)
eq('the history is not trivial: refunds, lira, tips and discounts all happen', [
  input.refunded.length > 3, closed.some(c => (c.payments ?? []).some(p => p.currency === 'LBP')),
  closed.some(c => (c.payments ?? []).some(p => p.tipUsd)), closed.some(c => c.discount), closed.some(c => !c.payments.length),
], [true, true, true, true, true])

console.log('\nand a difference is found, never rounded away')
{
  // A shift whose stored cash is a dollar short of what was taken into it.
  const short = input.shifts.map((s, i) => (i === 3 ? { ...s, totals: { ...s.totals, cashIn: { ...s.totals.cashIn, usd: s.totals.cashIn.usd - 1 } } } : s))
  const r = R.reconcile({ ...input, shifts: short })
  const bad = r.lines.filter(l => !l.ok).map(l => [l.key, l.difference])
  eq('a drawer a dollar short is named, with the dollar', [r.ok, bad], [false, [['drawer-cash-usd', -1]]])

  // A check closed with no receipt number: in no export, so named, never lost.
  const unnumbered = { ...input.closed[0], id: 'no-number', receiptNumber: null }
  const u = R.reconcile({ ...input, closed: [...input.closed, unnumbered] })
  eq('a check closed with no receipt number is named, and the mix still agrees', [u.lines.find(l => l.key === 'unnumbered').ok, u.lines.find(l => l.key === 'mix-goods').ok], [false, true])

  // The sales summary and the mix cannot both be right about a check the mix cannot see.
  const other = { ...input.closed[0], id: 'ghost', branch: 'Elsewhere' }
  eq('a branch not asked for is in no figure', R.reconcile({ ...input, closed: [...input.closed, other] }).ok, true)

  // A payment taken into a shift that its stored totals never counted.
  const target = input.shiftChecks.findIndex(c => input.shifts.some(sh => sh.id === c.shiftIds[0]))
  const extra = input.shiftChecks.map((c, i) => (i === target ? { ...c, payments: [...c.payments, { tender: 'card', currency: 'USD', amount: 5, appliedLbp: 0, changeUsd: 0, changeLbp: 0, shiftId: c.shiftIds[0] }] } : c))
  eq('a payment the drawer never counted is found', R.reconcile({ ...input, shiftChecks: extra }).lines.find(l => l.key === 'drawer-card-usd').difference, -5)
}

rmSync(out, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
