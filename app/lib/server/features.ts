// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Writing the feature flags. The registry and the dependency graph stay in
// code (app/lib/features.ts); this only ever persists what a superadmin chose.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError } from './auth'
import {
  FEATURES, isFeatureOn,
  type FeatureDefinition, type FeatureFlags, type FeatureKey,
} from '../features'

export const FEATURES_DOC = 'appSettings/features'

/**
 * Validates a submitted flag set.
 *
 * Only `enabled` is accepted for now. The registry also models `surfaces` and
 * `branches`, and both are real requirements — hiding a public page while
 * staff keep managing it, running a module at one branch only — but neither
 * has a reader yet. Accepting values nothing enforces would put settings in
 * the database that appear to do something and do not, which is worse than
 * not offering them.
 */
export function parseFlagsInput(body: Record<string, unknown>): FeatureFlags {
  const raw = body.flags
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Missing flags.')

  const out: FeatureFlags = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in FEATURES)) {
      throw new HttpError(400, `Unknown feature: ${key}`)
    }
    const def = FEATURES[key as FeatureKey] as FeatureDefinition
    const enabled = (value as { enabled?: unknown })?.enabled

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      throw new HttpError(400, `${key}: enabled must be true or false.`)
    }

    // A locked module has no off state. Refusing loudly beats silently
    // ignoring it — a superadmin who thinks they switched off `auth` and
    // finds it still running deserves to know the request was rejected.
    if (def.locked && enabled === false) {
      throw new HttpError(400, `${def.label} is core and cannot be switched off.`)
    }

    out[key as FeatureKey] = { enabled: enabled === undefined ? def.defaultEnabled : enabled }
  }
  return out
}

export async function readFlags(): Promise<FeatureFlags> {
  const snap = await adminDb().doc(FEATURES_DOC).get()
  if (!snap.exists) return {}
  const data = snap.data() ?? {}
  const out: FeatureFlags = {}
  for (const key of Object.keys(FEATURES) as FeatureKey[]) {
    const raw = data[key]
    if (raw && typeof raw === 'object') out[key] = raw as FeatureFlags[FeatureKey]
  }
  return out
}

/**
 * Persists the choice and reports what actually moved.
 *
 * Reports the EFFECTIVE change, not just the stored one. Switching off a
 * parent takes its dependents down with it, and an audit entry saying only
 * "events: on -> off" hides that table reservations went with it. When
 * somebody asks next week why bookings stopped, this is the entry that has to
 * answer.
 */
export async function writeFlags(
  input: FeatureFlags,
  actor: { uid: string; email: string },
): Promise<{ changes: { key: string; label: string; before: boolean; after: boolean; cascaded: boolean }[] }> {
  const before = await readFlags()
  const merged: FeatureFlags = { ...before, ...input }

  const changes = (Object.keys(FEATURES) as FeatureKey[])
    .map(key => {
      const wasOn = isFeatureOn(key, before)
      const nowOn = isFeatureOn(key, merged)
      return {
        key,
        label: (FEATURES[key] as FeatureDefinition).label,
        before: wasOn,
        after: nowOn,
        // The superadmin did not touch this one; it moved because something
        // it depends on did.
        cascaded: input[key] === undefined,
      }
    })
    .filter(c => c.before !== c.after)

  if (changes.length === 0) return { changes }

  await adminDb().doc(FEATURES_DOC).set({
    ...merged,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  }, { merge: true })

  return { changes }
}
