// How long a sign-in at the café hub lasts — POS software, stage 3.
//
// Owner's decision, 14 Sep 2026: until phone sign-in exists (stage 5), staff
// sign in on the hub with today's account, and it "should last until they
// check out at night". A Firebase sign-in lasts an hour and renewing it needs
// the internet, which is the one thing a hub is built to do without. So the
// hub checks the sign-in once, while the internet is up, and gives a session
// of its own that runs to the end of the café's night.
//
// The night ends at 05:00 in the café's zone — the first 05:00 at least four
// hours after signing in, so somebody who signs in at 03:00 to close up is not
// put out at 05:00 halfway through the count. The POS has no check-out yet, so
// this, or signing out, is what ends a session.
//
// Pure, and asserted in verify:hub: a session that ends early stops a till
// mid-service, and one that never ends is a lost phone that can still take money.

import { zonedParts } from './dates'

export const HUB_SESSION_ENDS_AT_HOUR = 5
export const HUB_SESSION_MIN_HOURS = 4

/**
 * The instant a wall-clock hour happens on a calendar day in a zone.
 * Corrected against the zone's own clock, so a daylight-saving change cannot
 * move it by an hour.
 */
export function zonedHourInstant(year: number, month: number, day: number, hour: number, timeZone: string): number {
  const wanted = Date.UTC(year, month - 1, day, hour)
  let guess = wanted
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone)
    guess += wanted - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  }
  return guess
}

/** When a session started at `signedInMs` ends: 05:00 café time, at least four hours on. */
export function hubSessionExpiry(signedInMs: number, timeZone: string): number {
  const p = zonedParts(new Date(signedInMs), timeZone)
  const earliest = signedInMs + HUB_SESSION_MIN_HOURS * 3_600_000
  for (let offset = 0; offset < 4; offset++) {
    // Calendar arithmetic on a UTC date: no zone decides which day is next.
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + offset))
    const at = zonedHourInstant(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), HUB_SESSION_ENDS_AT_HOUR, timeZone)
    if (at >= earliest) return at
  }
  return earliest + 24 * 3_600_000
}
