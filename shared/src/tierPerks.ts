'use client'

import { useEffect, useState } from 'react'
import { collection, onSnapshot, type Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import { TIERS, TIER_LABELS } from './loyaltyTiers'
import { authedFetch, unwrap } from './apiClient'

// Staff-managed marketing content: what each status tier is worth. Shown on
// the public loyalty page and on a customer's own profile.
//
// Replaces shared/src/levelPerks.ts, which keyed perks to a level from 1 to 50
// and derived the tier label from the level on read. With levels gone, the
// tier IS the key — there is no longer a number in between to derive from.
//
// The collection is `tierPerks`. The old `levelPerks` documents are not
// migrated: they were seed content, not customer data, and their level numbers
// have no meaning under the new ladder.
export interface TierPerk {
  id: string
  /** One of TIER_LABELS. Stored, not derived — it is the key now. */
  tier: string
  perk: string
  createdAt: Timestamp | null
  updatedAt?: Timestamp | null
}

/**
 * Tier order, low to high, for "has this customer reached it yet" comparisons.
 * Taken from TIERS so the two can't disagree about the ladder.
 */
export const TIER_ORDER: string[] = TIER_LABELS


// seedTierPerksIfEmpty() is gone, for the same reasons as its twin in
// redemptions.ts: a query on every page mount that could only fire on a new
// project, and a second copy of a starter list npm run seed:demo already
// writes.

/**
 * Live perks, ordered by tier.
 *
 * Sorted in memory rather than with orderBy('tier'), because Firestore would
 * sort the labels alphabetically — Bronze, Gold, Platinum, Silver — which is
 * not the ladder. TIERS is the only definition of the real order.
 */
export function useTierPerks() {
  const [perks, setPerks]     = useState<TierPerk[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'tierPerks'), snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as TierPerk))
      rows.sort((a, b) => {
        const byTier = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
        return byTier !== 0 ? byTier : a.perk.localeCompare(b.perk)
      })
      setPerks(rows)
      setLoading(false)
    }, err => console.error('[useTierPerks] tierPerks listener failed:', err))
    return unsub
  }, [])

  return { perks, loading }
}

/** Perks grouped by tier, in ladder order, including tiers with none. */
export function perksByTier(perks: TierPerk[]): { tier: string; color: string; perks: TierPerk[] }[] {
  return TIERS.map(t => ({
    tier: t.label,
    color: t.color,
    perks: perks.filter(p => p.tier === t.label),
  }))
}

/**
 * The staff-managed perk catalogue.
 *
 * Routed through /api/admin/loyalty/catalogue rather than written directly.
 * A perk is what the programme advertises a tier is worth, which is a claim
 * the business makes to customers — the same class of decision as what a
 * reward costs, and it sat in the browser for the same reason: the approvals
 * moved in Phase 00 and the catalogue they operate on did not.
 *
 * assertTier() is gone from here. The route validates the tier against
 * TIER_LABELS and refuses an unknown one with a 400, so the check cannot be
 * skipped by calling the function differently. A perk filed under a tier that
 * does not exist would never render — perksByTier() groups strictly by TIERS —
 * and nothing would report it.
 */
export async function createTierPerk(input: { tier: string; perk: string }): Promise<void> {
  await unwrap(await authedFetch('/api/admin/loyalty/catalogue', 'POST', { kind: 'perk', ...input }))
}

export async function updateTierPerk(id: string, input: { tier: string; perk: string }): Promise<void> {
  await unwrap(await authedFetch('/api/admin/loyalty/catalogue', 'PATCH', { kind: 'perk', id, ...input }))
}

export async function deleteTierPerk(id: string): Promise<void> {
  await unwrap(await authedFetch(`/api/admin/loyalty/catalogue?kind=perk&id=${encodeURIComponent(id)}`, 'DELETE'))
}
