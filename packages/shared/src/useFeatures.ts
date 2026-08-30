'use client'

// The live read side of the feature registry — layers 1 and 2 of the three
// described in app/lib/features.ts.
//
// The registry has existed since the fork and nothing has ever read it. Every
// module was on regardless of what the flags said, which made the switchboard
// a promise rather than a feature. This is the half that makes it real in the
// browser.
//
// Split from features.ts for the same reason businessSettings.ts is split from
// useBusinessSettings.ts: features.ts must stay importable by the server, and
// anything importing app/lib/firebase.ts drags the client SDK into the server
// bundle.
//
// ── Both of these layers are cosmetic ──────────────────────────────────────
// Hiding a nav link and redirecting off a page stops an honest person going
// somewhere pointless. Neither stops anybody who wants in. That is fine,
// because a flag is a business switch and not an access control — the rules
// keyed on roles are what actually stop things, and they are unaffected by
// any of this. The moment a flag is doing security work, this is a hole.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import {
  FEATURES, FAIL_OPEN_FLAGS, isFeatureOn,
  type FeatureFlags, type FeatureKey,
} from './features'

export const FEATURES_DOC = 'appSettings/features'

/** Keeps only keys the registry knows, so a stale stored key can't confuse callers. */
export function parseFlags(data: Record<string, unknown> | undefined): FeatureFlags {
  if (!data) return FAIL_OPEN_FLAGS
  const out: FeatureFlags = {}
  for (const key of Object.keys(FEATURES) as FeatureKey[]) {
    const raw = data[key]
    if (raw && typeof raw === 'object') out[key] = raw as FeatureFlags[FeatureKey]
  }
  return out
}

/**
 * The live flag document.
 *
 * `loading` matters more here than it usually does: rendering with FAIL_OPEN
 * defaults and then hiding half the navigation a moment later looks like a
 * bug. Callers should wait.
 */
export function useFeatureFlags(): { flags: FeatureFlags; loading: boolean } {
  const [flags, setFlags] = useState<FeatureFlags>(FAIL_OPEN_FLAGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, FEATURES_DOC),
      snap => { setFlags(parseFlags(snap.data())); setLoading(false) },
      // Fail open, deliberately — see features.ts. An unreadable document
      // must not dark-screen the storefront.
      () => { setFlags(FAIL_OPEN_FLAGS); setLoading(false) },
    )
    return unsub
  }, [])

  return { flags, loading }
}

/** Whether one feature is effectively on, dependencies included. */
export function useFeature(key: FeatureKey): { on: boolean; loading: boolean } {
  const { flags, loading } = useFeatureFlags()
  return { on: isFeatureOn(key, flags), loading }
}

/**
 * Enforcement layer 2: redirect off a page whose module is switched off.
 *
 * features.ts has described this function since the fork; it did not exist.
 * Pages that call it get the same shape as useRequireRole — `checking` is true
 * until the answer is known, so a page renders nothing rather than flashing
 * content it is about to navigate away from.
 *
 * Deliberately sends people to /admin rather than showing "disabled". A
 * superadmin turned this module off on purpose; explaining that to a barista
 * who followed a bookmark helps nobody.
 */
export function useRequireFeature(key: FeatureKey): { checking: boolean; on: boolean } {
  const router = useRouter()
  const { on, loading } = useFeature(key)

  useEffect(() => {
    if (loading) return
    if (!on) router.replace('/admin')
  }, [loading, on, router])

  return { checking: loading || !on, on }
}
