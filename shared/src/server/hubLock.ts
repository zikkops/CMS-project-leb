// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// While a branch has a paired café hub, the online till for that branch is
// view-only — POS software, stage 4 (owner's decision S10, 14 Sep 2026).
//
// The hub is master for its branch's checks, tickets and drawer, and sends them
// up as they stand (hubPush.ts). A payment taken on the online till meanwhile
// is written over by the hub's copy of that check at its next push, and a table
// opened online is a second open check the hub never sees. So the cloud's till
// routes refuse to change that branch's trading. Reading it is still fine.
//
// On the hub itself it is the master, so nothing is refused there, except while
// an admin has switched its branch to the online till because the counter PC
// was out of action (S21). Then the hub refuses the same writes, until the
// branch is handed back (S23).

import type { Firestore } from 'firebase-admin/firestore'
import { adminDb, hubDbPath } from './firebaseAdmin'
import { HttpError } from './auth'
import { hubLocksBranch } from '../hubFallback'

const DEVICES = 'hubDevices'

/** What a till route is about to change: a branch named outright, or a document that belongs to one. */
export type TradingTarget = { branch: string } | { checkId: string } | { ticketId: string } | { shiftId: string }

export interface BranchHub {
  id: string
  name: string
}

/**
 * The paired hub trading a branch, from the hub rows, or null. An unpaired one
 * no longer counts, nor does one whose branch an admin switched to the online till.
 */
export function activeHubFor(rows: readonly { id: string; data: Record<string, unknown> }[], branch: string): BranchHub | null {
  const row = rows.find(r => r.data.branch === branch && hubLocksBranch(r.data))
  return row ? { id: row.id, name: typeof row.data.name === 'string' ? row.data.name : '' } : null
}

/** What the online till says when it is refused. */
export function hubOnlyMessage(branch: string, hub: BranchHub): string {
  return `${branch} trades on its café hub${hub.name ? ` (${hub.name})` : ''}, so the online till is view-only there. Use the counter PC.`
}

/** The paired hub trading a branch, or null. */
export async function branchHub(branch: string, db: Firestore = adminDb()): Promise<BranchHub | null> {
  if (!branch) return null
  const snap = await db.collection(DEVICES).where('branch', '==', branch).get()
  return activeHubFor(snap.docs.map(d => ({ id: d.id, data: d.data() ?? {} })), branch)
}

/** The branch a till write is about, or null when the document is not there — the write itself then says so. */
async function targetBranch(target: TradingTarget, db: Firestore): Promise<string | null> {
  if ('branch' in target) return target.branch
  const [collection, id] = 'checkId' in target
    ? ['checks', target.checkId]
    : 'ticketId' in target
      ? ['kitchenTickets', target.ticketId]
      : ['drawerShifts', target.shiftId]
  if (!id || id.includes('/')) return null
  const branch = (await db.doc(`${collection}/${id}`).get()).data()?.branch
  return typeof branch === 'string' ? branch : null
}

/** What the counter PC says while its branch trades on the online till. */
export function onlineInsteadMessage(branch: string): string {
  return `${branch || 'This branch'} is trading on the online till while this counter PC was out of action, so it takes no orders, payments or drawer changes here. An admin hands it back from Settings → Café Hubs.`
}

/** On a hub: whether an admin switched its branch to the online till, as the hub last heard. */
export async function hubTradingOnline(db: Firestore = adminDb()): Promise<{ online: boolean; branch: string }> {
  const d = (await db.doc('hubMeta/device').get()).data()
  return { online: d?.tradingOnline === true, branch: typeof d?.branch === 'string' ? d.branch : '' }
}

/**
 * Refuses, 409, a till write in the cloud for a branch a café hub is trading,
 * and on a hub, every till write while its branch trades online.
 * Call it after the caller is checked and before anything is written.
 */
export async function refuseWhileHubbed(
  target: TradingTarget,
  { db = adminDb(), onHub = Boolean(hubDbPath()) }: { db?: Firestore; onHub?: boolean } = {},
): Promise<void> {
  if (onHub) {
    const { online, branch } = await hubTradingOnline(db)
    if (online) throw new HttpError(409, onlineInsteadMessage(branch))
    return
  }
  const branch = await targetBranch(target, db)
  if (!branch) return
  const hub = await branchHub(branch, db)
  if (hub) throw new HttpError(409, hubOnlyMessage(branch, hub))
}
