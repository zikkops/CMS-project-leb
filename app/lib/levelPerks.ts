'use client'

import { useEffect, useState } from 'react'
import {
  collection, query, orderBy, onSnapshot, doc, getDoc, getDocs, addDoc,
  updateDoc, deleteDoc, limit, serverTimestamp, type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { logCreate, logUpdate, logDelete } from './activityLog'

// Public marketing content (app/loyalty/page.tsx's "Perks unlocked by
// level" section), staff-managed — same shape as redemptionItems/games.
// `tier` isn't stored here; it's always derived from `level` via
// getTierFromLevel (app/lib/levelConfig.ts) on read, so there's no way for
// a perk's tier label to drift out of sync with its actual level.
export interface LevelPerk {
  id: string
  level: number
  perk: string
  createdAt: Timestamp | null
  updatedAt?: Timestamp | null
}

// Default content seeded once if the collection is empty, so the public
// page never shows nothing — same pattern as seedRedemptionItemsIfEmpty.
const DEFAULT_LEVEL_PERKS: { level: number; perk: string }[] = [
  { level: 5,  perk: 'Free soft drink on your birthday' },
  { level: 10, perk: '5% off all food orders' },
  { level: 15, perk: 'Reserve a table up to 48h in advance' },
  { level: 20, perk: '10% off all orders + early event access' },
  { level: 30, perk: 'Free coffee once a month + name on leaderboard' },
  { level: 40, perk: 'Priority event registration + 15% off' },
  { level: 50, perk: 'Permanent Onboard Legend badge + free item every month' },
]

export async function seedLevelPerksIfEmpty(): Promise<void> {
  const snap = await getDocs(query(collection(db, 'levelPerks'), limit(1)))
  if (!snap.empty) return

  await Promise.all(DEFAULT_LEVEL_PERKS.map(p =>
    addDoc(collection(db, 'levelPerks'), {
      level: p.level,
      perk: p.perk,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  ))
}

// Live, sorted by level — used by both the public loyalty page and the
// admin management page.
export function useLevelPerks() {
  const [perks, setPerks]     = useState<LevelPerk[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(collection(db, 'levelPerks'), orderBy('level', 'asc'))
    const unsub = onSnapshot(q, snap => {
      setPerks(snap.docs.map(d => ({ id: d.id, ...d.data() } as LevelPerk)))
      setLoading(false)
    }, err => console.error('[useLevelPerks] levelPerks listener failed:', err))
    return unsub
  }, [])

  return { perks, loading }
}

export async function createLevelPerk(input: { level: number; perk: string }): Promise<void> {
  await addDoc(collection(db, 'levelPerks'), {
    level: input.level,
    perk: input.perk.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await logCreate('Loyalty Management', `Level perk — Level ${input.level}`, {
    level: input.level,
    perk: input.perk.trim(),
  })
}

export async function updateLevelPerk(id: string, input: { level: number; perk: string }): Promise<void> {
  const ref = doc(db, 'levelPerks', id)
  const before = (await getDoc(ref)).data() as { level?: number; perk?: string } | undefined

  await updateDoc(ref, {
    level: input.level,
    perk: input.perk.trim(),
    updatedAt: serverTimestamp(),
  })

  await logUpdate(
    'Loyalty Management',
    `Level perk — Level ${input.level}`,
    before ?? {},
    { level: input.level, perk: input.perk.trim() }
  )
}

export async function deleteLevelPerk(id: string): Promise<void> {
  const ref = doc(db, 'levelPerks', id)
  const before = (await getDoc(ref)).data() as { level?: number; perk?: string } | undefined

  await deleteDoc(ref)
  await logDelete('Loyalty Management', `Level perk — Level ${before?.level ?? id}`, before ?? {})
}
