// Reading the points movements an export is built from.
//
// The arithmetic is in shared/src/loyaltyExport.ts — pure, and asserted by
// `npm run verify:export`. This file only fetches the right documents.
//
// ── Why redemptions take two queries ───────────────────────────────────────
// A redemption is counted on the day it was HANDED OVER, which may be days
// after it was requested. A query ranged on createdAt alone would miss one
// asked for last month and collected this month — the very transaction an
// owner is asking about. So it queries both fields and unions by id. Both are
// single-field ranges, so neither needs a composite index.

import { requestedBranches, readInChunks } from './salesExport'
import type { CutShort } from '../salesExport'
import { buildLoyaltyExport, loyaltyLiability, type LoyaltyExport, type LoyaltyLiability } from '../loyaltyExport'
import type { ExportRequest } from './salesExport'
import { adminDb } from './firebaseAdmin'
import { readSettings } from './settings'
import { addDays } from '../reportPeriods'
import { todayYmd } from '../dates'

export async function readLoyaltyExport(
  range: ExportRequest,
  opts: { timeZone: string; branches: string[] },
): Promise<LoyaltyExport & { from: string; to: string; branches: string[]; cutShort: CutShort | null }> {
  const wanted = new Set(requestedBranches(range, opts.branches))

  // In chunks of café days (T7.2), each with its own cap, and said when one
  // is met: a points ledger cut short understates the liability.
  const tx = await readInChunks('transactions', 'createdAt', range, opts.timeZone)
  // And those REVERSED in the range, whenever they were issued: a reversal is
  // a movement on its own day (T7.14, gap 19).
  const reversedIn = await readInChunks('transactions', 'reversedAt', range, opts.timeZone)
  const txById = new Map<string, Record<string, unknown>>()
  for (const d of [...tx.docs, ...reversedIn.docs]) txById.set(d.id, d.data)
  const txDocs = [...txById.entries()].map(([id, data]) => ({ id, data: () => data }))

  // Requested-in-window and confirmed-in-window, unioned: see the note above.
  const requested = await readInChunks('redemptions', 'createdAt', range, opts.timeZone)
  const confirmed = await readInChunks('redemptions', 'confirmedAt', range, opts.timeZone)
  const byId = new Map<string, Record<string, unknown>>()
  for (const d of [...requested.docs, ...confirmed.docs]) byId.set(d.id, { id: d.id, ...d.data })
  const cuts = [tx.cutShort, reversedIn.cutShort, requested.cutShort, confirmed.cutShort].filter((c): c is CutShort => c !== null)
  const cutShort = cuts.sort((a, b) => a.completeThrough.localeCompare(b.completeThrough))[0] ?? null

  const branchOk = (b: unknown) => wanted.size === 0 || wanted.has(String(b ?? ''))

  // Each movement is kept by its own day inside buildLoyaltyExport().
  const transactions = txDocs
    .map(d => ({ id: d.id, ...d.data() }) as Record<string, unknown>)
    .filter(t => branchOk(t.branchId))

  const redemptions = [...byId.values()]
    .filter(r => branchOk(r.branchId))

  return {
    ...buildLoyaltyExport(transactions, redemptions, { timeZone: opts.timeZone, from: range.from, to: range.to }),
    cutShort,
    from: range.from,
    to: range.to,
    branches: [...wanted],
  }
}

/**
 * The points liability for a period (UPGRADE.md T7.14): the ledger for the
 * period, today's balances, and the ledger from the day after the period up
 * to today, so the balance at the period's end can be worked back. Balances
 * belong to members, not branches, so the balance side reads every branch
 * whatever the caller chose; the movements are the caller's branches.
 */
export async function readLoyaltyLiability(
  range: ExportRequest,
  opts: { timeZone: string; branches: string[] },
): Promise<LoyaltyLiability & { period: LoyaltyExport & { branches: string[]; cutShort: CutShort | null }; asOf: string }> {
  const everyBranch = { timeZone: opts.timeZone, branches: [] as string[] }
  const today = todayYmd(opts.timeZone)
  const [period, whole, settings, members] = await Promise.all([
    readLoyaltyExport(range, opts),
    readLoyaltyExport({ ...range, branch: '' }, everyBranch),
    readSettings(),
    adminDb().collection('users').where('points', '>', 0).get(),
  ])
  const after = range.to < today
    ? await readLoyaltyExport({ from: addDays(range.to, 1), to: today, branch: '' }, everyBranch)
    : null
  const balanceNow = members.docs.reduce((n, d) => n + (Number(d.data().points) || 0), 0)
  const cuts = [period.cutShort, whole.cutShort, after?.cutShort ?? null].filter((c): c is CutShort => c !== null)
  return {
    ...loyaltyLiability({
      period: { ...whole, days: whole.days },
      after,
      balanceNow,
      members: members.size,
      branches: period.branches,
      pointValueUsd: settings.pointValueUsd,
    }),
    period: { ...period, cutShort: cuts.sort((a, b) => a.completeThrough.localeCompare(b.completeThrough))[0] ?? null },
    asOf: today,
  }
}
