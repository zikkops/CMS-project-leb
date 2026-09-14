'use client'

// The settings the till reads, through the backend — POS software, stage 2.
//
// The same names, the same answers and the same behaviour when a read fails
// as the shared hooks (shared/src/useFeatures.ts, useBusinessSettings.ts,
// usePrintingSettings.ts), which admin and the website keep using. The till's
// copies read through backend(), so in software mode the café's hub can answer
// them. What each document means is still the shared parsers; only where it
// comes from moved.
//
// Not here: the staff check (useRequireRole in adminAuth). It reads the signed-in
// user's token and staff record, which is sign-in, and it moves with the phone
// sign-in in stage 5.

import { useEffect, useState } from 'react'
import { backend } from './backend'
import { FAIL_OPEN_FLAGS, isFeatureOn, parseFlags, type FeatureFlags, type FeatureKey } from '@big-cms/shared/features'
import { SETTINGS_DEFAULTS, parseSettings, type BusinessSettings } from '@big-cms/shared/businessSettings'
import { PRINTING_DEFAULTS, parsePrintingSettings, type PrintingSettings } from '@big-cms/shared/printing'

/** The live feature switches. `loading` matters: callers should wait rather than flash hidden screens. */
export function useFeatureFlags(): { flags: FeatureFlags; loading: boolean } {
  const [flags, setFlags] = useState<FeatureFlags>(FAIL_OPEN_FLAGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => backend().watch({ kind: 'settings', doc: 'features' },
    snap => { setFlags(parseFlags(snap.docs[0]?.data)); setLoading(false) },
    // Fail open, as the shared hook does: an unreadable document must not
    // dark-screen the till. A flag is a business switch, not an access control.
    () => { setFlags(FAIL_OPEN_FLAGS); setLoading(false) },
  ), [])

  return { flags, loading }
}

/** Whether one feature is effectively on, dependencies included. */
export function useFeature(key: FeatureKey): { on: boolean; loading: boolean } {
  const { flags, loading } = useFeatureFlags()
  return { on: isFeatureOn(key, flags), loading }
}

/** The live business settings: VAT, the exchange rate, margins. Defaults while loading or unreadable. */
export function useBusinessSettings(): { settings: BusinessSettings; loading: boolean } {
  const [settings, setSettings] = useState<BusinessSettings>(SETTINGS_DEFAULTS)
  const [loading, setLoading] = useState(true)

  useEffect(() => backend().watch({ kind: 'settings', doc: 'business' },
    snap => { setSettings(parseSettings(snap.docs[0]?.data)); setLoading(false) },
    // A permission error or a dropped connection must not dark-screen a form.
    () => setLoading(false),
  ), [])

  return { settings, loading }
}

/** Live printer configuration. An unreadable document keeps the defaults: every printer off. */
export function usePrintingSettings(): { settings: PrintingSettings; loading: boolean } {
  const [settings, setSettings] = useState<PrintingSettings>(PRINTING_DEFAULTS)
  const [loading, setLoading] = useState(true)

  useEffect(() => backend().watch({ kind: 'settings', doc: 'printing' },
    snap => { setSettings(parsePrintingSettings(snap.docs[0]?.data)); setLoading(false) },
    () => setLoading(false),
  ), [])

  return { settings, loading }
}
