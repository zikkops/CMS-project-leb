import {
  collection, addDoc, getDocs, query, orderBy, limit,
  doc, updateDoc, deleteDoc, serverTimestamp, deleteField,
} from 'firebase/firestore'
import { db } from './firebase'
import { logActivity, logUpdate, logDelete } from './activityLog'
import { authedFetch, unwrap } from './apiClient'
import { BRANCHES } from './branches'

export type OrderUnit = 'box' | 'kg' | 'liter' | 'gallon' | 'bottle' | 'bag' | 'pcs' | 'jar' | 'block' | 'can'
export type Department = 'Kitchen' | 'Bar' | 'Cleaning'

export const UNIT_LABELS: Record<OrderUnit, string> = {
  box:    'Box',
  kg:     'KG',
  liter:  'Liter',
  gallon: 'Gallon',
  bottle: 'Bottle',
  bag:    'Bag',
  pcs:    'Pcs',
  jar:    'Jar',
  block:  'Block',
  can:    'Can',
}

export const DEPARTMENTS: Department[] = ['Kitchen', 'Bar', 'Cleaning']

// ---- Providers ----

export interface OrderProvider {
  id: string
  name: string
  phones: Partial<Record<typeof BRANCHES[number], string>>
  categories?: string[]                   // ordered list of sub-group names for this provider
  categoryTranslations?: Record<string, string>  // English category name → Arabic
  notes?: string
  createdAt: { seconds: number } | null
}

export async function listProviders(): Promise<OrderProvider[]> {
  const snap = await getDocs(query(collection(db, 'orderProviders'), orderBy('name')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as OrderProvider))
}

export async function addProvider(p: Omit<OrderProvider, 'id' | 'createdAt'>): Promise<void> {
  await addDoc(collection(db, 'orderProviders'), { ...p, createdAt: serverTimestamp() })
  await logActivity('create', 'Order Provider', p.name)
}

export async function updateProvider(
  id: string,
  before: Partial<OrderProvider>,
  after: Partial<OrderProvider>,
): Promise<void> {
  await updateDoc(doc(db, 'orderProviders', id), { ...after })
  await logUpdate('Order Provider', after.name ?? id, before, after)
}

export async function deleteProvider(id: string, name: string): Promise<void> {
  await deleteDoc(doc(db, 'orderProviders', id))
  await logDelete('Order Provider', name)
}

export function getProviderPhone(provider: OrderProvider | undefined, branch: string): string {
  return provider?.phones?.[branch as typeof BRANCHES[number]] ?? ''
}

// ---- Template items ----

export interface OrderTemplateItem {
  id: string
  name: string
  nameAr?: string
  department: Department
  // The durable link to the supplies/{id} doc whose stock a delivery of this
  // item moves. Before this existed, order template items and supplies were
  // connected only by a lowercased name match done at seed time — so renaming
  // either side silently broke the chain from ordering to stock with no error.
  //
  // Backfilled by scripts/link-template-supplies.mjs. Optional because an item
  // can legitimately be ordered without being stocked and counted; receiving
  // shows those as unstocked rather than failing.
  supplyId?: string
  category?: string      // sub-group within a provider, e.g. "Syrups", "Powders"
  providerId?: string
  unit: OrderUnit
  packSize?: number
  packUnit?: string
  sortOrder: number
  createdAt: { seconds: number } | null
}

export interface WeeklyOrderReportItem {
  templateId: string
  name: string
  department: Department
  category?: string      // carried from template for display grouping
  providerId?: string
  unit: OrderUnit
  quantity: number
  packSize?: number
  packUnit?: string
}

export interface WeeklyOrderReport {
  id: string
  branch: string
  weekStart: string
  weekLabel: string
  department?: Department        // unset on legacy mixed reports
  items: WeeklyOrderReportItem[]
  notes: string
  submittedBy: string
  submittedByEmail: string
  submittedAt: { seconds: number } | null
  whatsappSent?: Record<string, boolean>  // providerId (or '__none__') → sent
}

export async function listTemplateItems(): Promise<OrderTemplateItem[]> {
  const snap = await getDocs(query(collection(db, 'orderTemplateItems'), orderBy('name')))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as OrderTemplateItem))
    .sort((a, b) => {
      const dA = DEPARTMENTS.indexOf(a.department ?? 'Kitchen')
      const dB = DEPARTMENTS.indexOf(b.department ?? 'Kitchen')
      if (dA !== dB) return dA - dB
      const pDiff = (a.providerId ?? '').localeCompare(b.providerId ?? '')
      if (pDiff !== 0) return pDiff
      const cDiff = (a.category ?? '').localeCompare(b.category ?? '')
      if (cDiff !== 0) return cDiff
      return a.name.localeCompare(b.name)
    })
}

export async function addTemplateItem(
  item: Omit<OrderTemplateItem, 'id' | 'createdAt'>
): Promise<void> {
  await addDoc(collection(db, 'orderTemplateItems'), { ...item, createdAt: serverTimestamp() })
  await logActivity('create', 'Weekly Order Template', `${item.department} — ${item.name}`)
}

export async function updateTemplateItem(
  id: string,
  before: Partial<OrderTemplateItem>,
  after: Partial<OrderTemplateItem>,
): Promise<void> {
  const update = Object.fromEntries(
    Object.entries(after).map(([k, v]) => [k, v === undefined ? deleteField() : v])
  )
  await updateDoc(doc(db, 'orderTemplateItems', id), update)
  await logUpdate('Weekly Order Template', after.name ?? id, before, after)
}

export async function deleteTemplateItem(id: string, name: string): Promise<void> {
  await deleteDoc(doc(db, 'orderTemplateItems', id))
  await logDelete('Weekly Order Template', name)
}

// ---- Reports ----

// Submitting runs SERVER-SIDE (Phase 00 standing rule). See
// app/lib/server/weeklyOrders.ts.
//
// The request now names template items and quantities only. Every other field
// on a line — name, unit, category, provider, pack size — is read from the
// template document on the server. The browser used to send whole lines, so it
// could submit an order for an item that never existed, or attribute one to
// the wrong supplier. submittedBy comes from the verified token.
export async function submitWeeklyReport(
  report: Omit<WeeklyOrderReport, 'id' | 'submittedAt' | 'submittedBy' | 'submittedByEmail'>
): Promise<string> {
  const res = await authedFetch('/api/admin/weekly-orders', 'POST', {
    branch: report.branch,
    weekStart: report.weekStart,
    weekLabel: report.weekLabel,
    department: report.department,
    items: report.items.map(i => ({ templateId: i.templateId, quantity: i.quantity })),
    notes: report.notes,
  })
  const data = await unwrap(res)
  return data.id as string
}

export async function listWeeklyReports(): Promise<WeeklyOrderReport[]> {
  const snap = await getDocs(
    query(collection(db, 'weeklyOrderReports'), orderBy('submittedAt', 'desc'))
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as WeeklyOrderReport))
}

// ---- Grouping helpers ----

export function groupByProvider<T extends { providerId?: string }>(
  items: T[]
): { providerId: string | undefined; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = item.providerId ?? '__none__'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return Array.from(map.entries()).map(([key, items]) => ({
    providerId: key === '__none__' ? undefined : key,
    items,
  }))
}

export function groupByCategory<T extends { category?: string }>(
  items: T[]
): { category: string | undefined; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = item.category?.trim() || '__none__'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  // Named categories alphabetically, items without a category last
  return Array.from(map.entries())
    .sort(([a], [b]) => a === '__none__' ? 1 : b === '__none__' ? -1 : a.localeCompare(b))
    .map(([key, items]) => ({ category: key === '__none__' ? undefined : key, items }))
}

// ---- Pack label ----

export function packLabel(unit: OrderUnit, packSize?: number, packUnit?: string): string {
  if (!packSize) return UNIT_LABELS[unit]
  const inside = packUnit ? ` ${packUnit}` : ''
  return `${UNIT_LABELS[unit]} (${packSize}${inside} each)`
}

// ---- Translation ----

export async function translateToArabic(text: string): Promise<string> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ar`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Translation request failed')
  const data = await res.json()
  if (data.responseStatus !== 200) throw new Error('Translation failed')
  return data.responseData.translatedText as string
}

// ---- Order text generation ----

// providerFilter: when set, generates text only for that provider's items (across all departments)
export function generateOrderText(
  report: WeeklyOrderReport,
  providers: Record<string, OrderProvider>,
  nameArMap: Record<string, string>,
  showArabic: boolean,
  providerFilter?: string,
): string {
  const lines: string[] = []

  // Always open with branch + week so the recipient knows context
  lines.push(`*Weekly Order — ${report.branch}*`)
  lines.push(`Week: ${report.weekLabel}`)
  lines.push('')

  for (const dept of DEPARTMENTS) {
    const deptItems = report.items.filter(i => (i.department ?? 'Kitchen') === dept)
    if (deptItems.length === 0) continue

    const provGroups = groupByProvider(deptItems)
    const filtered = providerFilter
      ? provGroups.filter(g => g.providerId === providerFilter)
      : provGroups

    if (filtered.length === 0) continue

    lines.push(`*${dept.toUpperCase()}*`)

    for (const { providerId, items: pItems } of filtered) {
      const provider = providerId ? providers[providerId] : undefined

      // In the full copy show the provider name; in a per-provider WhatsApp skip it
      // (they already know who they are) and never include the phone number
      if (!providerFilter) {
        lines.push(`*${provider?.name ?? 'No Provider'}*`)
      }

      const catGroups = groupByCategory(pItems)
      const hasCategories = catGroups.some(g => g.category !== undefined)
      for (const { category, items: cItems } of catGroups) {
        if (hasCategories && category) lines.push(`_${category}_`)
        for (const item of cItems) {
          const ar    = nameArMap[item.templateId]
          const nameDisplay = showArabic && ar ? `${item.name} (${ar})` : item.name
          lines.push(`• ${nameDisplay}: ${item.quantity} ${UNIT_LABELS[item.unit]}`)
        }
      }
      lines.push('')
    }
  }

  if (!providerFilter && report.notes) {
    lines.push(`Notes: ${report.notes}`)
  }

  return lines.join('\n').trimEnd()
}

export function whatsappUrl(phone: string, text: string): string {
  const clean = phone.replace(/[\s\-().]/g, '').replace(/^00/, '+').replace(/^0/, '')
  const num   = clean.startsWith('+') ? clean.slice(1) : clean
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`
}

// ---- Weekly Order Logs ----

export interface WeeklyOrderLog {
  id:            string
  action:        'edit_quantity' | 'delete_report'
  reportId:      string
  branch:        string
  weekLabel:     string
  staffUid:      string
  staffEmail:    string
  createdAt:     { seconds: number } | null
  itemName?:     string
  oldQty?:       number
  newQty?:       number
  unit?:         string
  deletedCount?: number
}

// logWeeklyOrderAction() is gone. Each route writes its own weeklyOrderLogs
// entry in the same call as the change it records, so a submitted or edited
// order can no longer end up with no log entry because a second client call
// failed — and the entry records the verified caller rather than whichever
// uid the browser supplied.

// This used to take the ENTIRE items array from the caller, change one line,
// and write the whole array back — so the browser held the authoritative copy
// between read and write. Two people editing the same order, which is the
// normal case on an order day, silently lost one set of edits: whoever saved
// second won, with no conflict and no error.
//
// The route now updates the named line inside a transaction, reading the items
// from the stored document. A concurrent edit to a different line survives.
// The caller still gets the updated array back so the UI can re-render.
export async function updateReportItemQty(
  reportId: string,
  currentItems: WeeklyOrderReportItem[],
  templateId: string,
  newQty: number,
): Promise<WeeklyOrderReportItem[]> {
  const res = await authedFetch('/api/admin/weekly-orders', 'PATCH', {
    action: 'quantity', reportId, templateId, quantity: newQty,
  })
  await unwrap(res)
  return currentItems.map(i => (i.templateId === templateId ? { ...i, quantity: newQty } : i))
}

// The route refuses to delete an order a delivery has already been received
// against — that would orphan the delivery's orderReportId and leave the
// receiving history unable to explain what was ordered. Nothing checked that
// before.
export async function deleteWeeklyReport(reportId: string): Promise<void> {
  const res = await authedFetch('/api/admin/weekly-orders?id=' + encodeURIComponent(reportId), 'DELETE')
  await unwrap(res)
}

export async function toggleWhatsappSent(
  reportId: string,
  providerKey: string,  // providerId or '__none__'
  sent: boolean,
): Promise<void> {
  const res = await authedFetch('/api/admin/weekly-orders', 'PATCH', {
    action: 'whatsapp', reportId, providerKey, sent,
  })
  await unwrap(res)
}

export async function listWeeklyOrderLogs(limitCount = 150): Promise<WeeklyOrderLog[]> {
  const snap = await getDocs(
    query(collection(db, 'weeklyOrderLogs'), orderBy('createdAt', 'desc'), limit(limitCount))
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as WeeklyOrderLog))
}

// ---- Date helpers ----

export function getCurrentWeek(): { startStr: string; label: string } {
  const now = new Date()
  const day = now.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const label = `${fmt(monday)} – ${fmt(sunday)} ${sunday.getFullYear()}`
  const startStr = [
    monday.getFullYear(),
    String(monday.getMonth() + 1).padStart(2, '0'),
    String(monday.getDate()).padStart(2, '0'),
  ].join('-')

  return { startStr, label }
}
