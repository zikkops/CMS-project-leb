// Reading the closed checks an export is built from.
//
// The arithmetic is not here — it is in shared/src/salesExport.ts, which is
// pure and asserted by `npm run verify:export`. This file does one thing: get
// the right checks out of Firestore, and refuse a request that would read the
// whole collection.
//
// ── Why the range is padded, and then narrowed ─────────────────────────────
// A café day is not a UTC day. "The 12th" in Beirut starts at 21:00 UTC on the
// 11th, and a sale at 01:30 belongs to the day the café was open, not the day
// the server's clock was on. Rather than compute zone offsets here — date
// maths in a second place is how this repo got receipts numbered into the
// wrong month — the query fetches a day wider at each end, and the pure module
// decides which café day each check actually falls on. One day of padding
// covers every real zone offset (the widest is under 15 hours).

import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { buildExport, closedAtParts, type SalesExport } from '../salesExport'
import type { Check } from '../checks'

/**
 * The widest range one request may ask for.
 *
 * A quarter covers a VAT filing, which is the reason this exists. Wider than
 * that is a request to read the entire history in one go, and an export that
 * can do that by accident is an export that will.
 */
export const MAX_RANGE_DAYS = 100

const YMD = /^\d{4}-\d{2}-\d{2}$/

export interface ExportRequest {
  from: string
  to: string
  /** Empty means every branch the caller may see. */
  branch: string
}

export function parseExportRange(params: URLSearchParams): ExportRequest {
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  if (!YMD.test(from) || !YMD.test(to)) {
    throw new HttpError(400, 'Both dates must be YYYY-MM-DD.')
  }
  if (from > to) throw new HttpError(400, 'The first date is after the last one.')

  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  if (days > MAX_RANGE_DAYS) {
    throw new HttpError(400, `That is ${days} days. Export ${MAX_RANGE_DAYS} at a time or fewer.`)
  }
  return { from, to, branch: params.get('branch') ?? '' }
}

/** One day either side, as instants, so no café day can fall outside the query. */
export function paddedWindow(from: string, to: string): { start: Date; end: Date } {
  return {
    start: new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000),
    end: new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000),
  }
}

export async function readSalesExport(
  range: ExportRequest,
  opts: { timeZone: string; fallbackRate: number; branches: string[] },
): Promise<SalesExport & { from: string; to: string; branches: string[] }> {
  const { start, end } = paddedWindow(range.from, range.to)

  // Ranged on closedAt alone: a single-field range needs no composite index,
  // and the alternative — branch equality plus this range — needs one per
  // shape. The branch filter happens below, on a result set already bounded
  // by the date window.
  const query = adminDb().collection('checks')
    .where('closedAt', '>=', start)
    .where('closedAt', '<=', end)
    .orderBy('closedAt', 'asc')
    .limit(20_000)

  const snap = await query.get()

  const wanted = new Set(range.branch ? [range.branch] : opts.branches)
  const checks: Check[] = []
  for (const doc of snap.docs) {
    const check = { id: doc.id, ...doc.data() } as Check
    if (wanted.size > 0 && !wanted.has(check.branch)) continue
    // The café day, from the same function the rows are built with.
    const { day } = closedAtParts(check.closedAt, opts.timeZone)
    if (!day || day < range.from || day > range.to) continue
    checks.push(check)
  }

  return {
    ...buildExport(checks, { timeZone: opts.timeZone, fallbackRate: opts.fallbackRate }),
    from: range.from,
    to: range.to,
    branches: [...wanted],
  }
}
