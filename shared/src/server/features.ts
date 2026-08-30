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
  const pruned: string[] = []
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in FEATURES)) {
      // DROPPED, not refused, and this is a correction rather than a
      // loosening. The settings page loads the stored flags and saves them
      // all back, so a key left behind by a rename — 'games' and
      // 'gamePurchases' survived the products rename — made every future save
      // fail with "Unknown feature: games". Nobody could change any feature at
      // all, and the message pointed at a module that no longer exists.
      //
      // A key that is not in the registry governs nothing by definition, so
      // dropping it is how the document heals itself on the next save. Typos
      // cannot arrive this way either: the page renders its checkboxes from
      // Object.keys(FEATURES), so a key it sends always came from there.
      pruned.push(key)
      continue
    }
    const def = FEATURES[key as FeatureKey] as FeatureDefinition

    // The stored shape is { enabled: boolean }, and a bare boolean is a
    // caller that guessed wrong. Reading .enabled off it gives undefined,
    // which silently fell through to the default — so a request asking to
    // switch something ON could switch it off and return 200. Refuse instead.
    if (value === null || typeof value !== 'object') {
      throw new HttpError(400, `${key}: expected { enabled: true } or { enabled: false }.`)
    }
    const enabled = (value as { enabled?: unknown }).enabled

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
  if (pruned.length > 0) {
    console.warn(`[features] dropped ${pruned.length} stale flag(s): ${pruned.join(', ')}`)
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

  // Merged over the REGISTRY, not over whatever is stored. Dropping unknown
  // keys from the input was only half the job: the merge read them straight
  // back out of the document, so 'games' and 'gamePurchases' — left behind by
  // the products rename — would have been rewritten on every save forever.
  // Building from Object.keys(FEATURES) means the document heals itself the
  // next time anybody touches it.
  const merged: FeatureFlags = {}
  for (const key of Object.keys(FEATURES) as FeatureKey[]) {
    const value = input[key] ?? before[key]
    if (value) merged[key] = value
  }

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

  // Stale keys are deleted, not merely left out. { merge: true } keeps what is
  // already in the document, so building `merged` from the registry removed
  // 'games' and 'gamePurchases' from what gets written and the merge put them
  // straight back.
  //
  // Found from the RAW document, not from readFlags() — that already filters
  // to registry keys, so the stale ones are invisible to it by construction.
  // Looking for them there found nothing and healed nothing, which is exactly
  // the shape of a cleanup that reports success and does not happen.
  const snap = await adminDb().doc(FEATURES_DOC).get()
  const stored = snap.data() ?? {}
  const RESERVED = new Set(['updatedAt', 'updatedByUid', 'updatedByEmail'])
  const stale: Record<string, unknown> = {}
  for (const key of Object.keys(stored)) {
    if (!(key in FEATURES) && !RESERVED.has(key)) stale[key] = FieldValue.delete()
  }

  await adminDb().doc(FEATURES_DOC).set({
    ...merged,
    ...stale,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  }, { merge: true })

  return { changes }
}
