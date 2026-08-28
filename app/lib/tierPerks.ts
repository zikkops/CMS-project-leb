'use client'

import { useEffect, useState } from 'react'
import {
  collection, query, onSnapshot, doc, getDoc, getDocs, addDoc,
  updateDoc, deleteDoc, limit, serverTimestamp, type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { logCreate, logUpdate, logDelete } from './activityLog'
import { TIERS, TIER_LABELS } from './loyaltyTiers'

// Staff-managed marketing content: what each status tier is worth. Shown on
// the public loyalty page and on a customer's own profile.
//
// Replaces app/lib/levelPerks.ts, which keyed perks to a level from 1 to 50
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

const DEFAULT_TIER_PERKS: { tier: string; perk: string }[] = [
  { tier: 'Bronze',   perk: 'Earn points on every purchase' },
  { tier: 'Bronze',   perk: 'A free drink on your birthday' },
  { tier: 'Silver',   perk: '5% off food orders' },
  { tier: 'Silver',   perk: 'Reserve a table up to 48h ahead' },
  { tier: 'Gold',     perk: '10% off everything' },
  { tier: 'Gold',     perk: 'Early access to event tickets' },
  { tier: 'Gold',     perk: 'A free coffee every month' },
  { tier: 'Platinum', perk: '15% off everything' },
  { tier: 'Platinum', perk: 'Priority event registration' },
  { tier: 'Platinum', perk: 'A free item every month' },
]

export async function seedTierPerksIfEmpty(): Promise<void> {
  const snap = await getDocs(query(collection(db, 'tierPerks'), limit(1)))
  if (!snap.empty) return

  await Promise.all(DEFAULT_TIER_PERKS.map(p =>
    addDoc(collection(db, 'tierPerks'), {
      tier: p.tier,
      perk: p.perk,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  ))
}

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

function assertTier(tier: string): void {
  if (!TIER_ORDER.includes(tier)) {
    throw new Error(`Unknown tier "${tier}". Expected one of: ${TIER_ORDER.join(', ')}`)
  }
}

export async function createTierPerk(input: { tier: string; perk: string }): Promise<void> {
  assertTier(input.tier)
  await addDoc(collection(db, 'tierPerks'), {
    tier: input.tier,
    perk: input.perk.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await logCreate('Loyalty Management', `${input.tier} perk`, {
    tier: input.tier,
    perk: input.perk.trim(),
  })
}

export async function updateTierPerk(id: string, input: { tier: string; perk: string }): Promise<void> {
  assertTier(input.tier)
  const ref = doc(db, 'tierPerks', id)
  const before = (await getDoc(ref)).data() as { tier?: string; perk?: string } | undefined

  await updateDoc(ref, {
    tier: input.tier,
    perk: input.perk.trim(),
    updatedAt: serverTimestamp(),
  })

  await logUpdate('Loyalty Management', `${input.tier} perk`, before ?? {}, {
    tier: input.tier,
    perk: input.perk.trim(),
  })
}

export async function deleteTierPerk(id: string): Promise<void> {
  const ref = doc(db, 'tierPerks', id)
  const before = (await getDoc(ref)).data() as { tier?: string; perk?: string } | undefined

  await deleteDoc(ref)
  await logDelete('Loyalty Management', `${before?.tier ?? 'Tier'} perk`, before ?? {})
}
