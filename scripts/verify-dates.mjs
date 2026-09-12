// Assertions over calendar-day handling in shared/src/dates.ts.
//
//   node scripts/verify-dates.mjs
//   npm run verify:dates
//
// Transpiles the real module with the project's own TypeScript and asserts
// against it. Every case passes its timezone explicitly, so the result does
// not depend on the zone of the machine running this — which matters, because
// on Windows Node can ignore the TZ environment variable, and a check that
// silently ran in the wrong zone would prove nothing.

import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = mkdtempSync(join(tmpdir(), 'dates-verify-'))
execSync(
  `npx tsc shared/src/dates.ts --outDir ${out} ` +
  `--module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
  { stdio: 'pipe' },
)
const D = await import(`file://${join(out, 'dates.js')}`)

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} got=${JSON.stringify(got)}`)
  ok ? pass++ : fail++
}

const BEIRUT = 'Asia/Beirut'
const NEW_YORK = 'America/New_York'

console.log('\nymdInZone — the calendar day of an instant, in a zone')
const halfPastMidnightUtc = new Date('2026-09-10T00:30:00Z')
eq('03:30 local in Asia/Beirut is still the 10th', D.ymdInZone(halfPastMidnightUtc, BEIRUT), '2026-09-10')
eq('the same instant is the 9th in New York', D.ymdInZone(halfPastMidnightUtc, NEW_YORK), '2026-09-09')

console.log('\nisTodayOrLater — the home page dropped tonight\'s event at 3am')
const beirutEvening = new Date('2026-09-10T20:00:00+03:00')
// The expression EventsPreview used. Kept here so the bug stays on record.
eq('THE BUG: new Date(ymd) >= now, at 20:00 in Asia/Beirut',
   new Date('2026-09-10') >= beirutEvening, false)
eq('an event tonight is still ahead at 20:00 in Asia/Beirut',
   D.isTodayOrLater('2026-09-10', BEIRUT, beirutEvening), true)
eq('and at 23:59', D.isTodayOrLater('2026-09-10', BEIRUT, new Date('2026-09-10T23:59:00+03:00')), true)
eq('but not at 00:01 the next day',
   D.isTodayOrLater('2026-09-10', BEIRUT, new Date('2026-09-11T00:01:00+03:00')), false)
eq('yesterday\'s event is past', D.isTodayOrLater('2026-09-09', BEIRUT, beirutEvening), false)
eq('tomorrow\'s is ahead', D.isTodayOrLater('2026-09-11', BEIRUT, beirutEvening), true)

console.log('\n…and the admin list moved it to "done" early west of Greenwich')
const newYorkEvening = new Date('2026-09-10T21:00:00-04:00')   // 01:00 UTC on the 11th
// The expression the admin events page used: today as a UTC date.
eq('THE BUG: UTC "today" at 21:00 in New York is already the 11th',
   newYorkEvening.toISOString().split('T')[0], '2026-09-11')
eq('the café\'s today is still the 10th', D.todayYmd(NEW_YORK, newYorkEvening), '2026-09-10')
eq('so tonight\'s event is still ahead', D.isTodayOrLater('2026-09-10', NEW_YORK, newYorkEvening), true)

console.log('\nymdToLocalDate — the stored day, on any device')
const local = D.ymdToLocalDate('2026-09-10')
eq('day of month', local.getDate(), 10)
eq('month', local.getMonth(), 8)
eq('year', local.getFullYear(), 2026)
eq('local midnight, not UTC', [local.getHours(), local.getMinutes()], [0, 0])
eq('garbage is Invalid Date, not a guess', Number.isNaN(D.ymdToLocalDate('10/09/2026').getTime()), true)
eq('an empty string too', Number.isNaN(D.ymdToLocalDate('').getTime()), true)

console.log('\nzonedParts — wall-clock fields in a zone, whatever the host says')
const midnightBeirut = new Date('2026-09-30T21:00:00Z')   // 00:00 on 1 Oct, UTC+3
eq('midnight is hour 0, never 24', D.zonedParts(midnightBeirut, BEIRUT).hour, 0)
eq('and it is already the 1st', [D.zonedParts(midnightBeirut, BEIRUT).month, D.zonedParts(midnightBeirut, BEIRUT).day], [10, 1])
eq('while in UTC it is still the 30th', D.zonedParts(midnightBeirut, 'UTC').day, 30)

// ── Money: what the server charges and what it prints ─────────────────────
// A separate transpile — these import brand.ts and dates.ts. BRAND's timezone
// is its default here, Asia/Beirut, because this script loads no .env.
{
  const outM = mkdtempSync(join(tmpdir(), 'dates-money-verify-'))
  execSync(
    `npx tsc shared/src/invoiceFormat.ts shared/src/productPricing.ts --outDir ${outM} ` +
    `--module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
    { stdio: 'pipe' },
  )
  const { readdirSync, readFileSync, writeFileSync } = await import('node:fs')
  for (const f of readdirSync(outM).filter(f => f.endsWith('.js'))) {
    const p = join(outM, f)
    writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
  }
  const INV = await import(`file://${join(outM, 'invoiceFormat.js')}`)
  const PR = await import(`file://${join(outM, 'productPricing.js')}`)
  const utcMonth = d => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'numeric' }).format(d)

  console.log('\ninvoice periods — the café\'s quarter, not the host\'s')
  const oneThirtyOct1 = new Date('2026-09-30T22:30:00Z')   // 01:30 on 1 Oct in Asia/Beirut
  eq('what a UTC host would have read: still September', utcMonth(oneThirtyOct1), '9')
  eq('numbered in October and Q4',
     INV.formatInvoiceNumber(7, oneThirtyOct1, 'INV'), 'INV-Q4-102026-0007')
  eq('quarterOf agrees', INV.quarterOf(oneThirtyOct1), 4)

  const newYear = new Date('2026-12-31T22:30:00Z')         // 00:30 on 1 Jan 2027, UTC+2
  eq('the first half-hour of the year belongs to the new year',
     INV.invoicePeriod(newYear).year, 2027)
  eq('and is labelled with it', INV.formatInvoiceNumber(1, newYear, 'INV'), 'INV-Q1-012027-0001')
  eq('an explicit zone is honoured', INV.invoicePeriod(newYear, 'UTC').year, 2026)

  console.log('\nsale prices — the screen and the till read the same calendar')
  const sale = { price: 10, salePrice: 8, saleEndsAt: '2026-09-30' }
  eq('the café\'s today at 01:30 on 1 Oct', PR.todayKey(oneThirtyOct1), '2026-10-01')
  eq('so the sale that ended on the 30th no longer applies',
     PR.effectivePrice(sale, PR.todayKey(oneThirtyOct1)), 10)
  eq('it still did on the 30th at 23:00',
     PR.effectivePrice(sale, PR.todayKey(new Date('2026-09-30T20:00:00Z'))), 8)
}

// ── Table locks: the same id from the browser that takes a lock and the
//    server that releases it ────────────────────────────────────────────────
{
  const outL = mkdtempSync(join(tmpdir(), 'dates-locks-verify-'))
  execSync(
    `npx tsc shared/src/tableLocks.ts --outDir ${outL} ` +
    `--module esnext --target es2022 --skipLibCheck --moduleResolution bundler`,
    { stdio: 'pipe' },
  )
  const { readdirSync, readFileSync, writeFileSync } = await import('node:fs')
  for (const f of readdirSync(outL).filter(f => f.endsWith('.js'))) {
    const p = join(outL, f)
    writeFileSync(p, readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+?)'/g, "from '$1.js'"))
  }
  const TL = await import(`file://${join(outL, 'tableLocks.js')}`)

  // The formula as it was, evaluated in a stated zone — what the browser and
  // the server each computed when they were not in the same one.
  const oldIdIn = (tableId, d, zone) => {
    const p = D.zonedParts(d, zone)
    const key = `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`
    return `${tableId}__${key}_${Math.floor((p.hour * 60 + p.minute) / 30)}`
  }

  console.log('\ntable locks — one id, whoever computes it')
  const sevenThirty = new Date('2026-09-10T16:30:00Z')   // 19:30 in Asia/Beirut
  eq('a 19:30 booking locks bucket 39 of the 10th', TL.lockDocId('t1', sevenThirty), 't1__20260910_39')
  eq('THE BUG: a UTC server recomputed a different id to release it',
     oldIdIn('t1', sevenThirty, 'UTC'), 't1__20260910_33')
  const pastMidnight = new Date('2026-09-10T22:00:00Z')  // 01:00 on the 11th in Asia/Beirut
  eq('a 01:00 booking belongs to the 11th', TL.lockDocId('t1', pastMidnight), 't1__20260911_2')
  eq('THE BUG: which a UTC server filed under the 10th',
     oldIdIn('t1', pastMidnight, 'UTC'), 't1__20260910_44')

  // Existing locks were created by devices in Beirut, with the old formula.
  // The new ids must be byte-identical for all of them, or every current lock
  // becomes unreachable — the file's own warning. Checked across a year,
  // including both DST changes, at every half hour of a few sample days.
  const samples = []
  for (const day of ['2026-01-15', '2026-03-28', '2026-03-29', '2026-06-21', '2026-10-24', '2026-10-25', '2026-12-31']) {
    for (let m = 0; m < 24 * 60; m += 30) {
      samples.push(new Date(new Date(`${day}T00:00:00Z`).getTime() + m * 60000))
    }
  }
  // Compared against the old formula exactly as a device ran it — Date's own
  // local getters — not against zonedParts, which would only prove the new
  // code agrees with itself. That comparison means something only on a machine
  // whose zone IS the café's, so it runs there and says it was skipped
  // anywhere else, rather than passing without having checked anything.
  const deviceOldId = (tableId, d) =>
    `${tableId}__${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` +
    `_${Math.floor((d.getHours() * 60 + d.getMinutes()) / 30)}`
  const machineZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (machineZone === BEIRUT) {
    const mismatches = samples.filter(d => TL.lockDocId('t1', d) !== deviceOldId('t1', d))
    eq(`locks already made in Asia/Beirut keep their ids (${samples.length} slots, DST incl.)`, mismatches.length, 0)
  } else {
    console.log(`  SKIP  existing-lock compatibility needs a machine in ${BEIRUT}; this one is ${machineZone}`)
  }
}

console.log('\ncashUpDay — before 10am the night is still being counted')
eq('09:59 in Asia/Beirut is still yesterday\'s cash-up',
   D.cashUpDay(BEIRUT, new Date('2026-09-11T06:59:00Z')), '2026-09-10')
eq('10:00 in Asia/Beirut is today\'s',
   D.cashUpDay(BEIRUT, new Date('2026-09-11T07:00:00Z')), '2026-09-11')
eq('00:30 on the 1st is the last day of the month before',
   D.cashUpDay(BEIRUT, new Date('2026-09-30T21:30:00Z')), '2026-09-30')
eq('09:00 on 1 January is 31 December of the year before',
   D.cashUpDay(BEIRUT, new Date('2027-01-01T07:00:00Z')), '2026-12-31')
// 03:00 on the 11th in Asia/Beirut — still the 10th's night. A device in New
// York reads 20:00 on the 10th and happens to agree, so this case alone does
// not tell the two clocks apart.
eq('03:00 on the 11th in Asia/Beirut is the 10th\'s night',
   D.cashUpDay(BEIRUT, new Date('2026-09-11T00:00:00Z')), '2026-09-10')
// This one does. 15:00 on the 11th in Asia/Beirut is 08:00 in New York: the
// old code read the device's clock, saw "before 10am" and opened the 10th's
// form while the café was mid-afternoon on the 11th.
eq('THE BUG: 15:00 in Asia/Beirut is the 11th, even on a device in New York',
   D.cashUpDay(BEIRUT, new Date('2026-09-11T12:00:00Z')), '2026-09-11')

console.log('\ncafeWeek — the week an order is filed under')
// Friday 11 Sep 2026. The week runs Mon 7th to Sun 13th.
const wk = (iso, tz = BEIRUT) => D.cafeWeek(tz, new Date(iso))
eq('a midweek day gives its Monday', wk('2026-09-11T12:00:00Z').start, '2026-09-07')
eq('Monday itself is the start, not the week before',
   wk('2026-09-07T09:00:00Z').start, '2026-09-07')
eq('Sunday belongs to the week ending, not the one starting',
   wk('2026-09-13T09:00:00Z').start, '2026-09-07')
eq('and Monday after that moves on', wk('2026-09-14T09:00:00Z').start, '2026-09-14')

// The label names the week a human reads on the order, so it has to agree
// with the identity it is printed beside.
// en-GB abbreviates September as "Sept", not "Sep" — four letters, unlike
// every other month. Unchanged from the old label; pinned so a locale-data
// change is a failure here rather than a surprise on a supplier's order.
eq('the label spans Monday to Sunday',
   wk('2026-09-11T12:00:00Z').label, '7 Sept – 13 Sept 2026')
eq('a week spanning a month says both months',
   wk('2026-09-30T09:00:00Z').label, '28 Sept – 4 Oct 2026')
eq('a week spanning a year takes the Sunday\'s year',
   wk('2026-12-31T09:00:00Z').label, '28 Dec – 3 Jan 2027')
eq('and its start is still in the old year',
   wk('2026-12-31T09:00:00Z').start, '2026-12-28')

// THE BUG. 21:30 UTC on Sunday the 13th is already 00:30 Monday the 14th in
// Beirut: the café's new week has begun. A device reading its own clock files
// the order under the week that has just ended — where it reads as a week
// nobody ordered for and a week ordered for twice.
eq('THE BUG: just after café midnight on Monday is the NEW week',
   wk('2026-09-13T21:30:00Z').start, '2026-09-14')
eq('the same instant in UTC is still the old week',
   wk('2026-09-13T21:30:00Z', 'UTC').start, '2026-09-07')

// Why the label is formatted with an explicit timeZone, asserted rather than
// only commented. A Date carrying a calendar date, formatted in a host zone
// instead of UTC, names a different day — and the machine this suite runs on
// cannot show it, because Node on Windows ignores TZ and Beirut is east of
// UTC. Naming the zones explicitly is the only way to test it at all.
{
  const label = (d, tz) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: tz })
  const midnight = new Date(Date.UTC(2026, 8, 7))
  const noon = new Date(Date.UTC(2026, 8, 7, 12))
  eq('a UTC-midnight carrier reads as the 6th in New York', label(midnight, 'America/New_York'), '6 Sept')
  eq('a UTC-noon carrier survives it', label(noon, 'America/New_York'), '7 Sept')
  // …but noon is a narrower blast radius, not a fix: UTC+14 still rolls it on.
  eq('noon is NOT safe east of UTC+12', label(noon, 'Pacific/Kiritimati'), '8 Sept')
  eq('only an explicit UTC formats it right everywhere', label(noon, 'UTC'), '7 Sept')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
