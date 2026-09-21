// The cloud backend — online mode, and what the till has always done.
//
// Firestore listeners for reads and the Next routes (on the Admin SDK) for
// writes: the same calls the screens used to make themselves, now in one
// place. What each read means is planQuery() in queries.ts, so the hub backend
// (stage 3) can run the same plan over its local copy.

import {
  collection, doc, limit, onSnapshot, orderBy, query, where, Timestamp,
  type QueryConstraint,
} from 'firebase/firestore'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth, db } from '@big-cms/shared/firebase'
import { authedFetch, unwrap } from '@big-cms/shared/apiClient'
import { planQuery, type FilterValue, type LocalDoc } from './queries'
import type { PosBackend } from './types'
import { personLabel } from '../signOut'
import { clearAdminSessionCookie } from '@big-cms/shared/adminAuth'

/** A plan's value as Firestore wants it: a timestamp as a Timestamp, a list as a plain array. */
function firestoreValue(value: FilterValue): unknown {
  if (Array.isArray(value)) return [...value]
  if (typeof value === 'object' && value !== null && 'timestampMs' in value) return Timestamp.fromMillis(value.timestampMs)
  return value
}

export const cloudBackend: PosBackend = {
  kind: 'cloud',

  // onAuthStateChanged fires once with the restored user (or null): the only
  // reliable "sign-in has settled" signal the SDK gives. auth.currentUser is
  // null during that first tick whether or not anybody is signed in.
  watchAuth: onChange => onAuthStateChanged(auth, user => onChange(Boolean(user))),

  signedIn: () => Boolean(auth.currentUser),
  signedInAs: () => (auth.currentUser ? personLabel({ name: auth.currentUser.displayName, email: auth.currentUser.email }) : null),
  signOut: async () => {
    clearAdminSessionCookie()
    try { await signOut(auth) } catch { /* signed out here regardless */ }
  },

  watch(q, onData, onError) {
    const plan = planQuery(q)

    if (plan.docId !== undefined) {
      return onSnapshot(doc(db, plan.collection, plan.docId),
        snap => {
          const docs: LocalDoc[] = snap.exists() ? [{ id: snap.id, data: snap.data() }] : []
          onData({ docs, changed: docs })
        },
        onError)
    }

    const constraints: QueryConstraint[] = plan.where.map(f => where(f.field, f.op, firestoreValue(f.value)))
    if (plan.orderBy) constraints.push(orderBy(plan.orderBy.field, plan.orderBy.direction))
    if (plan.limit !== undefined) constraints.push(limit(plan.limit))

    return onSnapshot(query(collection(db, plan.collection), ...constraints),
      snap => onData({
        docs: snap.docs.map(d => ({ id: d.id, data: d.data() })),
        changed: snap.docChanges()
          .filter(c => c.type !== 'removed')
          .map(c => ({ id: c.doc.id, data: c.doc.data() })),
      }),
      onError)
  },

  async request(method, path, body, opts) {
    return unwrap(await authedFetch(path, method, body, opts ?? {}))
  },
}
