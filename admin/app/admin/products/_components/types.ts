export interface Product {
  id: string
  name: string
  category: string
  description: string
  price: number
  wholesalePrice?: number | null
  salePrice?: number | null
  saleEndsAt?: string | null
  stock: Record<string, number>
  image: string
  // Issued once on create and never rewritten — see shared/src/skuFormat.ts.
  // Optional because products that predate the backfill may not carry one.
  sku?: string
}

export const EMPTY = {
  name: '',
  category: '',
  description: '',
  price: 0,
  wholesalePrice: null as number | null,
  salePrice: null as number | null,
  saleEndsAt: '' as string,
  image: '',
}

export type ProductForm = typeof EMPTY & { stock: Record<string, number> }

// Used only before a client has created any categories of their own. These
// were board-game genres — Strategy, Party, Cooperative, RPG — so a café's
// first product was filed under "Strategy". Categories are the client's.
export const FALLBACK_CATEGORIES = ['General']
