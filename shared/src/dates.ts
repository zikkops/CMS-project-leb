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
