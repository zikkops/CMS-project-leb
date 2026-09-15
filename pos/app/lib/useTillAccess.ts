'use client'

// The till's staff check: whether this person may open this screen.
//
// Online it is useRequireRole(), unchanged. On a café hub (POS software,
// stage 3) it is the hub session: the same section rule (hasSectionAccess) over
// the role the session started with, and the same feature switches, read from
// the hub. Firebase is not asked there. On a hub with no internet its staff
// record read rejects, and every screen would read "no access" for the rest of
// the night.
//
// Which of the two is decided once, when the page mounts, from the page's own
// marking (backend/index.ts), so the hooks a screen calls never change between
// renders. The server render never knows it is on a hub, and both start as
// "checking", so the first paint is the same either way.

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useRequireRole, SECTION_ACCESS } from '@big-cms/shared/adminAuth'
import { hasSectionAccess, type Role } from '@big-cms/shared/roles'
import { featureForSection, isFeatureOn } from '@big-cms/shared/features'
import { onHub } from './backend'
import { watchHubSession, type HubSession } from './backend/hub'
import { useFeatureFlags } from './useTillSettings'

export interface TillAccess {
  checking: boolean
  blocked: 'feature' | 'access' | null
  role: Role | null
}

interface Routes { login?: string; home?: string }

function useCloudAccess(allowed: Role[], routes: Routes): TillAccess {
  const { checking, blocked, role } = useRequireRole(allowed, routes)
  return { checking, blocked, role }
}

function useHubAccess(allowed: Role[], routes: Routes): TillAccess {
  const loginPath = routes.login ?? '/pos/login'
  const homePath = routes.home ?? '/pos'
  const router = useRouter()
  const pathname = usePathname()
  const [session, setSession] = useState<HubSession | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => watchHubSession(s => { setSession(s); setLoaded(true) }), [])
  const { flags, loading: featuresLoading } = useFeatureFlags()

  // By reference, as useRequireRole finds it: callers pass SECTION_ACCESS.xxx itself.
  const sectionKey = Object.entries(SECTION_ACCESS).find(([, v]) => v === allowed)?.[0]
  const role = session?.role ?? null
  // No grants or revocations: the hub holds no staff records yet (stage 4), so the role decides.
  const hasAccess = hasSectionAccess(role, allowed, [], sectionKey, [])
  const feature = sectionKey ? featureForSection(sectionKey) : undefined
  const featureOn = featuresLoading || !feature || isFeatureOn(feature, flags)

  useEffect(() => {
    if (!loaded) return
    if (!session) {
      router.replace(loginPath)
      return
    }
    // Same as useRequireRole: never redirect to the page already open, or the
    // screen renders nothing and says nothing.
    // A kitchen screen (S19) belongs on the kitchen display, whichever page it reaches.
    if (session.scope === 'kds' && sectionKey !== 'kds') {
      router.replace('/pos/kds')
      return
    }
    if ((!featureOn || !hasAccess) && pathname !== homePath) router.replace(homePath)
  }, [loaded, session, featureOn, hasAccess, pathname, router, loginPath, homePath, sectionKey])

  const checking = !loaded || featuresLoading || !session || !hasAccess || !featureOn
  const blocked: TillAccess['blocked'] =
    !loaded || featuresLoading || !session ? null
    : !featureOn ? 'feature'
    : !hasAccess ? 'access'
    : null

  return { checking, blocked, role }
}

export function useTillAccess(allowed: Role[], routes: Routes = {}): TillAccess {
  // Fixed for the life of the page — see the note at the top.
  const [hub] = useState(onHub)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return hub ? useHubAccess(allowed, routes) : useCloudAccess(allowed, routes)
}
