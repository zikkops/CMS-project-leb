import { STOCKED_BRANCHES } from '@big-cms/shared/branches'

// Configuration, not a constant — see app/admin/supplies/page.tsx for what
// the hardcoded version did to the stock figures.
export const SUPPLY_BRANCHES = STOCKED_BRANCHES
export type SupplyBranch = string

export interface Supply {
  id: string
  name: string
  quantity: Record<SupplyBranch, number>
  unit: string
  threshold: number
  category: string
}
