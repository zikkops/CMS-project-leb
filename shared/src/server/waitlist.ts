// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The waitlist (UPGRADE.md T3.13). Rules in shared/src/waitlist.ts. Server-only
// collection `waitlist`, no Firestore rule, so no rules deploy. Adding takes a
// request id (postOnce), so a Save pressed twice adds one party.

import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRANCHES } from '../branches'
import { BRAND } from '../brand'
import { todayYmd } from '../dates'
import { timestampMs } from '../timestamps'
import { WAITLIST, type WaitEntry, type WaitInput, type WaitStatus } from '../waitlist'

function assertBranch(caller: Caller, branch: string): void {
  if (!(BRANCHES as readonly string[]).includes(branch)) throw new HttpError(400, 'Unknown branch.')
  if (caller.role !== 'admin' && caller.branchIds.length > 0 && !caller.branchIds.includes(branch)) {
    throw new HttpError(403, 'That branch is not one of yours.')
  }
}

function toEntry(id: string, d: Record<string, unknown>): WaitEntry {
  return {
    id, branch: String(d.branch ?? ''), day: String(d.day ?? ''), name: String(d.name ?? ''),
    partySize: Number(d.partySize ?? 1), note: String(d.note ?? ''),
    quotedMinutes: typeof d.quotedMinutes === 'number' ? d.quotedMinutes : null,
    status: d.status === 'seated' || d.status === 'left' ? d.status : 'waiting',
    addedAt: timestampMs(d.addedAt, 0), doneAt: d.doneAt ? timestampMs(d.doneAt, 0) : null,
  }
}

/** Today's list at a branch, today being the café's. Two equality filters: no composite index. */
export async function listWaitlist(caller: Caller, branch: string): Promise<{ day: string; entries: WaitEntry[] }> {
  assertBranch(caller, branch)
  const day = todayYmd(BRAND.locale.timezone)
  const snap = await adminDb().collection(WAITLIST).where('branch', '==', branch).where('day', '==', day).get()
  return { day, entries: snap.docs.map(d => toEntry(d.id, d.data())) }
}

export async function addToWaitlist(caller: Caller, branch: string, input: WaitInput, requestId: string | null): Promise<{ id: string; created: boolean }> {
  assertBranch(caller, branch)
  const db = adminDb()
  const ref = requestId ? db.doc(`${WAITLIST}/${requestId}`) : db.collection(WAITLIST).doc()
  const doc = {
    branch, day: todayYmd(BRAND.locale.timezone), ...input, status: 'waiting' satisfies WaitStatus,
    addedAt: Timestamp.now(), doneAt: null, addedBy: caller.uid, addedByEmail: caller.email ?? '',
  }
  try {
    await ref.create(doc)
    return { id: ref.id, created: true }
  } catch (err) {
    if ((err as { code?: unknown }).code === 6) return { id: ref.id, created: false }
    throw err
  }
}

/** Seated, gone, or back to waiting (a tap that was wrong). */
export async function setWaitStatus(caller: Caller, id: string, status: unknown): Promise<{ name: string; status: WaitStatus; branch: string }> {
  if (status !== 'waiting' && status !== 'seated' && status !== 'left') throw new HttpError(400, 'Seated, left or waiting.')
  if (!id || id.includes('/')) throw new HttpError(400, 'Missing entry.')
  const db = adminDb()
  const ref = db.doc(`${WAITLIST}/${id}`)
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That party is no longer on the list.')
    const d = snap.data() ?? {}
    assertBranch(caller, String(d.branch ?? ''))
    tx.update(ref, { status, doneAt: status === 'waiting' ? null : Timestamp.now(), doneBy: caller.uid })
    return { name: String(d.name ?? ''), status, branch: String(d.branch ?? '') }
  })
}
