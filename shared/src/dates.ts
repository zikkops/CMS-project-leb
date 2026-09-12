// Calendar days — an event's date — stored as 'YYYY-MM-DD' strings.
//
// A date-only value has no time and no zone, and the two obvious ways of
// handling one are both wrong:
//
//   new Date('2026-09-10')   is UTC midnight, not the café's midnight. In
//                            Beirut that is 03:00 local, so a home page asking
//                            "is this event still ahead of now?" dropped
//                            tonight's event from 3am on the day itself —
//                            the one day anybody is looking for it.
//
//   new Date().toISOString() gives today's date in UTC. In a café west of
//                            Greenwich the UTC date rolls over in the
//                            evening, so tonight's event moved to "done"
//                            while it was still being set up.
//
// "Today" here is the CAFÉ's today, in its configured timezone — not the
// device's. A visitor abroad looking at a Beirut café's events should see
// Beirut's today, and so should a manager whose phone is set to another zone.
//
// No imports on purpose, so a verifier can transpile it standalone. Callers
// pass BRAND.locale.timezone.

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

/** The calendar date of an instant, in a given timezone, as 'YYYY-MM-DD'. */
export function ymdInZone(at: Date, timeZone: string): string {
  // formatToParts rather than format(): the separators and order a locale
  // chooses are presentation, and this string is compared, not shown.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at)
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Today in the café's timezone, as 'YYYY-MM-DD'. */
export function todayYmd(timeZone: string, now: Date = new Date()): string {
  return ymdInZone(now, timeZone)
}

/**
 * Whether a calendar day is today or later, in the café's timezone.
 *
 * A plain string comparison is correct here — 'YYYY-MM-DD' sorts
 * chronologically — and it is the whole point: no instant is ever built from
 * the stored date, so no zone can shift it.
 */
export function isTodayOrLater(ymd: string, timeZone: string, now: Date = new Date()): boolean {
  return ymd >= todayYmd(timeZone, now)
}

/**
 * A calendar day as a Date at LOCAL midnight, for display only.
 *
 * getDate() and toLocaleDateString() read local fields, so building the Date
 * from local fields means they return the stored day on any device, in any
 * zone. Invalid Date for anything that is not a real 'YYYY-MM-DD' — the server
 * validates the format, so this only guards against data it did not write.
 */
export function ymdToLocalDate(ymd: string): Date {
  const m = YMD.exec(ymd)
  if (!m) return new Date(Number.NaN)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/**
 * The business day a cash-up belongs to, in the café's timezone.
 *
 * Before `cutoffHour` in the morning the night shift is still being counted,
 * so it is the previous day's cash-up. This used to read the device's own
 * getHours()/getDate(), which is right only on a device in the café's zone —
 * a manager signing in from abroad got the wrong day's form.
 *
 * The step back is done on the calendar day, not by subtracting hours from the
 * instant, so a daylight-saving change cannot move the cutoff by an hour.
 */
export function cashUpDay(timeZone: string, now: Date = new Date(), cutoffHour = 10): string {
  const p = zonedParts(now, timeZone)
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day - (p.hour < cutoffHour ? 1 : 0)))
  const pad = (n: number) => String(n).padStart(2, '0')
  // UTC getters on a date built in UTC: this is calendar arithmetic, no zone decides it.
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`
}

export interface ZonedParts {
  year: number
  /** 1-12, not 0-11 like Date.getMonth(). */
  month: number
  day: number
  /** 0-23. */
  hour: number
  minute: number
}

/**
 * The wall-clock fields of an instant in a given timezone.
 *
 * What getFullYear()/getMonth()/getHours() would return if the machine running
 * this were in that zone — which is exactly the thing that cannot be assumed.
 * On a server those getters read the HOST's zone, and a host is usually UTC:
 * three hours behind Beirut, which moved receipts into the previous month and
 * let the till charge a sale price the screen had already stopped showing.
 */
export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(at)
  const n = (type: string) => Number(parts.find(p => p.type === type)?.value ?? Number.NaN)
  return {
    year: n('year'),
    month: n('month'),
    day: n('day'),
    // h23 should already give 0-23, but some engines have printed midnight as
    // "24"; reduce rather than trust it.
    hour: n('hour') % 24,
    minute: n('minute'),
  }
}

/**
 * The Monday-to-Sunday week an instant falls in, in the café's timezone.
 *
 * `start` is an identity, not a label: a weekly order is filed under it and
 * the fulfilment bar matches receipts against it. This used to be `getDay()`
 * and `getDate()` on the submitting device, so a manager ordering from abroad
 * — or from a laptop whose clock had drifted a day — filed the order under the
 * wrong week, where it reads as a week nobody ordered for and a week ordered
 * for twice.
 *
 * It lives here rather than in weeklyOrders.ts because that module imports
 * Firestore, so nothing there can be asserted. This is pure, and
 * `verify:dates` covers it.
 *
 * The stepping is calendar arithmetic on a UTC date built from the café's own
 * Y-M-D, the same technique cashUpDay() uses: no zone and no daylight-saving
 * change can move a week boundary by an hour.
 */
export function cafeWeek(timeZone: string, now: Date = new Date()): { start: string; label: string } {
  const p = zonedParts(now, timeZone)
  // NOON UTC, not midnight. These Dates are only carriers for a calendar
  // date, but anything that formats one in the host's zone shifts a UTC
  // midnight back a day on every host west of Greenwich, and the label would
  // name the day before the one it was built from. Noon does not make that
  // safe — UTC+12 and east still roll it forward, so `timeZone: 'UTC'` below
  // is the correction and this is only a narrower blast radius if it is ever
  // dropped. Both, because the guard is one word and easy to lose: the
  // mutation that removed it passed every test here, Beirut being east of
  // UTC, which is exactly how this class of bug keeps reaching production.
  const today = new Date(Date.UTC(p.year, p.month - 1, p.day, 12))
  const dow = today.getUTCDay()                        // 0 Sunday … 6 Saturday
  const monday = new Date(today)
  // Sunday belongs to the week that has just ended, not the one starting.
  monday.setUTCDate(today.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  const pad = (n: number) => String(n).padStart(2, '0')
  // timeZone: 'UTC' is load-bearing. These Dates are UTC-midnight carriers for
  // a calendar date; formatted without it, the host's zone would shift them
  // and a label could name the day before the one it was built from.
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

  return {
    start: `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`,
    label: `${fmt(monday)} – ${fmt(sunday)} ${sunday.getUTCFullYear()}`,
  }
}
