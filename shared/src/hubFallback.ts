// A branch trades on the online till while its café hub is out of action —
// POS software, stage 4 (owner's decisions S21–S23, 15 Sep 2026).
//
//   S21  An admin switches the branch over by hand, in Café Hubs. Never
//        automatically: the cloud cannot tell a broken counter PC from a café
//        whose internet is down while the hub trades, and phones on mobile
//        data would then trade online at the same time.
//   S22  What the hub sends up while its branch trades online is held for a
//        manager, never applied, so nothing overwrites the online till's work.
//   S23  The branch goes back to the hub only once the online till has no open
//        tables and no open drawer shift there.
//
// A fourth rule follows from S22 and S23 together: the hub must have been back
// in touch, with nothing left unsent, since the branch went online. A hub still
// switched off may hold sales it never sent, and handed back first it would
// send them up as the master, over the online till's checks.
//
// Pure, and asserted by verify:hub-sync. The cloud's side is
// server/hubDevices.ts, the lock is server/hubLock.ts, and the hub's side is
// server/hubSync.ts.

import { timestampMs } from './timestamps'

/** Server-only collection, no Firestore rule: what a hub sent up while its branch traded online. */
export const HELD_ITEMS = 'hubHeldItems'

export type HeldStatus = 'waiting' | 'applied' | 'dismissed'
export type HeldDecision = 'apply' | 'dismiss'

export const isHeldDecision = (raw: unknown): raw is HeldDecision => raw === 'apply' || raw === 'dismiss'

/** When a hub's branch went over to the online till, or null while the hub trades it. */
export function onlineSinceOf(data: Record<string, unknown> | undefined | null): number | null {
  const ms = timestampMs(data?.onlineSince, 0)
  return ms > 0 ? ms : null
}

/** Whether a hub row locks its branch's online till (S10): still paired, and not switched to the online till (S21). */
export function hubLocksBranch(data: Record<string, unknown>): boolean {
  return !data.revokedAt && onlineSinceOf(data) === null
}

/**
 * Whether a hub, telling the cloud how far it has sent up and how far its
 * change log goes, has nothing left to send.
 */
export function caughtUp(sent: unknown, latest: unknown): boolean {
  if (sent === null || latest === null || sent === '' || latest === '') return false
  const s = Number(sent)
  const l = Number(latest)
  return Number.isInteger(s) && Number.isInteger(l) && s >= 0 && l >= 0 && s >= l
}

export interface HandBackState {
  branch: string
  revoked: boolean
  onlineSince: number | null
  /** When the hub last said it had nothing left to send. */
  caughtUpAt: number | null
  /** Checks still open for the branch in the cloud. */
  openChecks: number
  /** Whether the branch's drawer has a shift open in the cloud. */
  openShift: boolean
  /** Items from this hub still waiting for a manager. */
  heldWaiting: number
}

/** Why a branch cannot go back to its hub yet, or null when it can. */
export function handBackProblem(s: HandBackState): string | null {
  if (s.revoked) return 'That hub is unpaired. Pair a counter PC again instead.'
  if (s.onlineSince === null) return `${s.branch} is not trading online; its hub already has it.`
  if (s.caughtUpAt === null || s.caughtUpAt < s.onlineSince) {
    return `The counter PC has not been in touch since ${s.branch} went online, so it may still hold sales it never sent up. Switch it on with the internet, wait a few minutes for it to sync, then hand back.`
  }
  if (s.openChecks > 0) {
    return `${s.openChecks === 1 ? 'A table is' : `${s.openChecks} tables are`} still open at ${s.branch} on the online till. Close ${s.openChecks === 1 ? 'it' : 'them'} first.`
  }
  if (s.openShift) return `The drawer shift at ${s.branch} is still open on the online till. Close it with a count first.`
  if (s.heldWaiting > 0) {
    return `${s.heldWaiting === 1 ? 'One item' : `${s.heldWaiting} items`} the counter PC sent up still ${s.heldWaiting === 1 ? 'waits' : 'wait'} for a manager in Held Hub Sales. Decide ${s.heldWaiting === 1 ? 'it' : 'each one'} first.`
  }
  return null
}

const text = (v: unknown, fallback = '?') => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : typeof v === 'number' ? String(v) : fallback)

/**
 * One line saying what a held document or movement is, for the manager
 * deciding it. Read from plain fields only, so it works on a document as it was
 * sent up.
 */
export function heldSummary(
  collection: string,
  data: Record<string, unknown> | null | undefined,
  move?: { collection: string; docId: string; delta: number } | null,
): string {
  if (move) return `Stock ${move.delta > 0 ? '+' : ''}${move.delta} of ${text(move.docId)} (${move.collection})`
  const d = data ?? {}
  switch (collection) {
    case 'checks': {
      const lines = Array.isArray(d.lines) ? d.lines.filter(l => (l as { status?: unknown })?.status !== 'void').length : 0
      return `Table ${text(d.tableNumber)}, ${text(d.status)}, ${lines} ${lines === 1 ? 'line' : 'lines'}${typeof d.invoiceNumber === 'string' ? `, receipt ${d.invoiceNumber}` : ''}`
    }
    case 'kitchenTickets':
      return `${text(d.station, 'Kitchen')} ticket, ${text(d.status)}`
    case 'drawerShifts':
      return `Drawer shift, ${text(d.status)}`
    case 'branchDrawers':
      return d.openShiftId ? 'Drawer: a shift open' : 'Drawer: no shift open'
    default:
      return `${collection} document`
  }
}
