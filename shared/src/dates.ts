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
