import {
  doc, getDoc, setDoc, collection, query, where,
  orderBy, limit, getDocs, writeBatch, serverTimestamp, type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { BRANCHES } from './branches'

// Faten isn't a stocked branch for consumable supplies — see app/admin/supplies/page.tsx's
// own SUPPLY_BRANCHES, which this mirrors.
export const INVENTORY_BRANCHES = BRANCHES.filter(b => b !== 'Faten')
export type InventoryBranch = typeof INVENTORY_BRANCHES[number]

// A count is scoped to one department at a time — Kitchen, Bar, and Cleaning
// are counted (and submitted) independently of each other, even for the same
// branch and date, so one department's progress never blocks another's.
export const DEPARTMENTS = ['Kitchen', 'Bar', 'Cleaning', 'Other'] as const
export type Department = typeof DEPARTMENTS[number]

export interface InventoryLine {
  supplyId:    string
  name:        string
  nameAr?:     string
  category:    string
  unit:        string
  previousQty: number
  countedQty:  number | null   // null = not yet counted by the employee
}

export interface DailyInventoryReport {
  id:               string
  branch:           string
  date:             string          // 'YYYY-MM-DD'
  department:       string
  status:           'draft' | 'submitted'
  items:            InventoryLine[]
  notes:            string
  submittedBy:      string
  submittedByEmail: string
  submittedAt:      Timestamp | null
  updatedAt:        Timestamp | null
  updatedBy:        string
}

export function inventoryDocId(branch: string, date: string, department: string) {
  return `${branch}_${date}_${department}`
}

export function todayDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface SupplyForCount {
  id:       string
  name:     string
  nameAr?:  string
  category: string
  unit:     string
  quantity: Record<string, number>
}

// Independent of app/admin/supplies/page.tsx's own Firestore access — kept
// separate so this lib doesn't depend on that page's local state shape.
export async function listSuppliesForCount(): Promise<SupplyForCount[]> {
  const snap = await getDocs(collection(db, 'supplies'))
  return snap.docs.map(d => {
    const data = d.data()
    const quantity = typeof data.quantity === 'number'
      ? { [INVENTORY_BRANCHES[0]]: data.quantity }
      : (data.quantity as Record<string, number> | undefined) ?? {}
    return {
      id: d.id,
      name: (data.name as string) ?? '',
      nameAr: (data.nameAr as string | undefined) || undefined,
      category: (data.category as string) ?? 'Other',
      unit: (data.unit as string) ?? 'pieces',
      quantity,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export function emptyInventoryReport(
  branch: string, date: string, department: string, supplies: SupplyForCount[], uid: string, email: string,
): DailyInventoryReport {
  return {
    id: inventoryDocId(branch, date, department),
    branch,
    date,
    department,
    status: 'draft',
    items: supplies
      .filter(s => s.category === department)
      .map(s => ({
        supplyId: s.id,
        name: s.name,
        nameAr: s.nameAr,
        category: s.category,
        unit: s.unit,
        previousQty: s.quantity[branch] ?? 0,
        countedQty: null,
      })),
    notes: '',
    submittedBy: uid,
    submittedByEmail: email,
    submittedAt: null,
    updatedAt: null,
    updatedBy: uid,
  }
}

export async function getDailyInventory(branch: string, date: string, department: string): Promise<DailyInventoryReport | null> {
  const snap = await getDoc(doc(db, 'dailyInventoryCounts', inventoryDocId(branch, date, department)))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as DailyInventoryReport
}

export async function saveDailyInventoryDraft(report: DailyInventoryReport, uid: string): Promise<void> {
  const id = inventoryDocId(report.branch, report.date, report.department)
  await setDoc(doc(db, 'dailyInventoryCounts', id), {
    ...report,
    id,
    status: 'draft',
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
}

// Writes the final count doc and, in the same batch, pushes each counted
// quantity onto its supplies/{id} doc via dot-path field update — that only
// touches this one branch's key inside the quantity map, so it can't
// clobber another branch's count with stale data even if two branches (or
// two departments) are being counted around the same time.
export async function submitDailyInventory(report: DailyInventoryReport, uid: string): Promise<void> {
  const id = inventoryDocId(report.branch, report.date, report.department)
  const batch = writeBatch(db)
  batch.set(doc(db, 'dailyInventoryCounts', id), {
    ...report,
    id,
    status: 'submitted',
    submittedAt: report.submittedAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  })
  for (const line of report.items) {
    if (line.countedQty == null) continue
    batch.update(doc(db, 'supplies', line.supplyId), {
      [`quantity.${report.branch}`]: line.countedQty,
      updatedAt: serverTimestamp(),
    })
  }
  await batch.commit()
}

export async function listDailyInventories(branch: string | 'all', limitCount = 30): Promise<DailyInventoryReport[]> {
  const col = collection(db, 'dailyInventoryCounts')
  const q = branch === 'all'
    ? query(col, orderBy('date', 'desc'), limit(limitCount))
    : query(col, where('branch', '==', branch), orderBy('date', 'desc'), limit(limitCount))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as DailyInventoryReport)
}

// Single equality filter — no composite index needed, unlike a branch+date
// range query would require. Used by the history calendar's day-detail page.
export async function listDailyInventoriesForDate(date: string): Promise<DailyInventoryReport[]> {
  const snap = await getDocs(query(collection(db, 'dailyInventoryCounts'), where('date', '==', date)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as DailyInventoryReport)
}
