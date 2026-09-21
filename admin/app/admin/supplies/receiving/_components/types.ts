import type { StorageKind } from '@big-cms/shared/foodSafety'

export interface SupplyRow {
  id: string
  name: string
  nameAr?: string
  category: string
  unit: string
  avgUnitCost: number
  vatable?: boolean
  /** Chilled or frozen: a delivery asks for its temperature (with Food Safety on). */
  storage?: StorageKind | null
}
