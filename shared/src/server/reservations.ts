// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Approving and rejecting bookings — event spots and table reservations.
//
// Three things were wrong with doing this from the browser, and they are the
// same three every mutation in this migration has had:
//
//   1. THE APPROVER CAME FROM THE REQUEST. approveTableReservation(res,
//      staffUid) took the uid as an argument, so the audit trail recorded
//      whoever the browser named. A barista could file an approval under the
//      manager's name.
//
//   2. NOTHING RE-CHECKED THE STATUS. Two managers clicking approve both
//      succeeded, and approving something already rejected silently
//      un-rejected it — overwriting rejectedBy and the reason while leaving
//      the customer's rejection notification standing.
//
//   3. THE AUDIT ENTRY WAS A SEPARATE CALL AFTERWARDS. If it failed, the
//      booking changed state with nothing in the log. Same shape as the
//      end-of-day and delivery bugs fixed earlier in this migration.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import { bucketStartTimesInRange, lockDocId } from '../tableLocks'

export type ReservationKind = 'event' | 'table'
export type ReservationAction = 'approve' | 'reject'

export interface ReservationInput {
  kind: ReservationKind
  id: string
  action: ReservationAction
  reason: string
}

const COLLECTION: Record<ReservationKind, string> = {
  event: 'eventReservations',
  table: 'tableReservations',
}

export function parseReservationInput(body: Record<string, unknown>): ReservationInput {
  const kind = body.kind
  if (kind !== 'event' && kind !== 'table') {
    throw new HttpError(400, 'Missing or unknown kind — expected "event" or "table".')
  }
  const action = body.action
  if (action !== 'approve' && action !== 'reject') {
    throw new HttpError(400, 'Missing or unknown action — expected "approve" or "reject".')
  }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) throw new HttpError(400, 'Missing reservation id.')

  return { kind, id, action, reason: String(body.reason ?? '').trim().slice(0, 500) }
}

export interface ResolveResult {
  /** For the audit label — read from the stored document, not the request. */
  label: string
  branch: string
  /** The customer to notify. */
  userId: string
  /** Lock documents released, for a table rejection. */
  locksReleased: number
}

/**
 * Moves a booking out of `pending`, and only out of `pending`.
 *
 * The status check happens inside a transaction so two managers racing on the
 * same request cannot both win — the second gets a 409 naming what already
 * happened, rather than silently overwriting the first decision.
 *
 * Rejecting a table booking also releases its locks. Those ids are recomputed
 * server-side from the STORED start and end, never from the request: a browser
 * that could name the lock documents to delete could free somebody else's
 * table.
 */
export async function resolveReservation(
  input: ReservationInput,
  actor: { uid: string; email: string },
): Promise<ResolveResult> {
  const db = adminDb()
  const ref = db.doc(`${COLLECTION[input.kind]}/${input.id}`)

  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That booking no longer exists.')

    const data = snap.data() ?? {}
    const status = String(data.status ?? '')
    if (status !== 'pending') {
      throw new HttpError(409,
        `That booking was already ${status} — reload to see the current state.`)
    }

    const now = FieldValue.serverTimestamp()
    tx.update(ref, input.action === 'approve'
      ? { status: 'approved', approvedBy: actor.uid, approvedAt: now }
      : {
          status: 'rejected',
          rejectedBy: actor.uid,
          rejectedAt: now,
          rejectionReason: input.reason || null,
        })

    let locksReleased = 0

    // Rejecting frees the slot. Approving does not — the lock was taken when
    // the request was made and has to stay for the life of the booking.
    if (input.kind === 'table' && input.action === 'reject') {
      const startAt = data.startAt?.toDate?.()
      const blockedUntil = data.blockedUntil?.toDate?.()
      const tableIds: string[] = Array.isArray(data.tableIds) ? data.tableIds : []

      if (startAt && blockedUntil) {
        for (const tableId of tableIds) {
          for (const bucket of bucketStartTimesInRange(startAt, blockedUntil)) {
            tx.delete(db.doc(`tableLocks/${lockDocId(String(tableId), bucket)}`))
            locksReleased++
          }
        }
      }
    }

    const label = input.kind === 'event'
      ? `${data.eventTitle ?? input.id} — ${data.branch ?? ''}`.trim()
      : `${data.branch ?? ''} — Table${(data.tableNumbers ?? []).length > 1 ? 's' : ''} ${(data.tableNumbers ?? []).join(', ')}`.trim()

    return {
      label,
      branch: String(data.branch ?? ''),
      userId: String(data.userId ?? ''),
      locksReleased,
    }
  })
}
