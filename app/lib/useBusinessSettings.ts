'use client'

// The live-settings hook, split out from businessSettings.ts.
//
// That module has to be importable by app/lib/server/** and app/api/**, and
// anything importing app/lib/firebase.ts drags the Firebase CLIENT SDK into
// the server bundle. Same split as roles.ts (shared) and adminAuth.ts
// (browser) — the shared half stays free of both React and Firebase.

import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import { SETTINGS_DOC, SETTINGS_DEFAULTS, parseSettings, type BusinessSettings } from './businessSettings'

/**
 * The live business settings.
 *
 * An onSnapshot listener rather than a one-off read, matching the rest of the
 * app — change the VAT rate and every open receiving form picks it up without
 * anyone reloading. `loading` is exposed so a form can avoid rendering a total
 * computed from the fallback and then visibly correcting itself a moment
 * later.
 */
export function useBusinessSettings(): { settings: BusinessSettings; loading: boolean } {
  const [settings, setSettings] = useState<BusinessSettings>(SETTINGS_DEFAULTS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, SETTINGS_DOC),
      snap => { setSettings(parseSettings(snap.data())); setLoading(false) },
      // A permission error or a dropped connection must not dark-screen a
      // form. Keep the defaults and carry on.
      () => setLoading(false),
    )
    return unsub
  }, [])

  return { settings, loading }
}
