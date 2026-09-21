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
import { buildExport, closedAtParts, exportCutShort, refundedAtParts, EXPORT_CHECK_CAP, type CutShort, type SalesExport } from '../salesExport'
import type { Check } from '../checks'
import { readBranchList, rangeChunks, MAX_REPORT_DAYS } from '../reportPeriods'

/**
 * The widest range one request may ask for.
 *
 * A quarter covers a VAT filing, which is the reason this exists. Wider than
 * that is a request to read the entire history in one go, and an export that
 * can do that by accident is an export that will.
 */
// A year and a quarter (UPGRADE.md T7.2): last year beside this one. Read in
// chunks (readInChunks()), so the length no longer decides whether a read is
// cut short; this bound is only there so nothing asks for the whole history.
export const MAX_RANGE_DAYS = MAX_REPORT_DAYS

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
    throw new HttpError(400, `That is ${days} days. A report covers at most ${MAX_RANGE_DAYS} days (a year and a quarter).`)
  }
  return { from, to, branch: params.get('branch') ?? '' }
}

/**
 * The branches a request names, among the caller's own (UPGRADE.md T7.1): one,
 * a comma list, or '' / 'all' for every one of theirs. A branch that is not
 * theirs refuses the request with 403, never quietly dropped.
 */
export function requestedBranches(range: Pick<ExportRequest, 'branch'>, own: readonly string[]): string[] {
  const list = readBranchList(range.branch, own)
  if (typeof list === 'string') throw new HttpError(403, list)
  return list
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
  // Sales by the day they closed, and refunds by the day they were given
  // (T7.4): a check closed last month and refunded this month is read for its
  // refund, and appears here as a credit, not as a sale.
  const [{ checks, branches, cutShort }, refunded] = await Promise.all([
    readClosedChecks(range, opts),
    readRefundedChecks(range, opts),
  ])
  const byId = new Map(checks.map(c => [c.id, c]))
  for (const c of refunded) if (!byId.has(c.id)) byId.set(c.id, c)
  return {
    ...buildExport([...byId.values()], { timeZone: opts.timeZone, fallbackRate: opts.fallbackRate, from: range.from, to: range.to }),
    cutShort,
    from: range.from,
    to: range.to,
    branches,
  }
}

/**
 * Checks REFUNDED on the café days asked for (T7.4), whenever they closed.
 * Ranged on `refundedAt` alone with the same padded window, so it needs no
 * composite index, then narrowed to the branches and the café days.
 */
export async function readRefundedChecks(
  range: ExportRequest,
  opts: { timeZone: string; branches: string[] },
): Promise<Check[]> {
  const read = await readInChunks('checks', 'refundedAt', range, opts.timeZone)
  const wanted = new Set(requestedBranches(range, opts.branches))
  return read.docs
    .map(doc => ({ id: doc.id, ...doc.data }) as Check)
    .filter(c => c.status === 'refunded' && wanted.has(c.branch))
    .filter(c => {
      const { day } = refundedAtParts(c as Check & { refundedAt?: unknown }, opts.timeZone)
      return Boolean(day) && day >= range.from && day <= range.to
    })
}

/**
 * The checks that closed on the café days asked for, at the branches asked
 * for: the export's read, shared by the reports (UPGRADE.md T3.2–T3.4) so a
 * report and the export cannot disagree about which day a check was.
 */
/**
 * Documents of a collection whose `field` (a Timestamp) falls in the café days
 * asked for, read a month of café days at a time (UPGRADE.md T7.2), oldest
 * first, each piece with the padded window and its own cap. Pieces overlap by
 * their padding, so documents are kept once. If any piece meets its cap, the
 * answer is whole only through the day before the first place it was cut.
 * Ranged on the one field, so no composite index is needed.
 */
export async function readInChunks(
  collection: string,
  field: string,
  range: Pick<ExportRequest, 'from' | 'to'>,
  timeZone: string,
): Promise<{ docs: { id: string; data: Record<string, unknown> }[]; cutShort: CutShort | null }> {
  const seen = new Map<string, Record<string, unknown>>()
  let cutShort: CutShort | null = null
  for (const piece of rangeChunks(range.from, range.to)) {
    const { start, end } = paddedWindow(piece.from, piece.to)
    const snap = await adminDb().collection(collection)
      .where(field, '>=', start)
      .where(field, '<=', end)
      .orderBy(field, 'asc')
      .limit(EXPORT_CHECK_CAP)
      .get()
    for (const doc of snap.docs) if (!seen.has(doc.id)) seen.set(doc.id, doc.data())
    const last = snap.docs[snap.docs.length - 1]
    const cut = last ? exportCutShort(snap.size, EXPORT_CHECK_CAP, closedAtParts(last.data()[field], timeZone).day) : null
    // The earliest cut is where the whole answer stops being complete.
    if (cut && (!cutShort || cut.completeThrough < cutShort.completeThrough)) cutShort = cut
  }
  return { docs: [...seen.entries()].map(([id, data]) => ({ id, data })), cutShort }
}

export async function readClosedChecks(
  range: ExportRequest,
  opts: { timeZone: string; branches: string[] },
): Promise<{ checks: Check[]; branches: string[]; cutShort: CutShort | null }> {
  // Ranged on closedAt alone: a single-field range needs no composite index,
  // and the alternative — branch equality plus this range — needs one per
  // shape. The branch filter happens below, on a result set already bounded
  // by the date window. Read in chunks, so a year does not meet the cap (T7.2).
  const read = await readInChunks('checks', 'closedAt', range, opts.timeZone)
  const cutShort = read.cutShort
  const snap = { docs: read.docs.map(d => ({ id: d.id, data: () => d.data })) }

  const wanted = new Set(requestedBranches(range, opts.branches))
  const checks: Check[] = []
  for (const doc of snap.docs) {
    const check = { id: doc.id, ...doc.data() } as Check
    if (wanted.size > 0 && !wanted.has(check.branch)) continue
    // The café day, from the same function the rows are built with.
    const { day } = closedAtParts(check.closedAt, opts.timeZone)
    if (!day || day < range.from || day > range.to) continue
    checks.push(check)
  }
  return { checks, branches: [...wanted], cutShort }
}
