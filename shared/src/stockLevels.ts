// Par levels and low stock on supplies (UPGRADE.md T3.10). Pure, asserted by
// verify:delivery-math.
//
// Every supply has had one minimum, `threshold`, for every branch. A small
// branch and the flagship do not run out at the same count, so a branch may
// now have its own level (`par.<branch>`), and the minimum is what a branch
// without one uses. Below the level is low; nothing left (or less) is out.

export interface StockedSupply {
  id: string
  name: string
  unit: string
  threshold: number
  /** Branch → its own level. Absent for a branch: the threshold. */
  par?: Record<string, number> | null
  quantity: Record<string, number> | number | null | undefined
}

export type StockStatus = 'ok' | 'low' | 'out'

/** The level a branch runs this supply at: its own, else the minimum for every branch. */
export function levelFor(s: Pick<StockedSupply, 'threshold' | 'par'>, branch: string): number {
  const own = s.par?.[branch]
  if (typeof own === 'number' && Number.isFinite(own) && own >= 0) return own
  return Number.isFinite(s.threshold) && s.threshold > 0 ? s.threshold : 0
}

/** Out at nothing (or less: a count can go negative), low below the level. */
export function stockStatus(qty: number, level: number): StockStatus {
  if (!(qty > 0)) return 'out'
  if (qty < level) return 'low'
  return 'ok'
}

/** What one branch holds of a supply. A legacy single number is the first branch's. */
export function qtyAt(s: Pick<StockedSupply, 'quantity'>, branch: string, firstBranch: string): number {
  if (typeof s.quantity === 'number') return branch === firstBranch ? s.quantity : 0
  const n = Number(s.quantity?.[branch] ?? 0)
  return Number.isFinite(n) ? n : 0
}

export interface LowRow {
  id: string
  name: string
  unit: string
  branch: string
  qty: number
  level: number
  status: Exclude<StockStatus, 'ok'>
  /** What brings it back up to its level, never negative. */
  toLevel: number
}

/** Everything low or out at these branches, out first, then furthest below its level. */
export function lowStock(supplies: readonly StockedSupply[], branches: readonly string[], firstBranch: string): LowRow[] {
  const rows: LowRow[] = []
  for (const s of supplies) {
    for (const branch of branches) {
      const qty = qtyAt(s, branch, firstBranch)
      const level = levelFor(s, branch)
      const status = stockStatus(qty, level)
      if (status === 'ok') continue
      rows.push({ id: s.id, name: s.name, unit: s.unit, branch, qty, level, status, toLevel: Math.max(0, Math.round((level - qty) * 1000) / 1000) })
    }
  }
  return rows.sort((a, b) => (a.status === b.status ? (b.level - b.qty) - (a.level - a.qty) || a.name.localeCompare(b.name) : a.status === 'out' ? -1 : 1))
}
