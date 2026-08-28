import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from './firebase'

export type LogAction = 'create' | 'update' | 'delete'

export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

const DEFAULT_EXCLUDE = ['id', 'createdAt', 'updatedAt']

// Firestore rejects `undefined` anywhere in a document. Round-tripping through
// JSON drops/normalizes it the same way the rest of the app already expects.
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

async function writeLog(payload: {
  action: LogAction
  section: string
  label: string
  changes?: FieldChange[]
  snapshot?: object
}) {
  const user = auth.currentUser
  if (!user) return
  await addDoc(collection(db, 'activityLog'), {
    action: payload.action,
    section: payload.section,
    label: payload.label,
    changes: payload.changes ? sanitize(payload.changes) : null,
    snapshot: payload.snapshot ? sanitize(payload.snapshot) : null,
    userEmail: user.email,
    userId: user.uid,
    createdAt: serverTimestamp(),
  })
}

// Simple logger for entities that are just a name (categories, types) — no
// meaningful field-by-field diff to show.
export async function logActivity(action: LogAction, section: string, label: string) {
  await writeLog({ action, section, label })
}

export async function logCreate(section: string, label: string, snapshot: object) {
  await writeLog({ action: 'create', section, label, snapshot })
}

export async function logUpdate(
  section: string,
  label: string,
  before: object,
  after: object,
  exclude: string[] = []
) {
  const changes = diffFields(before, after, exclude)
  if (changes.length === 0) return
  await writeLog({ action: 'update', section, label, changes })
}

export async function logDelete(section: string, label: string, snapshot?: object) {
  await writeLog({ action: 'delete', section, label, snapshot })
}
