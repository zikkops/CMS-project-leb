// How a table is held for a booking.
//
// A reservation does not merely record an intention — it takes a LOCK on each
// half-hour bucket it covers, one document per table per bucket, created in
// the same transaction as the request. That is what stops two customers
// booking the same table for the same time: the second write hits a document
// that already exists.
//
// Locks are taken when the request is MADE, not when staff approve it, so a
// pending request already holds its slot. Rejecting is what releases it.
//
// ── Why this is its own file ───────────────────────────────────────────────
// These four functions were private to shared/src/tableReservations.ts, which is
// a 'use client' module. Rejecting a booking has to delete exactly the same
// lock documents the request created, and that now happens server-side — so
// the id formula has to be reachable from both. It must produce byte-identical
// ids on either side or a rejection leaves orphaned locks that silently block
// a table forever.
//
// No React and no Firebase import here on purpose, so shared/src/server/** can
// import it without dragging the client SDK into the server bundle.

import { BRAND } from './brand'
import { zonedParts } from './dates'

/** Bookings are held in half-hour slots. */
export const BUCKET_MINUTES = 30

// ── Why these read the café's timezone and not "local" ─────────────────────
// The header's own rule — byte-identical ids on both sides — was broken by
// the two functions below it. They used getFullYear()/getHours(), which read
// the zone of whatever runs them: the customer's browser when a booking takes
// its locks, the server's host when a rejection releases them. A host is
// usually UTC. The server then computed ids three hours off, deleted locks
// that did not exist — a no-op, not an error — and left the real ones in
// place, blocking the table for that slot indefinitely. Two customers in
// different zones likewise computed different ids for the same real slot, so
// the lock could not stop them booking it twice.
//
// Computed in the café's zone, the ids are the same everywhere. For every lock
// a Beirut device already created they are also byte-identical to before, so
// nothing existing becomes unreachable — asserted in scripts/verify-dates.mjs.

/** YYYYMMDD in the café's timezone — a booking belongs to the day the café is open. */
export function dateKey(d: Date): string {
  const { year, month, day } = zonedParts(d, BRAND.locale.timezone)
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`
}

/** Which half-hour of the café's day, counted from its midnight. */
export function bucketIndex(d: Date): number {
  const { hour, minute } = zonedParts(d, BRAND.locale.timezone)
  return Math.floor((hour * 60 + minute) / BUCKET_MINUTES)
}

/**
 * The lock document id for one table in one slot.
 *
 * Deterministic on purpose: nothing stores the list of locks a reservation
 * took, so releasing them means recomputing the same ids from the same start
 * and end. Change this formula and every existing lock becomes unreachable.
 */
export function lockDocId(tableId: string, d: Date): string {
  return `${tableId}__${dateKey(d)}_${bucketIndex(d)}`
}

/** Every bucket start between `start` (inclusive) and `end` (exclusive). */
export function bucketStartTimesInRange(start: Date, end: Date): Date[] {
  const starts: Date[] = []
  let cur = new Date(start)
  while (cur < end) {
    starts.push(new Date(cur))
    cur = new Date(cur.getTime() + BUCKET_MINUTES * 60000)
  }
  return starts
}
