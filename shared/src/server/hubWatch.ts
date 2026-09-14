// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Running the till's live queries on the café hub — POS software, stage 3.
//
// The till asks for a plan (pos/app/lib/backend/queries.ts). Online, the cloud
// runs it as a Firestore listener. On a hub, /api/hub/query runs it here, over
// the hub's store, whose where / orderBy / limit behave as Firestore's; the
// till asks again when the change feed (/api/hub/changes) says a write touched
// the plan's collection.
//
// The plan's shape is repeated here rather than imported: shared/ cannot import
// from an app. The route hands over pos's QueryPlan, which fits this, and
// verify:hub runs both runPlan() and runHubPlan() over the same documents and
// asserts they agree.

import { Timestamp } from 'firebase-admin/firestore'
import type { HubStore, LocalQuery } from './hubStore'

export interface HubPlan {
  collection: string
  docId?: string
  where: readonly { field: string; op: '==' | 'in' | '>='; value: unknown }[]
  orderBy?: { field: string; direction: 'asc' | 'desc' }
  limit?: number
}

export interface HubDoc {
  id: string
  data: Record<string, unknown>
}

/** A plan's value as the store wants it: a timestamp as a Timestamp, a list as a plain array. */
function storeValue(value: unknown): unknown {
  if (Array.isArray(value)) return [...value]
  if (value && typeof value === 'object' && 'timestampMs' in value) {
    return Timestamp.fromMillis(Number((value as { timestampMs: unknown }).timestampMs))
  }
  return value
}

export async function runHubPlan(store: HubStore, plan: HubPlan): Promise<HubDoc[]> {
  if (plan.docId !== undefined) {
    const snap = await store.doc(`${plan.collection}/${plan.docId}`).get()
    return snap.exists ? [{ id: snap.id, data: snap.data() ?? {} }] : []
  }
  let q: LocalQuery = store.collection(plan.collection)
  for (const f of plan.where) q = q.where(f.field, f.op, storeValue(f.value))
  if (plan.orderBy) q = q.orderBy(plan.orderBy.field, plan.orderBy.direction)
  if (plan.limit !== undefined) q = q.limit(plan.limit)
  return (await q.get()).docs.map(d => ({ id: d.id, data: d.data() ?? {} }))
}
