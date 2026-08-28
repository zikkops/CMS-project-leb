// Branches — now configuration, not a constant.
//
// This file used to open with a hardcoded list of four specific café branches.
// That single line is a good illustration of why a codebase serves exactly one
// customer: three other files then wrote `BRANCHES.filter(b => b !== 'Faten')`
// to express "the branches that hold stock", each independently, each able to
// drift from the others.
//
// Both lists now come from app/lib/brand.ts.
//
// ── A type change worth knowing about ──────────────────────────────────────
// `BRANCHES` was `as const`, so `typeof BRANCHES[number]` was the union
// 'Beirut' | 'Zouk' | 'Broummana' | 'Faten'. A configured list can't produce a
// literal union — the values aren't known until runtime — so that type is now
// `string`.
//
// Call sites still compile. What you lose is the compiler catching a branch
// name typo, which is why resolveBranchName() and the receiving route both
// validate against the configured list at runtime instead. If you see a type
// that used to be a branch union and is now `string`, that's this, not a bug.

import { BRAND } from './brand'

export const BRANCHES: readonly string[] = BRAND.branches

/** Branches that hold consumable stock — the counted, received, ordered ones. */
export const STOCKED_BRANCHES: readonly string[] = BRAND.stockedBranches

/** The flagship, used wherever one branch has to be picked as a default. */
export const PRIMARY_BRANCH: string = BRAND.branches[0] ?? ''

export function isBranch(value: unknown): value is string {
  return typeof value === 'string' && BRANCHES.includes(value)
}

export function isStockedBranch(value: unknown): value is string {
  return typeof value === 'string' && STOCKED_BRANCHES.includes(value)
}

export function emptyStock(): Record<string, number> {
  return Object.fromEntries(BRANCHES.map(b => [b, 0]))
}

// Existing records may still have `stock` as a single number — fold that into
// the flagship branch on first edit instead of forcing a one-off migration.
export function normalizeStock(stock: unknown): Record<string, number> {
  const result = emptyStock()
  if (typeof stock === 'number') {
    if (PRIMARY_BRANCH) result[PRIMARY_BRANCH] = stock
  } else if (stock && typeof stock === 'object') {
    for (const b of BRANCHES) {
      const v = (stock as Record<string, unknown>)[b]
      if (typeof v === 'number') result[b] = v
    }
  }
  return result
}

export function totalStock(stock: unknown): number {
  if (typeof stock === 'number') return stock
  if (stock && typeof stock === 'object') {
    return Object.values(stock as Record<string, number>)
      .reduce((sum, n) => sum + (Number(n) || 0), 0)
  }
  return 0
}

// Branch ids are the branch name itself (there's no separate branches
// collection). This normalizes casing and falls back to the raw value for
// anything unrecognized, so a renamed branch shows its stored name rather
// than a blank cell.
export function resolveBranchName(branchId: string | undefined | null): string {
  if (!branchId) return '—'
  const match = BRANCHES.find(b => b.toLowerCase() === branchId.toLowerCase())
  return match ?? branchId
}
