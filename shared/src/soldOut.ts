// "86": a dish sold out for the rest of the day at one branch (UPGRADE.md T3.5).
//
// Pure, and asserted by verify:checks. `available` on a menu item is one switch
// for every branch and stays the admin's; this is the till's, per branch and
// per day. It lives on the menu item (`menuItems/{id}.soldOut`, branch → the
// café day it was marked) because the till already reads the menu live, and
// menu items are already readable, so no new query or Firestore rule is
// needed. On a café hub the field is kept local through each pull (pullSpec's
// keepLocal), so a hub marks its own branch with no internet.
//
// It clears itself: marked on one café day, it means nothing the next. The
// café day turns at 05:00, as the hub's sessions do, so a dish run out of at
// 22:00 is back on the menu for the morning without anybody remembering to
// un-mark it, and one marked at 01:00 is still out until the kitchen closes.

import { cashUpDay } from './dates'

export const SOLD_OUT_DAY_STARTS = 5

/** The café day a sold-out mark belongs to, turning at 05:00 in the café's zone. */
export function soldOutDay(timeZone: string, now: Date = new Date()): string {
  return cashUpDay(timeZone, now, SOLD_OUT_DAY_STARTS)
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** A stored map read defensively: branch → café day, anything else dropped. */
export function readSoldOut(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [branch, day] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof day === 'string' && YMD.test(day)) out[branch] = day
  }
  return out
}

/** Whether an item is sold out at this branch on this café day. A mark from another day has expired. */
export function isSoldOut(raw: unknown, branch: string, day: string): boolean {
  return readSoldOut(raw)[branch] === day
}
