// Printing from the café hub itself — POS software (owner's decision S28,
// 15 Sep 2026).
//
// On a hub, the counter PC prints to network printers on the café network: a
// kitchen ticket on its station's printer as it is sent, and the customer
// receipt on the receipt station's printer as a check closes, when that is
// switched on. No screen needs "Print here", and no internet is needed.
//
// Each is a job recorded in the hub's database under the ticket's or check's
// id, so it prints once however often the document changes, and a job that
// fails is tried again a few times and then reported, never thrown: paper is a
// copy of the order, and the screen is the order.
//
// Pure: which changes make a job, and when to try again. The hub's side is
// server/hubPrinting.ts. Asserted by verify:hub-sync.

import type { Station } from './checks'
import { printerFor, printsFromHub, type PrintingSettings } from './printing'
import { timestampMs } from './timestamps'

/** Hub-only collection: `hubPrintJobs/{ticket_<id> | receipt_<id>}`. */
export const PRINT_JOBS = 'hubPrintJobs'

/**
 * Only something sent or closed this recently prints. A hub that starts again,
 * or a printer switched on later, must not print the evening's backlog.
 */
export const PRINT_WINDOW_MS = 10 * 60_000

/** Tries per job, and how long to wait before each retry. */
export const PRINT_ATTEMPTS = 3
const RETRY_DELAYS_MS = [10_000, 30_000]

export type PrintJobKind = 'ticket' | 'reprint' | 'receipt'

export interface PrintJobPlan {
  id: string
  kind: PrintJobKind
  refId: string
  station: Station
}

const recent = (ms: number, now: number) => Number.isFinite(ms) && ms > 0 && ms <= now + 60_000 && now - ms <= PRINT_WINDOW_MS

/** The job a kitchen ticket makes, or null: a new ticket, just sent, at this hub's branch, whose station prints from the hub. */
export function ticketJob(
  ticket: { id: string; data: Record<string, unknown> },
  settings: PrintingSettings,
  hubBranch: string,
  now: number,
): PrintJobPlan | null {
  const d = ticket.data
  if (!hubBranch || d.branch !== hubBranch || d.status !== 'new') return null
  if (typeof d.station !== 'string' || !recent(timestampMs(d.sentAt, NaN), now)) return null
  const station = d.station as Station
  if (!printsFromHub(printerFor(settings, hubBranch, station))) return null
  return { id: `ticket_${ticket.id}`, kind: 'ticket', refId: ticket.id, station }
}

/**
 * The job a reprint makes (UPGRADE.md T3.6), or null: the ticket's reprint
 * count rose, just now, at this hub's branch, for a station the hub prints.
 * One job per count (`ticket_<id>_r<n>`), so the same reprint never prints
 * twice. Any status but cancelled: a ticket already picked up can still be
 * asked for again.
 */
export function ticketReprintJob(
  ticket: { id: string; data: Record<string, unknown> },
  settings: PrintingSettings,
  hubBranch: string,
  now: number,
): PrintJobPlan | null {
  const d = ticket.data
  const n = Number(d.reprints ?? 0)
  if (!hubBranch || d.branch !== hubBranch || d.status === 'cancelled' || !Number.isInteger(n) || n < 1) return null
  if (typeof d.station !== 'string' || !recent(timestampMs(d.reprintRequestedAt, NaN), now)) return null
  const station = d.station as Station
  if (!printsFromHub(printerFor(settings, hubBranch, station))) return null
  return { id: `ticket_${ticket.id}_r${n}`, kind: 'reprint', refId: ticket.id, station }
}

/** The job a check makes, or null: just closed with its receipt number, receipts on close switched on, printed from the hub. */
export function receiptJob(
  check: { id: string; data: Record<string, unknown> },
  settings: PrintingSettings,
  hubBranch: string,
  now: number,
): PrintJobPlan | null {
  const d = check.data
  if (!hubBranch || d.branch !== hubBranch || d.status !== 'closed') return null
  if (typeof d.receiptNumber !== 'string' || !d.receiptNumber) return null
  if (!recent(timestampMs(d.closedAt, NaN), now)) return null
  if (!settings.receiptOnClose || !printsFromHub(printerFor(settings, hubBranch, settings.receiptStation))) return null
  return { id: `receipt_${check.id}`, kind: 'receipt', refId: check.id, station: settings.receiptStation }
}

/** How long to wait before trying a job again after its `attempts`-th failure, or null when it is not tried again. */
export function retryDelay(attempts: number): number | null {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts >= PRINT_ATTEMPTS) return null
  return RETRY_DELAYS_MS[attempts - 1] ?? null
}
