// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// The server-side twin of shared/src/activityLog.ts. Same collection, same
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
import { recordError } from './errorReports'
import { todayYmd } from '../dates'
import { BRAND } from '../brand'
import type { AppName } from '../errorReport'

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

/**
 * Writes the entry, and never throws (UPGRADE.md T5.9).
 *
 * Every caller logs AFTER its write has committed: a sale closed, a payment
 * taken, a stock move. An entry that fails to write used to throw out of the
 * route, so the till showed an error for a sale that had happened, and the
 * waiter tried again. Now the failure goes to the error reports
 * (/admin/errors, one document per distinct fault) and the request answers as
 * what it was: done.
 */
async function writeLog(actor: Caller, payload: {
  action: LogAction
  section: string
  label: string
  changes?: FieldChange[]
  snapshot?: object
}) {
  try {
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
  } catch (err) {
    console.error('[activityLog] an entry was not written:', err)
    await reportLogFailure(payload.section, err)
  }
}

/** Which app this server is; set per app in next.config's env, admin when unset. */
function serverApp(): AppName {
  const app = process.env.BIG_CMS_APP
  return app === 'web' || app === 'pos' ? app : 'admin'
}

// The section, not the label: a label can carry a name or an amount, and the
// fingerprint should fold every failure of one kind into one report.
async function reportLogFailure(section: string, err: unknown): Promise<void> {
  try {
    const e = err instanceof Error ? err : new Error(String(err))
    await recordError(serverApp(), {
      message: `Activity log entry not written (${section}): ${e.message}`,
      stack: e.stack ?? '',
      path: 'server/activityLog',
      at: new Date().toISOString(),
    }, todayYmd(BRAND.locale.timezone))
  } catch (again) {
    // Nothing left to tell but the server's own log.
    console.error('[activityLog] and the error report failed too:', again)
  }
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
