// SERVER ONLY — see firebaseAdmin.ts for the import rule.
//
// Supplies and the daily count: the far end of the Phase 01 chain, where
// stock quantities actually live.
//
//   order template → weekly order → delivery → supplies.quantity ← daily count
//
// Two things here move real stock, so both belong on the server: submitting a
// count writes each counted figure onto its supply, and deleting a supply can
// silently break the link a delivery needs to move stock at all.

import { FieldValue, FieldPath } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin'
import { HttpError, type Caller } from './auth'
import { BRANCHES } from '../branches'
import { readStorageKind, canSetStorage, type StorageKind } from '../foodSafety'
import {
  readAllergenKeys, readProposedAllergens, supplyAllergenWrite, decideAllergenRequest, sameAllergens,
  type AllergenList, type AllergenWrite,
} from '../allergens'

const DATE = /^\d{4}-\d{2}-\d{2}$/

function assertBranch(caller: Caller, branch: string): void {
  if (caller.role === 'admin') return
  if (caller.branchIds.length === 0) return
  if (!caller.branchIds.includes(branch)) {
    throw new HttpError(403, 'That branch is not one of yours.')
  }
}

function count(v: unknown, label: string): number {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label} must be a non-negative number.`)
  if (n > 1_000_000) throw new HttpError(400, `${label} is implausibly large.`)
  return n
}

function zeroStock(): Record<string, number> {
  return Object.fromEntries(BRANCHES.map(b => [b, 0]))
}

// ── Supplies ──────────────────────────────────────────────────────────────

export interface SupplyInput {
  name: string
  nameAr: string | null
  category: string
  unit: string
  threshold: number
  provider: string | null
  // Whether VAT applies to this item by default. Most raw food is zero-rated
  // and chemicals and paper goods are not, so the answer belongs on the item
  // rather than being re-decided on every delivery. Receiving seeds each line
  // from it and lets the line override, because the same item can arrive taxed
  // from one supplier and untaxed from another.
  vatable: boolean
  // Recipes (Sep 2026). Stock stays counted in `unit` — what receiving and the
  // daily count already use. A recipe measures in `recipeUnit`, and
  // `recipeUnitsPerPurchaseUnit` converts: 3785.41 ml to the gallon. Null means
  // not set, and a recipe using this supply in another unit cannot be saved
  // until it is — a guessed factor is silently a thousand times wrong
  // (shared/src/recipes.ts).
  recipeUnit: string | null
  recipeUnitsPerPurchaseUnit: number | null
  /** Usable share of what is bought, above 0 and at most 100. Null means all of it. */
  yieldPercent: number | null
  /**
   * Allergen keys. null means nobody has checked this item; [] means checked
   * and contains none. The difference is the whole allergen chart: an unchecked
   * ingredient makes every dish using it "not verified" (shared/src/allergens.ts).
   */
  allergens: string[] | null
  /** Chilled or frozen asks for a temperature at goods receiving. null: not set. Managers and admins only. */
  storage: StorageKind | null
}

/** Blank clears an optional number; anything else must be a real one in range. */
function optionalNumber(raw: unknown, label: string, test: (n: number) => boolean, rule: string): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || !test(n)) throw new HttpError(400, `${label} ${rule}`)
  return n
}

export function parseSupplyInput(body: Record<string, unknown>): SupplyInput {
  const name = String(body.name ?? '').trim()
  if (!name) throw new HttpError(400, 'A name is required.')

  const threshold = Number(body.threshold ?? 1)
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new HttpError(400, 'Threshold must be a whole number of at least 1.')
  }

  const recipeFields = {
    recipeUnit: body.recipeUnit ? String(body.recipeUnit).trim().slice(0, 50) || null : null,
    recipeUnitsPerPurchaseUnit: optionalNumber(body.recipeUnitsPerPurchaseUnit, 'The recipe conversion',
      n => n > 0 && n <= 1_000_000, 'must be a number above zero.'),
    yieldPercent: optionalNumber(body.yieldPercent, 'Usable share',
      n => n > 0 && n <= 100, 'must be above 0% and at most 100%.'),
    // A form that does not send allergens leaves the item "not checked", never
    // "contains none": failing towards unverified is the only safe direction.
    allergens: Array.isArray(body.allergens) ? readAllergenKeys(body.allergens) : null,
    storage: readStorageKind(body.storage),
  }

  return {
    ...recipeFields,
    name: name.slice(0, 200),
    nameAr: body.nameAr ? String(body.nameAr).trim().slice(0, 200) : null,
    category: String(body.category ?? '').trim().slice(0, 100),
    unit: String(body.unit ?? '').trim().slice(0, 50),
    threshold,
    provider: body.provider ? String(body.provider).trim().slice(0, 200) : null,
    // Default true: the old whole-invoice VAT rate taxed every line, so an
    // item that predates this flag keeps totalling the way it always did.
    vatable: body.vatable !== false,
  }
}

/** What a save did to an item's allergens, for the activity log. */
export interface AllergenChange {
  outcome: AllergenWrite['outcome']
  before: AllergenList
  after: AllergenList
  proposed: AllergenList | undefined
}

/** A request for an allergen change, as stored. Only this file writes one. */
function allergenRequest(caller: Caller, keys: AllergenList) {
  return { keys, by: caller.uid, byEmail: caller.email ?? '', at: FieldValue.serverTimestamp() }
}

function storedAllergens(data: Record<string, unknown>): { allergens: AllergenList; proposed: AllergenList | undefined } {
  return {
    allergens: Array.isArray(data.allergens) ? readAllergenKeys(data.allergens) : null,
    proposed: readProposedAllergens(data.allergensProposed),
  }
}

/**
 * Only an admin sets allergens (owner's decision, 14 Sep 2026). Anyone else
 * with the supplies section can still create the item: its allergens stay "not
 * checked", and what they entered waits as a request.
 */
export async function createSupply(input: SupplyInput, initialQty: number, caller: Caller): Promise<{ id: string; allergens: AllergenChange }> {
  const { allergens: sent, ...rest } = input
  // Chilled or frozen decides whether receiving asks for a temperature, so
  // only a manager or admin says (owner's decision, 14 Sep 2026).
  if (rest.storage !== null && !canSetStorage(caller.role)) {
    throw new HttpError(403, 'Only a manager or admin can mark an item chilled, frozen or ambient.')
  }
  const write = supplyAllergenWrite({ allergens: null }, sent, caller.role === 'admin')
  const ref = await adminDb().collection('supplies').add({
    ...rest,
    allergens: write.allergens,
    ...(write.outcome === 'proposed' ? { allergensProposed: allergenRequest(caller, write.proposed ?? null) } : {}),
    // Every configured branch, and only those. The client's seedFromTemplates
    // hardcoded { Beirut, Zouk, Broummana } — the original café's branches —
    // so in any other deployment it created stock keys for branches that do
    // not exist and none for the branches that do.
    quantity: Object.fromEntries(BRANCHES.map(b => [b, count(initialQty, 'Quantity')])),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { id: ref.id, allergens: { outcome: write.outcome, before: null, after: write.allergens, proposed: write.proposed } }
}

export async function updateSupply(id: string, input: SupplyInput, caller: Caller): Promise<{
  allergens: AllergenChange
  storage: { before: StorageKind | null; after: StorageKind | null } | null
}> {
  const db = adminDb()
  const ref = db.doc(`supplies/${id}`)
  // A transaction, because the allergen decision reads what is stored: two
  // saves at once must not both be judged against the same stale request.
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That item no longer exists.')
    const stored = storedAllergens(snap.data() ?? {})
    const { allergens: sent, ...rest } = input
    // The form sends the stored value back unchanged, so only an actual
    // change is refused.
    const storedStorage = readStorageKind(snap.data()?.storage)
    if (rest.storage !== storedStorage && !canSetStorage(caller.role)) {
      throw new HttpError(403, 'Only a manager or admin can change whether an item is chilled, frozen or ambient.')
    }
    const write = supplyAllergenWrite(stored, sent, caller.role === 'admin')
    // `quantity` is deliberately absent: it is only ever set by a submitted
    // daily count or a received delivery. Editing an item must not become a
    // back door for adjusting stock without a count behind it.
    tx.update(ref, {
      ...rest,
      allergens: write.allergens,
      // Written only when this save makes the request, so a waiting request
      // keeps the name of whoever actually asked.
      ...(write.outcome === 'proposed' ? { allergensProposed: allergenRequest(caller, write.proposed ?? null) } : {}),
      ...(write.outcome === 'accepted' ? { allergensProposed: FieldValue.delete() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return {
      allergens: { outcome: write.outcome, before: stored.allergens, after: write.allergens, proposed: write.proposed },
      storage: rest.storage !== storedStorage ? { before: storedStorage, after: rest.storage } : null,
    }
  })
}

/**
 * An admin accepts or rejects a waiting request. `expected` is the request the
 * admin was looking at: if it has been changed since, nothing is decided,
 * because accepting a list you did not read is not accepting it.
 */
export async function decideSupplyAllergens(
  id: string, decision: 'accept' | 'reject', expected: AllergenList, caller: Caller,
): Promise<{ name: string; before: AllergenList; after: AllergenList; requestedBy: string }> {
  const db = adminDb()
  const ref = db.doc(`supplies/${id}`)
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'That item no longer exists.')
    const data = snap.data() ?? {}
    const stored = storedAllergens(data)
    const result = decideAllergenRequest(stored, decision)
    if (!result) throw new HttpError(409, 'There is no allergen change waiting on this item.')
    if (!sameAllergens(stored.proposed, expected)) {
      throw new HttpError(409, 'The requested change was edited while you were looking at it. Reload and check it again.')
    }
    tx.update(ref, {
      allergens: result.allergens,
      allergensProposed: FieldValue.delete(),
      allergensDecided: { decision, by: caller.uid, byEmail: caller.email ?? '', at: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    })
    const request = data.allergensProposed as { byEmail?: unknown } | undefined
    return {
      name: String(data.name ?? id),
      before: stored.allergens,
      after: result.allergens,
      requestedBy: typeof request?.byEmail === 'string' ? request.byEmail : '',
    }
  })
}

export async function setThreshold(id: string, threshold: number): Promise<void> {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new HttpError(400, 'Threshold must be a whole number of at least 1.')
  }
  await adminDb().doc(`supplies/${id}`).update({
    threshold,
    updatedAt: FieldValue.serverTimestamp(),
  })
}

/**
 * One branch's own level for a supply (UPGRADE.md T3.10), or null to go back
 * to the minimum every branch uses. A whole number, 0 up: 0 means this branch
 * only runs low when it runs out.
 */
export async function setPar(id: string, branch: string, par: number | null): Promise<void> {
  if (!(BRANCHES as readonly string[]).includes(branch) || branch.includes('.')) throw new HttpError(400, 'Unknown branch.')
  if (par !== null && (!Number.isInteger(par) || par < 0 || par > 1_000_000)) {
    throw new HttpError(400, 'A level must be a whole number of 0 or more.')
  }
  await adminDb().doc(`supplies/${id}`).update({
    [`par.${branch}`]: par === null ? FieldValue.delete() : par,
    updatedAt: FieldValue.serverTimestamp(),
  })
}

export async function deleteSupply(id: string): Promise<{ name: string }> {
  const db = adminDb()
  const ref = db.doc(`supplies/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpError(404, 'That item no longer exists.')

  // THE GUARD THAT DID NOT EXIST. An order template item points at a supply
  // through supplyId, and receiving a delivery moves stock through that link.
  // Deleting the supply leaves the template pointing at nothing — and a
  // delivery of that item then posts successfully while moving no stock at
  // all, with no error. scripts/link-template-supplies.mjs reports exactly
  // this state, separately from never-linked items, because it means stock
  // has been silently failing to move.
  const linked = await db.collection('orderTemplateItems')
    .where('supplyId', '==', id).limit(5).get()
  if (!linked.empty) {
    const names = linked.docs.map(d => String(d.data().name ?? d.id)).join(', ')
    throw new HttpError(409,
      `${linked.size} order template item(s) still point at this item (${names}). ` +
      `Deleting it would leave deliveries of those items moving no stock. ` +
      `Unlink or delete them in the Weekly Orders template first.`)
  }

  // The same guard for recipes (Sep 2026). A recipe pointing at a deleted
  // supply cannot be costed, and with the `recipes` switch on its sales would
  // try to take ingredients off a shelf that no longer exists.
  const inRecipes = await db.collection('recipes')
    .where('supplyIds', 'array-contains', id).limit(5).get()
  if (!inRecipes.empty) {
    const itemIds = inRecipes.docs.map(d => d.id)
    const items = await db.getAll(...itemIds.map(itemId => db.doc(`menuItems/${itemId}`)))
    const names = items.map((s, i) => String(s.data()?.name ?? itemIds[i])).join(', ')
    throw new HttpError(409,
      `${inRecipes.size} recipe(s) still use this item (${names}). ` +
      `Remove it from those recipes in Recipes & Costing first.`)
  }

  const name = String(snap.data()?.name ?? id)
  await ref.delete()
  return { name }
}

// ── Seeding supplies from the order template ──────────────────────────────

export interface SeedResult {
  created: number
  linked: number
  arabicBackfilled: number
}

/**
 * Create a supply for every template item that has none, and link them.
 *
 * The client version matched template to supply on `name.toLowerCase()` and
 * never wrote `supplyId` — which is precisely the fragile linkage Phase 01
 * exists to replace. Rename either side and the chain from ordering to stock
 * breaks with no error.
 *
 * Here the name match is only used to ADOPT an existing supply that has no
 * link yet; the durable `supplyId` is written in both cases, so this is the
 * last time a name is used to connect them.
 */
export async function seedSuppliesFromTemplates(): Promise<SeedResult> {
  const db = adminDb()
  const [templates, supplies, providers] = await Promise.all([
    db.collection('orderTemplateItems').get(),
    db.collection('supplies').get(),
    db.collection('orderProviders').get(),
  ])

  const providerName = new Map(providers.docs.map(d => [d.id, String(d.data().name ?? '')]))
  const byName = new Map(supplies.docs.map(d => [String(d.data().name ?? '').toLowerCase(), d]))

  let created = 0, linked = 0, arabicBackfilled = 0

  for (const t of templates.docs) {
    const data = t.data()
    if (data.supplyId) continue                       // already linked; nothing to do

    const existing = byName.get(String(data.name ?? '').toLowerCase())

    if (existing) {
      await t.ref.update({ supplyId: existing.id })
      linked++
      if (data.nameAr && !existing.data().nameAr) {
        await existing.ref.update({ nameAr: data.nameAr, updatedAt: FieldValue.serverTimestamp() })
        arabicBackfilled++
      }
      continue
    }

    const ref = await db.collection('supplies').add({
      name: data.name ?? '',
      nameAr: data.nameAr ?? null,
      category: data.department ?? '',
      quantity: zeroStock(),
      unit: data.unit ?? '',
      threshold: 1,
      provider: data.providerId ? (providerName.get(data.providerId) ?? null) : null,
      // Written explicitly rather than left to the read-side default, so an
      // item seeded from a template shows the same VAT state in the inventory
      // form as one created by hand.
      vatable: true,
      updatedAt: FieldValue.serverTimestamp(),
    })
    await t.ref.update({ supplyId: ref.id })
    created++
    linked++
  }

  return { created, linked, arabicBackfilled }
}

// ── The daily count ───────────────────────────────────────────────────────

export interface CountInput {
  branch: string
  date: string
  department: string
  items: { supplyId: string; countedQty: number | null }[]
  notes: string
  submit: boolean
}

export function parseCountInput(body: Record<string, unknown>): CountInput {
  const branch = String(body.branch ?? '').trim()
  if (!(BRANCHES as readonly string[]).includes(branch)) {
    throw new HttpError(400, `Unknown branch: ${branch || '(none)'}`)
  }
  const date = String(body.date ?? '').trim()
  if (!DATE.test(date)) throw new HttpError(400, 'Date must be YYYY-MM-DD.')

  const raw = Array.isArray(body.items) ? body.items : []
  return {
    branch,
    date,
    department: String(body.department ?? '').trim().slice(0, 100),
    items: raw.map((row, i) => {
      const r = (row ?? {}) as Record<string, unknown>
      const supplyId = String(r.supplyId ?? '').trim()
      if (!supplyId) throw new HttpError(400, `Line ${i + 1} is missing its item.`)
      return {
        supplyId,
        countedQty: r.countedQty == null ? null : count(r.countedQty, `Line ${i + 1} count`),
      }
    }),
    notes: String(body.notes ?? '').slice(0, 5000),
    submit: body.submit === true,
  }
}

export function inventoryDocId(branch: string, date: string, department: string): string {
  return `${branch}_${date}_${department}`
}

export async function saveCount(caller: Caller, input: CountInput): Promise<{ id: string; applied: number }> {
  assertBranch(caller, input.branch)

  const db = adminDb()
  const id = inventoryDocId(input.branch, input.date, input.department)
  const ref = db.doc(`dailyInventoryCounts/${id}`)

  // The browser names what was counted and nothing else. Everything a history
  // page shows about a line — its name, its unit, what the system expected,
  // what a unit cost — is read here from the supply, inside the same
  // transaction that overwrites the stock figure.
  //
  // It used to take the browser's two fields and REPLACE the document with
  // them, so every stored count carried only supplyId and countedQty while the
  // history pages rendered a name, a unit and a "Last Count" from fields that
  // were never saved: blank names, a difference of NaN, and every counted item
  // reported as changed. Read against the demo project on 14 Sep 2026, the one
  // stored count had exactly those two fields on all 18 of its lines.
  //
  // `previousQty` is what the system held for this branch at the moment of
  // saving — for a submission, exactly the figure the count is about to
  // overwrite. Counted minus that is the variance: usage since the last count,
  // or, with the `recipes` switch deducting ingredients on sale, what sales do
  // not explain. A transaction, so no sale can move the stock between the
  // expected figure being read and the count replacing it.
  return db.runTransaction(async tx => {
    const existing = await tx.get(ref)
    if (existing.exists && existing.data()?.status === 'submitted' && input.submit) {
      throw new HttpError(409, 'That count has already been submitted.')
    }

    const supplyIds = [...new Set(input.items.map(i => i.supplyId))]
    const supplySnaps = supplyIds.length
      ? await tx.getAll(...supplyIds.map(supplyId => db.doc(`supplies/${supplyId}`)))
      : []
    const supplies = new Map(supplySnaps.map(s => [s.id, s]))
    if (supplyIds.some(supplyId => !supplies.get(supplyId)?.exists)) {
      // Refused rather than stored without a name: a count line nobody can
      // identify later is worse than asking for a reload now.
      throw new HttpError(409, 'An item on this count no longer exists. Reload the count and try again.')
    }

    const lines = input.items.map(item => {
      const data = supplies.get(item.supplyId)?.data() ?? {}
      const rawQty = data.quantity
      const held = typeof rawQty === 'number'
        ? rawQty                                    // legacy single-number stock
        : Number((rawQty as Record<string, unknown> | undefined)?.[input.branch] ?? 0)
      const cost = Number(data.avgUnitCost)
      return {
        supplyId: item.supplyId,
        name: String(data.name ?? ''),
        ...(data.nameAr ? { nameAr: String(data.nameAr) } : {}),
        category: String(data.category ?? ''),
        unit: String(data.unit ?? ''),
        previousQty: Number.isFinite(held) ? held : 0,
        // What a unit cost when it was counted, so a variance valued next
        // month does not move with the average cost.
        unitCostUsd: Number.isFinite(cost) && cost > 0 ? cost : null,
        countedQty: item.countedQty,
      }
    })

    tx.set(ref, {
      ...input,
      items: lines,
      id,
      status: input.submit ? 'submitted' : 'draft',
      submittedBy: existing.exists ? existing.data()?.submittedBy ?? caller.uid : caller.uid,
      submittedByEmail: existing.exists ? existing.data()?.submittedByEmail ?? (caller.email ?? '') : (caller.email ?? ''),
      ...(input.submit ? { submittedAt: existing.data()?.submittedAt ?? FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    })

    let applied = 0
    if (input.submit) {
      for (const line of input.items) {
        if (line.countedQty == null) continue
        // FieldPath, not the string `quantity.${branch}`. The Admin SDK parses a
        // dotted string as a path, and `branch` arrives in a request — a value
        // containing a dot would write to a different part of the document.
        // Touching only this branch's key is what stops one branch's count
        // clobbering another's.
        tx.update(db.doc(`supplies/${line.supplyId}`),
          new FieldPath('quantity', input.branch), line.countedQty,
          'updatedAt', FieldValue.serverTimestamp())
        applied++
      }
    }

    return { id, applied }
  })
}
