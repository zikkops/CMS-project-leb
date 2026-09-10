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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
