// Shared leveling config — XP curve, level titles, and tiers. Reusable
// anywhere in the app that needs to display or compute a customer's level
// without recomputing the curve itself.

export const MAX_LEVEL = 50
export const XP_PER_LEVEL = 1000

export const LEVEL_TITLES: string[] = [
  'Newcomer', 'Pawn', 'Card Flipper', 'Dice Roller', 'Rule Skimmer',
  'Board Setter', 'Game Finder', 'Table Sitter', 'First Mover', 'Strategist-in-Training',
  'Quest Taker', 'Side Quester', 'Tavern Regular', 'Spell Learner', 'Dungeon Crawler',
  'Meeple Mover', 'Victory Pointer', 'Board Veteran', 'Relic Hunter', 'Campaign Runner',
  'Party Leader', 'Map Reader', 'Quest Giver', 'Siege Breaker', 'Hall of Fame',
  'Story Weaver', 'Guild Member', 'Lore Keeper', 'Trap Disarmer', 'Dragon Tamer',
  'Shadow Tactician', 'Ancient Collector', 'Deck Architect', 'Secret Keeper', 'Dungeon Delver',
  'Myth Maker', 'Council Elder', 'Void Walker', 'Realm Defender', 'Chronicle Writer',
  'Arcane Sage', 'Celestial Binder', 'World Shaper', 'Lore Eternal', 'Rift Walker',
  'Time Weaver', 'Fate Caller', 'Cosmos Reader', 'Game God', 'Onboard Legend',
]

export interface Tier {
  label: string
  min: number
  max: number
}

export const TIERS: Tier[] = [
  { label: 'Apprentice', min: 1,  max: 10 },
  { label: 'Adventurer', min: 11, max: 20 },
  { label: 'Champion',   min: 21, max: 30 },
  { label: 'Legend',     min: 31, max: 40 },
  { label: 'Mythic',     min: 41, max: 50 },
]

export const TIER_COLORS: Record<string, string> = {
  Apprentice: '#888780',
  Adventurer: '#1D9E75',
  Champion:   '#378ADD',
  Legend:     '#7F77DD',
  Mythic:     '#EF9F27',
}

export function getTierFromLevel(level: number): string {
  return TIERS.find(t => level >= t.min && level <= t.max)?.label ?? TIERS[0].label
}

export interface LevelInfo {
  level: number
  levelTitle: string
  tier: string
  currentLevelXP: number
  nextLevelXP: number
  progressPercent: number
}

// Linear curve: level N is reached at (N - 1) * XP_PER_LEVEL total XP, so
// level 2 = 1000, level 10 = 9000, level 50 = 49000. Capped at MAX_LEVEL —
// XP beyond the level-50 threshold doesn't overflow into a level 51.
export function getLevelFromXP(xp: number): LevelInfo {
  const safeXp = Math.max(0, xp || 0)
  const rawLevel = Math.floor(safeXp / XP_PER_LEVEL) + 1
  const level = Math.min(rawLevel, MAX_LEVEL)

  const currentLevelXP = (level - 1) * XP_PER_LEVEL
  const nextLevelXP = level < MAX_LEVEL ? level * XP_PER_LEVEL : currentLevelXP

  const progressPercent = level >= MAX_LEVEL
    ? 100
    : Math.min(100, Math.max(0, ((safeXp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100))

  return {
    level,
    levelTitle: LEVEL_TITLES[level - 1],
    tier: getTierFromLevel(level),
    currentLevelXP,
    nextLevelXP,
    progressPercent,
  }
}
