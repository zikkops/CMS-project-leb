'use client'

// The live printing settings, split out from printing.ts for the same reason
// useBusinessSettings.ts is split out from businessSettings.ts: the model has
// to stay importable by shared/src/server/** and by route handlers, and
// anything importing shared/src/firebase.ts drags the Firebase client SDK into
// the server bundle.

import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import {
  PRINTING_DOC, PRINTING_DEFAULTS, parsePrintingSettings, type PrintingSettings,
} from './printing'

/**
 * Live printer configuration.
 *
 * A listener rather than a read, so moving a station to a different printer
 * takes effect on the KDS without anyone reloading a screen mid-service —
 * which is the only time anybody ever changes this.
 *
 * Errors keep the defaults: every printer off. A dropped connection must not
 * make the app believe in a printer that is not there, and it must not stop
 * the screen working either.
 */
export function usePrintingSettings(): { settings: PrintingSettings; loading: boolean } {
  const [settings, setSettings] = useState<PrintingSettings>(PRINTING_DEFAULTS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, PRINTING_DOC),
      snap => { setSettings(parsePrintingSettings(snap.data())); setLoading(false) },
      () => setLoading(false),
    )
    return unsub
  }, [])

  return { settings, loading }
}
