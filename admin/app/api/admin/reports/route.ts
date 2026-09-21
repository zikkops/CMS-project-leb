// Reports over closed checks (UPGRADE.md T3.2–T3.4).
//
// GET ?report=voids|mix&from=YYYY-MM-DD&to=YYYY-MM-DD&branch=
// GET ?report=hourly&from=DAY&to=DAY&branch=      one day, beside the same day a week before
// GET ?report=timesheet&from=&to=&branch=           who clocked in and out (T3.12)
//
// Gated on `endOfDay`, as the accountant's export is: the same people, reading
// the same money, and deliberately not a new SECTION_ACCESS key. The checks
// come from the export's own read (readClosedChecks()), so a report and the
// export cannot disagree about which café day a check was, and the figures
// are built here by shared/src/salesReports.ts. The browser names a range and
// a branch, never a figure.

import { requireSection, toResponse, HttpError, type Caller } from '@big-cms/shared/server/auth'
import { parseExportRange, readClosedChecks, readInChunks, readRefundedChecks, readSalesExport, requestedBranches } from '@big-cms/shared/server/salesExport'
import { readSettings } from '@big-cms/shared/server/settings'
import { salesSummary } from '@big-cms/shared/salesSummary'
import { tenderSummary } from '@big-cms/shared/tenderSummary'
import { vatReport } from '@big-cms/shared/vatReport'
import { cashUpReport } from '@big-cms/shared/cashUpReport'
import { readCashUp } from '@big-cms/shared/server/cashUp'
import { readReceiptSequence } from '@big-cms/shared/server/receiptSequence'
import { receiptSequence } from '@big-cms/shared/receiptSequence'
import { readLabour } from '@big-cms/shared/server/labour'
import { labourReport } from '@big-cms/shared/labourReport'
import { readReceivedDeliveries } from '@big-cms/shared/server/receivedDeliveries'
import { TIME_ENTRIES, peopleOf, timesheet, type TimeEntry } from '@big-cms/shared/timeClock'
import { timestampMs } from '@big-cms/shared/timestamps'
import { dayBefore, hourlySales, productMix, voidDiscountReport } from '@big-cms/shared/salesReports'
import { adminDb } from '@big-cms/shared/server/firebaseAdmin'
import { BRAND } from '@big-cms/shared/brand'
import type { Check } from '@big-cms/shared/checks'

export const runtime = 'nodejs'

/**
 * Which category each menu item is in NOW, by the item's id. Lines do not
 * carry their category, and the menu is small (two collections, a few dozen
 * documents), so it is read whole rather than per line.
 */
async function menuCategories(): Promise<Record<string, string>> {
  const db = adminDb()
  const [items, categories] = await Promise.all([db.collection('menuItems').get(), db.collection('menuCategories').get()])
  const names = new Map(categories.docs.map(d => [d.id, String(d.data().name ?? '')]))
  const out: Record<string, string> = {}
  for (const d of items.docs) {
    const name = names.get(String(d.data().categoryId ?? ''))
    if (name) out[d.id] = name
  }
  return out
}

export async function GET(request: Request): Promise<Response> {
  try {
    const caller: Caller = await requireSection(request, 'endOfDay')
    const params = new URL(request.url).searchParams
    const range = parseExportRange(params)

    // Branch scoping, as the export does it: an admin sees every branch,
    // anyone else the ones they are assigned to.
    const own = caller.role === 'admin' || caller.branchIds.length === 0 ? BRAND.branches : caller.branchIds
    // One branch, several (a comma list) or all of theirs (UPGRADE.md T7.1).
    const chosen = requestedBranches(range, own)

    const timeZone = BRAND.locale.timezone
    const report = params.get('report')
    // With several branches, each report answers per branch as well
    // (T7.1): the same function over each branch's own checks, so the
    // screen's "All" row, the sum of these, is the same figure.
    const perBranch = <T,>(checks: Check[], build: (list: Check[]) => T) =>
      chosen.length > 1 ? chosen.map(branch => ({ branch, report: build(checks.filter(c => c.branch === branch)) })) : []
    if (report === 'sales') {
      // The sales summary (T7.3): the export's own rows, sales by close day
      // and refunds by refund day, added up per branch and then across.
      const { exchangeRate } = await readSettings()
      const result = await readSalesExport(range, { timeZone, fallbackRate: exchangeRate, branches: own })
      return Response.json(
        { ok: true, from: range.from, to: range.to, branches: chosen, cutShort: result.cutShort, ...salesSummary(result.checks, chosen) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (report === 'payments') {
      // Payments and tenders (T7.5), from the export's own payment and refund rows.
      const { exchangeRate } = await readSettings()
      const result = await readSalesExport(range, { timeZone, fallbackRate: exchangeRate, branches: own })
      const paidChecks = new Set(result.payments.map(p => p.receipt)).size
      return Response.json(
        { ok: true, from: range.from, to: range.to, branches: chosen, cutShort: result.cutShort, paidChecks, ...tenderSummary(result.payments, result.checks, chosen) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (report === 'vat') {
      // The VAT report (T7.6): output by rate from the export's rows, reversals
      // on refunds in their own period, and input VAT from received deliveries.
      const { exchangeRate } = await readSettings()
      const [result, received] = await Promise.all([
        readSalesExport(range, { timeZone, fallbackRate: exchangeRate, branches: own }),
        readReceivedDeliveries(range, { timeZone, branches: own }),
      ])
      return Response.json(
        { ok: true, from: range.from, to: range.to, branches: chosen, cutShort: result.cutShort ?? received.cutShort, ...vatReport(result.checks, received.deliveries, chosen) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (report === 'cashup') {
      // Cash-up and drawer (T7.7): every shift by cash-up day, per currency,
      // with that day's End of Day count beside it.
      const read = await readCashUp(range, { timeZone, branches: own })
      return Response.json(
        { ok: true, from: range.from, to: range.to, branches: read.branches, ...cashUpReport(read.shifts, read.eod, read.branches) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (report === 'labour') {
      // The labour report (T7.11): hours, cost at each day's rate, tips and
      // what payroll owes. Admin only on top of endOfDay: it carries rates,
      // which is why Staff Pay is admin only.
      if (caller.role !== 'admin' && !caller.superadmin) throw new HttpError(403, 'The labour report is for admins: it shows pay rates.')
      const read = await readLabour(range, { timeZone, branches: own })
      return Response.json(
        { ok: true, from: range.from, to: range.to, branches: read.branches, cutShort: read.cutShort, ...labourReport(read) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (report === 'receipts') {
      // The receipt sequence (T7.10): one counter across every branch, so it
      // is read whole and judged whole; only the caller's branches are shown.
      const read = await readReceiptSequence(range, { timeZone, branches: own })
      return Response.json(
        { ok: true, from: range.from, to: range.to, branches: read.branches, cutShort: read.cutShort, ...receiptSequence(read.uses, read.issues, read.blocks, { branches: read.branches }) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (report === 'voids') {
      // The exception report (T7.9): voids and discounts on the checks that
      // closed in the period, and the refunds GIVEN in it, on refundedAt.
      const [{ checks, branches, cutShort }, refunded] = await Promise.all([
        readClosedChecks(range, { timeZone, branches: own }),
        readRefundedChecks(range, { timeZone, branches: own }),
      ])
      return Response.json(
        {
          ok: true, from: range.from, to: range.to, branches, cutShort, checks: checks.length, ...voidDiscountReport(checks, { timeZone, refunded }),
          byBranch: chosen.length > 1 ? chosen.map(branch => ({
            branch,
            totals: voidDiscountReport(checks.filter(c => c.branch === branch), {
              timeZone, refunded: refunded.filter(c => c.branch === branch),
            }).totals,
          })) : [],
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (report === 'mix') {
      const [{ checks, branches, cutShort }, categoryOf] = await Promise.all([
        readClosedChecks(range, { timeZone, branches: own }),
        menuCategories(),
      ])
      return Response.json(
        {
          ok: true, from: range.from, to: range.to, branches, cutShort, ...productMix(checks, { categoryOf }),
          byBranch: perBranch(checks, list => productMix(list, { categoryOf }).totals).map(b => ({ branch: b.branch, totals: b.report })),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (report === 'timesheet') {
      // Clock-ins from the café hubs (UPGRADE.md T3.12), ranged on `at` alone
      // with the export's padded window, then narrowed to the café days asked for.
      // In chunks of café days, and said when a piece meets its cap (T7.2).
      const read = await readInChunks(TIME_ENTRIES, 'at', range, timeZone)
      const wanted = new Set(chosen)
      const entries: TimeEntry[] = read.docs.map(d => d.data).filter(e => wanted.has(String(e.branch))).map(e => ({
        uid: String(e.uid), name: String(e.name ?? ''), branch: String(e.branch), direction: e.direction === 'out' ? 'out' : 'in', at: timestampMs(e.at, 0),
      }))
      const sheet = timesheet(entries, { timeZone, now: Date.now() })
      const shifts = sheet.shifts.filter(s => s.day >= range.from && s.day <= range.to)
      const byBranch = chosen.length > 1
        ? chosen.map(branch => {
            const own = shifts.filter(s => s.branch === branch)
            return { branch, totals: { shifts: own.length, minutes: own.reduce((m, s) => m + (s.minutes ?? 0), 0) } }
          })
        : []
      return Response.json(
        // People from the shifts in the range only (gap 17), not the padded window.
        { ok: true, from: range.from, to: range.to, branches: [...wanted], ...sheet, shifts, people: peopleOf(shifts), byBranch, cutShort: read.cutShort },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (report === 'hourly') {
      if (range.from !== range.to) throw new HttpError(400, 'The hourly report is for one day.')
      // The day and the same weekday before it: one read of the eight days between.
      const week = { ...range, from: dayBefore(range.to, 7) }
      const { checks, branches, cutShort } = await readClosedChecks(week, { timeZone, branches: own })
      return Response.json(
        {
          ok: true, branches, cutShort, ...hourlySales(checks, { timeZone, day: range.to }),
          byBranch: perBranch(checks, list => hourlySales(list, { timeZone, day: range.to }).totals).map(b => ({ branch: b.branch, totals: b.report })),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    throw new HttpError(400, 'Unknown report.')
  } catch (err) {
    return toResponse(err)
  }
}
