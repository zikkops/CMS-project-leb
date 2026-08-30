// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The server-side twin of app/lib/activityLog.ts. Same collection, same
// document shape, so /admin/logs renders entries from a route handler exactly
// as it renders entries written from the browser.
//
// This exists because moving a mutation into a route handler would otherwise
// silently drop it out of the audit log: the client logger reads
// auth.currentUser, which does not exist on the server. Any write that used to
// be logged from the browser must keep being logged after it moves — an audit
// trail with a hole in it is worse than one you know is incomplete.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import type { Caller } from './auth'

export type LogAction = 'create' | 'update' | 'delete'

export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

const DEFAULT_EXCLUDE = ['id', 'createdAt', 'updatedAt', 'claimsUpdatedAt']

// Firestore rejects `undefined` anywhere in a document. Round-tripping through
// JSON drops/normalizes it the same way the client logger already does.
function sanitize<T>(value: T): T {
  return value === undefined ? (null as T) : JSON.parse(JSON.stringify(value))
}

export function diffFields(
  before: object,
  after: object,
  exclude: string[] = []
): FieldChange[] {
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const skip = new Set([...DEFAULT_EXCLUDE, ...exclude])
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  const changes: FieldChange[] = []
  for (const key of keys) {
    if (skip.has(key)) continue
    if (JSON.stringify(b[key] ?? null) !== JSON.stringify(a[key] ?? null)) {
      changes.push({ field: key, before: sanitize(b[key] ?? null), after: sanitize(a[key] ?? null) })
    }
  }
  return changes
}

async function writeLog(actor: Caller, payload: {
  action: LogAction
  section: string
  label: string
  changes?: FieldChange[]
  snapshot?: object
}) {
  await adminDb().collection('activityLog').add({
    action: payload.action,
    section: payload.section,
    label: payload.label,
    changes: payload.changes ? sanitize(payload.changes) : null,
    snapshot: payload.snapshot ? sanitize(payload.snapshot) : null,
    userEmail: actor.email,
    userId: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
  })
}

export async function logActivity(actor: Caller, action: LogAction, section: string, label: string) {
  await writeLog(actor, { action, section, label })
}

export async function logCreate(actor: Caller, section: string, label: string, snapshot: object) {
  await writeLog(actor, { action: 'create', section, label, snapshot })
}

export async function logUpdate(
  actor: Caller,
  section: string,
  label: string,
  before: object,
  after: object,
  exclude: string[] = []
) {
  const changes = diffFields(before, after, exclude)
  if (changes.length === 0) return
  await writeLog(actor, { action: 'update', section, label, changes })
}

export async function logDelete(actor: Caller, section: string, label: string, snapshot?: object) {
  await writeLog(actor, { action: 'delete', section, label, snapshot })
}
